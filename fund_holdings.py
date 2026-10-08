#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取基金季报十大持仓 -> 输出 fund_holdings.json

用途
----
本脚本从东方财富 fundf10 接口抓取各只基金的「季度报告 · 十大重仓股」
（topline=10，即前十大；半年报虽有更全明细但不取，见下），
整理成资产看板（index.html）可导入的 JSON 结构：

    {
      "000043": {
        "report": "2026-06-30",
        "items": [{"c": "AAPL", "n": "苹果", "p": 8.29, "m": "us"}, ...],
        "nav": [[时间戳(ms), 单位净值], ...],   // 净值历史（紧凑二维数组，升序）；proxy 类基金无此字段
        "alloc": {"stock": 91.66, "bond": 0.0, "cash": 5.88}  // 资产配置(占净比%)：股票/债券/现金，供盘中估值未知块近似
      },
      "016532": {"report": "跟踪纳斯达克100", "proxy": true, "items": [...]},

      // 非美股（港/A/日/韩）行情快照：每天存一次，看板按目标日取收盘价与当日涨跌
      "_daily_quotes": {
        "kr005930": [{"date": "20260904", "close": 255500, "prevClose": 250000,
                      "ts": "2026-09-04 14:30:05"}, ...],   // 升序，最多 5 条
        "hk02513":  [{"date": "20260904", "close": 1075, "prevClose": 1108,
                      "ts": "2026/09/04 16:08:05"}, ...]
      },

      // QQQ 日线历史（曲线图「QQQ 涨跌幅(基准)」对比线用）：每天增量追加新交易日，
      // 已有历史以存盘数据为准（防源端截断/换源抹史），仅最后一天会被新抓取刷新
      "qqq_daily": [{"d": "2026-02-06", "c": 518.20}, ...]    // 升序，{d:日期, c:收盘价}
    }

字段含义
  report : 季报日期，格式 YYYY-MM-30（季末）；代理基金为文字说明
  items  : 十大持仓列表（按占净值比例降序，固定前 10 条）
           c = 证券代码, n = 名称, p = 占净值比例(%), m = 市场(us/hk/sh/sz/jp/kr)
           注：半年报会披露 20-30 条完整明细（含 ISIN 全码），本脚本刻意不取；
           market_of 仍保留 ISIN 识别，以备个别前十大里出现这类代码
  proxy  : true 表示用代理（如纳斯达克100ETF联接用 QQQ 代理，不抓东方财富）

_daily_quotes（顶层，非基金键，前端按基金代码遍历时会被自然忽略）
  看板原本靠东方财富 push2his 取港/A/日/韩的历史日K，但该接口对日股(176.)/韩股(177.)
  恒返回空，且每次打开页面都要现抓一遍（慢、且受跨域与限流影响）。
  改为每天用腾讯 qt.gtimg.cn 存一次「现价/昨收/行情时间」，攒出近 5 个交易日的序列，
  看板直接按目标日取 close 当基准、close/prevClose-1 当当日涨跌，无需再请求东方财富。
  同日期覆盖，抓取失败保留旧值。

用法
----
  # 默认输出 fund_holdings.json（基金列表见下方 DEFAULT_CODES）
  python3 fund_holdings.py

  # 指定输出文件
  python3 fund_holdings.py -o holdings.json

  # 用配置文件覆盖基金列表（配置文件形如 {"codes": ["000043", ...], "proxy": {"016532": true}}）
  python3 fund_holdings.py -c fund_codes.json

  # 命令行直接指定要抓的基金（逗号分隔，覆盖默认）
  python3 fund_holdings.py --codes 000043,270023

  # CI 中只想看结果、不写文件
  python3 fund_holdings.py --quiet --no-write

说明
----
  - 接口来自东方财富 fundf10，仅用于个人资产记录，请遵守其 robots / 频率限制。
  - 浏览器端直连该接口会被跨域拦截，因此改为「脚本/CI 抓取 -> 提交 JSON -> 看板导入」。
  - 本脚本只负责「抓取并产出 JSON」，不负责提交；提交由 GitHub Actions 完成。
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import datetime as _dt
import urllib.request
from html.parser import HTMLParser

# ---------------------------------------------------------------------------
# 腾讯行情时间戳 → 美东交易日(YYYYMMDD)
# 腾讯时间戳为「北京时间」；而前端预测层目标日以「美东」为准，快照日期必须与之
# 对齐，否则会出现「北京 09-08 抓的数据其实是美东 09-07，却被当成未来跳过」的错位。
# 故此处把北京时间戳换算成美东日期后再写入快照。
# ---------------------------------------------------------------------------
try:
    from zoneinfo import ZoneInfo as _ZI
    _TZ_BJ = _ZI("Asia/Shanghai")
    _TZ_ET = _ZI("America/New_York")
    def _et_trade_date(ts_raw, fallback):
        s = re.sub(r"\D", "", ts_raw or "")
        if len(s) < 14:
            return fallback
        try:
            bj = _dt.datetime.strptime(s[:14], "%Y%m%d%H%M%S").replace(tzinfo=_TZ_BJ)
            return bj.astimezone(_TZ_ET).strftime("%Y%m%d")
        except Exception:
            return fallback
except Exception:  # 无 IANA 时区库（如 Windows 缺 tzdata）时手动换算
    def _us_dst(y, m, d):
        # 美东夏令时：3 月第 2 个周日起，到 11 月第 1 个周日止
        if m < 3 or m > 11:
            return False
        if 3 < m < 11:
            return True
        if m == 3:
            wd = _dt.date(y, 3, 1).weekday()
            second_sun = 1 + (6 - wd) % 7 + 7
            return d >= second_sun
        wd = _dt.date(y, 11, 1).weekday()
        first_sun = 1 + (6 - wd) % 7
        return d < first_sun
    def _et_trade_date(ts_raw, fallback):
        s = re.sub(r"\D", "", ts_raw or "")
        if len(s) < 14:
            return fallback
        try:
            bj = _dt.datetime.strptime(s[:14], "%Y%m%d%H%M%S")
        except Exception:
            return fallback
        # 北京 UTC+8；美东夏令时(EDT, UTC-4)差 12h，冬令时(EST, UTC-5)差 13h
        diff = 13 if _us_dst(bj.year, bj.month, bj.day) else 12
        et = bj - _dt.timedelta(hours=diff)
        return et.strftime("%Y%m%d")

# ---------------------------------------------------------------------------
# 默认基金列表（与 index.html 的 FUND_HOLDINGS 对齐）
# ---------------------------------------------------------------------------
DEFAULT_CODES = ["000043", "270023", "021277", "016532", "016533","539002"]

# 走代理的基金：东方财富无有效季报，用 QQQ 代理，保持不动
DEFAULT_PROXY = {"016532": True, "016533": True}

QQQ_PROXY = {
    "report": "跟踪纳斯达克100",
    "proxy": True,
    "items": [{"c": "QQQ", "m": "us", "n": "纳斯达克100ETF", "p": 100}],
}

# 基金资产配置（股/债/现金占净比 %）：用于「未知持仓块」用 QQQ 涨跌近似的盘中估值。
# 代理基金(跟踪纳斯达克100)视为 100% 权益，硬编码。
PROXY_ALLOC = {"stock": 100.0, "bond": 0.0, "cash": 0.0}
# Data_assetAllocation 的 series.name -> 输出键
ALLOC_NAMES = {"股票占净比": "stock", "债券占净比": "bond", "现金占净比": "cash"}

USER_AGENT = "Mozilla/5.0"
REFERER = "https://fundf10.eastmoney.com/"
BASE_URL = "https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=%s&topline=10"


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------
# 东方财富行情链接里的市场前缀（//quote.eastmoney.com/unify/r/<前缀>.<代码>）。
# 这是最可靠的市场线索：A股/港股/美股都会被东财收录并带链接；
# 日股/韩股东财【未收录】（无链接、data-texch 为空），只能靠代码格式或名称推断。
EM_MARKET_MAP = {
    "105": "us",   # 纳斯达克（NVDA / MU / AVGO ...）
    "106": "us",   # 纽交所（TSM / LLY / GLW ...）
    "116": "hk",   # 港股（02513 智谱 ...）
    "0": "sz",     # 深圳（300408 三环集团 ...）
    "1": "sh",     # 上海（600519 贵州茅台 ...）
}

# 东财未收录时的兜底名单（韩国6位代码与A股6位代码格式完全相同，无法从格式区分）
# 日股 285A（铠侠）已由「4位数字+字母」的格式规则命中，无需列在此处；
# 4004（Resonac）是纯 4 位数字、格式规则认不出来，才需要名单兜底。
KNOWN_JP_CODES = {"4004"}          # Resonac（东京证交所）
KNOWN_KR_CODES = {"000660", "005930"}  # SK海力士 / 三星电子（韩国交易所）
JP_NAME_KEYS = ("kioxia", "铠侠")
KR_NAME_KEYS = ("海力士", "三星", "sk hynix", "samsung")

# 未收录且名单未命中时，是否用腾讯行情接口反查市场（可识别新增日韩股，需联网）
ENABLE_QT_PROBE = True

