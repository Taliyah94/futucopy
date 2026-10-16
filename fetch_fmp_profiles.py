#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取 all_stocks.json **市值前 N 只**（默认 100）的 FMP **行业 + 收盘价**，
与 JSON 现况核对：行业不一样就替换、空着就补上；**收盘价覆盖行内 p**（用户
2026-10-14 定稿：historyofmarket 的现价由 FMP 收盘价替换），写回 all_stocks.json。

用途
----
选股器「全部个股」= S&P 500 + Nasdaq 100 合并去重（all_stocks.json，由
fund_holdings.py 每日生成，行序 = 市值降序）。本脚本给市值前 N 只补一套
FMP（Financial Modeling Prep）的行业分类 + 最新收盘价，与 historyofmarket
的 ind / p 是两套口径，前 N 只以 FMP 为准：

    {"c": "AAPL", "n": "苹果", "ind": "Technology",
     "mc": ..., "p": 228.52, "ret": ...,
     "fmpSector": "Technology", "fmpIndustry": "Consumer Electronics"}

接口：FMP stable profile（旧 api/v3/profile 已于 2025-08-31 停用）
    GET https://financialmodelingprep.com/stable/profile?symbol=AAPL&apikey=KEY
    → [{"symbol": "AAPL", "sector": "Technology",
        "industry": "Consumer Electronics", "price": 228.52, ...}]
    一次请求同时给到 sector / industry / **price**（收盘价）→ 不额外耗额度。

范围（用户 2026-10-14 定稿：只维护市值前 100）
----
· 只抓市值前 N 只（--scope，默认 120；all_stocks.json 行序即市值降序，
  防御性再按 mc 排一次）；
· 前端「板块」热力图与「全部个股」排序都只看头部 → 前 100 覆盖足够；
· 掉出前 N 的票：缓存条目删除、all_stocks.json 行内 fmp 字段剥掉
  （fund_holdings.py 每日重生成 + attach_fmp_cache 也只会带回前 N 的数据，
  两边一致，不会春风吹又生）。**p 不还原**：这些行每天由 fund_holdings.py
  用 historyofmarket 现值重新生成，本来就是源值。

每日节奏（FMP 免费 key 250 次/天；前 100 → 约 100 次/天，留足重试余量）
----
**收盘价必须每天刷新**（--refresh-days，默认 1），行业只需月度核对
（--stale-days，默认 30）。两者来自**同一次请求**，故取更严格的那个：
    待抓 = 没抓过 + asof 早于 min(refresh-days, stale-days) 天前
→ 日常实际是**每天全量重抓前 120**（价格要新鲜；行业顺带核对，无额外成本）。
--stale-days 0 或 --refresh-days 0 = 强制全量重抓。

核对 / 替换 / 补缺（写回规则）
----
行业：抓到的 (sector, industry) 与 JSON 现况（行内 fmp 字段，缺失时回退看缓存
旧值）比对：
  · 旧值空、新值非空            → 补上（filled）；
  · 新旧都非空且不同            → 替换（changed，stderr 列新旧值名单）；
  · 相同                        → 不动（same）。
收盘价：抓到且 > 0 → **覆盖**行内 p（保留 2 位小数，与 historyofmarket 同精度）；
        抓不到（FMP 没这条 / price 缺失）→ **不动 p**（绝不写 0，见项目铁律
        「没数据就显示 --」：宁可留昨天的真价，也不造一个假的）。
写回 all_stocks.json：前 N 行用缓存（核对后的值）**替换**行内 fmp 字段 + p；
范围外的行**剥掉** fmpSector / fmpIndustry。

⚠️ 与 fund_holdings.py 的协同（每日先后顺序，别搞反）
----
· 北京 05:00 本脚本跑 → 更新缓存 fmp_profiles.json + 回写 all_stocks.json；
· 北京 23:00 fund_holdings.py 跑（cron "0 15 * * *"）→ **重新生成** all_stocks.json
  （p 回到 historyofmarket 值）后调用 attach_fmp_cache —— 该函数已同步改成
  「命中缓存就一并覆盖 p」→ 一天里任何时刻看，前 N 只的 p 都是 FMP 收盘价。
  若只改本脚本不改 attach_fmp_cache，每天 23:00 之后 FMP 价格会被冲掉、
  到次日 05:00 才回来（实测会来回横跳）。

ticker 兼容
----
FMP 不认点号 ticker（BRK.B 返回 Premium 报错）→ 自动回退 BRK-B 再试；
FMP 确实没数据的 symbol（空数组）也会入缓存（空串），避免每日重抓。

用法
----
  python3 fetch_fmp_profiles.py                    # 日常：前 100，行业 + 收盘价
  python3 fetch_fmp_profiles.py --refresh-days 0   # 强制全量重抓（默认 100 个）
  python3 fetch_fmp_profiles.py --scope 200        # 改维护范围（默认 120）
  python3 fetch_fmp_profiles.py --limit 5          # 单轮最多抓 5 个（试跑）
  python3 fetch_fmp_profiles.py --limit 0          # 不抓，只做缓存剪枝/回写
  python3 fetch_fmp_profiles.py --apikey XXXX      # 或设环境变量 FMP_API_KEY

