#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取 all_stocks.json 全部个股的 FMP sector / industry，写回 all_stocks.json

用途
----
选股器「全部个股」= S&P 500 + Nasdaq 100 合并去重（all_stocks.json，由
fund_holdings.py 每日生成）。本脚本给每只票补一套 FMP（Financial Modeling
Prep）的行业分类，与 historyofmarket 的 ind 是两套口径、并存不冲突：

    {"c": "AAPL", "n": "苹果", "ind": "Technology",
     "mc": ..., "p": ..., "ret": ...,
     "fmpSector": "Technology", "fmpIndustry": "Consumer Electronics"}

接口：FMP stable profile（旧 api/v3/profile 已于 2025-08-31 停用）
    GET https://financialmodelingprep.com/stable/profile?symbol=AAPL&apikey=KEY
    → [{"symbol": "AAPL", "sector": "Technology", "industry": "Consumer Electronics", ...}]

限额与节奏（用户 2026-10-12 定稿）
----
FMP 免费 key 一天 250 次 → 单次运行**默认最多抓 200 个**（--limit 可改），
留余量。518 只约 3 个工作日抓全；之后每日只补指数调仓新增的 ticker。

去重 / 删除规则（每次运行都做）
----
缓存文件 fmp_profiles.json（symbol → {fmpSector, fmpIndustry, asof}）：
  ① 缓存里**不在** all_stocks.json 个股名单里的 symbol → 删除（调仓掉出
     SP500 / Nasdaq100 的，避免缓存无限膨胀）；
  ② 已在缓存里的 symbol → 本次不抓；
  ③ 其余（没抓过的）按 all_stocks.json 行序（市值降序）**从上往下**抓，
     抓满 --limit 为止；
  ④ 跑完把**全量缓存**合并写回 all_stocks.json —— fund_holdings.py 每日
     重生成 all_stocks.json 会冲掉行内字段，故每次全量回填（该脚本侧也已
     同步合并，双保险）。

ticker 兼容
----
FMP 不认点号 ticker（BRK.B 返回 Premium 报错）→ 自动回退 BRK-B 再试；
FMP 确实没数据的 symbol（空数组）也会入缓存（空串），避免每日重抓。

用法
----
  python3 fetch_fmp_profiles.py                  # 默认抓 200 个
  python3 fetch_fmp_profiles.py --limit 5        # 只抓 5 个（试跑）
  python3 fetch_fmp_profiles.py --limit 0        # 不抓，只做缓存合并/回写
  python3 fetch_fmp_profiles.py --apikey XXXX    # 或设环境变量 FMP_API_KEY

CI：手动 workflow .github/workflows/fmp-profiles.yml（workflow_dispatch）。
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
import fund_holdings as fh   # 复用 dump_all_stocks / load_fmp_cache / attach_fmp_cache，保证格式一致

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


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="抓取 all_stocks.json 全部个股的 FMP sector/industry 并写回")
    ap.add_argument("--all-stocks", default="all_stocks.json",
                    help="全部个股 JSON 路径（默认 all_stocks.json）")
    ap.add_argument("--cache", default=None,
                    help="FMP 缓存路径（默认 <all-stocks 同目录>/fmp_profiles.json）")
    ap.add_argument("--apikey", default=None,
                    help="FMP API Key（或环境变量 FMP_API_KEY）")
    ap.add_argument("--limit", type=int, default=200,
                    help="单次最多抓取个数（默认 200；FMP 免费额度 250/天）")
    ap.add_argument("--sleep", type=float, default=0.35,
                    help="每次请求间隔秒数（默认 0.35，200 个约 70s+请求耗时）")
    ap.add_argument("--retries", type=int, default=2,
                    help="单 symbol 失败重试次数（默认 2）")
    ap.add_argument("--no-write", action="store_true",
                    help="只抓不写文件（调试用）")
    args = ap.parse_args(argv)

    apikey = args.apikey or os.environ.get("FMP_API_KEY") or ""

    here = os.path.dirname(os.path.abspath(args.all_stocks)) or "."
    cache_path = args.cache or os.path.join(here, fh.FMP_CACHE_FILE)

    # ① 读个股名单（保持 all_stocks.json 行序 = 市值降序）
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
    codes, seen = [], set()
    for r in rows:
        c = str((r or {}).get("c") or "").strip().upper()
        if c and c not in seen:
            seen.add(c)
            codes.append(c)

    # ② 读缓存 → 删掉不在个股名单里的（调仓掉出的）→ 已在缓存的不抓
    cache = fh.load_fmp_cache(cache_path)
    n_before = len(cache)
    cache = {k: v for k, v in cache.items() if k in seen}
    n_pruned = n_before - len(cache)
    todo = [c for c in codes if c not in cache]
    if args.limit >= 0:
        todo = todo[:args.limit]

    if todo and not apikey:
        sys.stderr.write("错误：有 %d 只待抓但未提供 FMP API Key（--apikey 或环境变量 FMP_API_KEY）\n"
                         % len(todo))
        return 2

    sys.stderr.write("个股 %d 只；已抓 %d，掉出删除 %d，本次待抓 %d（上限 %d）\n"
                     % (len(codes), len(cache), n_pruned, len(todo), args.limit))

    # ③ 按个股顺序从上往下抓
    done, failed = 0, []
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
            cache[sym] = {
                "fmpSector": res[0],
                "fmpIndustry": res[1],
                "asof": _dt.date.today().isoformat(),
            }
            done += 1
            if done <= 3 or done % 25 == 0:
                sys.stderr.write("  [%d/%d] %s → %s / %s\n"
                                 % (i, len(todo), sym, res[0] or "-", res[1] or "-"))
        if i < len(todo):
            time.sleep(args.sleep)

    # ④ 全量缓存合并写回 all_stocks.json（含往日已抓的，防每日重生成冲掉）
    n_attached = fh.attach_fmp_cache(rows, cache)
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

    left = len([c for c in codes if c not in cache])
    sys.stderr.write("完成：新抓 %d，失败 %d，缓存共 %d；已回填 all_stocks.json %d/%d 只"
                     "（还剩 %d 只待抓，耗时 %.0fs）\n"
                     % (done, len(failed), len(cache), n_attached, len(codes),
                        left, time.time() - t0))
    if failed:
        sys.stderr.write("失败名单：%s\n" % ", ".join(failed[:50]))
    # 有待抓且一个都没成功 → 非零退出，方便 CI/手动运行看出问题
    return 1 if (todo and done == 0) else 0


if __name__ == "__main__":
    sys.exit(main())