# ---------------------------------------------------------------------------
# 非美股（港/A/日/韩）行情快照
# ---------------------------------------------------------------------------
# 东方财富 push2his 对日股(176.) / 韩股(177.) 恒返回空 data，取不到历史日K；
# 港股/A股虽然能取到，但每次打开页面都要现抓一遍，慢且依赖跨域接口。
# 腾讯 qt.gtimg.cn 能给出「现价 / 昨收 / 行情时间」但没有历史K。
# 因此每天跑一次，把当天快照存进 JSON，攒出近 N 个交易日的序列供看板按目标日取值。
# 美股不在此列：盘前/盘后与 Bybit 实时价另有一套逻辑，继续走腾讯实时。
SNAPSHOT_MARKETS = ("hk", "sz", "sh", "jp", "kr")
SNAPSHOT_DAYS = 5                # 每个代码保留最近几个交易日
SNAPSHOT_KEY = "_daily_quotes"   # 顶层键名（非 6 位基金代码，前端遍历时会被忽略）
QT_BATCH = 20                    # 腾讯行情单次批量查询的代码数


def probe_market(code, timeout=6):
    """用腾讯行情反查代码所属市场：依次试 kr/hk/sh/sz，返回首个有行情的市场。

    看板最终就是用 qt.gtimg.cn 读这些代码，所以以它为准最可靠；失败返回 None。
    只对 6 位数字代码调用（韩股与 A 股格式完全相同、无法从格式区分的场景），
    日股代码是「4位数字+字母」，不会走到这里，故不试 jp 前缀。
    """
    for mk in ("kr", "hk", "sh", "sz"):
        try:
            req = urllib.request.Request(
                "https://qt.gtimg.cn/q=%s%s" % (mk, code),
                headers={"User-Agent": USER_AGENT},
            )
            txt = urllib.request.urlopen(req, timeout=timeout).read().decode("gbk", "ignore")
            if ('v_%s%s="' % (mk, code)) in txt and "pv_none_match" not in txt:
                return mk
        except Exception:  # noqa: BLE001 - 探测失败即换下一个市场
            continue
    return None


def market_of(code, name="", em_prefix=None):
    """判断证券市场，返回 us/hk/sh/sz/jp/kr。

    判定优先级：
      1. 东财行情链接前缀（最可靠，A股/港股/美股均被收录）
      2. 日股/韩股代码格式与已知名单（东财未收录的场景）
      3. 腾讯行情反查（解决韩国6位代码与A股6位代码格式冲突）
      4. 纯代码格式兜底（完全没有东财线索时的旧逻辑）
    """
    code = (code or "").strip()
    nm = (name or "").lower()

    # 1) 东财行情链接前缀
    if em_prefix and str(em_prefix) in EM_MARKET_MAP:
        return EM_MARKET_MAP[str(em_prefix)]

    # 2) 东财未收录：多为日股/韩股。日股代码形如 285A（4位数字+字母）
    if re.match(r"^\d{4}[A-Za-z]$", code):
        return "jp"
    if code in KNOWN_JP_CODES or any(k in nm for k in JP_NAME_KEYS):
        return "jp"
    if code in KNOWN_KR_CODES or any(k in nm for k in KR_NAME_KEYS):
        return "kr"

    # 2.5) ISIN 全码（topline>10 的半年报明细里部分日韩股只给 ISIN，
    #      如 JP3914400001 村田制作所 / KR7009150004 三星电机）
    #      台股 ISIN(TW...) 不再转 tw：腾讯无台股行情、看板也没有 tw 分支，
    #      标注出来只会落到未知市场画杠，与其如此不如归 us 由上游名单兜底。
    m_isin = re.match(r"^([A-Z]{2})[A-Z0-9]{9}\d$", code)
    if m_isin:
        return {"JP": "jp", "KR": "kr"}.get(m_isin.group(1), "us")

    # 3) 6位数字：韩股与A股格式完全相同，用腾讯行情反查（失败则回落第 4 步）
    if ENABLE_QT_PROBE and re.match(r"^\d{6}$", code):
        probed = probe_market(code)
        if probed:
            return probed

    # 4) 纯代码格式兜底（注意：4位数字+字母已在第 2 步判为日股，这里不会再遇到）
    if re.match(r"^[A-Za-z]+$", code):
        return "us"
    if re.match(r"^\d{5}$", code):
        return "hk"
    if re.match(r"^\d{6}$", code):
        return "sh" if code[:2] in ("60", "68", "90") else "sz"
    return "us"


def fetch_content(code, retries=3, timeout=30):
    """抓取单只基金的季报 HTML 片段，返回 (content, report)。失败返回 (None, None)。"""
    url = BASE_URL % code
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": USER_AGENT, "Referer": REFERER}
            )
            raw = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore")
            m = re.search(r'content:"(.*?)"\s*,', raw, re.S)
            if not m:
                return None, None
            content = (
                m.group(1)
                .replace('\\"', '"')
                .replace("\\'", "'")
                .replace("\\n", "")
                .replace("\\t", "")
            )
            rep = re.search(r"(\d{4})年(\d)季度", raw)
            report = "%s-%02d-30" % (rep.group(1), int(rep.group(2)) * 3) if rep else ""
            return content, report
        except Exception as e:  # noqa: BLE001 - 网络异常统一重试
            last_err = e
            if attempt < retries:
                time.sleep(2 * attempt)  # 简单退避
    sys.stderr.write("  [异常] %s: %s\n" % (code, last_err))
    return None, None


def parse_asset_allocation(raw):
    """从 pingzhongdata/{code}.js 的 Data_assetAllocation 解析最新一期 股票/债券/现金 占净比(%)。

    结构：Data_assetAllocation = {"series":[{"name":"股票占净比","data":[...]}, ...], "categories":[...]}
    每个 series 的 data 数组与 categories 对齐，取末位(最新一期)。任一缺失返回 None。
    """
    m = re.search(r"Data_assetAllocation\s*=\s*(\{.*?\})\s*;", raw, re.S)
    if not m:
        return None
    try:
        obj = json.loads(m.group(1))
    except Exception:  # noqa: BLE001 - 解析失败当无配置
        return None
    series = obj.get("series") if isinstance(obj, dict) else None
    if not isinstance(series, list):
        return None
    out = {}
    for s in series:
        nm = s.get("name") if isinstance(s, dict) else None
        if nm in ALLOC_NAMES and isinstance(s.get("data"), list) and s["data"]:
            try:
                out[ALLOC_NAMES[nm]] = round(float(s["data"][-1]), 2)
            except (TypeError, ValueError):
                pass
    return out or None


def fetch_nav(code, retries=3, timeout=30):
    """抓取基金净值历史 Data_netWorthTrend，返回 [[t_ms, nav], ...]（紧凑、升序）或 None。

    数据源与浏览器端一致：fund.eastmoney.com/pingzhongdata/{code}.js，
    其中 Data_netWorthTrend = [{"x": 时间戳(ms), "y": 单位净值, ...}, ...]。
    仅取 (x, y) 两列，单位净值 <=0 的脏数据丢弃；输出紧凑二维数组 [[t_ms, nav], ...]。
    """
    url = "https://fund.eastmoney.com/pingzhongdata/%s.js" % code
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": USER_AGENT, "Referer": "https://fundf10.eastmoney.com/"}
            )
            raw = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore")
            m = re.search(r"Data_netWorthTrend\s*=\s*(\[.*?\])\s*;", raw, re.S)
            if not m:
                return None
            arr = json.loads(m.group(1))
            out = []
            for row in arr:
                if not isinstance(row, dict):
                    continue
                t, nav = row.get("x"), row.get("y")
                if not isinstance(nav, (int, float)) or not isinstance(t, (int, float)):
                    continue
                if nav <= 0:
                    continue
                out.append([int(t), round(float(nav), 4)])
            alloc = parse_asset_allocation(raw)
            return (out if out else None), alloc
        except Exception as e:  # noqa: BLE001 - 网络异常统一重试
            last_err = e
            if attempt < retries:
                time.sleep(2 * attempt)
    sys.stderr.write("  [nav异常] %s: %s\n" % (code, last_err))
    return None, None


def collect_snapshot_symbols(result):
    """从抓取结果里收集非美股（港/A/日/韩）的腾讯行情代码，如 hk02513 / sz300408 / jp285A。

    跳过 ISIN 全码（如 JP3914400001）：腾讯不认，查了也是空。
    """
    isin = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")
    syms = []
    for entry in (result or {}).values():
        if not isinstance(entry, dict):
            continue
        for it in entry.get("items") or []:
            mk = (it or {}).get("m")
            code = (it or {}).get("c", "")
            if mk in SNAPSHOT_MARKETS and not isin.match(code):
                # 代码保留原始大小写：日股 285A 末位大写，腾讯对大小写敏感（jp285a 查不到）
                s = "%s%s" % (mk, code)
                if s not in syms:
                    syms.append(s)
    return syms


