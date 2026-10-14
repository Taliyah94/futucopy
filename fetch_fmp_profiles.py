#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取 all_stocks.json **市值前 N 只**（默认 200）的 FMP sector / industry，
与 JSON 现况核对：不一样就替换、空着就补上，写回 all_stocks.json。

用途
----
选股器「全部个股」= S&P 500 + Nasdaq 100 合并去重（all_stocks.json，由
fund_holdings.py 每日生成，行序 = 市值降序）。本脚本给市值前 N 只补一套
FMP（Financial Modeling Prep）的行业分类，与 historyofmarket 的 ind 是两套
口径、并存不冲突：

    {"c": "AAPL", "n": "苹果", "ind": "Technology",
     "mc": ..., "p": ..., "ret": ...,
     "fmpSector": "Technology", "fmpIndustry": "Consumer Electronics"}

接口：FMP stable profile（旧 api/v3/profile 已于 2025-08-31 停用）
    GET https://financialmodelingprep.com/stable/profile?symbol=AAPL&apikey=KEY
    → [{"symbol": "AAPL", "sector": "Technology", "industry": "Consumer Electronics", ...}]

范围（用户 2026-10-14 定稿：只维护市值前 200）
----
· 只抓市值前 N 只（--scope，默认 200；all_stocks.json 行序即市值降序，
  防御性再按 mc 排一次）；
· 前端「板块」热力图只取市值前 100 分组 → 前 200 覆盖绰绰有余；
· 掉出前 N 的票：缓存条目删除、all_stocks.json 行内 fmp 字段剥掉
  （fund_holdings.py 每日重生成 + attach_fmp_cache 也只会带回前 N 的数据，
  两边一致，不会春风吹又生）。

每日节奏（FMP 免费 key 250 次/天）
----
每轮待抓 = ① 前 N 里**没抓过**的（指数调仓新进）+
          ② 抓过但 **asof 超过 --stale-days 天**的（默认 30，月度重核对——
             FMP 偶尔调整行业分类，月度频率足够，不必每日全量烧额度）。
--stale-days 0 = 强制全量重核对（本次切换范围时跑过一次，之后日常 30 天）。

核对 / 替换 / 补缺（写回规则，用户 2026-10-14 定稿）
----
抓到的 (sector, industry) 与 JSON 现况（行内 fmp 字段，缺失时回退看缓存
旧值）比对：
  · 旧值空、新值非空            → 补上（filled）；
  · 新旧都非空且不同            → 替换（changed，stderr 列新旧值名单）；
  · 相同                        → 不动（same）。
写回 all_stocks.json：前 N 行用缓存（核对后的值）**替换**行内 fmp 字段；
范围外的行**剥掉** fmpSector / fmpIndustry（只维护前 N，旧的清掉）。
fund_holdings.py 每日重生成会冲掉行内字段，故每次全量回填（双保险）。

ticker 兼容
----
FMP 不认点号 ticker（BRK.B 返回 Premium 报错）→ 自动回退 BRK-B 再试；
FMP 确实没数据的 symbol（空数组）也会入缓存（空串），避免每日重抓。

用法
----
  python3 fetch_fmp_profiles.py                    # 日常：补新 + 核对超 30 天的
  python3 fetch_fmp_profiles.py --stale-days 0     # 强制全量重核对（默认 200 个）
  python3 fetch_fmp_profiles.py --scope 100        # 改维护范围（默认 200）
  python3 fetch_fmp_profiles.py --limit 5          # 单轮最多抓 5 个（试跑）
  python3 fetch_fmp_profiles.py --limit 0          # 不抓，只做缓存剪枝/回写
  python3 fetch_fmp_profiles.py --apikey XXXX      # 或设环境变量 FMP_API_KEY

CI：手动 workflow .github/workflows/fmp-profiles.yml（workflow_dispatch）。
    apikey 输入框**留空**即可——在仓库 Settings → Secrets and variables →
    Actions 配一次 FMP_API_KEY，workflow 优先读 Secret。