CI：.github/workflows/fmp-profiles.yml
    · **定时** cron "0 21 * * *" = 北京 05:00（对应美东收盘后 1 小时，取到的是
      上一交易日收盘价）。注意夏令时：UTC 21:00 在夏令时为美东 17:00（收盘后
      1 小时，稳妥）；冬令时为美东 16:00 = 恰好收盘那一刻，可能偶发取到盘中价，
      真发现不对就把 cron 往后挪一小时（"0 22 * * *" = 北京 06:00）；
    · 也可手动 Run workflow。apikey 输入框**留空**即可——在仓库 Settings →
      Secrets and variables → Actions 配一次 FMP_API_KEY，workflow 优先读 Secret。
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


def _to_price(v):
    """把 FMP 的 price 字段转成 float；缺失/非数字/非正 → None（绝不返回 0）。

    ⚠️ 项目铁律「没数据就显示 --」：价格拿不到必须留 None 让上层**不改** p，
    绝不能兜一个 0 或负数进去（那是最像真的假数）。
    """
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not (f > 0) or f != f:      # 排除 0 / 负数 / NaN
        return None
    return f


def fetch_fmp_profile(symbol, apikey, retries=2, timeout=20):
    """抓单个 symbol 的 (sector, industry, price, chgPct)。

    返回：
      (s, i, px, chg) 成功（s/i 可能为空串；px 可能 None；chg = 当日涨跌幅%，
                         优先 changesPercentage，缺失时由 change/price 推算；
                         px 为 None 时 chg 也应为 None，此时**不要**动行内 p/mc）；
      ("", "", None, None) FMP 确实没这个票的数据（空数组）→ 入缓存，避免每日重抓；
      None           网络/服务端问题 → 不入缓存，次日再试。
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
                d = obj[0]
                chg = d.get("changesPercentage")
                if chg is None and d.get("change") is not None and d.get("price") is not None:
                    try:
                        chg = round(float(d["change"]) / (float(d["price"]) - float(d["change"])) * 100, 4)
                    except (TypeError, ValueError, ZeroDivisionError):
                        chg = None
                return (str(d.get("sector") or ""), str(d.get("industry") or ""),
                        _to_price(d.get("price")), chg)
            if isinstance(obj, list) and not obj:
                saw_empty = True
                break                         # 该变体无数据 → 换下一个变体，不必重试
            # 其余（超时 / 5xx / 非 JSON）→ 退避后重试同一变体
            if attempt < retries:
                time.sleep(1.5 * attempt)
    return ("", "", None, None) if saw_empty else None


def _mc_of(r):
    """行的市值；缺失/非数字当 -1（排降序时垫底）。"""
    v = (r or {}).get("mc")
    return v if isinstance(v, (int, float)) else -1


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="抓取 all_stocks.json 市值前 N 只的 FMP 行业 + 收盘价，"
                    "与 JSON 核对后替换/补缺并写回（收盘价覆盖行内 p）")
    ap.add_argument("--all-stocks", default="all_stocks.json",
                    help="全部个股 JSON 路径（默认 all_stocks.json）")
    ap.add_argument("--cache", default=None,
                    help="FMP 缓存路径（默认 <all-stocks 同目录>/fmp_profiles.json）")
    ap.add_argument("--apikey", default=None,
                    help="FMP API Key（或环境变量 FMP_API_KEY）")
    ap.add_argument("--scope", type=int, default=120,
                    help="只维护市值前 N 只（默认 100）")
    ap.add_argument("--refresh-days", type=int, default=1,
                    help="收盘价：缓存超过 N 天 → 重抓（默认 1 = 每天）")
    ap.add_argument("--stale-days", type=int, default=30,
                    help="行业：缓存 asof 超过 N 天 → 重抓核对（默认 30）。"
                         "实际取 min(refresh-days, stale-days)，因为两者同一次请求")
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
    force_all = args.stale_days <= 0 or args.refresh_days <= 0
    # 收盘价要每天新鲜（refresh-days），行业只需月度核对（stale-days）；
    # 两者来自**同一次 profile 请求** → 取更严格的那个（min），等于每天全量重抓。
    days = [d for d in (args.stale_days, args.refresh_days) if d > 0]
    cutoff = "9999-99-99" if (force_all or not days) else (
        _dt.date.today() - _dt.timedelta(days=min(days))).isoformat()
    todo, reason = [], {}
    for c in codes:
        e = cache.get(c)
        if not e:
            todo.append(c)                       # 没抓过（调仓新进 / 首次）
            reason[c] = "new"
        # ⚠️ 用 <= 不是 <：refresh-days=1（每天）时 cutoff = 昨天，
        #    asof=昨天 就该重抓；写成 < 会变成「隔一天才抓一次」（实测 off-by-one）。
        elif force_all or str(e.get("asof") or "") <= cutoff:
            todo.append(c)                       # 太旧 → 重抓（刷新收盘价 + 核对行业变类）
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
            e_old = cache.get(sym) or {}
            cache[sym] = {
                "fmpSector": res[0],
                "fmpIndustry": res[1],
                # 收盘价：本轮拿到就更新；拿不到（res[2] is None）→ **沿用缓存旧价**
                # 并把 asof 仍记为今天（避免次日把它当"缺价"反复重抓同一只）。
                # ⚠️ 若连旧价都没有 → 写 None，上层写回时**不动**行内 p（不编造）。
                "price": res[2] if res[2] is not None else e_old.get("price"),
                # 当日涨跌幅%：本轮拿到就更新，否则沿用缓存旧值 → 用于预估今日市值
                "chgPct": res[3] if res[3] is not None else e_old.get("chgPct"),
                "asof": _dt.date.today().isoformat(),
            }
            if res[2] is not None:
                stat["price"] = stat.get("price", 0) + 1
            fetched.add(sym)
            done += 1
            if done <= 3 or done % 25 == 0:
                sys.stderr.write("  [%d/%d] %s → %s / %s / %s\n"
                                 % (i, len(todo), sym, res[0] or "-", res[1] or "-",
                                    ("%.2f" % res[2]) if res[2] is not None else "无价"))
        if i < len(todo):
            time.sleep(args.sleep)

    # ④ 写回 all_stocks.json：前 N 行用缓存（核对后的值）替换行业 + **落地 fmp 对象与活动值**；
    #    范围外剥掉 fmp 字段与行业，活动值回退 HOM（保证不含前 120 以外的 stale fmp）。
    #    fmp 对象 / 活动 p、mc 由 fh.apply_fmp_to_row 统一生成（与 fund_holdings.py 同逻辑）。
    n_attached, n_price = 0, 0
    price_lines = []
    run_date = _dt.date.today().isoformat()
    hom_asof_aj = (doc.get("asof") or "") if isinstance(doc, dict) else ""
    for r in rows:
        c = str((r or {}).get("c") or "").strip().upper()
        if c in in_scope:
            e = cache.get(c)
            if e:
                # 锚定 HOM（历史行情收盘基线）：覆盖前的活动值即 HOM；缺则补（asof 用 JSON 顶层 asof）
                if not r.get("hom"):
                    r["hom"] = {"price": r.get("p"), "mc": r.get("mc"), "asof": hom_asof_aj}
                r["fmpSector"] = e.get("fmpSector") if e.get("fmpSector") is not None else None
                r["fmpIndustry"] = e.get("fmpIndustry") if e.get("fmpIndustry") is not None else None
                fh.apply_fmp_to_row(r, e, run_date)
                n_attached += 1
                px = e.get("price")
                if isinstance(px, (int, float)) and px > 0:
                    old_p = (r.get("hom") or {}).get("price")
                    new_p = round(float(px), 2)
                    if (old_p is None or old_p != new_p) and len(price_lines) < 12:
                        price_lines.append("    %s: HOM %s → FMP %.2f (Δ%s%%)"
                                           % (c, ("%.2f" % old_p) if isinstance(old_p, (int, float)) else "?",
                                              new_p, e.get("chgPct")))
                    n_price += 1
        else:
            # 范围外：剥掉 fmp 字段与行业，活动值回退 HOM（不还原也不编造）
            r.pop("fmpSector", None)
            r.pop("fmpIndustry", None)
            r.pop("fmp", None)
            hom = r.get("hom") or {}
            if hom.get("mc") is not None:
                r["mc"] = hom["mc"]
            if hom.get("price") is not None:
                r["p"] = hom["price"]
    doc["rows"] = rows
    doc["nFmp"] = n_attached
    doc["nFmpPrice"] = n_price
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
                          if cache.get(c) and str(cache[c].get("asof") or "") <= cutoff])
    sys.stderr.write("完成：新抓 %d（补缺 %d、替换 %d、未变 %d、拿到收盘价 %d），失败 %d，缓存共 %d；"
                     "已回填 all_stocks.json 行业 %d/%d 只、**落地 fmp 对象 %d 只**（范围外剥掉 fmp 字段、活动值回退 HOM）；"
                     "还剩 新进 %d + 待重核 %d，耗时 %.0fs\n"
                     % (done, stat["filled"], stat["changed"], stat["same"],
                        stat.get("price", 0), len(failed),
                        len(cache), n_attached, len(codes), n_price, left_new, left_stale,
                        time.time() - t0))
    if changed_lines:
        sys.stderr.write("行业替换名单（JSON 旧值 → FMP 新值）：\n%s\n" % "\n".join(changed_lines))
    if price_lines:
        sys.stderr.write("HOM→FMP 价格名单（仅列前 %d 条）：\n%s\n"
                         % (len(price_lines), "\n".join(price_lines)))
    if failed:
        sys.stderr.write("失败名单：%s\n" % ", ".join(failed[:50]))
    # 有待抓且一个都没成功 → 非零退出，方便 CI/手动运行看出问题
    return 1 if (todo and done == 0) else 0


if __name__ == "__main__":
    sys.exit(main())