def fetch_qt_quotes(syms, retries=3, timeout=15):
    """批量拉腾讯行情，返回 {sym: {"date","close","prevClose","ts"}}。

    qt.gtimg.cn 字段：p[3] 现价 / p[4] 昨收 / p[30] 行情时间。
    时间格式两种：A股 "20260828161406"、日韩股 "2026-09-04 14:30:29"，
    统一取前 8 位数字当日期（YYYYMMDD），便于字符串比较。
    单个代码失败不影响其他代码。
    """
    out = {}
    if not syms:
        return out
    for i in range(0, len(syms), QT_BATCH):
        chunk = syms[i:i + QT_BATCH]
        url = "https://qt.gtimg.cn/q=" + ",".join(chunk)
        txt = None
        for attempt in range(1, retries + 1):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                txt = urllib.request.urlopen(req, timeout=timeout).read().decode("gbk", "ignore")
                break
            except Exception as e:  # noqa: BLE001 - 网络异常统一重试
                if attempt == retries:
                    sys.stderr.write("  [行情失败] %s: %s\n" % (",".join(chunk), e))
                else:
                    time.sleep(2 * attempt)
        if not txt:
            continue
        for sym in chunk:
            m = re.search('v_%s="([^"]*)"' % re.escape(sym), txt)
            if not m:
                continue
            p = m.group(1).split("~")
            if len(p) < 31:
                continue
            try:
                close, prev = float(p[3]), float(p[4])
            except (ValueError, IndexError):
                continue
            if close <= 0:
                continue
            date = re.sub(r"\D", "", p[30])[:8]
            if len(date) != 8:
                continue
            # 腾讯时间戳为北京时间，换算成美东交易日再写快照（与前端预测层目标日口径一致）
            date = _et_trade_date(p[30], date)
            if not date:
                continue
            out[sym] = {
                "date": date,
                "close": round(close, 4),
                "prevClose": round(prev, 4) if prev > 0 else None,
                "ts": p[30],
            }
    return out


def load_existing_snapshots(path):
    """读取已存盘 JSON 里的快照，兼容旧键 _jpkr_quotes（合并后只按新键写回）。"""
    out = {}
    if not (path and os.path.exists(path)):
        return out
    try:
        with open(path, encoding="utf-8") as f:
            obj = json.load(f)
    except Exception as e:  # noqa: BLE001 - 旧文件损坏则当空，不阻断主流程
        sys.stderr.write("  [快照] 读取旧文件失败，本次不累积：%s\n" % e)
        return out
    part = obj.get(SNAPSHOT_KEY)
    if not isinstance(part, dict):
        return out
    for sym, rows in part.items():
        if not isinstance(rows, list):
            continue
        by_date = {}
        for r in out.get(sym, []) + rows:
            if isinstance(r, dict) and r.get("date"):
                by_date[r["date"]] = r
        if by_date:
            out[sym] = [by_date[d] for d in sorted(by_date)]
    return out


def merge_quote_snapshots(old, new, keep=SNAPSHOT_DAYS):
    """合并新旧快照：同日期覆盖，按日期升序，只留最近 keep 条。

    old 为已存盘的结构 {"kr005930": [{date, close, prevClose, ts}, ...]}，
    new 为本次抓取结果；抓取失败（new 缺某个 sym）时该 sym 原样保留。
    """
    merged = {}
    if isinstance(old, dict):
        for k, v in old.items():
            if isinstance(v, list):
                rows = [x for x in v if isinstance(x, dict) and x.get("date")]
                if rows:
                    merged[k] = rows
    for sym, rec in (new or {}).items():
        rows = [x for x in merged.get(sym, []) if x.get("date") != rec["date"]]
        rows.append(rec)
        rows.sort(key=lambda x: x["date"])
        merged[sym] = rows[-keep:]
    return merged


class _TableParser(HTMLParser):
    """把季报表格解析成二维单元格列表。

    东方财富 jjcc 内容里通常含两张表：第一张是「十大重仓股」(占净值比例 %)，
    第二张是「持仓变动」(同列名但数值为市值/股数，会污染结果)。
    这里只收集【最外层第一张表】的行。
    """

    def __init__(self):
        super().__init__()
        self.rows = []
        self.row_markets = []       # 每行从行情链接里解析出的东财市场前缀（未收录则为 None）
        self._tds = []
        self._td_markets = []
        self._td_market = None
        self._in_td = False
        self._buf = ""
        self._table_depth = 0       # 当前 <table> 嵌套深度
        self._first_done = False    # 第一张表已结束则不再收集

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._table_depth += 1
        elif tag == "tr" and self._table_depth == 1 and not self._first_done:
            self._tds = []
            self._td_markets = []
        elif tag == "td" and self._table_depth == 1 and not self._first_done:
            self._in_td = True
            self._buf = ""
            self._td_market = None
        elif tag == "a" and self._in_td:
            # 行情链接形如 //quote.eastmoney.com/unify/r/105.MU，前缀即市场
            m = re.search(r"unify/r/(\d+)\.", dict(attrs).get("href", "") or "")
            if m:
                self._td_market = m.group(1)

    def handle_data(self, data):
        if self._in_td:
            self._buf += data

    def handle_endtag(self, tag):
        if tag == "table":
            if self._table_depth == 1:
                self._first_done = True  # 第一张表结束
            self._table_depth = max(0, self._table_depth - 1)
        elif tag == "td" and self._table_depth == 1 and not self._first_done:
            self._tds.append(self._buf.strip())
            self._td_markets.append(self._td_market)
            self._in_td = False
        elif tag == "tr" and self._table_depth == 1 and not self._first_done:
            if self._tds:
                self.rows.append(self._tds)
                self.row_markets.append(self._td_markets)


def parse(content):
    """从 content 解析出十大持仓 items 列表。"""
    p = _TableParser()
    p.feed(content)
    items = []
    for i, r in enumerate(p.rows):
        if len(r) < 7:
            continue
        seq, code, name, pct = r[0], r[1], r[2], r[6]
        if not re.match(r"^\d+$", seq):
            continue
        if not code or code in ("--", ""):
            continue
        try:
            ratio = float(pct.replace("%", "").replace(",", ""))
        except ValueError:
            continue
        # 东财市场前缀：取本行首个行情链接的前缀；为 None 表示东财未收录（多为日股/韩股）
        mkts = p.row_markets[i] if i < len(p.row_markets) else []
        em_prefix = next((x for x in mkts if x), None)
        items.append(
            {"c": code, "n": name, "p": round(ratio, 2),
             "m": market_of(code, name, em_prefix)}
        )
    return items


# ---------------------------------------------------------------------------
# QQQ 日线历史（曲线图 TWR 基准对比用）
# ---------------------------------------------------------------------------
# 看板的「曲线图」会把 QQQ 当日净值归一化为累计涨跌幅，与组合的 TWR 放在同一
# 根收益率轴上对比（谁是基准、谁跑赢一目了然）。这需要 QQQ 的每日收盘价序列。
#
# 数据源：优先腾讯 appstock fqkline（与脚本其余行情同源），但该接口对美股「带起
# 止日期」查询会退化、且「最近 N 条」模式对美股只返回首末两条，拿不到连续历史；
# 故回退新浪美股日K（US_MinKService.getDailyK），实测返回 2001 年至今完整日线。
# 每天跑一次会重新抓取全量并更新，曲线图据此自动刷新。
QQQ_SINA = "https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20_/US_MinKService.getDailyK?symbol=QQQ&___qn=3&_=1"


def fetch_qqq_daily(retries=3, timeout=30):
    """抓取 QQQ 日线历史，返回 [{"d": "YYYY-MM-DD", "c": 收盘价}, ...]（升序）。

    先试腾讯，失败回退新浪。两者都失败返回 None（不阻断主流程）。
    """
    last_err = None
    # 1) 腾讯 appstock fqkline（同源；仅作为首选项，美股历史可能不全）
    for attempt in range(1, retries + 1):
        try:
            url = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=usQQQ,day,,,800,qfq"
            req = urllib.request.Request(
                url, headers={"User-Agent": USER_AGENT, "Referer": "https://gu.qq.com/"}
            )
            raw = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore")
            obj = json.loads(raw)
            day = obj.get("data", {}).get("usQQQ", {}).get("day", [])
            out = []
            for row in day:
                if not isinstance(row, (list, dict)):
                    continue
                d = row[0] if isinstance(row, list) else row.get("date")
                c = row[2] if isinstance(row, list) else row.get("close")
                try:
                    close = float(c)
                except (ValueError, TypeError):
                    continue
                if close <= 0 or not d:
                    continue
                out.append({"d": d, "c": round(close, 2)})
            if len(out) >= 5:  # 腾讯对美股常只给首末两条，不足以做连续对比
                out.sort(key=lambda x: x["d"])
                return out
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < retries:
                time.sleep(2 * attempt)
    # 2) 新浪美股日K（完整历史）
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                QQQ_SINA, headers={"User-Agent": USER_AGENT, "Referer": "https://stock.finance.sina.com.cn/"}
            )
            raw = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore")
            i, j = raw.find("["), raw.rfind("]")
            if i < 0 or j < 0:
                continue
            arr = json.loads(raw[i:j + 1])
            out = []
            for x in arr:
                d = x.get("d")
                c = x.get("c")
                if not d or c is None:
                    continue
                try:
                    close = float(c)
                except (ValueError, TypeError):
                    continue
                if close <= 0:
                    continue
                out.append({"d": d, "c": round(close, 2)})
            if out:
                out.sort(key=lambda x: x["d"])
                return out
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < retries:
                time.sleep(2 * attempt)
    sys.stderr.write("  [QQQ] 抓取失败: %s\n" % last_err)
    return None