"""

import argparse
import datetime as _dt
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fund_holdings as fh   # 复用 dump_all_stocks / load_fmp_cache，保证格式一致

FMP_PROFILE_URL = "https://financialmodelingprep.com/stable/profile"


class FmpFatal(Exception):
    """额度用尽 / key 无效等「重试无意义」的错误 → 熔断整轮，不再逐 symbol 重试。"""


def _http_get(url, timeout=20):
    """GET 返回 (http_code, body)；curl 优先、urllib 兜底（同 fund_holdings 的理由：
    部分 Windows 环境有 HTTPS 中间人代理，urllib 校验证书失败而 curl 能过）。"""
    try:
        r = subprocess.run(
            ["curl", "-sS", "--max-time", str(timeout), "-w", "\n%{http_code}", url],
            capture_output=True, timeout=timeout + 5)
        if r.returncode == 0 and r.stdout.strip():
            out = r.stdout.decode("utf-8", "ignore")
            body, _, code = out.rpartition("\n")
            return (int(code) if code.isdigit() else 0), body
    except Exception:  # noqa: BLE001 - curl 不可用/超时 → urllib 兜底
        pass
    try:
        req = urllib.request.Request(url, headers={"User-Agent": fh.USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        try:
            return e.code, e.read().decode("utf-8", "ignore")
        except Exception:  # noqa: BLE001
            return e.code, ""
    except Exception:  # noqa: BLE001 - 网络层失败
        return 0, ""


def _is_fatal(code, txt):
    """额度用尽 / key 无效 / 未授权 → True（重试和换 ticker 都没用，直接熔断）。"""
    if code in (401, 403, 429):
        return True
    low = (txt or "").lower()
    return any(k in low for k in (
        "limit reach", "limit reached", "exceeded your", "daily limit",
        "invalid api", "unauthorized", "forbidden"))


def fetch_fmp_profile(symbol, apikey, retries=2, timeout=20):
    """抓单个 symbol 的 (sector, industry)。

    返回：
      (s, i)  成功（s/i 可能为空串 —— FMP 有这条记录但没填行业）；
      ("", "") FMP 确实没这个票的数据（空数组）→ 入缓存，避免每日重抓；
      None     网络/服务端问题 → 不入缓存，次日再试。
    抛出 FmpFatal：额度/key 问题，调用方应熔断整轮。
    """
    variants = [symbol]
    if "." in symbol:                      # BRK.B → BRK-B（FMP 不认点号）
        variants.append(symbol.replace(".", "-"))
    saw_empty = False
    for sym in variants:
        for attempt in range(1, retries + 1):
            url = "%s?symbol=%s&apikey=%s" % (
                FMP_PROFILE_URL, urllib.parse.quote(sym), urllib.parse.quote(apikey))
            code, txt = _http_get(url, timeout=timeout)
            if _is_fatal(code, txt):
                raise FmpFatal((txt or "http %d" % code).strip()[:200])
            obj = None
            try:
                obj = json.loads(txt)
            except Exception:  # noqa: BLE001 - 非 JSON（如 Premium 纯文本报错）
                obj = None
            if isinstance(obj, list) and obj and isinstance(obj[0], dict):
                return (str(obj[0].get("sector") or ""), str(obj[0].get("industry") or ""))
            if isinstance(obj, list) and not obj:
                saw_empty = True
                break                         # 该变体无数据 → 换下一个变体，不必重试
            # 其余（超时 / 5xx / 非 JSON）→ 退避后重试同一变体
            if attempt < retries:
                time.sleep(1.5 * attempt)
    return ("", "") if saw_empty else None


def _mc_of(r):
    """行的市值；缺失/非数字当 -1（排降序时垫底）。"""
    v = (r or {}).get("mc")
    return v if isinstance(v, (int, float)) else -1


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="抓取 all_stocks.json 市值前 N 只的 FMP sector/industry，"
                    "与 JSON 核对后替换/补缺并写回")
    ap.add_argument("--all-stocks", default="all_stocks.json",
                    help="全部个股 JSON 路径（默认 all_stocks.json）")
    ap.add_argument("--cache", default=None,
                    help="FMP 缓存路径（默认 <all-stocks 同目录>/fmp_profiles.json）")
    ap.add_argument("--apikey", default=None,
                    help="FMP API Key（或环境变量 FMP_API_KEY）")
    ap.add_argument("--scope", type=int, default=200,
                    help="只维护市值前 N 只（默认 200）")
    ap.add_argument("--stale-days", type=int, default=30,
                    help="缓存 asof 超过 N 天 → 重抓核对（默认 30；0=强制全量重核对）")
    ap.add_argument("--limit", type=int, default=200,
                    help="单轮最多抓取个数（默认 200；FMP 免费额度 250/天）")
    ap.add_argument("--sleep", type=float, default=0.35,
                    help="每次请求间隔秒数（默认 0.35）")
    ap.add_argument("--retries", type=int, default=2,
                    help="单 symbol 失败重试次数（默认 2）")
    ap.add_argument("--no-write", action="store_true",
                    help="只抓不写文件（调试用）")
    args = ap.parse_args(argv)

    apikey = args.apikey or os.environ.get("FMP_API_KEY") or ""

    here = os.path.dirname(os.path.abspath(args.all_stocks)) or "."
    cache_path = args.cache or os.path.join(here, fh.FMP_CACHE_FILE)

    # ① 读个股名单 → 市值前 N（防御性按 mc 降序；行序本就是市值降序）
    try:
        with open(args.all_stocks, encoding="utf-8") as f:
            doc = json.load(f)
    except Exception as e:  # noqa: BLE001
        sys.stderr.write("错误：读取 %s 失败：%s\n" % (args.all_stocks, e))
        return 2
    rows = doc.get("rows") if isinstance(doc, dict) else None
    if not isinstance(rows, list) or not rows:
        sys.stderr.write("错误：%s 里没有 rows（先跑 fund_holdings.py 生成）\n" % args.all_stocks)
        return 2
    rows = sorted(rows, key=_mc_of, reverse=True)
    scope_rows = rows[:args.scope] if args.scope > 0 else rows
    codes, seen = [], set()
    for r in scope_rows:
        c = str((r or {}).get("c") or "").strip().upper()
        if c and c not in seen:
            seen.add(c)
            codes.append(c)
    in_scope = seen

    # JSON 现况快照（核对基准：行内 fmp 字段；缺失时回退看缓存旧值）
    cur_row = {}
    for r in rows:
        c = str((r or {}).get("c") or "").strip().upper()
        if c and c not in cur_row:
            cur_row[c] = (r.get("fmpSector") or "", r.get("fmpIndustry") or "")

    # ② 读缓存 → 删掉不在维护范围里的（掉出前 N / 旧范围残留）→ 算待抓
    cache = fh.load_fmp_cache(cache_path)
    n_before = len(cache)
    cache = {k: v for k, v in cache.items() if k in in_scope}
    n_pruned = n_before - len(cache)
    force_all = args.stale_days <= 0
    cutoff = "9999-99-99" if force_all else (
        _dt.date.today() - _dt.timedelta(days=args.stale_days)).isoformat()
    todo, reason = [], {}
    for c in codes:
        e = cache.get(c)
        if not e:
            todo.append(c)                       # 没抓过（调仓新进 / 首次）
            reason[c] = "new"
        elif force_all or str(e.get("asof") or "") < cutoff:
            todo.append(c)                       # 太旧 → 重抓核对行业变类
            reason[c] = "stale"
    if args.limit >= 0:
        todo = todo[:args.limit]

    if todo and not apikey:
        sys.stderr.write("错误：有 %d 只待抓但未提供 FMP API Key（--apikey 或环境变量 FMP_API_KEY）\n"
                         % len(todo))
        return 2

    n_new = sum(1 for c in todo if reason[c] == "new")
    n_stale = len(todo) - n_new
    todo_desc = ("强制全量重核对 %d" % n_stale) if force_all else (
        "新进 %d + 超 %d 天重核对 %d" % (n_new, args.stale_days, n_stale))
    sys.stderr.write("维护范围：市值前 %d 只（共 %d 行）；已抓 %d，范围外删除 %d，"
                     "本次待抓 %d（%s，上限 %d）\n"
                     % (len(codes), len(rows), len(cache), n_pruned, len(todo),
                        todo_desc, args.limit))

    # ③ 按市值顺序从上往下抓；抓到就与 JSON 现况比对（补缺/替换/未变）
    done, failed, fetched = 0, [], set()
    stat = {"filled": 0, "changed": 0, "same": 0}
    changed_lines = []
    t0 = time.time()
    for i, sym in enumerate(todo, 1):
        try:
            res = fetch_fmp_profile(sym, apikey, retries=args.retries)
        except FmpFatal as e:
            sys.stderr.write("  [熔断] %s\n" % e)
            sys.stderr.write("  （额度用尽或 key 无效，剩余 %d 个明日再试）\n" % (len(todo) - i + 1))
            break
        if res is None:
            failed.append(sym)
            sys.stderr.write("  [失败] %s（网络/服务端，次日重试）\n" % sym)
        else:
            old_s, old_i = cur_row.get(sym, ("", ""))
            if not old_i:
                old_s = old_s or (cache.get(sym) or {}).get("fmpSector") or ""
                old_i = old_i or (cache.get(sym) or {}).get("fmpIndustry") or ""
            if not old_i and res[1]:
                stat["filled"] += 1
                sys.stderr.write("  [补缺] %s → %s\n" % (sym, res[1]))
            elif old_i and (old_s, old_i) != res:
                stat["changed"] += 1
                changed_lines.append("    %s: %s / %s  →  %s / %s"
                                     % (sym, old_s or "-", old_i, res[0] or "-", res[1] or "-"))
                sys.stderr.write("  [替换] %s: %s → %s\n" % (sym, old_i, res[1] or "-"))
            elif old_i:
                stat["same"] += 1
            cache[sym] = {
                "fmpSector": res[0],
                "fmpIndustry": res[1],
                "asof": _dt.date.today().isoformat(),
            }
            fetched.add(sym)
            done += 1
            if done <= 3 or done % 25 == 0:
                sys.stderr.write("  [%d/%d] %s → %s / %s\n"
                                 % (i, len(todo), sym, res[0] or "-", res[1] or "-"))
        if i < len(todo):
            time.sleep(args.sleep)

    # ④ 写回 all_stocks.json：前 N 行用缓存（核对后的值）替换；范围外剥掉 fmp 字段
    n_attached = 0
    for r in rows:
        c = str((r or {}).get("c") or "").strip().upper()
        if c in in_scope:
            e = cache.get(c)
            if e:
                r["fmpSector"] = e.get("fmpSector") if e.get("fmpSector") is not None else None
                r["fmpIndustry"] = e.get("fmpIndustry") if e.get("fmpIndustry") is not None else None
                n_attached += 1
        else:
            r.pop("fmpSector", None)
            r.pop("fmpIndustry", None)
    doc["rows"] = rows
    doc["nFmp"] = n_attached
    if not args.no_write:
        try:
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(cache, f, ensure_ascii=False, indent=2, sort_keys=True)
            with open(args.all_stocks, "w", encoding="utf-8") as f:
                f.write(fh.dump_all_stocks(doc))
        except Exception as e:  # noqa: BLE001
            sys.stderr.write("写文件失败：%s\n" % e)
            return 1

    left_new = len([c for c in codes if c not in cache])
    if force_all:
        # 强制全量模式：「还剩」= 本轮没重核到的（明日/下次继续）
        left_stale = len([c for c in codes if c in cache and c not in fetched])
    else:
        left_stale = len([c for c in codes
                          if cache.get(c) and str(cache[c].get("asof") or "") < cutoff])
    sys.stderr.write("完成：新抓 %d（补缺 %d、替换 %d、未变 %d），失败 %d，缓存共 %d；"
                     "已回填 all_stocks.json %d/%d 只（范围外剥掉旧 fmp 字段）；"
                     "还剩 新进 %d + 待重核 %d，耗时 %.0fs\n"
                     % (done, stat["filled"], stat["changed"], stat["same"], len(failed),
                        len(cache), n_attached, len(codes), left_new, left_stale,
                        time.time() - t0))
    if changed_lines:
        sys.stderr.write("替换名单（JSON 旧值 → FMP 新值）：\n%s\n" % "\n".join(changed_lines))
    if failed:
        sys.stderr.write("失败名单：%s\n" % ", ".join(failed[:50]))
    # 有待抓且一个都没成功 → 非零退出，方便 CI/手动运行看出问题
    return 1 if (todo and done == 0) else 0


if __name__ == "__main__":
    sys.exit(main())