def load_existing_qqq(path):
    """读取已存盘 JSON 里的 qqq_daily 日线历史，作为增量追加的基底。"""
    if not (path and os.path.exists(path)):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            obj = json.load(f)
    except Exception as e:  # noqa: BLE001 - 旧文件损坏则当空，退回全量
        sys.stderr.write("  [QQQ] 读取旧文件失败，本次全量重抓：%s\n" % e)
        return []
    part = obj.get("qqq_daily")
    if not isinstance(part, list):
        return []
    out = []
    for r in part:
        if not (isinstance(r, dict) and r.get("d") and r.get("c") is not None):
            continue
        try:
            close = float(r["c"])
        except (ValueError, TypeError):
            continue
        if close > 0:
            out.append({"d": str(r["d"]), "c": round(close, 2)})
    out.sort(key=lambda x: x["d"])
    return out


def merge_qqq_daily(old, fresh):
    """增量合并 QQQ 日线：
    - 旧历史（< 旧数据最后一天）原样保留，防止源端截断或换源抹掉已有历史；
    - 旧数据最后一天及之后以新抓取为准（刷新当日收盘价 + 追加新交易日）。
    任一侧为空则直接返回另一侧。"""
    if not old:
        return fresh or []
    if not fresh:
        return old
    last_d = old[-1]["d"]
    by_d = {r["d"]: r for r in old}
    for r in fresh:
        if r["d"] >= last_d:
            by_d[r["d"]] = r
    return sorted(by_d.values(), key=lambda x: x["d"])


# ---------------------------------------------------------------------------
# 美元/离岸人民币（USDCNH）日频汇率
#
# 数据源：frankfurter（欧洲央行每日参考价 base=USD&symbols=CNY），**只有日频、没有分时**。
# 为什么也落成文件、前端只读不拉：
#   ① 浏览器直连 api.frankfurter.dev 在部分网络下会 `ERR_CERT_COMMON_NAME_INVALID`
#      （HTTPS 中间人拦截），fetch 静默失败 → 自选行拿不到价、K 线直接画不出来；
#   ② 与 qqq_daily 一样「每天拉一次、前端只读最新」，请求数恒定、行为可预期。
# 口径注意：这是 **ECB 在岸 CNY 参考价**，不是离岸 CNH 现货 —— 两者有几十个基点价差，
#   但日线级别走势一致；周末与 ECB 假日不更新（停在上一个交易日）。
# 起点与 qqq_daily 对齐；合并语义与 QQQ 相同（旧历史保留，旧末日及之后以新抓取为准）。
FRANKFURTER_URL = "https://api.frankfurter.dev/v1/{start}..{end}?base=USD&symbols=CNY"
FX_DAILY_KEY = "usdcnh_daily"     # 顶层键名（非 6 位基金代码，前端遍历基金时会忽略）
FX_SERIES_START = "2025-01-02"    # 与 fund_holdings.json 里 qqq_daily 的首日一致


def _norm_fx_rows(rates):
    """{"2026-10-02": {"CNY": 6.7046}} -> [{"d": "YYYY-MM-DD", "c": 汇率}, ...]（升序）。

    保留 4 位小数：ECB 给的就是 4 位，USDCNH 在这个量级上 4 位足够（1e-4 ≈ 0.0015%）。
    """
    if not isinstance(rates, dict):
        return []
    out = []
    for d, v in rates.items():
        if not isinstance(v, dict) or v.get("CNY") is None:
            continue
        try:
            c = float(v["CNY"])
        except (ValueError, TypeError):
            continue
        if c > 0:
            out.append({"d": str(d), "c": round(c, 4)})
    out.sort(key=lambda x: x["d"])
    return out


def fetch_fx_daily(start=FX_SERIES_START, retries=3, timeout=30):
    """抓 USD->CNY 日频收盘，返回升序列表；失败返回 None（不阻断主流程）。

    curl 优先、urllib 兜底：部分 Windows 环境有 HTTPS 中间人代理，Python 校验证书会报
    `certificate is not valid for 'api.frankfurter.dev'`，而 curl 走系统证书链能过。
    GitHub Actions 没有这层拦截，curl 同样可用，所以统一先走 curl。
    """
    end = _dt.date.today().isoformat()
    url = FRANKFURTER_URL.format(start=start, end=end)
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            raw = subprocess.run(["curl", "-sS", "--max-time", str(timeout), url],
                                 capture_output=True, timeout=timeout + 5)
            if raw.returncode == 0 and raw.stdout.strip():
                got = _norm_fx_rows(json.loads(raw.stdout.decode("utf-8", "ignore")).get("rates"))
                if got:
                    return got
                last_err = ValueError("empty rates")
        except Exception as e:  # noqa: BLE001
            last_err = e
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            obj = json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore"))
            got = _norm_fx_rows(obj.get("rates"))
            if got:
                return got
            last_err = ValueError("empty rates")
        except Exception as e:  # noqa: BLE001
            last_err = e
        if attempt < retries:
            time.sleep(2 * attempt)
    sys.stderr.write("  [FX] 抓取失败: %s\n" % last_err)
    return None


def load_existing_fx(path):
    """读取已存盘 JSON 里的 usdcnh_daily，作为增量追加的基底。"""
    if not (path and os.path.exists(path)):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            obj = json.load(f)
    except Exception as e:  # noqa: BLE001 - 旧文件损坏则当空，退回全量
        sys.stderr.write("  [FX] 读取旧文件失败，本次全量重抓：%s\n" % e)
        return []
    return _norm_fx_rows(obj.get(FX_DAILY_KEY))


def merge_fx_daily(old, fresh):
    """增量合并（与 merge_qqq_daily 同语义）：
    - 旧历史（< 旧数据最后一天）原样保留，防止源端截断抹掉已有历史；
    - 旧数据最后一天及之后以新抓取为准（刷新当日 + 追加新交易日）。
    任一侧为空则直接返回另一侧（**fresh 为空时返回 old**，所以抓失败不会丢历史）。"""
    if not old:
        return fresh or []
    if not fresh:
        return old
    last_d = old[-1]["d"]
    by_d = {r["d"]: r for r in old}
    for r in fresh:
        if r["d"] >= last_d:
            by_d[r["d"]] = r
    return sorted(by_d.values(), key=lambda x: x["d"])



# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# 美股市值榜（含 OTC / ADR 巨头）—— 选股器「全部个股」tab 的数据源
#
# 为什么用东方财富 push2 而不是 FMP（2026-10-07 实测，用户原本指定 FMP）：
#   FMP **免费版**（password.txt 里那个 key）根本取不到 screener：
#     api/v3/stock_screener 与 api/v3/stock-screener → 403 Legacy（端点 2025-08-31 停用）
#     stable/company-screener、stable/batch-quote    → 402 Restricted（需付费订阅）
#     stable/company-profile                          → 404（免费版没有）
#     stable/quote?symbol=X                           → 200，但**只能单只**查，额度 250 次/天
#   而「全市场按市值排序」只能靠 screener，batch 也被墙 —— 免费版做不到。
#   FMP 侧也拿不到 sector（profile 404 / sector-analytics 402），所以行业同样走东财。
#   东财 clist/get 一次请求按 f20（市值）降序给全市场，**顺带 f100 = GICS 行业（中文）**，
#   免费无 key，一个请求拿到 代码/名称/现价/涨跌幅/市值/行业 六项。
#
# 市场代码（实测 2026-10-07）：
#   m:105=m NASDAQ / m:106=NYSE / m:107=AMEX → 13847 只
#   m:153 = OTC / ADR（OTCQX、OTCQB、TRF）  →   952 只，TCEHY 腾讯控股(ADR)、TCTZF 腾讯控股
#   ⚠️ 多市场合并查询（fs=m:105,m:106,m:107,m:153）实测会超时，必须**分两次请求再合并**。
#
# 字段与缩放（实测校准，勿改）：
#   f12=代码  f13=市场号  f14=名称  f2=现价(×1000)  f3=涨跌幅%(×100)  f20=市值(真实美元)  f100=行业
#   校验：NVDA f2=237330 → 237.33；f3=-80 → -0.80%；f20=5719653000000 → 5.72 万亿。
#
# 为什么给 OTC 预留固定名额（US_TOP_OTC_SLOTS）：
#   OTC 巨头的 ADR（TCEHY 约 5120 亿）市值高于交易所 top150 门槛，纯粹合并排序通常也装得下；
#   但 ADR 里绝大多数是几十亿的小票，一旦市场整体估值变化导致门槛抬高，可能一只都进不来，
#   「包含 OTC 巨头 ADR」就会悄悄失效。显式留 10 个名额（150 - 140）让它稳定可控。
#
# ⚠️ 本机（国内家庭宽带）访问 push2 **极不稳定**：2026-10-07 实测同一上午 5 次连续请求 4 次
#    超时/000，偶发才成功。真正每天跑的是 GitHub Actions（美国 runner），那边才稳。
#    所以这里必须有重试；且**失败时保留上一版名单**（沿用本文件其余模块的语义：
#    拉不到就不覆盖、绝不写成空 —— 空名单会让选股器「全部个股」tab 变成空白）。
# ⚠️ 域名回退链（2026-10-08 加）：push2 主域对 GitHub Actions（Azure 美国 IP）实测回
#    **HTTP 502 Bad Gateway**（10-07 run 日志：4 组请求 × 3 次重试全 502，非限流 429，
#    是东财对境外机房 IP 的策略）。编号镜像 90.push2 等同源同路径，实测（外部网络）可用，
#    每次重试换下一个域名。本机（国内宽带）则是 TLS 握手直接被 RST，走哪个域名都 000 ——
#    本地别指望直连，真正生产在 Actions。
#    注意本机 curl 000 与 Actions 502 是**两种不同的故障**：前者链路阻断，后者服务端拒绝。
EM_LIST_HOSTS = [
    "https://push2.eastmoney.com",
    "https://90.push2.eastmoney.com",
    "https://48.push2.eastmoney.com",
    "https://push2delay.eastmoney.com",   # 延迟 15 分钟版兜底（榜单场景可接受）
]
EM_FS_EXCH = "m:105,m:106,m:107"
EM_FS_OTC = "m:153"
US_TOP_KEY = "us_top"          # fund_holdings.json 顶层键（前端只认这个）
US_TOP_TOTAL = 150             # 名单总长度
US_TOP_OTC_SLOTS = 10          # 其中给 OTC/ADR 的固定名额，其余给三大交易所
EM_PRICE_SCALE = 1000.0        # 美股 f2 是价格 ×1000
EM_PCT_SCALE = 100.0           # f3 是涨跌幅 ×100


def _em_clist(fs, limit, fid="f20", po=1, retries=3, timeout=25, fields=None):
    """东财 clist/get：按 fid + po 排序取 limit 条。返回 list[原始 dict]，失败 None。

    po=1 降序 / po=0 升序（跌幅榜就要 po=0）。
    pz 上限实测 100 稳妥（超过会截断/超时），要 150 就分页；这里调用方按需传页号。
    """
    if fields is None:
        fields = "f12,f13,f14,f2,f3,f20,f100"
    last = None
    # 域名回退（2026-10-08）：主域对 Actions 境外 IP 回 502，每次重试换下一个 host；
    # 200 但 diff 为空也算失败继续换（防东财个别镜像抽风给空数据）。
    n = len(EM_LIST_HOSTS)
    total = retries * n
    for attempt in range(1, total + 1):
        host = EM_LIST_HOSTS[(attempt - 1) % n]
        url = (host + "/api/qt/clist/get?pn=1&pz=%d&po=%d&fid=%s&fs=%s&fields=%s"
               % (limit, po, fid, fs, fields))
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            raw = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore")
            obj = json.loads(raw)
            diff = (obj.get("data") or {}).get("diff") or []
            rows = list(diff.values()) if isinstance(diff, dict) else list(diff)
            rows = [r for r in rows if isinstance(r, dict)]
            if rows:
                return rows
            last = RuntimeError("200 但 diff 为空")
        except Exception as e:  # noqa: BLE001 - 网络/JSON 各种失败统一重试
            last = e
            if attempt < total:
                time.sleep(1.2 * attempt)   # time 已在文件顶部 import
    sys.stderr.write("  [东财] 请求失败(%s fid=%s po=%d, %d 次): %s\n"
                     % (fs, fid, po, total, last))
    return None


def _em_clist_po(fs, limit, fid="f20", po=1, retries=3, timeout=25, fields=None):
    """_em_clist 的薄包装：市场榜要用 f6/f8（成交量/成交额）且要 po=0 的升序。"""
    return _em_clist(fs, limit, fid=fid, po=po, retries=retries, timeout=timeout,
                     fields=fields or "f12,f13,f14,f2,f3,f6,f8")


def _norm_us_top_rows(rows):
    """东财原始行 → 前端结构。价格/涨跌幅按实测缩放还原；缺关键字段的行直接丢。"""
    out = []
    for r in rows:
        code = (r.get("f12") or "").strip()
        if not code:
            continue
        try:
            mkt = int(r.get("f13"))
        except (TypeError, ValueError):
            mkt = 0
        p = r.get("f2")
        pc = r.get("f3")
        mc = r.get("f20")
        out.append({
            "c": code,
            "n": (r.get("f14") or "").strip(),
            "m": mkt,
            "p": round(float(p) / EM_PRICE_SCALE, 4) if isinstance(p, (int, float)) and p else None,
            "pct": round(float(pc) / EM_PCT_SCALE, 2) if isinstance(pc, (int, float)) and pc else None,
            "mc": int(mc) if isinstance(mc, (int, float)) and mc else None,
            "ind": (r.get("f100") or "").strip() or None,
            "otc": mkt == 153,
        })
    return out


def fetch_us_top(retries=3, timeout=25, total=US_TOP_TOTAL, otc_slots=US_TOP_OTC_SLOTS):
    """美股市值 top N 名单（含 OTC/ADR）。返回 {"asOf","source","rows"} 或 None。

    交易所与 OTC **分两次请求**（合并查询实测超时）：交易所取 total-otc_slots 只、
    OTC 取 otc_slots 只，各自按市值降序，最后再按市值统一排序。
    任何一半失败就整体返回 None —— 半份名单比旧名单更糟（页面会以为只有这些票）。
    """
    ex_n = max(1, total - otc_slots)
    ex = _em_clist(EM_FS_EXCH, ex_n, fid="f20", po=1, retries=retries, timeout=timeout)
    if not ex:
        return None
    otc = _em_clist(EM_FS_OTC, otc_slots, fid="f20", po=1, retries=retries, timeout=timeout)
    if not otc:
        return None
    rows = _norm_us_top_rows(ex) + _norm_us_top_rows(otc)
    rows.sort(key=lambda x: -(x["mc"] or 0))
    if len(rows) < total:
        sys.stderr.write("  [美股榜] 只取到 %d 只（目标 %d）\n" % (len(rows), total))
    return {
        "asOf": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "eastmoney push2 clist/get",
        "slots": {"exch": len(ex), "otc": len(otc)},
        "rows": rows[:total],
    }


def load_existing_us_top(path):
    """从已存盘 JSON 读上一版名单（失败保留用）。"""
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
        u = old.get(US_TOP_KEY)
        return u if isinstance(u, dict) and u.get("rows") else None
    except Exception:  # noqa: BLE001 - 首次运行/文件损坏
        return None


def merge_us_top(old, fresh):
    """名单是**每日快照**（不是历史序列），语义与 qqq_daily 的增量合并不同：
    抓成功就整份换成新的；抓失败（None）才沿用旧的。
    旧名单的 asOf 会原样保留 —— 前端据此显示「数据日期」，不假装是今天的数据。"""
    if fresh and fresh.get("rows"):
        return fresh
    return old


# ---------------------------------------------------------------------------
# 市场榜（选股器「市场」tab）：成交榜 / 涨幅榜 / 跌幅榜，各 top 10
#
# 为什么落成文件而不是前端直连（2026-10-07 决定）：
#   浏览器直连 push2 **技术上可行**（实测 OPTIONS 预检回显 Access-Control-Allow-Origin），
#   但本机实测 push2 的 DNS 首选 IPv6（2402:4e00:... trafficmanager.cn），IPv6 通路有问题 →
#   `net::ERR_EMPTY_RESPONSE` / curl 000，**同一时刻 fund.eastmoney.com 却完全正常**。
#   既然用户自己的浏览器也可能命中同样的问题，就不赌前端直连 —— 走 workflow 每天抓一次。
#   顺带的好处：榜单是「每日快照」语义，不必担心盘中频繁刷新把额度打爆。
#
# 三个榜 = **同一个接口的三个参数组合**（各 1 次请求，共 3 次）：
#   成交榜 fid=f6(成交量) po=1(降序) / 涨幅榜 fid=f3(涨跌幅) po=1 / 跌幅榜 fid=f3 po=0(升序)
#   —— 用户原本指定的 Alpaca v1beta1 screener 免费账户全部 404（订阅级限制），
#      quotes 无涨跌幅/成交量、bars 是 IEX only 实测 5 个 symbol 只回 2 个，所以走东财。
#
# ⚠️ 字段缩放沿用美股榜那套（实测校准）：f2 现价 ×1000、f3 涨跌幅 ×100、f20 市值不缩放。
#    成交量 f6 / 成交额 f8 是**手数与金额**，单位与美股不同，前端只做量级展示不参与计算。
#    任一榜失败 → **只回退这一榜**（榜单之间互不依赖），三榜全失败才整体保留旧数据。
US_MKT_KEY = "us_mkt"           # fund_holdings.json 顶层键（前端只认这个）
US_MKT_TOP = 10                 # 每榜条数（用户 2026-10-07 定的「top 10」）
# (键名, 中文名, fid, po) —— po=1 降序 / po=0 升序
US_MKT_BOARDS = [
    ("turnover", "成交榜", "f6", 1),
    ("gainer", "涨幅榜", "f3", 1),
    ("loser", "跌幅榜", "f3", 0),
]


def _norm_us_mkt_rows(rows):
    """东财原始行 → 前端结构。缩放与 _norm_us_top_rows 同源，这里只多带成交量/成交额。"""
    out = []
    for r in rows:
        code = (r.get("f12") or "").strip()
        if not code:
            continue
        try:
            mkt = int(r.get("f13"))
        except (TypeError, ValueError):
            mkt = 0
        p, pc = r.get("f2"), r.get("f3")
        vol, amt = r.get("f6"), r.get("f8")
        out.append({
            "c": code,
            "n": (r.get("f14") or "").strip(),
            "m": mkt,
            "p": round(float(p) / EM_PRICE_SCALE, 4) if isinstance(p, (int, float)) and p else None,
            "pct": round(float(pc) / EM_PCT_SCALE, 2) if isinstance(pc, (int, float)) and pc else None,
            "vol": int(vol) if isinstance(vol, (int, float)) and vol else None,
            "amt": int(amt) if isinstance(amt, (int, float)) and amt else None,
        })
    return out


def fetch_us_market(retries=3, timeout=25, top=US_MKT_TOP):
    """三个市场榜。返回 {"asOf","source","boards":{键:[行]}} 或 None（全失败）。

    各榜**独立失败**：某一榜取不到就缺那一榜，不整份作废 —— 三个榜来自三次独立请求，
    一起失败通常意味着东财整体不可达（Actions 上少见），此时保留旧数据更诚实。
    """
    boards, failed = {}, []
    for key, _label, fid, po in US_MKT_BOARDS:
        rows = _em_clist_po(EM_FS_EXCH, top, fid=fid, po=po, retries=retries, timeout=timeout)
        if rows:
            boards[key] = _norm_us_mkt_rows(rows)[:top]
        else:
            failed.append(key)
    if not boards:
        return None
    if failed:
        sys.stderr.write("  [市场榜] 部分榜单取不到: %s（其余照常写入）\n" % ",".join(failed))
    return {
        "asOf": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "eastmoney push2 clist/get",
        "boards": boards,
    }


def load_existing_us_mkt(path):
    """从已存盘 JSON 读上一版市场榜（全失败时保留用）。"""
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
        u = old.get(US_MKT_KEY)
        return u if isinstance(u, dict) and u.get("boards") else None
    except Exception:  # noqa: BLE001 - 首次运行/文件损坏
        return None


def merge_us_market(old, fresh):
    """逐榜合并：新抓到的榜用新的，没抓到的沿用旧的（比整份保留旧更合理）。

    asOf 只在**真抓到新数据**时刷新 —— 沿用旧榜时不刷新，否则页面会显示今天的日期
    却挂着昨天的数字（违反「没数据不假装是最新的」原则）。
    """
    if not fresh or not fresh.get("boards"):
        return old
    if not old or not old.get("boards"):
        return fresh
    merged = {}
    for key, _label, _fid, _po in US_MKT_BOARDS:
        nb = fresh["boards"].get(key)
        ob = old["boards"].get(key)
        merged[key] = nb or ob or []
    merged = {k: v for k, v in merged.items() if v}
    if not merged:
        return old
    # 有任何一个榜是新的 → 认为这份数据是新的（混合日期已在页面上标注每榜更新时间则更严谨，
    # 这里保守起见：只要有过半的榜是新的就更新 asOf）
    new_cnt = sum(1 for k, v in fresh["boards"].items() if v)
    return {
        "asOf": fresh["asOf"] if new_cnt >= 2 else old.get("asOf", fresh["asOf"]),
        "source": fresh.get("source") or old.get("source"),
        "boards": merged,
    }


# ---------------------------------------------------------------------------
# 10 年期美债收益率（BC_10YEAR，日频 %）—— 与 USDCNH 同样的「每天抓一次、前端只读」
#
# 为什么也落成文件（2026-10-07 用户要求「省额度」）：
#   原来前端**每次打开页面 + 每 30 分钟**都直接 fetch 财政部 XML，一次 300KB，
#   既慢又反复请求；改成每天写进 fund_holdings.json、前端只读最新，
#   请求数恒定 —— 与 usdcnh_daily 完全一致。
# 数据源仍是财政部官方 Daily Treasury Par Yield Curve（权威的 H.15 数据）：
#   fred.stlouisfed.org 不行（CSV 不发 ACAO、ALFRED 的 CORS 白名单写死自己域名、api 要 key），
#   财政部 home.treasury.gov 的 XML 同样权威且浏览器可直连。
#
# ⚠️ **财政部 XML 一次只给一年**（?field_tdr_date_value=2026），所以按年份分段请求再合并。
#    实测：2025 → 249 条（01-02~12-31，末值 4.18）、2026 → 192 条（01-02~10-06，末值 5.27）。
#    起点用 FX_SERIES_START（2025-01-02），与 usdcnh_daily / qqq_daily 完全对齐。
# 口径：BC_10YEAR 是**百分数**（5.27 = 5.27%），与自选行显示一致，**不做 /100**。
UST_DAILY_KEY = "ust10y_daily"   # fund_holdings.json 顶层键（前端只认这个）
TREASURY_YIELD_URL = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates"
                      "/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=%d")
_TREASURY_RE = re.compile(r"<entry>([\s\S]*?)</entry>")
_UST_DATE_RE = re.compile(r"<d:NEW_DATE[^>]*>([\d-]{10})")
_UST_VAL_RE = re.compile(r"<d:BC_10YEAR[^>]*>([\d.]+)</d:BC_10YEAR>")


def _norm_ust_rows(xml_text, start=None):
    """财政部 Atom feed → [{"d": "YYYY-MM-DD", "c": 收益率%}, ...]（升序、去重）。"""
    if not xml_text:
        return []
    out = []
    seen = set()
    for m in _TREASURY_RE.finditer(xml_text):
        d = _UST_DATE_RE.search(m.group(1))
        y = _UST_VAL_RE.search(m.group(1))
        if not (d and y):
            continue
        day = d.group(1)
        if start and day < start:
            continue
        try:
            val = float(y.group(1))
        except ValueError:
            continue
        if val <= 0:
            continue
        if day in seen:
            continue
        seen.add(day)
        out.append({"d": day, "c": round(val, 4)})
    out.sort(key=lambda x: x["d"])
    return out


def fetch_treasury_daily(start=FX_SERIES_START, retries=3, timeout=30):
    """抓 10Y 美债日频序列（跨年分段请求），失败返回 None（不阻断主流程）。

    curl 优先、urllib 兜底：与 fetch_fx_daily 同一套理由（部分 Windows 环境有 HTTPS
    中间人代理，Python 校验证书会失败而 curl 走系统证书链能过；Actions 上两者都可用）。
    """
    y0 = int(str(start)[:4])
    y1 = _dt.date.today().year
    merged, got_any, last_err = [], False, None
    for year in range(y0, y1 + 1):
        url = TREASURY_YIELD_URL % year
        rows = None
        for attempt in range(1, retries + 1):
            try:
                raw = subprocess.run(["curl", "-sS", "--max-time", str(timeout), url],
                                     capture_output=True, timeout=timeout + 5)
                if raw.returncode == 0 and raw.stdout.strip():
                    rows = _norm_ust_rows(raw.stdout.decode("utf-8", "ignore"), start)
                    if rows:
                        break
                    rows = None
            except Exception as e:  # noqa: BLE001
                last_err = e
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                rows = _norm_ust_rows(
                    urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore"), start)
                if rows:
                    break
                rows = None
            except Exception as e:  # noqa: BLE001
                last_err = e
            if attempt < retries:
                time.sleep(2 * attempt)
        if rows:
            got_any = True
            merged.extend(rows)
        else:
            sys.stderr.write("  [美债] %d 年段抓取失败: %s\n" % (year, last_err))
    if not got_any:
        sys.stderr.write("  [美债] 全部年份段都失败\n")
        return None
    # 跨年可能有重叠（当年数据会被反复刷新），按日期去重取最后一条
    by_d = {}
    for r in merged:
        by_d[r["d"]] = r
    return [by_d[k] for k in sorted(by_d)]


def load_existing_treasury(path):
    """读取已存盘 JSON 里的 ust10y_daily，作为增量追加的基底。"""
    if not (path and os.path.exists(path)):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            obj = json.load(f)
    except Exception as e:  # noqa: BLE001 - 旧文件损坏则当空，退回全量
        sys.stderr.write("  [美债] 读取旧文件失败，本次全量重抓：%s\n" % e)
        return []
    return _norm_ust_rows(json.dumps(obj.get(UST_DAILY_KEY)), None)


def merge_treasury_daily(old, fresh):
    """增量合并，语义与 merge_fx_daily 完全相同（抓失败绝不丢历史）。"""
    if not old:
        return fresh or []
    if not fresh:
        return old
    last_d = old[-1]["d"]
    by_d = {r["d"]: r for r in old}
    for r in fresh:
        if r["d"] >= last_d:
            by_d[r["d"]] = r
    return sorted(by_d.values(), key=lambda x: x["d"])


def load_config(path):
    """读取可选的 fund_codes.json 配置。返回 (codes, proxy) 或 (None, None)。"""
    if not path or not os.path.exists(path):
        return None, None
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    codes = cfg.get("codes")
    proxy = cfg.get("proxy", {})
    if not isinstance(codes, list) or not codes:
        raise ValueError("配置文件中 codes 必须为非空数组")
    return codes, {str(k): bool(v) for k, v in proxy.items()}


def scrape(codes, proxy, retries=3, quiet=False):
    """抓取所有基金，返回结果 dict。"""
    result = {}
    for code in codes:
        code = str(code).strip()
        if not code:
            continue
        if proxy.get(code):
            # 代理基金(纳斯达克100ETF联接)：不直接持股，资产配置以东财真实占净比为准
            entry = {
                "report": QQQ_PROXY["report"],
                "proxy": True,
                "items": [dict(it) for it in QQQ_PROXY["items"]],
            }
            _nav, alloc = fetch_nav(code, retries=retries)
            # 代理基金同样要落 nav：016532/016533（ETF联接）在东财是有净值的，
            # 之前这里把 _nav 丢弃，导致 fund_holdings.json 里这两只没有 nav，
            # 前端「资金明细」历史序列会把它们过滤掉、合计对不上持仓表。
            if not alloc:
                alloc = dict(PROXY_ALLOC)
            bond = float(alloc.get("bond", 0.0) or 0.0)
            cash = float(alloc.get("cash", 0.0) or 0.0)
            # 股权暴露(=100-债-现金)：ETF联接基金只持有 ETF，其权重即股权暴露，
            # 剩余为现金/债券缓冲。这样 13 行明细合计 = 股权暴露 + 债 + 现金 = 100%，
            # 盘中预测也顺带体现现金拖累(predPct = 股权暴露% × QQQ)。
            equity = round(max(0.0, 100.0 - bond - cash), 2)
            entry["items"][0]["p"] = equity
            entry["alloc"] = alloc
            if _nav:
                entry["nav"] = _nav
            result[code] = entry
            if not quiet:
                sys.stderr.write("  [代理] %s 使用 QQQ 代理(股权暴露 %.2f%%, 现金 %.2f%%)%s\n" % (
                    code, equity, cash, "" if _nav else "，未取到 nav"))
            continue
        if not quiet:
            sys.stderr.write("  [抓取] %s ...\n" % code)
        try:
            content, report = fetch_content(code, retries=retries)
            if content:
                items = parse(content)
                if items:
                    nav, alloc = fetch_nav(code, retries=retries)
                    entry = {"report": report, "items": items}
                    if nav:
                        entry["nav"] = nav
                    if alloc:
                        entry["alloc"] = alloc
                    result[code] = entry
                else:
                    sys.stderr.write("  [空] %s 未解析到持仓\n" % code)
            else:
                sys.stderr.write("  [失败] %s 未取到内容\n" % code)
        except Exception as e:  # noqa: BLE001
            sys.stderr.write("  [异常] %s: %s\n" % (code, e))
    return result


def trim_nav(result, asset_path, buffer_days=60, quiet=False):
    """就地裁剪各基金 nav：保留 [最早买入交易日 - buffer_days, ...] 之后的部分。

    nav 时间戳为 ms（东财按北京时间零点取整）。最早交易日取 Asset_parsed.json
    seed.pa_funds[].trades 里最早一笔的 date（YYYY-MM-DD）。基金无记录/文件缺失
    则该基金保持原样。返回裁剪统计 {code: (before, after)}。
    """
    trade_date = {}
    try:
        with open(asset_path, encoding="utf-8") as f:
            ap = json.load(f)
        for pf in (ap.get("seed") or {}).get("pa_funds", []):
            code = str(pf.get("code") or "")
            ds = [t.get("date") for t in (pf.get("trades") or [])
                  if isinstance(t, dict) and t.get("date")]
            if code and ds:
                trade_date[code] = min(ds)
    except Exception as e:  # noqa: BLE001 - 找不到/损坏则整体不裁剪
        if not quiet:
            sys.stderr.write("  [nav裁剪] 读 %s 失败，跳过裁剪：%s\n" % (asset_path, e))
        return {}

    day_ms = 86400 * 1000
    stats = {}
    for code, entry in result.items():
        if not isinstance(entry, dict):
            continue
        nav = entry.get("nav")
        if not isinstance(nav, list) or not nav:
            continue
        d = trade_date.get(str(code))
        if not d:
            continue
        y, m, dd = (int(x) for x in d.split("-"))
        cutoff = _dt.datetime(y, m, dd, tzinfo=_dt.timezone.utc).timestamp() * 1000 \
            - buffer_days * day_ms
        kept = [row for row in nav
                if isinstance(row, (list, tuple)) and row and row[0] >= cutoff]
        if len(kept) < len(nav):
            entry["nav"] = kept
            stats[code] = (len(nav), len(kept))
            if not quiet:
                sys.stderr.write("  [nav裁剪] %s：%d -> %d 条（最早交易日 %s - %d 天）\n"
                                 % (code, len(nav), len(kept), d, buffer_days))
    return stats


def merge_nav(old_nav, new_nav):
    """新旧 nav 按时间戳取并集：同日以新值为准，按时间升序返回。"""
    rows = {}
    for r in (old_nav or []) + (new_nav or []):
        if isinstance(r, (list, tuple)) and r and isinstance(r[0], (int, float)):
            rows[r[0]] = r
    return [rows[k] for k in sorted(rows)]


def merge_with_existing(result, path, codes, quiet=False):
    """与已存盘 JSON 增量合并（就地改 result）：

    - nav：旧 nav ∪ 本次抓到的 nav（同日新覆盖旧）——东财每次返回全史，
      合并的意义在抓取中断/部分失败时不丢历史；
    - 单项失败兜底：本次某基金没抓到持仓（items 缺失）→ 整条沿用旧条目；
      本次抓到持仓但 nav 缺失 → 只沿用旧 nav；
    - 只处理本次 codes 列表内的基金（从配置移除的基金不会残留在结果里）；
    - _daily_quotes / qqq_daily 已由各自增量逻辑处理，此处跳过。
    """
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except Exception:  # noqa: BLE001 - 首次运行/文件损坏则无旧数据可并
        return
    if not isinstance(old, dict):
        return
    for code in codes:
        code = str(code).strip()
        old_entry = old.get(code)
        if not isinstance(old_entry, dict):
            continue
        new_entry = result.get(code)
        if not isinstance(new_entry, dict) or not new_entry.get("items"):
            # 整只失败：沿用旧条目（nav/report/alloc 全保留）
            if old_entry.get("items"):
                result[code] = old_entry
                if not quiet:
                    sys.stderr.write("  [增量] %s 本次未抓到，沿用旧数据\n" % code)
            continue
        old_nav = old_entry.get("nav")
        if isinstance(old_nav, list) and old_nav and not new_entry.get("nav"):
            new_entry["nav"] = old_nav
            if not quiet:
                sys.stderr.write("  [增量] %s 本次未取到 nav，沿用旧 %d 条\n" % (code, len(old_nav)))
        elif isinstance(old_nav, list) and old_nav and new_entry.get("nav"):
            merged = merge_nav(old_nav, new_entry["nav"])
            if len(merged) > len(new_entry["nav"]):
                new_entry["nav"] = merged


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="抓取基金季报十大持仓 -> fund_holdings.json"
    )
    ap.add_argument("-o", "--output", default="fund_holdings.json",
                    help="输出 JSON 路径（默认 fund_holdings.json）")
    ap.add_argument("-c", "--config", default=None,
                    help="基金列表配置文件 fund_codes.json")
    ap.add_argument("--codes", default=None,
                    help="逗号分隔的基金代码，覆盖默认列表")
    ap.add_argument("--no-write", action="store_true",
                    help="只打印 JSON，不写文件")
    ap.add_argument("--quiet", action="store_true",
                    help="减少 stderr 输出")
    ap.add_argument("--retries", type=int, default=3,
                    help="单只基金抓取失败重试次数（默认 3）")
    ap.add_argument("--no-trim-nav", action="store_true",
                    help="跳过 nav 裁剪（默认按最早交易日-60天缓冲截掉更早历史）")
    ap.add_argument("--no-merge", action="store_true",
                    help="跳过与存盘文件的增量合并（默认并集+失败沿用旧数据）")
    ap.add_argument("--no-snapshots", action="store_true",
                    help="跳过日股/韩股行情快照抓取")
    ap.add_argument("--no-qqq", action="store_true",
                    help="跳过 QQQ 日线抓取（曲线图基准对比用）")
    ap.add_argument("--no-fx", action="store_true",
                    help="跳过美元/离岸人民币汇率日线抓取（自选行与 K 线用）")
    ap.add_argument("--no-us-top", action="store_true",
                    help="跳过美股市值榜抓取（选股器「全部个股」tab 用）")
    ap.add_argument("--no-ust", action="store_true",
                    help="跳过 10 年期美债日频抓取（自选行 10Ymain 用）")
    ap.add_argument("--no-us-mkt", action="store_true",
                    help="跳过市场榜抓取（选股器「市场」tab：成交/涨幅/跌幅各 top 10）")
    ap.add_argument("--snapshot-days", type=int, default=SNAPSHOT_DAYS,
                    help="行情快照保留天数（默认 %d）" % SNAPSHOT_DAYS)
    args = ap.parse_args(argv)

    # 确定基金列表：命令行 > 配置文件 > 默认
    codes, proxy = load_config(args.config)
    if codes is None:
        codes, proxy = list(DEFAULT_CODES), dict(DEFAULT_PROXY)
    if args.codes:
        codes = [c.strip() for c in args.codes.split(",") if c.strip()]
        # 命令行指定时，代理仅保留命中者
        proxy = {c: proxy.get(c, False) for c in codes}

    codes = [c for c in codes if c not in (None, "")]
    if not codes:
        sys.stderr.write("错误：没有任何要抓取的基金代码\n")
        return 2

    result = scrape(codes, proxy, retries=args.retries, quiet=args.quiet)

    # 非美股（港/A/日/韩）行情快照：每天存一条，攒出近 N 个交易日序列供看板直接读取
    if not args.no_snapshots:
        syms = collect_snapshot_symbols(result)
        if syms:
            quotes = fetch_qt_quotes(syms, retries=args.retries)
            if not args.quiet:
                sys.stderr.write("  [快照] 港/A/日/韩 %d 个代码，取到 %d 个\n" % (len(syms), len(quotes)))
            # 读取已存盘文件里的旧快照，合并后回写（--no-write 时也能累积）
            old = load_existing_snapshots(args.output)
            merged = merge_quote_snapshots(old, quotes, keep=max(1, args.snapshot_days))
            if merged:
                result[SNAPSHOT_KEY] = merged
        elif not args.quiet:
            sys.stderr.write("  [快照] 无非美股持仓，跳过\n")

    # QQQ 日线历史（曲线图 TWR 基准对比）：增量追加，已有历史以存盘数据为准
    if not args.no_qqq:
        qqq_old = load_existing_qqq(args.output)
        qqq = fetch_qqq_daily(retries=args.retries)
        qqq_merged = merge_qqq_daily(qqq_old, qqq)
        if qqq_merged:
            result["qqq_daily"] = qqq_merged
            if not args.quiet:
                _n_new = len(qqq_merged) - len(qqq_old) if qqq_old else len(qqq_merged)
                sys.stderr.write("  [QQQ] 日线 %d 条（%s ~ %s，新增 %d 条）\n" % (
                    len(qqq_merged), qqq_merged[0]["d"], qqq_merged[-1]["d"], _n_new))
        elif not args.quiet:
            sys.stderr.write("  [QQQ] 未取得日线，跳过\n")

    # 美元/离岸人民币日频汇率（自选行 + K 线）：与 QQQ 同样的增量合并
    if not args.no_fx:
        fx_old = load_existing_fx(args.output)
        # 起点跟着 qqq_daily 走（「和 QQQ 一样」）：文件里已有 QQQ 历史就取它的首日
        start = FX_SERIES_START
        _qqq_hist = load_existing_qqq(args.output)
        if _qqq_hist:
            start = min(start, _qqq_hist[0]["d"])
        fx = fetch_fx_daily(start=start, retries=args.retries)
        fx_merged = merge_fx_daily(fx_old, fx)
        # ⚠️ 必须无条件写回：result 是全新 dict，fetch 失败时 merge 返回旧数据，
        #    不写就等于把已有汇率历史抹掉。
        if fx_merged:
            result[FX_DAILY_KEY] = fx_merged
            if not args.quiet:
                _n_new = len(fx_merged) - len(fx_old) if fx_old else len(fx_merged)
                sys.stderr.write("  [FX] 汇率日线 %d 条（%s ~ %s，新增 %d 条）\n" % (
                    len(fx_merged), fx_merged[0]["d"], fx_merged[-1]["d"], _n_new))
        elif not args.quiet:
            sys.stderr.write("  [FX] 未取得汇率日线\n")

    # 10 年期美债日频（自选行 10Ymain）：与 FX 完全同语义，起始日也对齐
    if not args.no_ust:
        ust_old = load_existing_treasury(args.output)
        ust_start = FX_SERIES_START
        _qqq_hist2 = load_existing_qqq(args.output)
        if _qqq_hist2:
            ust_start = min(ust_start, _qqq_hist2[0]["d"])
        ust = fetch_treasury_daily(start=ust_start, retries=args.retries)
        ust_merged = merge_treasury_daily(ust_old, ust)
        # ⚠️ 无条件写回（与 FX 同理）：fetch 失败时 merge 返回旧数据，不写等于抹掉历史。
        if ust_merged:
            result[UST_DAILY_KEY] = ust_merged
            if not args.quiet:
                _n_new2 = len(ust_merged) - len(ust_old) if ust_old else len(ust_merged)
                sys.stderr.write("  [美债] 日线 %d 条（%s ~ %s，新增 %d 条）\n" % (
                    len(ust_merged), ust_merged[0]["d"], ust_merged[-1]["d"], _n_new2))
        elif not args.quiet:
            sys.stderr.write("  [美债] 未取得日线\n")

    # 美股市值榜（选股器「全部个股」tab）：每日快照语义，拉不到就沿用上一版
    if not args.no_us_top:
        us_old = load_existing_us_top(args.output)
        us_fresh = fetch_us_top(retries=args.retries)
        us_merged = merge_us_top(us_old, us_fresh)
        # ⚠️ 必须无条件写回（与 FX 同理）：result 是全新 dict，fetch 失败时 merge 返回旧数据，
        #    不写就等于把已有名单抹成空 → 前端「全部个股」tab 会空白。
        if us_merged:
            result[US_TOP_KEY] = us_merged
            if not args.quiet:
                _otc = us_merged.get("slots", {}).get("otc", 0)
                _tag = "" if us_fresh else "（本次未取到，沿用旧数据）"
                sys.stderr.write("  [美股榜] %d 只（含 OTC/ADR %d 只）@ %s%s\n" % (
                    len(us_merged.get("rows") or []), _otc, us_merged.get("asOf"), _tag))
        elif not args.quiet:
            sys.stderr.write("  [美股榜] 未取得名单\n")

    # 市场榜（选股器「市场」tab）：成交榜 / 涨幅榜 / 跌幅榜，各 top 10，3 次请求
    if not args.no_us_mkt:
        mkt_old = load_existing_us_mkt(args.output)
        mkt_fresh = fetch_us_market(retries=args.retries)
        mkt_merged = merge_us_market(mkt_old, mkt_fresh)
        # 同上：无条件写回，否则 fetch 失败会把已存的市场榜抹成空
        if mkt_merged:
            result[US_MKT_KEY] = mkt_merged
            if not args.quiet:
                _bs = mkt_merged.get("boards") or {}
                _tag = "" if mkt_fresh else "（本次未取到，沿用旧数据）"
                sys.stderr.write("  [市场榜] %s @ %s%s\n" % (
                    " ".join("%s%d" % (k, len(v)) for k, v in _bs.items()),
                    mkt_merged.get("asOf"), _tag))
        elif not args.quiet:
            sys.stderr.write("  [市场榜] 未取得榜单\n")

    # 增量合并：与存盘文件取并集（同日新覆盖旧），抓取失败的部分沿用旧数据
    if not args.no_merge:
        merge_with_existing(result, args.output, codes, quiet=args.quiet)

    # nav 裁剪：按各基金最早买入交易日-60天缓冲截掉更早的历史（前端 buildSeries 只从
    # 最早交易日起取数，更早的 nav 属无用冗余；东财 pingzhongdata 每次返回全史，
    # 不裁剪则文件每天膨胀回 600KB+）。最早交易日读同目录 Asset_parsed.json 的
    # seed.pa_funds[].trades；找不到该文件或某基金无交易日记录则该基金不裁剪。
    if not args.no_trim_nav:
        trim_nav(result, os.path.join(os.path.dirname(os.path.abspath(args.output)) or ".",
                                      "Asset_parsed.json"), quiet=args.quiet)

    js = json.dumps(result, ensure_ascii=False, indent=2)

    if args.no_write:
        print(js)
    else:
        try:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(js)
            if not args.quiet:
                sys.stderr.write("\n已写入 %s\n" % args.output)
        except Exception as e:  # noqa: BLE001
            sys.stderr.write("写文件失败：%s\n上方 JSON 仍可直接复制使用\n" % e)

    # 统计：成功（含代理）与失败（无 items）。跳过顶层非基金键（qqq_daily / _daily_quotes）
    NON_FUND_KEYS = (SNAPSHOT_KEY, "qqq_daily", FX_DAILY_KEY)
    ok = sum(1 for k, v in result.items()
             if k not in NON_FUND_KEYS and isinstance(v, dict) and v.get("items"))
    failed = len([c for c in codes if c not in result or not result[c].get("items")])
    if not args.quiet:
        sys.stderr.write("成功 %d 只，失败 %d 只\n" % (ok, failed))

    # 全部失败则非零退出，方便 CI 判定
    return 0 if ok > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
