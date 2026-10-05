/* =====================================================================
   资产看板 · 行情终端（框架）
   ---------------------------------------------------------------------
   数据层说明：
     - 自选列表（watchlist）：带 instId 的行来自 OKX 公开行情接口（镜像域名
       cnoyu.org）——加密货币走现货（BTC-USDT），股票/指数/商品走 USDT 永续
       （如 ORCL-USDT-SWAP）；带 txCode 的行走腾讯行情（A股指数，sh000001）；
       其余行（美元离岸/10Y 国债）无对应品种，静态占位。
     - 报价头（quote）与分时图（series）已接入 OKX：选中标的时由 loadInstrument()
       拉取 /market/ticker + /market/candles 并刷新，启动自动选中第一个、每 15s 刷新。
     - 评论（comments）仍为占位 mock，接真实数据时调 window.MarketTerminal.setData()。
   ===================================================================== */

(function () {
  'use strict';

  /* ===================================================================
     1. 数据层（占位）
     =================================================================== */

  const APP_DATA = {
    updatedAt: '2026-09-30 20:25:51',

    // 当前选中标的（默认 ORCL，启动后由 loadInstrument 填充实时数据）
    quote: {
      code: 'ORCL',
      name: '甲骨文',
      market: 'US',
      last: 0,
      change: 0,
      changePct: 0,
      prevClose: 0,
    },

    // 分时序列：由 fetchCandles() 拉取 OKX 1m K 线生成
    // [{ t: 'HH:MM', price, vol }, ...]
    series: null,

    // 自选列表（顺序与截图一致）
    //   - 带 instId 的行：实时，OKX 行情（加密=现货，股票/指数/商品=USDT 永续）
    //   - 带 txCode 的行：实时，腾讯行情（A股指数，上证=sh000001）
    //   - 不带 instId/txCode 的行：静态占位（OKX 无对应品种：美元离岸/10Y 国债）
    //   - price/pct 为主显示，extPrice/extPct 为次级「盘前」显示
    /* 自选列表。cat = 分类归属（对应顶部 全部/美股/沪深/期货/加密币 五个 tab）：
       us=美股  cn=A股/沪深  fut=期货  ccy=加密币  fx=外汇(归入期货)  bond=债券(归入期货)
       market 字段仍保留原始交易所标识（沪深/外汇/NYMEX/CME/US/USDT 等）用于副行显示，两套不要混。 */
    watchlist: [
      // ⚠️ 前两行是**静态行**：无数据源（无 instId / txCode / fxCode），点进去也没有 K 线。
      //    USDCNH 例外：2026-10-04 起读 fund_holdings.json 的 usdcnh_daily（fxCode:'USDCNH'），有日K。
      //   asOf = 数据时间备注，会显示在副行末尾；拉到日频数据后由 fetchFxWatch / fetchTreasuryWatch
      //   覆盖成真实日期，拉不到就保持「快照」（值是硬编码的截图快照，日期无从考证）。
      //   （上证指数原为静态行，2026-10-04 起改走腾讯 txCode: 'sh000001'，已实时。）
      { code: '000001',  name: '上证指数',           market: '沪深',  cat: 'cn',  price: 3842.19,  pct: 0.31,  extPrice: null,     extPct: null, txCode: 'sh000001', live: true },
      { code: 'USDCNH',  name: '美元/离岸人民币',     market: '外汇',  cat: 'fx',  price: 6.70626, pct: -0.02, extPrice: null,     extPct: null, fxCode: 'USDCNH', asOf: '快照' },
      { code: '10Ymain', name: '10年国债收益率期货',  market: '债',    cat: 'bond', price: 5.223,   pct: -0.44, extPrice: null,     extPct: null, asOf: '快照' },
      { code: 'CLmain',  name: 'WTI原油期货主连',     market: 'NYMEX', cat: 'fut', price: 90.30,    pct: 1.03,  extPrice: null,     extPct: null, instId: 'CL-USDT-SWAP',   live: true },
      { code: 'TQQQ',    name: '三倍做多纳指ETF',     market: 'US',    cat: 'us',  price: 77.460,   pct: 0.55,  extPrice: 78.300,   extPct: 1.08, instId: 'TQQQ-USDT-SWAP', live: true },
      { code: 'NQmain',  name: '纳斯达克100指数期货', market: 'CME',   cat: 'fut', price: 30723.25, pct: 0.36,  extPrice: null,     extPct: null, instId: 'US100-USDT-SWAP', live: true },
      { code: 'ORCL',    name: '甲骨文',             market: 'US',    cat: 'us',  price: 137.790,  pct: 3.91,  extPrice: 137.095,  extPct: -0.50, instId: 'ORCL-USDT-SWAP', live: true },
      { code: 'NVDA',    name: '英伟达',             market: 'US',    cat: 'us',  price: 227.210,  pct: -0.72, extPrice: 228.799,  extPct: 0.70, instId: 'NVDA-USDT-SWAP', live: true },
      { code: 'MSFT',    name: '微软',               market: 'US',    cat: 'us',  price: 508.960,  pct: -0.05, extPrice: 510.240,  extPct: 0.25, instId: 'MSFT-USDT-SWAP', live: true },
      { code: 'SNDK',    name: '闪迪',               market: 'US',    cat: 'us',  price: 1729.760, pct: 0.98,  extPrice: 1735.940, extPct: 0.36, instId: 'SNDK-USDT-SWAP', live: true },
      { code: 'HOOD',    name: '罗宾汉',             market: 'US',    cat: 'us',  price: 122.300,  pct: 2.85,  extPrice: null,     extPct: null, instId: 'HOOD-USDT-SWAP', live: true },
      { code: 'BTC-USDT', name: 'BTC', market: 'USDT', cat: 'ccy', price: 0, pct: 0, extPrice: null, extPct: null, instId: 'BTC-USDT', live: true },
      { code: 'OKB-USDT', name: 'OKB', market: 'USDT', cat: 'ccy', price: 0, pct: 0, extPrice: null, extPct: null, instId: 'OKB-USDT', live: true },
    ],

    // 评论面板
    comments: [
      { user: '34846817',       time: '1分钟前',  text: '哈哈哈，今晚10个点！',                          likes: 0, replies: 0 },
      { user: '精益求精的夏佐', time: '2分钟前',  text: '太难了！没逃跑就挨打了',                        likes: 0, replies: 0 },
      { user: '巴菲特的二大爷', time: '2分钟前',  text: '舒服了吧买多的😂😂',                            likes: 0, replies: 0 },
      { user: '巴菲特的二大爷', time: '3分钟前',  text: '怎么涨的就怎么跌下去，110补仓，前低必到，做一个脚，之后暴升', likes: 1, replies: 0 },
      { user: '兄弟你好抽象',   time: '43分钟前', text: '（暂无内容）',                                  likes: 0, replies: 0 },
    ],
  };

  // 静态标的补出「涨跌额 / 昨收」（截图只给了涨跌幅，按比例反推），供点击后报价头使用
  APP_DATA.watchlist.forEach((it) => {
    if (it.change === undefined || it.change === null) {
      const pc = it.price / (1 + (it.pct || 0) / 100);
      const dp = it.price < 1 ? 6 : 3;
      it.prevClose = +pc.toFixed(it.price < 1 ? 6 : 4);
      it.change = +(it.price - pc).toFixed(dp);
    }
  });

  /* -------------------------------------------------------------------
     K 线数据：OKX K 线接口
     - 端点 /market/candles?instId=...&bar=<bar>&limit=N（单次上限 300，最新在前）
     - 返回 data 为 [ts, open, high, low, close, vol, ...]
     - 支持 bar：1m 3m 5m 15m 30m 1H 2H 4H 6H 12H 1D 1W 1M 3M（无 1Y，年K 由 3M 本地聚合）
     ------------------------------------------------------------------- */
  async function fetchCandles(instId, limit, bar) {
    limit = limit || 100;
    const res = await fetch(
      OKX_API_BASE + '/market/candles?instId=' + encodeURIComponent(instId) +
      '&bar=' + (bar || '1m') + '&limit=' + limit
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.code !== '0' || !json.data || !json.data.length) throw new Error('empty payload');
    const rows = json.data.slice().reverse();          // 旧 -> 新
    return rows.map((r) => {
      const close = parseFloat(r[4]);
      const d = new Date(+r[0]);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return {
        t: hh + ':' + mm,
        price: close,
        vol: parseFloat(r[5]) || 0,
      };
    });
  }

  /* -------------------------------------------------------------------
     图表周期：分时 / 5日 / 日K / 周K / 月K / 季K / 年K
     - 全部画成**折线图**（与分时同一套渲染），只是数据粒度不同
     - OKX 无 bar=1Y，年K用 3M 拉全量后本地按自然年聚合
     - 分时的时段下拉（盘前/盘中/盘后/夜盘）只在 mode='time' 生效
     ------------------------------------------------------------------- */
  const CHART_MODES = {
    time: { bar: null,   limit: 0,   label: '分时' },   // null = 走时段切分逻辑
    /* 「5日」用 **5m** 而不是 1m：OKX 任何 bar 粒度单次都最多给 **1440 根**（实测 1m/3m/5m/15m/30m/1H
       全是 1440，只是覆盖时长不同：1m=1天、3m=3天、**5m=5天**、15m=15天…）。
       原来写 1m → 无论翻多少页都只能拿到 1 天，横轴退化成 10-03/10-04 两天。
       5m × 1440 = 5 天，正好对上「5日」。 */
    d5:   { bar: '5m',   limit: 1440, label: '5日', sessions: 5 },
    d1:   { bar: '1D',   limit: 220, label: '日K' },
    wk:   { bar: '1W',   limit: 160, label: '周K' },
    mo:   { bar: '1M',   limit: 120, label: '月K' },
    qr:   { bar: '3M',   limit: 80,  label: '季K' },
    yr:   { bar: '3M',   limit: 300, label: '年K', groupBy: 'year' },
  };
  let chartMode = 'time';

  /* 按自然年把 3M K 线聚合成年K：开=首开、高=最高、低=最低、收=末收、量=求和 */
  function aggregateByYear(rows) {
    const byYear = new Map();
    for (const r of rows) {                       // rows 已按时间升序
      const y = new Date(r.ts).getFullYear();
      const cur = byYear.get(y);
      if (!cur) byYear.set(y, { ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, vol: r.vol });
      else {
        cur.h = Math.max(cur.h, r.h);
        cur.l = Math.min(cur.l, r.l);
        cur.c = r.c;
        cur.vol += r.vol;
      }
    }
    return [...byYear.values()];
  }

  /* 周期 K 线 → series（折线图数据结构：t / price / vol） */
  async function fetchPeriodSeries(instId, mode) {
    const cfg = CHART_MODES[mode] || CHART_MODES.d1;

    // 5日：按美东日分组，只保留最近 N 个交易日（对齐富途的「5日」分时图）
    if (cfg.sessions) {
      /* ⚠️ OKX 对**任何 bar 粒度**单次都最多返回 **1440 根**（实测 1m/3m/5m/15m/30m/1H 全是 1440），
         翻页到第 6 页就返回空。所以覆盖时长 = 1440 × bar 粒度：
           1m → 1 天、3m → 3 天、5m → 5 天、15m → 15 天。
         「5日」必须用 **5m**（cfg.bar）；用 1m 无论翻多少页都只有 1 天，横轴退化成一个刻度。
         `need` 只用于决定翻几页，够 1440 即可（bar 粒度已决定实际覆盖范围）。 */
      const need = Math.min(cfg.limit || 1440, 1440);
      const raw = await fetchRawCandles(instId, need, cfg.bar);
      const byDay = new Map();
      for (const r of raw) {                     // 最新在前
        const et = new Date(new Date(+r[0]).toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const key = et.getFullYear() + '-' + String(et.getMonth() + 1).padStart(2, '0') + '-' + String(et.getDate()).padStart(2, '0');
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push({ ts: +r[0], price: parseFloat(r[4]), vol: parseFloat(r[5]) || 0 });
      }
      const days = [...byDay.keys()].sort().reverse().slice(0, cfg.sessions);   // 最近的 N 天
      const out = [];
      for (const d of days.sort()) {               // 旧 -> 新
        byDay.get(d).forEach((p) => {
          const dt = new Date(p.ts);
          out.push({
            t: d + ' ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0'),
            price: p.price, vol: p.vol,
          });
        });
      }
      /* 百分比轴基准 = **首根之前那个交易日的收盘**（即 prevClose）。
         取不到就退回报价头的 prevClose —— 绝不用 series[0].price（首根收盘）：
         那会让多日图标签恒为 0.00%（实测 ORCL 首点 142.46、末点也是 142.46）。
         raw 是「最新在前」，所以从**最旧那根**（raw 末尾）往前找，第一根美东日期与首点不同的即前一日收盘。
         ⚠️ 不能拿 out[0].t 反解时间戳 —— 那个 `HH:mm` 是**浏览器本地时区**写的，不是 ET。 */
      if (out.length) {
        const d0 = days[0];                          // 最早那天的 ET 日期（days 已升序）
        for (let i = raw.length - 1; i >= 0; i--) {
          const r = raw[i];
          if (new Date(+r[0]).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) !== d0) {
            out[0].prev = parseFloat(r[4]);
            break;
          }
        }
      }
      return out;
    }

    const res = await fetch(
      OKX_API_BASE + '/market/candles?instId=' + encodeURIComponent(instId) +
      '&bar=' + cfg.bar + '&limit=' + cfg.limit
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.code !== '0' || !json.data || !json.data.length) throw new Error('empty payload');
    let rows = json.data.slice().reverse().map((r) => ({   // 旧 -> 新
      ts: +r[0],
      o: parseFloat(r[1]), h: parseFloat(r[2]), l: parseFloat(r[3]), c: parseFloat(r[4]),
      vol: parseFloat(r[5]) || 0,
    }));
    if (cfg.groupBy === 'year') rows = aggregateByYear(rows);

    return rows.map((r) => {
      const d = new Date(r.ts);
      const MM = String(d.getMonth() + 1).padStart(2, '0');
      const DD = String(d.getDate()).padStart(2, '0');
      let t;
      if (cfg.groupBy === 'year') t = String(d.getFullYear());
      else if (mode === 'mo' || mode === 'qr') t = d.getFullYear() + '-' + MM;
      else if (mode === 'wk' || mode === 'd1') t = d.getFullYear() + '-' + MM + '-' + DD;
      else t = MM + '-' + DD + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
      return { t, price: r.c, vol: r.vol };
    });
  }

  /* -------------------------------------------------------------------
     美股分时时段：OKX 永续 7x24 连续交易，按美东时间把 K 线切分成
     富途风格的时段（盘前/盘中/盘后/夜盘/全天），取最近一个该时段窗口
     ------------------------------------------------------------------- */
  const US_SESSIONS = {
    pre:     { label: '盘前', match: (m) => m >= 240 && m < 570 },   // 04:00-09:30
    regular: { label: '盘中', match: (m) => m >= 570 && m < 960 },   // 09:30-16:00
    post:    { label: '盘后', match: (m) => m >= 960 && m < 1200 },  // 16:00-20:00
    night:   { label: '夜盘', match: (m) => m >= 1200 || m < 240 },  // 20:00-04:00（跨零点）
    all:     { label: '全天', match: () => true },                   // 最近 24h
  };
  function currentSessionKey() {   // 默认显示「当前进行中」的美东时段（盘前看盘前、盘中看盘中，富途同款）
    const s = usSession();         // '盘前' | null(盘中) | '盘后' | '夜盘'
    if (s === '盘前') return 'pre';
    if (s === '盘后') return 'post';
    if (s === '夜盘') return 'night';
    return 'regular';
  }
  let usSessionSel = currentSessionKey();

  function etMinutes(ts) {
    const d = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return d.getHours() * 60 + d.getMinutes();
  }

  /* 「nowTs 所在 ET 日期」再往前/后 dayOffset 天 + 当天 etMin 分钟 → UTC 时间戳。
     用「猜偏移(-4/-5) → 构造 → toLocaleString 反查分钟」自校验，夏令时也不会算错。
     抽出来是因为「1D 起点」和「各时段起点」都要用同一套换算，别各写一份。 */
  function etTsOn(nowTs, dayOffset, etMin) {
    for (const off of [-4, -5]) {
      const loc = new Date(nowTs + off * 3600e3);
      const d = new Date(Date.UTC(loc.getUTCFullYear(), loc.getUTCMonth(), loc.getUTCDate() + dayOffset));
      const guess = d.getTime() - off * 3600e3 + etMin * 60000;
      const back = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'America/New_York' }));
      if (back.getHours() * 60 + back.getMinutes() === etMin) return guess;
    }
    return nowTs + dayOffset * 86400e3;                   // 兜底
  }

  /* 「**最近一个已过的 ET 20:00**」的时间戳 —— 1D（交易日）窗口的统一起点。
     用户 2026-10-05 定稿：「美东 20:00 夜盘开始为 1D 的开始，到 24 小时后 20:00 盘后结束」，
     窗口内顺序 = 夜盘 → 盘前 → 盘中 → 盘后。
     ⚠️ **不要再用「从最新往回扫 m>=1200 的点」那种扫法**（自选页原先就是这么写的），
        它在**当前不在夜盘时**（盘前/盘中/盘后，也就是绝大多数时间）会立刻 k=0，
        然后走兜底退化成**滚动 24 小时** —— 起点变成「现在往前 24h」而不是 20:00，
        正是用户报的「1d 取了 24h 的，不对」。 */
  function etLast20Ts(nowTs) {
    return etTsOn(nowTs, etMinutes(nowTs) >= 1200 ? 0 : -1, 1200);
  }

  /* 各时段的**起始 ET 分钟**（US_SESSIONS 的 match 区间的左端）。
     用来判「当前属于今天还是昨天的这个时段」—— 见 assetSeries 里的窗口裁剪。 */
  const SESS_START_MIN = { pre: 240, regular: 570, post: 960, night: 1200 };

  /* 翻页拉取原始 K 线（最新在前），拼够 total 根或源返回空为止（单页上限 300）。
     OKX 源最多回溯 1440 根/页链，1m = 24h，对「最近一个美东 20:00 → 现在」这个窗口足够。 */
  async function fetchRawCandles(instId, total, bar) {
    const barArg = bar || '1m';
    const pages = [];
    let fetched = 0, after = null;
    const cap = Math.min(total || 1440, 1440);
    const maxPages = Math.min(12, Math.ceil(cap / 300) + 1);
    for (let p = 0; p < maxPages && fetched < cap; p++) {
      const url = OKX_API_BASE + '/market/candles?instId=' + encodeURIComponent(instId) +
        '&bar=' + barArg + '&limit=300' + (after ? '&after=' + after : '');
      const json = await fetch(url).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
      if (json.code !== '0' || !json.data || !json.data.length) break;
      pages.push(json.data);
      fetched += json.data.length;
      after = json.data[json.data.length - 1][0];    // 本页最旧一根 -> 继续往更早翻
    }
    return pages.flat();                             // 最新在前
  }

  /* 美股分时：拉取 -> 按美东时段过滤 -> 最近一个该时段窗口 -> 点序列 */
  async function fetchUsSessionSeries(instId, sessionKey) {
    const sess = US_SESSIONS[sessionKey] || US_SESSIONS.regular;
    const raw = await fetchRawCandles(instId, 1800);      // 最新在前

    /* 「全天 / 1D」特殊处理（用户 2026-10-04：「1d应该是从美东20：00（夜盘开始）算，
       不一定是之前的24小时」）：
       它不是一个"时段"（US_SESSIONS.all.match 恒为 () => true），而是一个**交易日窗口**：
       从**最近一个美东 20:00**（夜盘开盘 = 新交易日起点）一直到最新一根。
       不能用通用算法（head = 第一根 match 的点）—— all 的 match 恒真 → head=0 → 退化成滚动 24h。

       最简且不会错的写法：**「本夜盘段」= 最近一个 ET 20:00 之后的所有 K 线**。
       raw 最新在下标 0，往下标增大的方向就是时间更早。
       所以：从 0 开始一直吃「ET 分钟 >= 1200」的（20:00-23:59 段），
       碰到第一根 m < 1200 时——如果它是凌晨（m < 240），说明同一夜盘还在延续，继续吃；
       否则（盘后/盘中）说明已越过 20:00 边界，**它的下一根（更早方向的前一根）就是 20:00**，
       窗口起点 = 该下标 + 1。currentSessionKey() 保证了默认时段就是当前进行中的那个，
       所以窗口终点恒为 raw 最新那根。

       ⚠️ 两个坑（实测踩过，别再改回去）：
         1. 不要用「找第一根 m >= 1200」当起点 —— raw 最新在前，那样会命中**上一日 23:59**
            （1439 也 >= 1200），起点变成 23:59 而不是 20:00。
         2. 往更早方向吃的时候，**不能一路吃到头**：m < 240 的凌晨段属于**当前**这一夜盘
            （夜盘跨零点），不是上一夜盘。必须用上面的 m < 240 判定来区分。
       兜底：数据不足 20:00（刚上市/源刚接上）→ 退回滚动 1440 根。 */
    if (sessionKey === 'all') {
      /* ⚠️ 2026-10-05 改用 `etLast20Ts()`：**从最新往回扫 isNight** 的老写法在
         **当前不是夜盘时**（盘前/盘中/盘后 —— 一天里 16 小时都是这种）第一根就出局 → k=0
         → 兜底退化成滚动 1440 根 = 24h，起点不是 20:00（用户报「1d 取了 24h 的，不对」）。
         现在直接按时间戳切：**最近一个已过的 ET 20:00 → 最新一根**（天然 ≤ 24h，
         顺序 = 夜盘 20:00-04:00 → 盘前 04:00-09:30 → 盘中 → 盘后 16:00-20:00）。 */
      const start = etLast20Ts(Date.now());
      const rows2 = raw.filter((r) => +r[0] >= start).reverse();   // 旧 -> 新
      if (rows2.length < 2) return raw.slice(0, Math.min(raw.length, 1440)).reverse();  // 兜底
      return rows2.map((r) => {
        const d = new Date(new Date(+r[0]).toLocaleString('en-US', { timeZone: 'America/New_York' }));
        /* t 带**美东日期**前缀（"YYYY-MM-DD HH:mm"）：这个窗口会跨日界，只给 HH:MM 分不清哪天。
           drawChart 的横轴在 `usSessionSel==='all'` 时会据此在日界处画竖线 + MM/DD 标注。 */
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return {
          t: y + '-' + mo + '-' + dd + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
          price: parseFloat(r[4]), vol: parseFloat(r[5]) || 0,
        };
      });
    }

    // 从最新往回找最近的该时段窗口：先跳过更新的非本时段 K 线（head），
    // 再向更早延伸（tail），直到遇到第一个不属于该时段的 K 线
    let head = -1;
    for (let i = 0; i < raw.length; i++) {
      if (sess.match(etMinutes(+raw[i][0]))) { head = i; break; }
    }
    if (head < 0) throw new Error('该时段暂无数据');
    let tail = head;
    while (tail + 1 < raw.length && sess.match(etMinutes(+raw[tail + 1][0]))) tail++;

    // 单个时段最长不超过 1440 根（一天）
    let lo = head, hi = tail + 1;
    if (hi - lo > 1440) lo = hi - 1440;
    const rows = raw.slice(lo, hi).reverse();             // 旧 -> 新

    return rows.map((r) => {
      const close = parseFloat(r[4]);
      const d = new Date(new Date(+r[0]).toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return { t: hh + ':' + mm, price: close, vol: parseFloat(r[5]) || 0 };
    });
  }

  /* 选中某标的：同步报价头 + 分时图（点击 / 首次加载 / 定时刷新都走这里） */
  async function loadInstrument(code) {
    const item = APP_DATA.watchlist.find((x) => x.code === code);
    if (item) {
      APP_DATA.quote = Object.assign({}, APP_DATA.quote, {
        code: item.code, name: item.name, market: item.market,
        last: item.price, change: item.change,
        changePct: item.pct, prevClose: item.prevClose,
      });
      renderQuote(APP_DATA.quote);
    }

    // 分时下拉入口仅美股 + 分时模式显示；其他周期一律收起
    const pt = $('#periodTab');
    const menu = $('#usSessionMenu');
    const showSessionCaret = !!(item && item.market === 'US' && chartMode === 'time');
    if (pt) pt.classList.toggle('has-caret', showSessionCaret);
    if (menu && !showSessionCaret) menu.hidden = true;

    // 无数据源的静态行（美元离岸/10Y）没有 K 线 -> 分时图显示空白背景
    if (!item || (!item.instId && !item.txCode && !item.fxCode)) {
      APP_DATA.series = null;
      drawChart();
      return;
    }

    try {
      let series;
      if (item.fxCode) {
        /* 外汇（USDCNH）：frankfurter 只有**日频收盘价**，没有分时 → 「分时」空白；
           5日 / 日K / 周K / 月K / 季K / 年K 都有（周~年K 由日线本地聚合）。
           数据 2000-01-13 起（ECB 把 CNY 纳入参考汇率的那天），约 6.8k 个交易日。 */
        if (chartMode === 'time') {
          APP_DATA.series = null;
          drawChart();
          return;
        }
        series = await fetchFxPeriodSeries(chartMode);
      } else if (item.txCode) {
        // 腾讯源（上证指数）：分时走 minute/query，其余周期走 fqkline / mkline
        series = (chartMode === 'time')
          ? await fetchTxTimeSeries(item.txCode)
          : await fetchTxPeriodSeries(item.txCode, chartMode);
      } else if (chartMode === 'time') {
        // 分时：美股按选中时段（盘前/盘中/盘后/夜盘/全天）切分；其余：最近 100 根 1m
        series = (item.market === 'US')
          ? await fetchUsSessionSeries(item.instId, usSessionSel)
          : await fetchCandles(item.instId, 100, '1m');
      } else {
        // K 线周期：5日/日K/周K/月K/季K/年K（折线图，与分时同一渲染）
        series = await fetchPeriodSeries(item.instId, chartMode);
      }
      APP_DATA.series = series;
      drawChart();
    } catch (e) {
      console.warn('[图表] 拉取失败，沿用上次数据：', e);
    }
  }

  /* -------------------------------------------------------------------
     自选行情：OKX 公开接口（镜像域名 cnoyu.org）
     - 数据来自 https://www.cnoyu.org/api/v5/market/ticker?instId=xxx
     - 该接口 CORS 反射 Origin，浏览器内可直接 fetch，无需代理
     - 加密货币走现货（BTC-USDT），股票/指数/商品走 USDT 永续（ORCL-USDT-SWAP）
     - 实时标的清单 = 自选中带 instId 的行
     ------------------------------------------------------------------- */
  const OKX_API_BASE = 'https://www.cnoyu.org/api/v5';
  const LIVE_INST_IDS = APP_DATA.watchlist.filter((x) => x.instId).map((x) => x.instId);

  /* -------------------------------------------------------------------
     涨跌幅基准：美股/期货用「前一日美东收盘价」（16:00 ET），其余用 open24h
     - 美东收盘价由小时线推算：最近一根 美东周五~周一 15:00-16:00 的已完结 K 线收盘
       （15:00 那根的收盘时刻即 16:00，周末自然落到周五）
     - 缓存 10 分钟：收盘基准一天只变一次，没必要每轮刷新都拉
     ------------------------------------------------------------------- */
  const BASE_MARKETS = new Set(['US', 'CME', 'NYMEX', 'USDT']);   // USDT = 加密货币，同样按美股口径
  const BASE_TTL = 10 * 60 * 1000;
  const prevCloseCache = {};                       // instId -> { value, at }

  async function fetchPrevCloseET(instId) {
    const res = await fetch(
      OKX_API_BASE + '/market/candles?instId=' + encodeURIComponent(instId) +
      '&bar=1H&limit=120'                          // 120h 内必含最近两个「工作日 15 点」K 线（周末自动回退到周五/周四）
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.code !== '0' || !json.data || !json.data.length) throw new Error('empty payload');
    const now = Date.now();
    const closes = [];
    for (const r of json.data) {                   // 最新在前 → 依次命中最近两个已完成交易日
      const ts = +r[0];
      const et = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const dow = et.getDay();
      if (dow >= 1 && dow <= 5 && et.getHours() === 15 && ts + 3600e3 <= now) {
        closes.push(parseFloat(r[4]));
        if (closes.length >= 2) break;
      }
    }
    return { prev: closes[0] || null, prev2: closes[1] || null };
  }

  function getPrevCloseET(instId) {
    const c = prevCloseCache[instId];
    if (c && Date.now() - c.at < BASE_TTL) return Promise.resolve(c);
    return fetchPrevCloseET(instId).then((v) => {
      if (v && v.prev) prevCloseCache[instId] = { prev: v.prev, prev2: v.prev2, at: Date.now() };
      return v;
    });
  }

  async function fetchWatchlist() {
    try {
      // 行情与「美东收盘基准」并行拉取
      const [results] = await Promise.all([
        Promise.all(LIVE_INST_IDS.map((id) =>
          fetch(OKX_API_BASE + '/market/ticker?instId=' + encodeURIComponent(id))
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        )),
        Promise.all(APP_DATA.watchlist
          .filter((x) => x.instId && BASE_MARKETS.has(x.market))
          .map((x) => getPrevCloseET(x.instId).catch(() => null))),
      ]);

      const byId = {};
      for (const res of results) {
        if (!res || res.code !== '0' || !res.data || !res.data[0]) continue;
        byId[res.data[0].instId] = res.data[0];
      }

      // 按 instId 就地更新对应行，静态标的原样保留
      let updated = 0;
      for (const instId of LIVE_INST_IDS) {
        const d = byId[instId];
        if (!d) continue;
        const item = APP_DATA.watchlist.find((x) => x.instId === instId);
        if (!item) continue;
        const last = parseFloat(d.last);
        const open = parseFloat(d.open24h);
        // 美股/期货：以前一日美东收盘为基准（取不到时退回 open24h）
        const base = (BASE_MARKETS.has(item.market) && prevCloseCache[instId])
          ? prevCloseCache[instId].prev
          : open;
        const pct = base ? (last - base) / base * 100 : 0;
        item.price = last;
        item.pct = +pct.toFixed(2);
        item.change = +(last - base).toFixed(last < 1 ? 6 : 2);
        item.prevClose = base;
        // 美股：延长时段（盘前/盘后/夜盘）主行改显「昨收快照」——昨收价 + 昨收相对前收的涨跌幅，
        // 现价与相对昨收的涨跌挪到副行小字（富途盘前样式）；prev2/prevDayPct 供渲染用
        if (item.market === 'US') {
          const pc = prevCloseCache[instId] || {};
          item.prev2 = pc.prev2 || null;
          item.prevDayPct = (pc.prev && pc.prev2)
            ? +((pc.prev - pc.prev2) / pc.prev2 * 100).toFixed(2) : null;
          item.extPrice = last;
          item.extPct = base ? +((last - base) / base * 100).toFixed(2) : null;
        } else {
          item.extPrice = null;
          item.extPct = null;
        }
        updated++;
      }

      if (updated) {
        renderWatchlist(APP_DATA.watchlist, APP_DATA.quote.code);
        // 刷新当前选中（首次加载时初始 quote 为 BTC-USDT，会直接选中它）
        const sel = APP_DATA.watchlist.find((x) => x.code === APP_DATA.quote.code)
                 || APP_DATA.watchlist.find((x) => x.live)
                 || APP_DATA.watchlist[0];
        loadInstrument(sel.code);
      }
    } catch (e) {
      console.warn('[自选] 行情拉取失败，沿用上次数据：', e);
    }
  }

  /* -------------------------------------------------------------------
     腾讯行情（A股/港股/美股指数与个股）：OKX 拿不到的品种走这里
     -------------------------------------------------------------------
     快照：GET https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=<code>,day,,,<n>,qfq
       → data[code].qt[code] =扁平快照数组（见 TX_QT 字段表）
       → data[code].day = [[日期,开,收,高,低,量], ...]（**升序**，末根最新）
     分时：GET .../appstock/app/minute/query?code=<code>
       → data[code].data = { date:'YYYYMMDD', data:['HHMM 价 量 额', ...] }
     分钟K：GET .../appstock/app/kline/mkline?param=<code>,m5,,<n>
       → data[code].m5 = [[YYYYMMDDHHMM,开,收,高,低,量,{},均价], ...]（升序）
     ⚠️⚠️ **三个端点一律用无 www 的 `ifzq.gtimg.cn`**（2026-10-04 修，勿改回 web.）：
       `web.ifzq.gtimg.cn` 的 **fqkline 被腾讯 WAF 拦了** —— 返回 501 + 一个
       `location.href="https://waf.tencent.com/501page.html?u=..."` 的 HTML 跳转页，
       响应头**没有任何 Access-Control-Allow-Origin** → 浏览器 fetch 直接抛
       "blocked by CORS policy"，`txGetUsDay()` 拿到 null → `VAL.txUs` 全空→
       `symbolChg('MU','us')` 恒返回 null → **每只基金的所有美股成分股都退化到
       「QQQ 兜底」**，于是持仓页基金的估值涨跌全部等于 QQQ 涨幅、看着「一动不动」
       （且几只不同持仓的基金涨跌幅一模一样，全是 QQQ 的数）。这就是本条修复的起因。
       `minute/query` 在 web. 上还能用，但为了一致性也统一走 ifzq。
     三个端点都发 `Access-Control-Allow-Origin: *`，浏览器可直连。
     ⚠️ 腾讯**没有季K**（season/quarter 均报错），季K 用月K按季度本地聚合；年K 腾讯只给 1 根，也本地聚合。
     ------------------------------------------------------------------- */
  const TX_FQ_BASE = 'https://ifzq.gtimg.cn/appstock/app/fqkline/get';
  const TX_MIN_BASE = 'https://ifzq.gtimg.cn/appstock/app/minute/query';
  const TX_MK_BASE = 'https://ifzq.gtimg.cn/appstock/app/kline/mkline';

  /* qt 扁平数组下标（实测 88 长度，指数/个股通用） */
  const TX_QT = {
    name: 1, code: 2, last: 3, prevClose: 4, open: 5, vol: 6,
    time: 30, change: 31, pct: 32, high: 33, low: 34,
  };

  async function txGetJson(url) {
    const res = await Promise.race([
      fetch(url),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.code !== 0 || !json.data) throw new Error('bad payload');
    return json.data;
  }

  /* 腾讯快照 -> { last, prevClose, change, pct, vol, time } */
  function parseTxQuote(qt) {
    if (!Array.isArray(qt) || qt.length < 35) return null;
    const n = (i) => parseFloat(qt[i]);
    const last = n(TX_QT.last);
    if (!(last > 0)) return null;
    return {
      name: qt[TX_QT.name],
      last,
      prevClose: n(TX_QT.prevClose),
      change: n(TX_QT.change),
      pct: n(TX_QT.pct),
      vol: n(TX_QT.vol) || 0,
      open: n(TX_QT.open),
      high: n(TX_QT.high),
      low: n(TX_QT.low),
      time: qt[TX_QT.time] || '',
    };
  }

  /* 快照 + 日K 一次拿（fqkline 同时返回 qt 和 day，不用额外请求） */
  async function fetchTxQuote(txCode) {
    const data = await txGetJson(TX_FQ_BASE + '?param=' + txCode + ',day,,,2,qfq');
    const node = data[txCode];
    if (!node) throw new Error('no ' + txCode);
    const q = parseTxQuote(node.qt && node.qt[txCode]);
    if (!q) throw new Error('empty qt');
    return q;
  }

  /* 腾讯 K 线：period = day | week | month（无季K/年K） */
  async function fetchTxKline(txCode, period, n) {
    const data = await txGetJson(
      TX_FQ_BASE + '?param=' + txCode + ',' + period + ',,' + ',' + (n || 320) + ',qfq'
    );
    const node = data[txCode] || {};
    const rows = node[period] || node.day || node.week || node.month;
    if (!rows || !rows.length) throw new Error('empty ' + period);
    return rows;                                   // [日期,开,收,高,低,量]，已升序
  }

  /* 分时：minute/query -> series（t 为 'HH:MM'） */
  async function fetchTxTimeSeries(txCode) {
    const data = await txGetJson(TX_MIN_BASE + '?code=' + txCode);
    const box = data[txCode] && data[txCode].data;
    if (!box || !box.data || !box.data.length) throw new Error('empty minute');
    /* ⚠️ 腾讯 minute/query 每行是 `HHMM 价格 成交量 成交额`，其中后两个字段是
       **当日累计值**（实测单调递增，末行 = 全天总量 414560247 / 679398992444.8），
       不是「这一分钟」的量。直接当单根量用会画出一根根递增的阶梯（用户 2026-10-04 截图指正）。
       → 必须差分成单根量。首行取原值（当日第一分钟 = 累计值 = 单根值）。 */
    const rows = box.data.map((r) => {
      const p = String(r).trim().split(/\s+/);
      return {
        t: p[0].slice(0, 2) + ':' + p[0].slice(2, 4),
        price: parseFloat(p[1]),
        cumVol: parseFloat(p[2]) || 0,       // 累计成交量（手）
      };
    });
    return rows.map((r, i) => ({
      t: r.t,
      price: r.price,
      // 差分求单根量；负数（源侧偶发回退）钳到 0，避免柱子朝下
      vol: i === 0 ? r.cumVol : Math.max(0, r.cumVol - rows[i - 1].cumVol),
    }));
  }

  /* 分钟K（5m）：mkline -> series。t = 'YYYY-MM-DD HH:MM'（5日图按天分组要用完整日期） */
  async function fetchTxMinuteKline(txCode, m5, n) {
    const data = await txGetJson(
      TX_MK_BASE + '?param=' + txCode + ',' + (m5 || 'm5') + ',,' + (n || 640)
    );
    const rows = data[txCode] && data[txCode][m5 || 'm5'];
    if (!rows || !rows.length) throw new Error('empty m5');
    return rows.map((r) => {
      const d = String(r[0]);                       // 'YYYYMMDDHHMM'
      const day = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
      const hm = d.slice(8, 10) + ':' + d.slice(10, 12);
      return { ts: d, day, t: day + ' ' + hm, price: parseFloat(r[2]), vol: parseFloat(r[5]) || 0 };
    });
  }

  /* 5日图：m5 分钟K按交易日分组，只保留最近 N 天（对齐富途「5日」横轴按天刻度） */
  async function fetchTxFiveDaySeries(txCode, sessions) {
    const need = Math.min((sessions || 5) * 130, 640);      // A股一天约 48 根 5m，多取以防分组不足
    const rows = await fetchTxMinuteKline(txCode, 'm5', need);
    const byDay = new Map();
    for (const r of rows) {                                  // rows 已升序
      if (!byDay.has(r.day)) byDay.set(r.day, []);
      byDay.get(r.day).push(r);
    }
    const days = [...byDay.keys()].sort();
    const keep = days.slice(-(sessions || 5));
    const out = [];
    for (const d of keep) {
      for (const r of byDay.get(d)) out.push({ t: r.t, price: r.price, vol: r.vol });
    }
    /* 百分比轴基准 = 最早一天**之前**那个交易日的收盘（取该日最后一根 5m 的收盘）。
       没有更早一天就退回报价头 prevClose（drawChart 有兜底）。 */
    const firstDay = keep[0];
    const beforeDays = days.filter((d) => d < firstDay);
    if (out.length && beforeDays.length) {
      const before = byDay.get(beforeDays[beforeDays.length - 1]);
      out[0].prev = before[before.length - 1].price;
    }
    return out;
  }

  /* 月K -> 季K / 年K 本地聚合（腾讯无 season 端点，年K 也只给 1 根） */
  function aggregateTxBy(rows, unit) {
    const byKey = new Map();
    for (const r of rows) {                                  // 升序
      const ds = String(r[0]);
      const y = ds.slice(0, 4);
      const m = +ds.slice(5, 7);
      const key = unit === 'year' ? y : y + '-Q' + Math.ceil(m / 3);
      const cur = byKey.get(key);
      if (!cur) byKey.set(key, { key, o: r[1], h: r[3], l: r[4], c: r[2], vol: r[5], y: +y, mm: m });
      else {
        cur.h = Math.max(+cur.h, +r[3]);
        cur.l = Math.min(+cur.l, +r[4]);
        cur.c = r[2];
        cur.vol = (+cur.vol || 0) + (+r[5] || 0);
        cur.mm = m;                                          // 记末月，季K 标签用
      }
    }
    return [...byKey.values()].sort((a, b) => (a.y - b.y) || (a.mm - b.mm));
  }

  /* 腾讯周期 K 线 -> series（t 格式与 OKX 路径保持一致，drawChart 通用） */
  async function fetchTxPeriodSeries(txCode, mode) {
    const cfg = CHART_MODES[mode] || CHART_MODES.d1;
    // 季K/年K：拉月K再聚合（腾讯无季K）
    if (mode === 'qr' || mode === 'yr') {
      const months = await fetchTxKline(txCode, 'month', 120);
      const agg = aggregateTxBy(months, mode === 'yr' ? 'year' : 'quarter');
      /* 标签与 OKX 路径同口径：年K = 'YYYY'，季K = 'YYYY-MM'（取该季末月的月份）。
         drawChart 的月K/季K 标签走 `else` 分支直接画 t，'2026-09' 这种最清楚。 */
      return agg.map((r) => ({
        t: mode === 'yr' ? String(r.y) : r.y + '-' + String(r.mm).padStart(2, '0'),
        price: +r.c, vol: +r.vol || 0,
      }));
    }
    if (mode === 'd5') return fetchTxFiveDaySeries(txCode, cfg.sessions);

    // day / week / month：直接取，行数与 OKX 路径对齐
    const period = mode === 'd1' ? 'day' : mode === 'wk' ? 'week' : 'month';
    const n = mode === 'd1' ? 320 : mode === 'wk' ? 320 : 120;
    const rows = await fetchTxKline(txCode, period, n);
    return rows.map((r) => {
      const ds = String(r[0]);
      return { t: mode === 'mo' ? ds.slice(0, 7) : ds, price: +r[2], vol: +r[5] || 0 };
    });
  }

  /* -------------------------------------------------------------------
     外汇（自选里的「美元/离岸人民币」USDCNH）—— 唯一有 K 线的外汇品种。

     ⚠️ 2026-10-04 定稿：**数据源改成 `fund_holdings.json` 的 `usdcnh_daily`**，
        前端**不再直连 frankfurter**，与 qqq_daily 完全同构（每天拉一次、只读最新）：
          - `fund_holdings.py` 里的 `fetch_fx_daily()` 抓 `api.frankfurter.dev`
            （ECB 每日参考价 base=USD&symbols=CNY），增量合并进 `usdcnh_daily`；
          - 抓取走 **curl 优先**（本机有 HTTPS 中间人代理，Python 校验证书会失败）；
          - 起点与 `qqq_daily` 对齐（2025-01-02），旧历史以存盘数据为准。
        为什么不再浏览器直连：① 浏览器直连 frankfurter 会偶发
        `ERR_CERT_COMMON_NAME_INVALID`（fetch 静默失败 → 行没价、K 线空白）；
        ② 每 60s 拉一次 190KB 全量太浪费。
        ⚠️ frankfurter 本身能回溯到 **2000-01-13**（ECB 纳入 CNY 的那天，约 6.8k 个交易日），
        想看更长历史把 `fund_holdings.py` 的 `FX_SERIES_START` 改早、重跑一次即可。
     - ⚠️ 只有**收盘中间价**（O=H=L=C 全等于收盘），没有真 OHLC / 成交量 —— 所以画的是
        日线**折线**（与腾讯/OKX 路径一致），不是蜡烛图。周/月/季/年同样按收盘聚合。
     - 口径是 **ECB 在岸 CNY 参考价**，与离岸 CNH 现货有几十个基点价差，日线走势一致；
        周末与 ECB 假日不更新（停在上一个交易日）。
     ------------------------------------------------------------------- */
  const FX_KEY = 'usdcnh_daily';// fund_holdings.json 里的顶层键
  const FX_JSON = 'fund_holdings.json';

  /* 汇率序列缓存： fund_holdings.json 有 90KB，自选行每 60s 刷一次时不能反复重拉。
     10 分钟过期即可 —— 源文件本身一天才变一次（workflow 每日提交）。 */
  let fxCache = { at: 0, rows: null };
  const FX_CACHE_MS = 10 * 60 * 1000;
  async function loadFxSeries() {
    if (fxCache.rows && Date.now() - fxCache.at < FX_CACHE_MS) return fxCache.rows;
    const r = await Promise.race([
      fetch(FX_JSON + '?t=' + Date.now()),          // 绕开浏览器对 JSON 的强缓存
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
    ]);
    if (!r.ok) throw new Error('fund_holdings.json http ' + r.status);
    const d = await r.json();
    const src = d && d[FX_KEY];
    if (!Array.isArray(src) || !src.length) throw new Error('usdcnh_daily 缺失');
    /* ⚠️ 不能用账户闭包里的 `ymd()` —— 它定义在initAccountData 内部，本模块取不到
       （踩过一次：整条链静默失败，K 线空白、行价不更新、还每次都重拉 JSON）。 */
    const rows = src
      .map((x) => {
        const s = String((x && x.d) || '');
        const ts = /^\d{8}$/.test(s) ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : s;
        return { ts, c: +(x && x.c) };
      })
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.ts) && x.c > 0)
      .sort((a, b) => (a.ts < b.ts ? -1 : 1));
    if (!rows.length) throw new Error('usdcnh_daily 无有效行');
    fxCache = { at: Date.now(), rows };
    return rows;
  }

  /* 给序列首根补「前一根收盘」—— drawChart 的百分比轴靠 `series[0].prev` 当基准 */
  function withPrev(rows) {
    const out = rows.map((r) => Object.assign({}, r, { prev: null }));
    for (let i = 1; i < out.length; i++) out[i].prev = out[i - 1].c;
    return out;
  }

  /* ISO 周的周一（作周K 的分组键与标签，与腾讯路径的周K 标签口径一致） */
  function isoMonday(ts) {
    const d = new Date(ts + 'T00:00:00Z');
    const dow = (d.getUTCDay() + 6) % 7;                 // 周一 = 0
    return new Date(d.getTime() - dow * 864e5).toISOString().slice(0, 10);
  }

  /* 日频收盘 → 周/季/月/年聚合（极值取该区间收盘的 max/min，因为源本身没有 OHLC） */
  function aggregateFxBy(rows, unit) {
    const byKey = new Map();
    for (const r of rows) {                                   // 升序
      const y = r.ts.slice(0, 4);
      const m = +r.ts.slice(5, 7);
      /* ⚠️ week 必须单独分支：漏掉它会掉进下面的 `y-MM` 月度桶，「周K」画出来的其实是月K。 */
      const key = unit === 'year' ? y : unit === 'week' ? isoMonday(r.ts)
        : unit === 'quarter' ? y + '-Q' + Math.ceil(m / 3)
          : y + '-' + String(m).padStart(2, '0');
      const cur = byKey.get(key);
      if (!cur) byKey.set(key, { key, c: r.c, hi: r.c, lo: r.c, y: +y, mm: m, endTs: r.ts });
      else {
        cur.c = r.c;
        cur.hi = Math.max(cur.hi, r.c);
        cur.lo = Math.min(cur.lo, r.c);
        cur.mm = m;                                           // 记末月，季/月标签用
        cur.endTs = r.ts;                                     // 记末日，周K 标签用
      }
    }
    /* 按 endTs 排最稳：周分组的 y/mm 只是周一所在月，跨月周会错序。 */
    return [...byKey.values()].sort((a, b) => (a.endTs < b.endTs ? -1 : 1));
  }

  /* 外汇周期序列 → series。'd5' = 最近 5 个交易日；'d1' 取最近 320 个交易日；其余本地聚合 */
  async function fetchFxPeriodSeries(mode) {
    const rows = withPrev(await loadFxSeries());
    if (mode === 'd5') {
      return rows.slice(-5).map((r) => ({ t: r.ts, price: r.c, vol: 0, prev: r.prev }));
    }
    if (mode === 'd1' || !mode) {
      return rows.slice(-320).map((r) => ({ t: r.ts, price: r.c, vol: 0, prev: r.prev }));
    }
    const unit = mode === 'wk' ? 'week' : mode === 'mo' ? 'month'
      : mode === 'qr' ? 'quarter' : 'year';
    const agg = aggregateFxBy(rows, unit);
    return agg.map((r, i) => ({
      t: unit === 'year' ? String(r.y)
        : unit === 'week' ? r.key
          : (unit === 'month' || unit === 'quarter')
            ? r.key.slice(0, 4) + '-' + r.key.slice(5, 7)
            : String(r.endTs),
      price: r.c, vol: 0,
      prev: i > 0 ? agg[i - 1].c : rows[0].prev,
    }));
  }

  /* 自选列表里的腾讯行：就地更新（与 fetchWatchlist 独立，失败不影响 OKX 行情） */
  const TX_ROWS = APP_DATA.watchlist.filter((x) => x.txCode);

  async function fetchTxWatch() {
    if (!TX_ROWS.length) return;
    try {
      const res = await Promise.all(TX_ROWS.map((r) => fetchTxQuote(r.txCode).catch(() => null)));
      let updated = 0;
      TX_ROWS.forEach((row, i) => {
        const q = res[i];
        if (!q) return;
        row.price = q.last;
        row.pct = q.pct;
        row.change = q.change;
        row.prevClose = q.prevClose;
        // A股没有盘前盘后，ext 恒空（渲染层只对 market==='US' 用 ext，这里保持一致）
        row.extPrice = null;
        row.extPct = null;
        // ⚠️ 刻意**不写** asOf：asOf 是「无 K 线静态行」的数据时间备注（见 renderWatchlist）。
        //   腾讯行已是实时行情，周末休市时显示上一交易日日期反而像过期数据，与约定不符。
        updated++;
      });
      if (updated) {
        renderWatchlist(APP_DATA.watchlist, APP_DATA.quote.code);
        const sel = APP_DATA.watchlist.find((x) => x.code === APP_DATA.quote.code);
        if (sel && sel.txCode) loadInstrument(sel.code);   // 选中的是腾讯行才重画图表
      }
    } catch (e) {
      console.warn('[腾讯] 行情拉取失败，沿用上次数据：', e);
    }
  }

  /* ===================================================================
     2. 工具函数
     =================================================================== */
  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = (n, d) => (n === null || n === undefined) ? '--' : Number(n).toFixed(d === undefined ? 2 : d);
  const fmtPct = (n) => (n === null || n === undefined) ? '--' : (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
  const cls = (n) => (n === null || n === undefined) ? 'flat' : (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

  /* 美股时段（按美东时间，自动含夏令时）：返回当前延长时段标签；正常时段返回 null（副行不显示）
     盘前 04:00-09:30 | 正常 09:30-16:00 | 盘后 16:00-20:00 | 夜盘 20:00-04:00 */
  function usSession() {
    try {
      const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const m = et.getHours() * 60 + et.getMinutes();
      if (m >= 240 && m < 570)  return '盘前';
      if (m >= 570 && m < 960)  return null;
      if (m >= 960 && m < 1200) return '盘后';
      return '夜盘';
    } catch (e) { return null; }
  }

  const AVATAR_COLORS = ['#2e6bff', '#ea3b3b', '#00a86b', '#ff8f1f', '#9b6bff', '#e64980'];
  const hashColor = (str) => {
    let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  };

  const ICON_LIKE = '<svg viewBox="0 0 24 24" class="ic"><path d="M7 10v10H4V10zM7 10l4-7a2 2 0 0 1 3 2v4h5a2 2 0 0 1 2 2.4l-1.3 6A2 2 0 0 1 17.7 19H7"/></svg>';
  const ICON_CMT  = '<svg viewBox="0 0 24 24" class="ic"><path d="M4 5h16v11H9l-5 4z"/></svg>';

  // canvas 绘图配色（与 styles.css 浅色主题保持一致）
  const THEME = {
    grid:       'rgba(15,23,42,0.06)',
    axisText:   '#949aab',
    up:         '#00a86b',   // 涨 = 绿
    down:       '#ea3b3b',   // 跌 = 红
    flat:       '#949aab',
    priceLine:  '#2e6bff',
    fillTop:    'rgba(46,107,255,0.16)',
    fillBottom: 'rgba(46,107,255,0.01)',
    volBar:     'rgba(46,107,255,0.45)',
  };

  /* ===================================================================
     3. 渲染
     =================================================================== */

  function renderQuote(q) {
    if (!q) return;
    $('#qCode').textContent = q.code;
    $('#qName').textContent = q.name;
    $('#qLast').textContent = fmt(q.last, 3);
    $('#qChange').textContent = (q.change > 0 ? '+' : '') + fmt(q.change, 3);
    $('#qPct').textContent = fmtPct(q.changePct);
    const c = cls(q.changePct);
    ['#qLast', '#qChange', '#qPct'].forEach((s) => {
      const el = $(s);
      el.classList.remove('up', 'down', 'flat');
      el.classList.add(c);
    });
  }

  /* 自选分类：顶部 tab 的当前选中项（'all' / us / cn / fut / ccy）。
     外汇(USDCNH)与债券(10Y)归入「期货」——那组本来就是大类行情位。 */
  const WL_CAT_OF = { fx: 'fut', bond: 'fut' };
  let wlCat = 'all';
  let wlTradeCat = 'all';      // 持仓页分类：'all' 全部 / 'us' 证券 / 'fund' 基金（与行情页独立）

  /* ---- 交易页持仓数据（由 initAccountData 数据就绪时填充，见 aoState.series 赋值处） ---- */
  const TRADE_POS = { stock: [], fund: [], fx: 1, totalCny: null, cashCny: 0, ibkrCashCny: 0, ready: false };

  /* 交易页持仓汇总。**推算总资产 = 上面那 8 行的市值之和 + 现金**（用户 2026-10-04 要求：
     「推算总资产不应该是交易里市值加起来吗」）—— 所以这里的两项构成必须与**行内所见**完全同口径：
       持仓市值合计 = Σ证券 valueCny + Σ基金 estAmount（基金用估算市值，即行里那个数）
       现金         = 盈透账户内现金 + 各银行账户现金（都不在持仓列表里，单独列一行）
     与账户总资产差额 = 推算总资产 − 账户页 totalCny（账户页是**账面口径**：基金按官方净值 navL、
       证券按同一时刻实时价），所以它现在 ≈ 基金的实时估值增量（正常几厘到 1 个点），
       不再是恒 0；恒 0 会被「基金估值 vs 官方净值」的差吃掉，反而看不清。 */
  /* 分时图是否正在页内展开（移动端）。汇总框据此隐藏：
     用户 2026-10-05：「移动端点了分时走势后账户资产那些就隐藏吧，下面只留分时走势」。
     ⚠️ 必须走这个状态位而不是在 open/close 里直接改 `tradeSum.hidden` ——
        renderTradeSum 每次刷新都会 `box.hidden = false` 把它重新亮回来。 */
  let assetSheetOpen = false;

  function renderTradeSum() {
    const box = document.getElementById('tradeSum');
    if (!box) return;
    if (!TRADE_POS.ready || TRADE_POS.totalCny == null) { box.hidden = true; return; }
    box.hidden = assetSheetOpen;   // 分时图展开时让位（收起后自动恢复）
    /* 金额一律**取整**（用户 2026-10-05：「都保留到整数」）：几十万量级的小数点没有信息量，
       还会把这一格撑宽、右侧美元/利息两行被挤到横滚区。
       ⚠️ 先 Math.round(Math.abs(v)) 再自己拼符号：直接 Math.round(-0.5) 会得到 -0（显示成 "-0"）。 */
    const f2 = (v, sign) => {
      if (v == null || !isFinite(v)) return '--';
      const s = Math.round(Math.abs(v)).toLocaleString('en-US');
      return (sign ? (v > 0 ? '+' : v < 0 ? '-' : '') : (v < 0 ? '-' : '')) + s;
    };
    const fx = TRADE_POS.fx || 1;
    /* 推算总资产 = **上面 8 行的市值求和 + 现金**（用户 2026-10-04 定稿）。
       市值取值必须与行内所见完全一致，否则「加起来」对不上：
         证券 = tradeValueCny（OKX/腾讯价 × 数量），退到 valueCny（Alpaca 账面价）
       ⚠️ 2026-10-05：这条链**不再兜底 IBKR 快照市值 posVal0**（用户：「市值合计也不用保留
          ibkr 快照兜底，没有意义」）。没有实时价的行现在**不计入**，而不是拿旧快照充数 ——
          充数会让「推算总资产」在 Alpaca 挂掉时显示一个看似正常的数，
          与汇总框第一行的「账户资产」差额巨大却看不出原因。 */
    let stockNow = 0;
    TRADE_POS.stock.forEach((r) => {
      const v = r.tradeValueCny != null ? r.tradeValueCny
        : (r.valueCny != null ? r.valueCny : null);
      if (v != null) stockNow += v;
    });
    let fundNow = 0;
    TRADE_POS.fund.forEach((f) => { fundNow += (f.estAmount != null ? f.estAmount : f.amount) || 0; });
    const posSum = stockNow + fundNow;                    // 持仓市值合计（= 8 行求和）
    const cashSum = TRADE_POS.ibkrCashCny + TRADE_POS.cashCny;
    const estCny = posSum + cashSum;                      // 推算总资产
    /* 给「推算总资产分时图」留一份同口径的拆解（见 assetSeries）。
       ⚠️ 必须在 estCny 之后同步存，不能等下一次刷新 —— 绘图是异步的，
          晚一步就会拿到上一轮的股数/基金值，曲线末点会和汇总对不上。 */
    TRADE_POS.parts = {
      fx,
      /* 曲线基准 = **账户资产**（用户 2026-10-05：「涨跌幅基准应该是账户资产 1052275」）。
         与下面第一行「账户资产」同源同刻，曲线末点的 % 与汇总框的「差额 %」因此对得上。
         必须在 estCny 之后同步存 —— 绘图是异步的，晚一步会拿到上一轮的基准。 */
      base: TRADE_POS.totalCny,
      cash: cashSum,
      fund: fundNow,                                                    // 当日基金估值（盘中无分钟级数据 → 常数）
      fundPrev: TRADE_POS.fund.reduce((s, f) => s + (f.amount || 0), 0), // 昨收官方净值市值（基准之一）
      stocks: TRADE_POS.stock.map((r) => ({ code: r.code, qty: r.qty, prev: r.prevClose })).filter((s) => s.qty),
    };
    const total = TRADE_POS.totalCny;
    // 抹掉浮点残差：几十万量级的浮点求和易差 0.0001 → 会显示「+0.00」还挂涨色，0.005 元以下归零
    const diffRaw = estCny - total;
    const diff = Math.abs(diffRaw) < 0.005 ? 0 : diffRaw;
    const pct = total ? diff / total * 100 : null;
    const setTxt = (id, txt, cls) => { const e = document.getElementById(id); if (!e) return; e.textContent = txt;
      e.className = 'num' + (cls ? ' ' + cls : ''); };
    setTxt('tradeSumAcct', f2(total));          // 账户资产（账户页账面口径，作为差额基准）
    // 推算总资产带色：与「账户资产」的差额同向同色（up 红 / down 绿），一眼看出是高了还是低了
    setTxt('tradeSumVal', f2(estCny), diff > 0 ? 'up' : diff < 0 ? 'down' : '');
    setTxt('tradeSumDiff', f2(diff, true), diff > 0 ? 'up' : diff < 0 ? 'down' : '');
    setTxt('tradeSumPct', pct == null ? '--' : (pct > 0 ? '+' : '') + pct.toFixed(2) + '%',
      pct > 0 ? 'up' : pct < 0 ? 'down' : '');

    /* 下面是「推算总资产分时图」：汇总一旦有数就显示图表区（无持仓时整块隐藏）。
       ⚠️ 这里只负责显隐与触发，K 线拉取在 refreshAssetChart 里节流（60s 一次）。 */
    const ach = document.getElementById('assetChart');
    if (ach) ach.hidden = !TRADE_POS.ready || !TRADE_POS.parts || !TRADE_POS.parts.stocks.length;
    const want = assetPending; assetPending = false;
    refreshAssetChart(want);          // 之前有过「数据没就绪被跳过」的历史 → 这次补画
  }

  /* ===================================================================
     持仓「推算总资产」分时图（2026-10-05 新增，仿富途时段下拉）
     ------------------------------------------------------------------
     曲线口径与上面的「推算总资产」**完全同源**：
         总资产(t) = Σ(股数_i × 该股分钟价_i(t)) × FX + 基金 + 现金
     基金只有日频净值（盘中无分钟级数据）、现金不动、汇率日频 → 这三项在一天内
     视作**常数**（只抬曲线高度，不影响形状）；时段按美东切，口径与自选页分时一致。
       盘前 04:00-09:30 / 盘中 09:30-16:00 / 盘后 16:00-20:00
       夜盘 20:00-次日 04:00（跨零点）/ 24h（滚动 24 小时）/ 全天（最近一个美东 20:00 起的交易日窗口）
     ⚠️ 源里没数据的时段（休市、或该源根本没这根 K 线）就画空白 ——
        绝不伪造数据、也不加「暂无数据」文案（与自选分时图同一约定）。
     ⚠️ 分钟价取自 **OKX 股票永续 1m**（与全站美股行情主源一致，见 fetchRawCandles）；
        它 7x24 连续，与真实美股盘前/盘后的时段划分靠 `etMinutes` 自己切。 */
  let assetChartData = null;        // 最近一次算出的序列（定时刷新时复用，不重复拉 K 线）
  const ASSET_SESS = {
    pre:     { label: '盘前', icon: '<rect x="1.5" y="4" width="4.6" height="8" rx="1" fill="#c9cedb"/><rect x="7.9" y="4" width="4.6" height="8" rx="1" fill="#2b3245"/>' },
    regular: { label: '盘中', icon: '<rect x="2" y="1.5" width="4" height="13" rx="1" fill="#2b3245"/><rect x="8" y="1.5" width="4" height="13" rx="1" fill="#2b3245"/>' },
    post:    { label: '盘后', icon: '<rect x="2" y="1.5" width="4" height="13" rx="1" fill="#c9cedb"/><rect x="8" y="1.5" width="4" height="13" rx="1" fill="#2b3245"/>' },
    night:   { label: '夜盘', icon: BOX_ICON('24', 7) },
    h24:     { label: '24h',  icon: BOX_ICON('24', 7) },
    all:     { label: '全天', icon: BOX_ICON('1D', 6.4) },
  };
  function BOX_ICON(txt, size) {
    return '<rect x="1" y="1" width="12" height="14" rx="2.6" fill="none" stroke="#2b3245" stroke-width="1.4"/>'
      + '<text x="7" y="11.4" text-anchor="middle" font-size="' + size + '" font-weight="700" fill="#2b3245"'
      + ' font-family="Helvetica,Arial,sans-serif">' + txt + '</text>';
  }
  const assetIconSvg = (key) => '<svg viewBox="0 0 14 16" aria-hidden="true">' + (ASSET_SESS[key] ? ASSET_SESS[key].icon : '') + '</svg>';
  /* 默认时段 = 当前进行中的美东时段（与自选页分时同款规则：夜盘看夜盘、盘前看盘前） */
  let assetSessSel = currentSessionKey();

  /* 取「该时段内」的持仓总资产分钟序列。
     返回 null = 数据不足/没持仓，调用方直接画空白。 */
  async function assetSeries(sess) {
    const p = TRADE_POS.parts;
    if (!p || !p.stocks || !p.stocks.length) return null;
    const key = ASSET_SESS[sess] ? sess : 'regular';
    const sessDef = (key === 'h24') ? null : (US_SESSIONS[key] || US_SESSIONS.regular);

    /* 各股分钟线并行拉（OKX 1m，最多回溯 1440 根 ≈ 24h，够覆盖所有时段）。
       ⚠️ instId 拼接规则见 okxInst（OKX_ALIAS：GOOG 复用 GOOGL）；这里持仓都是正股，直接拼。 */
    const legs = await Promise.all(p.stocks.map(async (s) => {
      try {
        const raw = await fetchRawCandles(s.code + '-USDT-SWAP', 1440, '1m');  // 最新在前
        if (!raw || !raw.length) return { s, pts: [] };
        const asc = raw.slice().map((r) => ({ ts: +r[0], price: +r[4] })).sort((a, b) => a.ts - b.ts);
        return { s, pts: asc };
      } catch (e) { return { s, pts: [] }; }
    }));

    const nowTs = Date.now();
    /* 时间轴 = 所有股该时段内的 ts 并集（升序）。
       24h 时段不按 ET 时段 match，直接取滚动 24 小时窗口。 */
    const tsSet = new Set();
    const target = Number.isFinite(p.fx) ? p.fx : 1;
    const fund = p.fund || 0, cash = p.cash || 0;
    /* 每只股在该时段的首点之前的空档，用**昨收**顶上（= 基准价），
       这样窗口一开始曲线就在昨收位置，不会掉到 0 或者 NaN。 */
    const prevOf = {};
    p.stocks.forEach((s) => { prevOf[s.code] = (s.prev > 0 ? s.prev : null); });

    for (const leg of legs) {
      for (const pt of leg.pts) {
        const m = etMinutes(pt.ts);
        if (key === 'h24') {
          if (pt.ts >= nowTs - 24 * 3600 * 1000) tsSet.add(pt.ts);
        } else if (key === 'all') {
          tsSet.add(pt.ts);
        } else if (sessDef && sessDef.match(m)) {
          tsSet.add(pt.ts);
        }
      }
    }
    let axis = Array.from(tsSet).sort((a, b) => a - b);
    if (axis.length < 2) return null;

    /* ⚠️⚠️ **窗口裁剪**（用户 2026-10-05：「推算总资产曲线图横坐标不太对吧」）。
       上面 tsSet 只是「按 match 过滤 24h 全量」，**没有取「最近一个该时段窗口」**，
       于是 24h 里的两段同名时段会一起进 axis：
         · 盘前 = 昨天 04:00~09:30 + 今天 04:00~09:30 都被 match 命中 → 画出一整天
           （截图里 X 轴 04:14 → 06:04 → 07:53 → 04:13，跨了一天多）；
         · all（1D）更离谱：match 恒真 → 整 24h 全进 → 起点是「现在往前 24h」，
           而不是「最近一个美东 20:00」。
       口径与自选页 `fetchUsSessionSeries` 完全一致（那边是降序 raw、这边是升序 axis，故方向相反）：
         ① all = **交易日窗口**：最近一个 ET 20:00（夜盘开盘 = 新交易日起点）→ 最新一根。
            用 `etLast20Ts()` 直接算时间戳，**不要**写成「从最新往前扫 m>=1200」——
            当前不是夜盘时（一天里 16 小时都是）那种扫法永远扫不到，裁剪会被跳过、退化成 24h。
         ② 其他时段 = **最近一个该时段窗口**：从最新往回找第一根 match（head），
            再向更早延伸直到遇见非本时段（tail），取 [tail, head]。
         ③ h24 保持滚动 24 小时（它本来就是「24h」语义，不裁）。 */
    if (key === 'all') {
      /* 交易日窗口：**最近一个已过的 ET 20:00 → 最新一根**（与自选页同一个工具，
         口径必然一致）。原来这里写的是「从末尾往前扫第一个 m>=1200」，
         在当前不是夜盘时扫不到 → 整个裁剪步骤被跳过 → 退化成滚动 24h。 */
      const start = etLast20Ts(Date.now());
      const cut = axis.filter((t) => t >= start);
      if (cut.length >= 2) axis = cut;
    } else if (sessDef) {
      /* ⚠️⚠️ 这里**不能**用自选页那套「从 head 往更早延伸、遇非 match 就停」——
         那套成立的前提是 raw **连续**（每分钟都有点，所以自然会撞到时段边界）。
         而这里的 axis 是 tsSet 去重后的集合，**只含匹配时段的 ts**：
         昨天盘前 05:21…09:30 与今天盘前 04:00…05:20 在数组里是**紧挨着的**
         （中间 18 小时的非盘前时段根本没进数组），延伸会一路走到下标 0，
         结果窗口跨了一整天（实测 pre = 330 点、05:21 → 次日 05:20）。
         正解：先判断「当前属于今天还是昨天的这个时段」——
           now 的 ET 分钟 >= 该时段起始 → 今天，否则昨天（今天这个还没开始）。
         再按时间戳起点裁剪，天然只留一段。 */
      const nowTs = Date.now();
      const sMin = SESS_START_MIN[key];
      if (sMin != null) {
        const start = etTsOn(nowTs, etMinutes(nowTs) >= sMin ? 0 : -1, sMin);
        const cut = axis.filter((t) => t >= start);
        if (cut.length >= 2) axis = cut;
        else return null;                 // 该时段尚无数据 → 交给上层自动 fallback 换时段
      }
    }

    /* 合成：每个时间点上，每只股取「该时刻及之前最近一根」的价格（前值填充），
       没有任何历史点的用昨收；再换成 CNY 加常数项。 */
    const out = [];
    for (const ts of axis) {
      let equityUsd = 0;
      for (const leg of legs) {
        const s = leg.s;
        let price = prevOf[s.code];
        for (const pt of leg.pts) { if (pt.ts > ts) break; if (pt.price > 0) price = pt.price; }
        if (price == null) continue;
        equityUsd += (s.qty || 0) * price;
      }
      out.push({ ts, price: equityUsd * target + fund + cash });
    }
    /* 基准 = **账户资产**（用户 2026-10-05：「推算总资产曲线涨跌幅基准应该是账户资产 1052275 吧，
       +1.1% 左右」）。也就是持仓页汇总框第一行那个数（IBKR 账面口径：证券权益 + 基金 + 现金），
       与「推算总资产」的差额 = 曲线当前点相对它的偏离 —— 语义上正是这张图要看的东西。
       ⚠️ 原来的基准是「昨收口径」（Σ股数×昨收×FX + 基金昨收净值 + 现金），
          那是个**虚构的、与页面任何数字都对不上**的起点（实测同一时刻 1,062,xxx vs 账户 1,052,275），
          于是「+1.97%」跟汇总框里的「差额 +11,074 / +1.05%」对不上号，很别扭。
       ⚠️ base 由 `renderTradeSum()` 写进 `parts.base`（它同时刷新 TRADE_POS.totalCny），
          两者同源同刻，不会出现「曲线用旧基准、汇总用新基准」。
       取不到时（账户页还没跑完）退回原昨收口径，别让整张图空掉。 */
    let base = Number(p.base) > 0 ? p.base : 0;
    if (!base) {
      base = (p.fundPrev || 0) + (p.cash || 0);
      p.stocks.forEach((s) => { if (s.prev > 0) base += (s.qty || 0) * s.prev * target; });
    }
    if (!base) return null;

    return {
      base,
      pts: out.map((d) => ({
        t: etHHMM(d.ts),
        day: etMD(d.ts),        // 'MM/DD'：1D 窗口跨日界时要靠它画竖线（见 drawAssetChart）
        ts: d.ts,
        v: d.price,
        pct: (d.price / base - 1) * 100,
      })),
    };
  }
  function etHHMM(ts) {
    const d = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  /* 美东日期 'MM/DD' —— 只给「1D（20:00 → 次日 20:00）」那种跨日窗口区分哪天用 */
  function etMD(ts) {
    const d = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
  }

  /* 画持仓总资产分时（左=金额 CNY，右=相对**账户资产**的百分比，褐色虚线=账户资产基准线）。
     ⚠️ 别再写回「昨收」：基准 2026-10-05 起是 `parts.base` = 账户资产（TRADE_POS.totalCny）。 */
  function drawAssetChart(data) {
    const canvas = document.getElementById('assetCanvas');
    const stage = document.getElementById('assetChartStage');
    if (!canvas || !stage) return;
    /* 无数据：重置画布尺寸即清空，仅留空白背景（与自选分时图同一约定） */
    const clear = () => {
      canvas.width = Math.round(stage.clientWidth * (window.devicePixelRatio || 1));
      canvas.height = Math.round(stage.clientHeight * (window.devicePixelRatio || 1));
    };
    if (!data || !data.pts || data.pts.length < 2) { clear(); return; }

    const dpr = window.devicePixelRatio || 1;
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const narrow = W < 460;
    const padL = narrow ? 52 : 62, padR = narrow ? 44 : 50, padT = 10, padB = 20;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const pts = data.pts, base = data.base;
    /* ⚠️ lo/hi 必须 `let`：下面 for 循环要往里夹最新极值（实时末端可能越界），
       写成 const 会在运行时抛 `Assignment to constant variable`，整张图静默变空白。
       ⚠️ **Y 轴上下值只由「横坐标范围内的数据」决定，不再把 base 夹进极值**（用户 2026-10-05：
       「这个图基准线如果太低就标在最下面就行了，纵坐标不用管这个基准线」）。
       之前 `Math.min(pts[0].v, base)` 会把基准强行拉进范围：日内只涨 1% 时，
       基准线远在画面之外 → 整张图为了迁就它压扁成一条横线（截图里就是这样）。
       现在基准线照画，但**夹到绘图区底部**表示，不影响刻度。 */
    let lo = Infinity, hi = -Infinity;
    for (const d of pts) { if (d.v < lo) lo = d.v; if (d.v > hi) hi = d.v; }
    if (!isFinite(lo) || !isFinite(hi)) { clear(); return; }
    const sp = (hi - lo) || Math.max(1, Math.abs(base) * 1e-4);
    const yMin = lo - sp * 0.12, yMax = hi + sp * 0.12;
    const X = (i) => padL + (i / (pts.length - 1)) * plotW;
    const Y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    /* 基准线的纵坐标：落在范围内就按真实位置画；低于下界就**贴到绘图区底部**，
       高于上界同理贴顶。clamp 后它只是一条位置指示线，不参与刻度计算。 */
    const baseY = Math.min(Math.max(Y(base), padT), padT + plotH);

    const money = (v) => Math.round(v).toLocaleString('en-US');
    ctx.font = '10px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'middle';
    const GRID = 4;
    for (let i = 0; i <= GRID; i++) {
      const y = padT + (i / GRID) * plotH;
      const v = yMax - (i / GRID) * (yMax - yMin);
      const pct = (v / base - 1) * 100;
      ctx.strokeStyle = THEME.grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = THEME.axisText;
      ctx.textAlign = 'right';
      ctx.fillText(money(v), padL - 6, y);
      const pc = pct > 0.0001 ? THEME.up : pct < -0.0001 ? THEME.down : THEME.flat;
      ctx.fillStyle = pc;
      ctx.textAlign = 'left';
      ctx.fillText((pct > 0 ? '+' : '') + pct.toFixed(2) + '%', padL + plotW + 6, y);
    }

    /* 基准线（账户资产 = 0% 的那条）：baseY 已在上面 clamp 到绘图区内。
       ⚠️ 2026-10-05 用户要求：
         · 颜色改**褐色**（原来灰色虚线太弱，看着像网格线）→ #8B4513，线宽 1.2、虚线更疏；
         · **删掉**「基准 1,052,275」那行小字 —— 头部右上角已经有一个「账户资产 1,052,275」，
           同一个数在图里出现两次是重复。 */
    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(padL, baseY); ctx.lineTo(padL + plotW, baseY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;

    /* 面积 + 折线 */
    const up = pts[pts.length - 1].pct >= 0;
    const lineColor = up ? THEME.up : THEME.down;
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, up ? 'rgba(0,168,107,0.18)' : 'rgba(234,59,59,0.18)');
    grad.addColorStop(1, 'rgba(46,107,255,0.01)');
    ctx.beginPath();
    ctx.moveTo(X(0), Y(pts[0].v));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(i), Y(pts[i].v));
    const path = new Path2D();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) path.moveTo(X(i), Y(pts[i].v)); else path.lineTo(X(i), Y(pts[i].v));
    }
    ctx.save();
    ctx.lineTo(X(pts.length - 1), padT + plotH);
    ctx.lineTo(X(0), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.restore();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.stroke(path);

    /* 最新点：水平虚线 + 两端色块标签（左=金额、右=百分比） */
    const last = pts[pts.length - 1];
    const lastY = Y(last.v);
    ctx.strokeStyle = up ? 'rgba(0,168,107,0.8)' : 'rgba(234,59,59,0.8)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(padL, lastY); ctx.lineTo(padL + plotW, lastY); ctx.stroke();
    ctx.setLineDash([]);
    const tagH = 15;
    const tagY = clamp(lastY, padT + tagH / 2, padT + plotH - tagH / 2);
    const drawTag = (x, w, text) => {
      const r = 3, yy = tagY - tagH / 2;
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.moveTo(x + r, yy);
      ctx.arcTo(x + w, yy, x + w, yy + tagH, r);
      ctx.arcTo(x + w, yy + tagH, x, yy + tagH, r);
      ctx.arcTo(x, yy + tagH, x, yy, r);
      ctx.arcTo(x, yy, x + w, yy, r);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x + w / 2, tagY);
      ctx.font = '10px "PingFang SC", "Microsoft YaHei", sans-serif';
    };
    drawTag(padL - (padL - 4), padL - 6, money(last.v));
    drawTag(padL + plotW + 2, padR - 4, (last.pct > 0 ? '+' : '') + last.pct.toFixed(2) + '%');

    /* 时间轴（美东） */
    ctx.fillStyle = THEME.axisText;
    ctx.textAlign = 'center';
    const ticks = narrow ? 4 : 6;
    for (let i = 0; i < ticks; i++) {
      const idx = Math.round((i / (ticks - 1)) * (pts.length - 1));
      ctx.fillText(pts[idx].t, X(idx), H - padB / 2 - 2);
    }
    /* ⚠️ 跨交易日时补一条日界竖线 + MM/DD 标注：
       「1D」窗口 = 最近一个 ET 20:00 → 24h 后 ET 20:00，**必然跨日界**，
       而刻度只画 HH:MM → 会出现两个 "20:00" 谁也分不清是谁天。
       （与自选页 all 的做法一致：跨日处画竖线 + 日期。） */
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].day === pts[i - 1].day) continue;
      const x = X(i);
      ctx.save();
      ctx.strokeStyle = 'rgba(148,154,171,0.45)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = THEME.axisText;
      ctx.textAlign = 'left';
      ctx.fillText(pts[i].day, Math.min(x + 4, padL + plotW - 28), padT + 8);
      ctx.textAlign = 'center';
    }
  }

  /* ---- 分时图的两处落点：**同一个节点**搬家 ----
     桌面（>680px）：放进右侧主区 `#assetChartHolder`，常驻显示；
     移动端（≤680px）：放进 **页内块** `#assetSheetBody`（#assetSheet 排在 #tradeSum 之后），
     点「推算总资产」那个汇总框展开/收起（2026-10-05 定稿：**不是浮层**，下方列表照旧能滚）。
     ⚠️ 只搬这**一个**节点，绝不复制两份 canvas —— 复制的话 drawAssetChart 只会更新一处。
     ⚠️ 断点用 matchMedia 而不是 window.innerWidth：必须与 CSS 里
        `@media (max-width:680px) { .trade-view .trade-main{display:none!important} }` 完全对齐。 */
  const AC_MQ = window.matchMedia('(max-width: 680px)');
  function placeAssetChart() {
    const chart = document.getElementById('assetChart');
    if (!chart) return AC_MQ.matches;
    const dst = AC_MQ.matches ? document.getElementById('assetSheetBody')
                              : document.getElementById('assetChartHolder');
    if (dst && chart.parentNode !== dst) dst.appendChild(chart);
    return AC_MQ.matches;
  }
  /* ---- 移动端分时图：**页内展开/收起**（2026-10-05 用户定稿）
      ⚠️ 它**不是浮层**：`#assetSheet` 就排在 `#tradeSum` 之后（.watchlist--trade 里），
         与上方的持仓列表同属一个纵向流 —— 展开时 `.wl__list`（flex:1）自动变矮、
         照旧可以上下滚；收起又变回原样。所以这里**不锁任何滚动、不加遮罩、不 preventDefault**，
         历史版本试过「全屏浮层 + 锁 scroll + touchmove」那套，正好是用户否掉的效果。 */
  function openAssetSheet() {
    if (!AC_MQ.matches) return;
    placeAssetChart();
    const sheet = document.getElementById('assetSheet');
    if (!sheet) return;
    sheet.hidden = false;
    /* 汇总框让位：账户资产/推算总资产/差额三行 + 「分时走势」入口一起收掉，
       展开后这一屏只剩分时走势（用户 2026-10-05）。
       ⚠️ 收起靠图卡右上角的 ×（#assetSheetClose），汇总框里的入口这时是隐藏的。 */
    assetSheetOpen = true;
    const sum = document.getElementById('tradeSum');
    if (sum) sum.hidden = true;
    /* 数据一旦就绪就把图显出来，别展开出来是个空壳（head 先显示 --） */
    const chart = document.getElementById('assetChart');
    if (chart && TRADE_POS.ready && TRADE_POS.parts) chart.hidden = false;
    refreshAssetChart(true);      // 刚展开，canvas 才首次量到尺寸 → 强制重拉一次
  }
  function closeAssetSheet() {
    const sheet = document.getElementById('assetSheet');
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    assetSheetOpen = false;
    /* 汇总框恢复显示交给 renderTradeSum（它每轮刷新都会按 assetSheetOpen 重算 hidden），
       这里立刻同步一次，避免收起后要等下一轮才出现。 */
    const sum = document.getElementById('tradeSum');
    if (sum && TRADE_POS.ready && TRADE_POS.totalCny != null) sum.hidden = false;
  }

  /* 拉数据 + 画 + 更新头部数字（节流：盘中定时刷新很密，60s 才真正重拉一次 K 线） */
  let assetChartTs = 0;
  let assetPending = false;   // 数据没就绪时被跳过 → 下一次汇总就绪时补画
  /* 外部请求重画（2026-10-05）：持仓侧栏收起/展开后主区宽度变了，canvas 要按新尺寸重画，
     但那个按钮在**另一个闭包**（initPanelCollapse）里，直接调 `refreshAssetChart` 会 ReferenceError。
     走 window 自定义事件跨闭包通信，比挂 window 属性干净。 */
  window.addEventListener('asset-chart-repaint', () => { refreshAssetChart(true); });
  async function refreshAssetChart(force) {
    const box = document.getElementById('assetChart');
    const stage = document.getElementById('assetChartStage');
    if (!box || !stage) return;
    /* 数据就绪就把它显出来（移动端在浮层里，只有打开时才量得到画布尺寸） */
    if (TRADE_POS.ready && TRADE_POS.parts && TRADE_POS.parts.stocks.length) box.hidden = false;
    /* ⚠️ 画布量到 0 宽 = 视图整块被切走了（.trade-view hidden）。这种时候**不拉 K 线**：
       一次要两只股各 5 页 1m，白给。切回来时由下面的 rail 点击事件 force 触发。 */
    if (box.hidden || document.hidden || !stage.clientWidth) return;
    /* ⚠️ 持仓数据还没就绪时**不白跑**：打一个 `assetPending` 标记，
       等 renderTradeSum 那次拿到 parts 时顺势 force 一次（见下方 tradeSum 末尾）——
       否则切视图那一下（parts 尚未就绪）就浪费了，用户要干等到下一个 15s tick。 */
    if (!TRADE_POS.ready || !TRADE_POS.parts) { assetPending = true; return; }
    const stale = Date.now() - assetChartTs > 60000;
    if (!force && !stale) { drawAssetChart(assetChartData); return; }
    assetChartTs = Date.now();
    try {
      assetChartData = await assetSeries(assetSessSel);
    } catch (e) { assetChartData = null; }
    /* 时段窗口里一根 K 线都没有时（典型：周末/休市，当前时段本就无成交），
       自动退到「最近有数据」的窗口，避免开屏就是一片空白被当成没画出来。
       ⚠️ 只在这种**空结果**下改选中的时段，用户手动选过之后不再覆盖。 */
    if (!assetChartData || assetChartData.pts.length < 2) {
      for (const k of ['all', 'regular', 'h24', 'night']) {
        if (k === assetSessSel) continue;
        try {
          const d = await assetSeries(k);
          if (d && d.pts.length >= 2) { assetChartData = d; assetSessSel = k; syncAssetSessUi(); break; }
        } catch (e2) { /* 换下一个 */ }
      }
    }
    paintAssetHead();
    drawAssetChart(assetChartData);
  }
  function paintAssetHead() {
    const pctEl = document.getElementById('assetChartPct');
    const valEl = document.getElementById('assetChartVal');
    const acctEl = document.getElementById('assetChartAcct');
    const d = assetChartData && assetChartData.pts && assetChartData.pts.length
      ? assetChartData.pts[assetChartData.pts.length - 1] : null;
    const upDown = d ? (d.pct > 0 ? 'up' : d.pct < 0 ? 'down' : '') : '';
    /* 金额一律取整（用户 2026-10-05：「都保留到整数」）—— 几十万量级的小数点没信息量，
       还把这一格撑宽。百分比保持两位（那是有意义的精度）。 */
    if (valEl) {
      valEl.textContent = d ? Math.round(d.v).toLocaleString('en-US') : '--';
      /* 大数字也带涨跌色（用户：「分时走势1063923带颜色」）—— 之前只有旁边的百分比有色，
         金额恒黑，看着像「没涨」。基准线是 base（= 昨收口径），与 pct 同源。 */
      valEl.className = 'num ' + upDown;
    }
    if (pctEl) {
      pctEl.textContent = d ? ((d.pct > 0 ? '+' : '') + d.pct.toFixed(2) + '%') : '--';
      pctEl.className = 'num asset-chart__pct ' + upDown;
    }
    /* 账户资产（IBKR 账面口径，= 汇总框第一行）也取整显示在时段下拉左侧 */
    if (acctEl) {
      const t = TRADE_POS.totalCny;
      acctEl.textContent = t == null || !isFinite(t) ? '--' : Math.round(t).toLocaleString('en-US');
    }
  }
  function syncAssetSessUi() {
    const def = ASSET_SESS[assetSessSel] || ASSET_SESS.regular;
    const label = document.getElementById('assetSessLabel');
    const icon = document.getElementById('assetSessIcon');
    if (label) label.textContent = def.label;
    if (icon) icon.innerHTML = assetIconSvg(assetSessSel);
    document.querySelectorAll('#assetSessMenu [data-asset-sess]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.assetSess === assetSessSel);
    });
  }

  /* 交易页持仓名称缩写：去掉「(QDII)」「ETF」「发起联接」三类**品类/产品形态后缀**。
     这些词不携带个股信息（QDII 说明投资地域、ETF 与联接说明产品形态，副行的代码已能定位），
     在 430px 侧栏里却各占 20~50px，导致「嘉实纳斯达克100ETF发起联接(QDII)A人民币」
     这类长名必须省略。实测依次去掉这三类后最宽名 150px < 可视 183px，8 行全部完整显示。
     完整名仍保留在行的 title 里，悬停可见。 */
  const tradeShortName = (name) => String(name || '')
    .replace(/\s*[(（]QDII[)）]\s*/gi, '')   // 去掉 (QDII) / （QDII）及其前后空格
    .replace(/\s*ETF\s*/g, '')             // 去掉 ETF
    .replace(/\s*发起联接\s*/g, '')         // 去掉「发起联接」
    .replace(/\s+/g, ' ')
    .trim();

  /* 交易页列表：只列**持仓**（证券 + 基金），不列自选。
     最后一列「市值/盈亏」上下两行 —— 上为市值（CNY，= 现价 × 份额），下为**盈亏**：
       证券：现价取腾讯、盈亏 = (腾讯现价 − 账户页现价) × 数量 × FX
       基金：现价 = 官方净值 ×(1+估算涨跌)、盈亏 = estAmount − amount
     ⚠️ 表头文案是「市值/盈亏」，但**不是**相对买入成本的累计盈亏（那个在账户页表格里），
     这里的盈亏是「现价相对基准的浮动」，别改回 pnlCny。
     单位统一为 CNY，颜色按绿涨红跌（.up 红 / .down 绿）。 */
  function renderTradeList() {
    const ul = $('#watchlistTrade');
    if (!ul) return;
    // f2 / clsCls 与账户页同口径（f2 在 initAccountData 内部，不在此作用域）
    const f2 = (v, sign) => {
      if (v == null || !isFinite(v)) return '--';
      const s = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return sign && v > 0 ? '+' + s : s;
    };
    const clsCls = (v) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
    const fx = TRADE_POS.fx || 1;
    const stock = TRADE_POS.stock.map((r) => ({
      kind: '证券', code: r.code, name: r.name,
      /* 现价 = **OKX 永续**（7×24 连续报价，用户 2026-10-04 定稿）；取不到才回落账户价。
         涨跌幅 = (腾讯现价 − **账户页那个现价**) ÷ 账户现价（tradePct 是小数，fmtPct 要百分数）。 */
      price: r.pTrade != null ? r.pTrade : r.price, cur: 'USD',
      pct: r.tradePct != null ? r.tradePct * 100 : null,
      // 市值按交易页的 OKX 价算（= 现价 × 份额），与「现价」列自洽；
      // 取不到就空着（2026-10-05 起不再用 IBKR 快照市值 posVal0 兜底）
      value: r.tradeValueCny != null ? r.tradeValueCny
          : (r.valueCny != null ? r.valueCny : null),
      // 「较基准」盈亏 = (腾讯现价 − 账户现价) × 数量 × 汇率
      pnl: r.tradeChgCny != null ? r.tradeChgCny : null,
      decimals: (r.mult === 100 ? 3 : 2),
    }));
    const fund = TRADE_POS.fund.map((f) => ({
      kind: '基金', code: f.code, name: f.name,
      // 现价/涨跌用**估值**（官方净值停更到 9-29，估值反映到今天）；无估值时回退官方净值
      price: f.estNav != null ? f.estNav : f.navL,
      pct: f.estChg != null ? f.estChg * 100
          : (f.navL != null && f.navP ? (f.navL - f.navP) / f.navP * 100 : null),
      cur: 'CNY',
      // 市值/盈亏也用估值口径（推算总资产随之变成估值口径，与差额校验一致）
      value: f.estAmount != null ? f.estAmount : f.amount,
      // 较基准（官方净值 navL）的盈亏；无估值时退回「最新净值 − 前一日净值」
      pnl: f.estAmount != null ? (f.estAmount - f.amount) : f.yest,
      decimals: 4,
      isEst: f.estNav != null,
      estChg: f.estChg,
      // 悬停提示：估值涨跌 + 汇率贡献。
      // ⚠️ `FX_IN_VAL = false`（2026-10-04 用户定稿「持仓的估值计算的时候把汇率因素去了」）时
      // 汇率贡献恒为 0，再显示「其中汇率 +0.000%」是废话，直接不显示这一段。
      fxNote: f.estChg != null
        ? `估值 ${(f.estChg * 100).toFixed(2)}%`
          + (f.estFxChg ? `（其中汇率 ${f.estFxChg >= 0 ? '+' : ''}${(f.estFxChg * 100).toFixed(3)}%）` : '')
        : '',
    }));
    /* 默认按**市值从大到小**排（用户 2026-10-04 定稿）：一眼看出仓位重心，也和「市值/盈亏」列一致。
       排序用行内那个 value（= 现价 × 份额，证券用腾讯价、基金用估算市值），
       缺失（null）当 0 沉到末尾。切分类 tab 后仍按同一规则排。 */
    const byValueDesc = (a, b) => (b.value || 0) - (a.value || 0);
    let list = stock.concat(fund).sort(byValueDesc);
    if (wlTradeCat !== 'all') {
      // 分类 tab：全部 / 证券 / 基金（2026-10-04 用户加的「基金」tab）。
      // 三种都要按市值降序，不能直接 `list = stock` —— 那会丢掉排序。
      if (wlTradeCat === 'us') list = stock.slice().sort(byValueDesc);
      else if (wlTradeCat === 'fund') list = fund.slice().sort(byValueDesc);
      else list = [];
    }
    if (!TRADE_POS.ready) {
      ul.innerHTML = '<li class="wl__row wl__row--empty"><span class="wl-name"><b>加载中…</b></span></li>';
      const s0 = document.getElementById('tradeSum'); if (s0) s0.hidden = true;
      return;
    }
    // 汇总按「全部」口径算，不随分类 tab 变（切到「证券」/「基金」时仍显示整体推算总资产）
    renderTradeSum();
    if (!list.length) {
      ul.innerHTML = '<li class="wl__row wl__row--empty"><span class="wl-name"><b>该分类下无持仓</b></span></li>';
      return;
    }
    ul.innerHTML = list.map((it) => {
      const c = cls(it.pct);
      const pc = clsCls(it.pnl);
      // 汇率明细只在悬停提示里给（副行已有「代码 · 类别」，再加就挤了）
      return `<li class="wl__row" data-code="${it.code}" title="${it.name}（${it.code}）· ${it.kind}${it.fxNote ? '｜' + it.fxNote : ''}">
          <span class="wl-name">
            <b>${tradeShortName(it.name)}</b>
            <span>${it.code} · ${it.kind}</span>
          </span>
          <span class="wl-price num ${c}">${fmt(it.price, it.decimals)}</span>
          <span class="wl-pct num ${c}">${fmtPct(it.pct)}</span>
          <span class="wl-vp">
            <!-- 市值也跟着涨跌上色（用户 2026-10-05：「市值也根据涨跌变颜色」），
                 用现价/涨跌幅那一档的 cls(pct)；下方盈亏仍按自身正负取色（clsCls(pnl)）。 -->
            <b class="num ${c}">${f2(it.value)}</b>
            <i class="num ${pc}">${f2(it.pnl, true)}</i>
          </span>
        </li>`;
    }).join('');
  }

  /* 分类归属：先取行上的 cat（us/cn/fut/ccy），再用 WL_CAT_OF 把
     fx/bond 折进 fut；两者都缺时按 market 兜底，最后默认 us。
     ⚠️ WL_CAT_OF 的键是 cat 值，不是 market —— 写错过一次会导致
     外汇/债券两组永远匹配不到、期货 tab 只剩 2 行。 */
  function catOf(it) {
    const c = it.cat || WL_CAT_OF[it.market] || 'us';
    return WL_CAT_OF[c] || c;
  }

  /* 数据时间备注用的短日期：'2026-10-02' → '10-02'，其它原样返回。 */
  const asOfMd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s).slice(5) : String(s || ''));

  function renderWatchlist(list, activeCode) {
    const session = usSession();                    // 美股延长时段标签（盘中为 null）
    // 行情页与交易页各有一份自选列表，共享同一数据源；
    // 交易页的分类切换独立（wlTradeCat），默认为「全部」。
    const paint = (ul, cat) => {
      if (!ul) return;
      const shown = cat === 'all' ? list : list.filter((x) => catOf(x) === cat);
      ul.innerHTML = shown.map((it) => {
      const active = it.code === activeCode ? ' is-active' : '';
      const isUS = it.market === 'US';
      // 美股延长时段（盘前/盘后/夜盘）：主行显示「昨日收盘快照」= 昨收价 + 昨收相对前收的涨跌幅，
      // 现价与相对昨收的涨跌挪到副行小字（富途盘前样式）；盘中/非美股维持现价口径
      const ext = isUS && !!session && it.prevDayPct != null && it.prevClose != null;
      const mainPrice = ext ? it.prevClose : it.price;
      const mainPct = ext ? it.prevDayPct : it.pct;
      const c = cls(mainPct);
      // 副行：延长时段现价，小字一律灰色（不带涨跌色）；正常时段不显示
      const showExt = ext && it.extPrice != null;
      const extRow = showExt ? `<i class="wl-sub num">${fmt(it.extPrice, 3)}</i>` : '';
      const extPctCell = showExt ? `<i class="wl-sub num">${fmtPct(it.extPct)}</i>` : '';
      /* 数据时间备注：只给**无 K 线**的静态行加（USDCNH / 10Y 国债 —— OKX/腾讯都没有
         对应品种，点进去也没有分时图）。有 instId / txCode 的实时行不显示，避免看着像过期数据。
         asOf 由各自的日频数据源写入（fetchFxWatch / fetchTreasuryWatch），拉不到时保持初始的「快照」。 */
      const asOf = it.asOf ? `<i class="wl-asof">${asOfMd(it.asOf)}</i>` : '';

      return `
        <li class="wl__row${active}" data-code="${it.code}">
          <span class="wl-name">
            <b>${it.name}</b>
            <span>${it.code}${it.market ? ' · ' + it.market : ''}${asOf}</span>
          </span>
          <span class="wl-price num ${c}">${fmt(mainPrice, mainPrice < 10 ? 5 : 3)}${extRow}</span>
          <span class="wl-pct num ${c}">${fmtPct(mainPct)}${extPctCell}</span>
        </li>`;
      }).join('');

      ul.querySelectorAll('.wl__row').forEach((row) => {
        row.addEventListener('click', () => {
          ul.querySelectorAll('.wl__row').forEach((r) => r.classList.remove('is-active'));
          row.classList.add('is-active');
          const picked = list.find((x) => x.code === row.dataset.code);
          if (picked) {
            loadInstrument(picked.code);
            // 移动端：点行后切到图表页（列表隐藏，只剩该标的 K 线）
            // （桌面端保持列表常驻，不受影响）
            // 交易页例外：点行只选中，不切图表（交易页自己的交互后续再补）
            if (isMobile()) showMobileChart();
          }
        });
      });
    };
    paint($('#watchlist'), wlCat);
    // 交易页那份列表列的是**持仓**而非自选，由 renderTradeList 单独渲染
  }

  /* ---------- 移动端（<680px）：列表页 ↔ 图表页 互斥切换 ----------
     移动端首页**只显示自选列表**，不显示图表（图表区 display:none）；
     点某个标的 → 列表隐藏、图表显示；点底栏「自选」→ 回到列表。
     桌面端两者常驻并排，不走这套逻辑。 */
  const MOBILE_MQ = '(max-width: 680px)';
  const isMobile = () => window.matchMedia(MOBILE_MQ).matches;

  /* 图表区/列表区的显隐会改变 canvas 可用尺寸 → 需重绘。
     布局重排在下一帧才稳定，所以等两拍再触发 resize。 */
  function redrawAfterLayout() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    }));
  }

  /* 显示图表、隐藏列表（移动端点行后） */
  function showMobileChart() {
    document.body.classList.remove('is-comment-mode');   // 图表态（与资讯页互斥）
    document.body.classList.add('is-chart-mode');
    const wl = document.querySelector('.watchlist');
    if (wl) wl.classList.add('is-collapsed');
    redrawAfterLayout();
  }
  /* 回到列表、隐藏图表（移动端点底栏「自选」后） */
  function showMobileList() {
    document.body.classList.remove('is-chart-mode');
    document.body.classList.remove('is-comment-mode');  // 同时退出资讯页
    const wl = document.querySelector('.watchlist');
    if (wl) wl.classList.remove('is-collapsed');
    // 高亮拨回「自选」（资讯/账户各自己管高亮，这里统一归位）
    document.querySelectorAll('.rail__item[data-view]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.view === 'market');
    });
    redrawAfterLayout();
  }

  /* 底部 tab bar：移动端四页（列表/图表/资讯/账户）互斥切换 */
  document.querySelectorAll('.rail__item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!isMobile()) return;
      const view = btn.dataset.view;
      if (view === 'market') { showMobileList(); return; }
      if (view === 'comment') {
        // 资讯：撤掉图表态、标记资讯态、**并隐藏账户页**（否则从账户页切过来会两者同屏叠加）。
        // 还要移除桌面「默认收起」逻辑加的 .is-collapsed，否则面板被压成 0 宽。
        document.body.classList.remove('is-chart-mode');
        document.body.classList.add('is-comment-mode');
        const wl = document.querySelector('.watchlist');
        if (wl) wl.classList.add('is-collapsed');
        const cp = document.querySelector('.comment-panel');
        if (cp) cp.classList.remove('is-collapsed');
        const acc = document.getElementById('accountView');
        if (acc) acc.hidden = true;
        // 自己管高亮：switchView 被守卫跳过，资讯按钮的 is-active 没人更新
        document.querySelectorAll('.rail__item[data-view]').forEach((b) => {
          b.classList.toggle('is-active', b.dataset.view === 'comment');
        });
        redrawAfterLayout();
      }
    });
  });

  /* 从系统切回前台时，若处于图表态要重绘（iOS 上 canvas 尺寸会丢） */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isMobile() && document.body.classList.contains('is-chart-mode')) {
      redrawAfterLayout();
    }
  });

  /* ===================================================================
     资讯面板两个 tab：
       - 「最新」社区评论（占位 mock）
       - 「推荐」**金十数据快讯**（默认，script 标签直连，不走 fetch）
     -------------------------------------------------------------------
     为什么用金十而不是富途自己的源（用户 2026-10-04 调研结论）：
       - `news.futunn.com/news-site-api/main/get-flash-list`（真正的富途快讯 API，能拿 60 条）
         实测响应里 **0 个 Access-Control-Allow-* 头** → 浏览器 fetch 必被同源策略拦掉。
       - `news.platform.elebank.com/main`（富途资讯站 SSR 页）
         同样 **0 个 CORS 头**，且返回 141KB 整个 HTML，快讯不走 JSON 接口而是压缩在
         `window.__NUXT__` 函数里；浏览器抓包确认它只请求 `get_tourist_sig`（游客签名）
         与 `beacon`（埋点），**没有任何快讯接口**，`flashList` 字段是空数组。
       （曾试过 workflow 抓本地 JSON，被用户否决：「不要 yml 和 json」；也曾用 iframe 内嵌
         elebank 快讯页，后因内容与金十高度重合、且金十更好用而整体删除。）
     选定方案：`https://www.jin10.com/flash_newest.js`
       - 响应 `Access-Control-Allow-Origin: *`，但更关键的是它是
         `var newest = [...]` 这种 **JS 赋值语句**，用 `<script src>` 加载即可拿到
         全局变量 `newest` —— 连 fetch 都不需要，更不需要 CORS。
       - 免 key、50 条/次、时间倒序，字段：`id` / `time`('YYYY-MM-DD HH:mm:ss') /
         `important`(1=重要) / `channel`(频道 id 数组) / `data.{title,content,pic,source}`。
     ⚠️ 用 script 加载会把 `window.newest` 挂到全局，取完记得删掉，避免污染其他代码。
     =================================================================== */
  const JIN10_JS = 'https://www.jin10.com/flash_newest.js';

  const JIN10_CHANNEL = {                 // channel id -> 中文名（实测取值 1/2/3/5/9）
    1: '外汇', 2: '原油', 3: '贵金属', 5: 'A股', 9: '加密货币',
  };
  const NEWS_STATE = { items: [], loaded: false, loading: false, at: '' };
  let cpTab = 'news';   // 资讯面板当前 tab：**默认「推荐」**（金十快讯，用户 2026-10-04 定稿）

  /* script 标签加载金十快讯：拿全局 `newest` 数组，用完即删 */
  function loadJin10Script() {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JIN10_JS + '?_t=' + Date.now();     // 绕开浏览器缓存，保证每轮拿到新的
      s.onload = () => {
        const raw = window.newest;
        // 无论成功失败都要摘掉全局变量，别让它污染页面的 window
        try { delete window.newest; } catch (e) { window.newest = undefined; }
        s.remove();
        if (Array.isArray(raw) && raw.length) resolve(raw);
        else reject(new Error('empty newest'));
      };
      s.onerror = () => { s.remove(); reject(new Error('script load failed')); };
      document.head.appendChild(s);
    });
  }

  async function fetchJin10() {
    if (NEWS_STATE.loading) return;
    NEWS_STATE.loading = true;
    try {
      const raw = await loadJin10Script();
      NEWS_STATE.items = raw.map((x) => {
        const d = x.data || {};
        const title = String(d.title || '').trim();   // ⚠️ 实测约 1/5 条 title 是 null，必须兜底
        // content 常以【标题】开头（"【…】正文"），标题非空时削掉重复前缀
        let body = String(d.content || '').replace(/\s+/g, ' ').trim();
        if (title && body.startsWith(title)) body = body.slice(title.length).trim();
        return {
          id: String(x.id || ''),
          time: String(x.time || ''),          // 'YYYY-MM-DD HH:mm:ss'（北京时间）
          title,
          body,
          important: Number(x.important) || 0,
          ch: (x.channel || []).map((c) => JIN10_CHANNEL[c] || '').filter(Boolean)[0] || '',
          /* 金十源会混入国际英文快讯（实测 50 条里约 23 条是纯英文），
             不是渲染 bug。标个 EN 便于分辨，未过滤 —— 英文快讯本身也有信息量。 */
          en: (title + body).match(/[\u4e00-\u9fff]/g) ? 0 : 1,
        };
      }).filter((x) => x.body || x.title)
        // 源侧已按时间倒序，这里再排一次保证严格有序（画时间轴依赖顺序）
        .sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
      NEWS_STATE.loaded = true;
      NEWS_STATE.at = new Date().toLocaleTimeString('zh-CN',
        { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
      if (cpTab === 'news') renderCpTab();
    } catch (e) {
      console.warn('[金十] 快讯加载失败，沿用上次数据：', e);
    } finally { NEWS_STATE.loading = false; }
  }

  function renderCpTab() {
    /* 快讯 tab 隐藏社区的「分享心情」输入框（那是发帖用的，快讯流里没有意义） */
    const compose = document.querySelector('.cp__compose');
    if (compose) compose.hidden = (cpTab === 'news');
    if (cpTab === 'news') renderNews();
    else renderComments(APP_DATA.comments);
  }

  /* 金十 time 形如 '2026-10-04 18:21:13'，取 'HH:MM'。
     正则匹配而非 slice(11,16)：万一源侧格式变了（如去掉秒、用 T 分隔），
     slice 会切出乱码，match 至少能安全退回原文。 */
  function jin10Hm(t) {
    const m = /(\d{2}):(\d{2})/.exec(String(t || ''));
    return m ? m[0] : String(t || '');
  }

  /* 「推荐」快讯流：时间轴样式（左侧圆点 + 时间/频道/EN/重要标签，其下正文） */
  function renderNews() {
    const ul = $('#commentList');
    if (!ul) return;
    if (!NEWS_STATE.items.length) {
      ul.innerHTML = '<li class="cp__item cp__item--empty"><p class="cp__text">快讯加载中…</p></li>';
      return;
    }
    ul.innerHTML = NEWS_STATE.items.map((n) => `
      <li class="cp__item cp__news cp__news--jin10${n.important === 1 ? ' is-important' : ''}" data-id="${n.id}">
        <div class="cp__news-time"><i class="cp__dot"></i>${jin10Hm(n.time)}${
          n.ch ? `<em class="cp__ch">${n.ch}</em>` : ''}${
          n.en ? '<em class="cp__en">EN</em>' : ''}${
          n.important === 1 ? '<em class="cp__lv">重要</em>' : ''}</div>
        <p class="cp__text">${n.title ? `<b>${n.title}</b> ` : ''}${n.body}</p>
      </li>`).join('');
  }

  function renderComments(list) {
    const ul = $('#commentList');
    const q = APP_DATA.quote || {};
    const tag = `<span class="tag">$${q.name || ''} (${q.code || ''})$</span>`;
    ul.innerHTML = list.map((c) => {
      const bg = hashColor(c.user);
      return `
        <li class="cp__item">
          <div class="cp__user">
            <span class="cp__avatar" style="background:${bg}">${c.user.slice(0, 1)}</span>
            <span class="cp__meta">
              <b>${c.user}</b>
              <span>${c.time}</span>
            </span>
            <button class="cp__follow">+ 关注</button>
          </div>
          <p class="cp__text">${tag} ${c.text}</p>
          <div class="cp__stats">
            <span>${ICON_LIKE}${c.likes}</span>
            <span>${ICON_CMT}${c.replies}</span>
          </div>
        </li>`;
    }).join('');
  }

  /* ===================================================================
     4. 分时图绘制（canvas）
     =================================================================== */
  function drawChart() {
    const canvas = $('#priceChart');
    const stage = canvas.parentElement;
    if (!canvas || !stage) return;

    const series = APP_DATA.series;
    if (!series || !series.length) {
      // 无数据：重置画布尺寸即清空内容，仅保留空白背景
      canvas.width = Math.round(stage.clientWidth * (window.devicePixelRatio || 1));
      canvas.height = Math.round(stage.clientHeight * (window.devicePixelRatio || 1));
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const padL = 70, padR = 54, padT = 12, padB = 22;
    const gap = 10;
    const plotW = W - padL - padR;
    const plotH = (H - padT - padB) * 0.76;
    const volTop = padT + plotH + gap;
    const volH = H - padB - volTop;

    const prices = series.map((d) => d.price);
    const lo = Math.min.apply(null, prices);
    const hi = Math.max.apply(null, prices);
    /* y 轴范围要把**实时价**算进去：`quote.last` 可能高于 K 线最高价（盘中跳涨），
       不并进来会让实时价落在画布外、标签被 clamp 顶到边缘、与右侧价格轴对不上。 */
    const live = (APP_DATA.quote && APP_DATA.quote.last > 0) ? APP_DATA.quote.last : null;
    const lo2 = live != null ? Math.min(lo, live) : lo;
    const hi2 = live != null ? Math.max(hi, live) : hi;
    const span2 = (hi2 - lo2) || 1;
    const yMin = lo2 - span2 * 0.08;
    const yMax = hi2 + span2 * 0.08;

    const X = (i) => padL + (i / (series.length - 1)) * plotW;
    const Y = (p) => padT + (1 - (p - yMin) / (yMax - yMin)) * plotH;

    /* 百分比轴基准：
       - 分时用「前一日美东收盘」`quote.prevClose`（与报价头一致，保证图上读数 = 报价头涨跌幅）；
       - K 线周期用「该周期**首根的前收**」`series[0].prev`。
       ⚠️ 原先用 `series[0].price`（首根**收盘**）当基准，是错的：
          「5日」图 series 覆盖多天，首根收盘与末点收盘在同一天凌晨时段常常**完全相等**
          （实测 ORCL：首点 10-03 11:59 = 142.46、末点 10-04 12:00 = 142.46）
          → 标签恒为 0.00%，用户报「5日为什么一直是 0%」。
          富途的「5日」标签显示的是**当日涨跌幅**，基准就是昨收，与分时同一口径。 */
    const prevClose = chartMode === 'time'
      ? (APP_DATA.quote.prevClose || series[0].price)
      : (series[0].prev != null ? series[0].prev
        : (APP_DATA.quote.prevClose || series[0].price));

    /* --- 网格 + 坐标轴 --- */
    ctx.font = '11px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'middle';
    const GRID = 4;
    for (let i = 0; i <= GRID; i++) {
      const y = padT + (i / GRID) * plotH;
      const price = yMax - (i / GRID) * (yMax - yMin);
      const pct = (price / prevClose - 1) * 100;

      ctx.strokeStyle = THEME.grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      ctx.setLineDash([]);

      const pc = pct > 0.0001 ? THEME.up : pct < -0.0001 ? THEME.down : THEME.flat;
      ctx.fillStyle = THEME.axisText;
      ctx.textAlign = 'right';
      ctx.fillText(price.toFixed(Math.abs(price) >= 1000 ? 1 : 3), padL - 8, y);
      ctx.fillStyle = pc;
      ctx.textAlign = 'left';
      ctx.fillText((pct > 0 ? '+' : '') + pct.toFixed(2) + '%', padL + plotW + 8, y);
    }

    /* --- 分时线（渐变填充） --- */
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, THEME.fillTop);
    grad.addColorStop(1, THEME.fillBottom);

    ctx.beginPath();
    ctx.moveTo(X(0), Y(series[0].price));
    for (let i = 1; i < series.length; i++) ctx.lineTo(X(i), Y(series[i].price));
    const linePath = new Path2D();
    for (let i = 0; i < series.length; i++) {
      if (i === 0) linePath.moveTo(X(i), Y(series[i].price));
      else linePath.lineTo(X(i), Y(series[i].price));
    }
    ctx.save();
    ctx.lineTo(X(series.length - 1), padT + plotH);
    ctx.lineTo(X(0), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = THEME.priceLine;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.stroke(linePath);

    /* --- 最新价：优先用**报价头的实时价**，没有才退回最后一根 K 线收盘 ---
       ⚠️ 用户 2026-10-04：「5日为什么一直是 0%，不应该是实时价吗」。
       K 线最后一根（尤其 5m/1m）是**已完结的收盘**，会比 ticker 滞后几分钟；
       报价头 `quote.last` 才是实时价（变量 `live`，见上方 y 轴范围处）。
       `lastPrice` 只用于**标签与水平虚线**，折线本身仍画 K 线收盘（历史不该被改写）。 */
    const lastBar = series[series.length - 1];
    const lastPrice = live != null ? live : lastBar.price;   // live 见上方 y 轴范围处
    const lastY0 = Y(lastPrice);
    ctx.strokeStyle = (APP_DATA.quote.changePct >= 0) ? 'rgba(0,168,107,0.85)' : 'rgba(234,59,59,0.85)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(padL, lastY0); ctx.lineTo(padL + plotW, lastY0); ctx.stroke();
    ctx.setLineDash([]);

    /* --- 最新价标签：左端实时价、右端涨跌幅（与两侧纵轴一致：左价格轴、右百分比轴） --- */
    const lastPct = prevClose ? (lastPrice / prevClose - 1) * 100 : 0;
    const tagC = lastPct >= 0 ? THEME.up : THEME.down;
    const tagH = 16;
    const tagY = clamp(lastY0, padT + tagH / 2, padT + plotH - tagH / 2);
    const drawTag = (x, w, text) => {
      const r = 3, yy = tagY - tagH / 2;
      ctx.fillStyle = tagC;
      ctx.beginPath();
      ctx.moveTo(x + r, yy);
      ctx.arcTo(x + w, yy, x + w, yy + tagH, r);
      ctx.arcTo(x + w, yy + tagH, x, yy + tagH, r);
      ctx.arcTo(x, yy + tagH, x, yy, r);
      ctx.arcTo(x, yy, x + w, yy, r);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + w / 2, tagY);
      ctx.font = '11px "PingFang SC", "Microsoft YaHei", sans-serif';
    };
    drawTag(padL - 66, 62, lastPrice.toFixed(Math.abs(lastPrice) >= 1000 ? 1 : 3));
    drawTag(padL + plotW + 2, padR - 4, (lastPct > 0 ? '+' : '') + lastPct.toFixed(2) + '%');

    /* --- 成交量 --- */
    /* ⚠️ y轴按**最大值**线性缩放时，开盘头几分钟的尖峰会压扁全天其余柱子
       （实测上证 09:31 单根 1626万手 vs 中位仅 120万手，差 13 倍，中位柱子几乎看不见）。
       富途等终端的做法是按分位数截顶：超过 P95 的柱子统一画到顶部，
       少数尖峰不 sacrificed 整体形态。P95 在此足够温和（开盘 5 根以内被截）。 */
    const volArr = series.map((d) => d.vol).filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    const p95 = volArr.length ? volArr[Math.min(volArr.length - 1, Math.floor(volArr.length * 0.95))] : 1;
    const maxVol = Math.max(p95, 1);
    /* 柱顶被截的根数（>0 即存在尖峰），用于在 VOL 标签上提示，避免误读柱高 */
    const clipped = series.filter((d) => d.vol > maxVol).length;
    const bw = Math.max(1, plotW / series.length - 0.4);
    ctx.fillStyle = THEME.volBar;
    for (let i = 0; i < series.length; i++) {
      const h = Math.min(1, series[i].vol / maxVol) * volH;
      ctx.fillRect(X(i) - bw / 2, volTop + volH - h, bw, h);
    }
    ctx.fillStyle = THEME.axisText;
    ctx.textAlign = 'left';
    ctx.fillText('成交量 VOL: ' + fmt(series[series.length - 1].vol, 3)
      + (clipped ? `（${clipped} 根尖峰已截顶）` : ''), padL, volTop - 4);

    /* --- 时间轴 --- */
    ctx.fillStyle = THEME.axisText;
    ctx.textAlign = 'center';
    /* 5日图按「交易日」取刻度，一天一格显示 MM/DD（对齐富途5日分时图的横轴）。
       series[].t 在 d5 下是 "YYYY-MM-DD HH:MM"，直接画会满屏重复同一天，
       所以先按天去重、再让每个刻度落在当天的首个数据点上。
       ⚠️ 数据源限制：OKX 镜像的 1m K线最多只留约 2 天（实测所有标的
          最早都到 2026-10-02 08:12），所以「5日」实际画出来常常只有 1~2 天，
          有多少显示多少，不伪造更早的数据。
       其他周期（分时/日K/周K…）仍用原 t 值。 */
    if (chartMode === 'd5') {
      const days = [];                       // [{day, idx}] 该日首个数据点的下标，旧->新
      for (let i = 0; i < series.length; i++) {
        const day = String(series[i].t).slice(0, 10);
        if (!days.length || days[days.length - 1].day !== day) days.push({ day, idx: i });
      }
      days.forEach((d, k) => {
        const x = X(d.idx);
        // 首个刻度贴左对齐，末个贴右对齐，避免文字被画布边缘裁掉
        ctx.textAlign = k === 0 ? 'left' : (k === days.length - 1 ? 'right' : 'center');
        const mm = d.day.slice(5, 7), dd = d.day.slice(8, 10);
        ctx.fillText(mm + '/' + dd, x, H - padB / 2 - 2);
      });
      ctx.textAlign = 'center';
      // 每天一根竖分隔线，标出日界（首个刻度不画，避免和左轴重叠）
      ctx.strokeStyle = THEME.grid;
      ctx.lineWidth = 0.5;
      days.forEach((d, k) => {
        if (k === 0) return;
        const x = X(d.idx);
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, volTop);
        ctx.stroke();
      });
    } else {
      const ticks = 6;
      /* 「全天」系列的 t 是 "YYYY-MM-DD HH:mm"（20 字符），刻度只画时间部分，
         否则 6 个刻度会挤成一团糊在一起。日界由下面那段单独标注。
         ⚠️ `usSessionSel` 是全局状态：在美股上选过「全天」后再切到非美股标的，
            t 只有 "HH:mm"（5 字符），直接 slice(11) 会画成空白 —— 故加长度判断。 */
      const tickText = (t) => {
        const s = String(t);
        return (usSessionSel === 'all' && s.length > 11) ? s.slice(11) : s;
      };
      for (let i = 0; i < ticks; i++) {
        const idx = Math.round((i / (ticks - 1)) * (series.length - 1));
        ctx.fillText(tickText(series[idx].t), X(idx), H - padB / 2 - 2);
      }
      /* 「全天 / 1D」会**跨美东日界**（窗口从最近一个 20:00 起算，最长跨两个日历日），
         只画 HH:MM 分不清哪天。在 ET 00:00 处画一条竖分隔线 + `MM/DD` 标注。
         series[].t 在 all 模式下是 "YYYY-MM-DD HH:mm"（见 fetchUsSessionSeries）。
         ⚠️ 非美股标的（上证指数）的 t 只有 "HH:mm"，slice(0,10) 拿不到日期，
            会让每根的 day 都相同 —— 这里加长度门槛，t 太短直接跳过日界标注。 */
      if (chartMode === 'time' && usSessionSel === 'all' && String(series[0].t).length > 11) {
        let prevDay = null;
        for (let i = 0; i < series.length; i++) {
          const day = String(series[i].t).slice(0, 10);
          if (prevDay != null && day !== prevDay) {      // 跨日了
            const x = X(i);
            ctx.strokeStyle = THEME.grid;
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, volTop); ctx.stroke();
            ctx.fillStyle = THEME.axisText;
            ctx.textAlign = 'center';
            ctx.fillText(day.slice(5, 7) + '/' + day.slice(8, 10), x, H - padB / 2 - 2);
          }
          prevDay = day;
        }
        ctx.textAlign = 'center';
      }
    }

    /* --- 悬浮十字线提示（占位，后续可扩展） --- */
    canvas._chartGeom = { padL, padR, padT, plotW, plotH, volTop, volH, yMin, yMax, series, X, Y };
  }

  /* ===================================================================
     5. 对外接口 + 启动
     =================================================================== */
  function renderAll() {
    renderQuote(APP_DATA.quote);
    renderWatchlist(APP_DATA.watchlist, APP_DATA.quote.code);
    renderTradeList();      // 交易页持仓列表（数据未就绪时显示「加载中…」）
    renderCpTab();          // 资讯面板：按当前 tab 渲染（社区评论 / 金十快讯）
    drawChart();          // 无 series 时显示空态，等待 OKX 拉取
  }

  // 供外部注入真实数据：MarketTerminal.setData({ quote, watchlist, comments, series })
  window.MarketTerminal = {
    APP_DATA: APP_DATA,
    setData(patch) {
      Object.assign(APP_DATA, patch || {});
      renderAll();
    },
    redraw: drawChart,
  };

  // 选中态切换（tab 组通用）
  document.querySelectorAll('[data-tabs]').forEach((group) => {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab, .ct-tab, .ci-tab, .cp-tab');
      if (!btn || !group.contains(btn)) return;
      group.querySelectorAll('.tab, .ct-tab, .ci-tab, .cp-tab')
        .forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');

      // 图表周期切换：分时 / 5日 / 日K / 周K / 月K / 季K / 年K
      const mode = btn.dataset.chartMode;
      if (mode && mode !== chartMode) {
        chartMode = mode;
        loadInstrument(APP_DATA.quote.code);
      }

      // 自选分类切换：全部 / 美股 / 沪深 / 期货 / 加密币
      const wcat = btn.dataset.wlCat;
      if (wcat && wcat !== wlCat) {
        wlCat = wcat;
        renderWatchlist(APP_DATA.watchlist || [], (APP_DATA.quote || {}).code);
      }
      // 交易页自选分类（独立状态，不影响行情页）
      const tcat = btn.dataset.wlTradeCat;
      if (tcat && tcat !== wlTradeCat) {
        wlTradeCat = tcat;
        renderWatchlist(APP_DATA.watchlist || [], (APP_DATA.quote || {}).code);
        renderTradeList();
      }
      // 资讯面板 tab：最新（社区 mock）/ 推荐（金十快讯）
      const cpc = btn.dataset.cpTab;
      if (cpc && cpc !== cpTab) {
        cpTab = cpc;
        renderCpTab();
        // 每次切到「推荐」都重拉一次（源侧有 ~45 分钟延迟，但刷新仍能拿到该源此刻的最新一条；
        // 原来只在首次 !loaded 时拉，重新打开页面看到的可能是 30 秒前的旧快照）
        if (cpTab === 'news') fetchJin10();
        // 「富途」tab 目前是待接入占位，不拉数据
      }
    });
  });

  /* 顶栏：美东时间（走秒）+ 美股时段标签（正常时段隐藏标签） */
  function renderBrandClock() {
    const timeEl = $('#brandEt');
    const tagEl = $('#brandSession');
    if (!timeEl) return;
    try {
      const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const MM = String(et.getMonth() + 1).padStart(2, '0');
      const dd = String(et.getDate()).padStart(2, '0');
      const hh = String(et.getHours()).padStart(2, '0');
      const mm = String(et.getMinutes()).padStart(2, '0');
      const ss = String(et.getSeconds()).padStart(2, '0');
      timeEl.textContent = '美东 ' + MM + '/' + dd + ' ' + hh + ':' + mm + ':' + ss;
      if (tagEl) {
        const s = usSession();
        tagEl.textContent = s || '';
        tagEl.hidden = !s;
      }
    } catch (e) { /* 时区不可用时保持占位 */ }
  }

  /* 美股分时时段下拉（盘前/盘中/盘后/夜盘/全天） */
  (function initSessionMenu() {
    const menu = $('#usSessionMenu');
    const periodTab = $('#periodTab');
    if (!menu || !periodTab) return;

    periodTab.addEventListener('click', () => {
      if (APP_DATA.quote.market !== 'US') return;    // 仅美股有此下拉
      if (chartMode !== 'time') { chartMode = 'time'; loadInstrument(APP_DATA.quote.code); }
      if (chartMode === 'time') menu.hidden = !menu.hidden;
    });

    menu.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-session]');
      if (!li) return;
      if (li.dataset.session === usSessionSel) { menu.hidden = true; return; }
      usSessionSel = li.dataset.session;
      menu.querySelectorAll('li').forEach((x) => x.classList.toggle('is-sel', x === li));
      menu.hidden = true;
      syncPeriodIcon();                                   // 立即换图标，不等 loadInstrument
      if (APP_DATA.quote.code) loadInstrument(APP_DATA.quote.code);
    });

    // 点击面板其它区域时收起
    document.addEventListener('click', (e) => {
      if (menu.hidden || menu.contains(e.target) || periodTab.contains(e.target)) return;
      menu.hidden = true;
    });

    /* ---- 分时按钮图标跟随当前时段（仿富途）----
       直接复用下拉菜单里 li 的 SVG 源码，保证按钮与菜单图标完全一致：
         盘前=左侧实/右侧淡、盘中=两侧实、盘后=左淡/右侧实、夜盘=24、全天=1D。
       「淡」的那半用 `fill-opacity`（而非 SVG 上的 opacity 属性）：
         - opacity 属性会同时让填充和描边一起变淡，且在橙色选中底上
           currentColor=白 会淡成浅橙，语义（哪半是"已进行"）被弱化；
         - fill-opacity 只淡填充，边界依然清晰，两个半的对比不受底色影响。 */
    const iconHost = $('#periodTabIcon');
    function syncPeriodIcon() {
      if (!iconHost || !menu) return;
      const key = usSessionSel || currentSessionKey() || 'regular';
      const li = menu.querySelector('li[data-session="' + key + '"]');
      const svg = li && li.querySelector('svg');
      if (!svg) return;
      // 克隆节点（同一 SVG 不能同时挂在两处）
      const copy = svg.cloneNode(true);
      copy.setAttribute('class', '');
      copy.setAttribute('fill', 'currentColor');
      // 把 svg 上的 opacity="x" 换成 fill-opacity，并加深一点保证可见
      copy.querySelectorAll('[opacity]').forEach((el) => {
        el.removeAttribute('opacity');
        el.setAttribute('fill-opacity', '0.42');
      });
      iconHost.innerHTML = '';
      iconHost.appendChild(copy);
    }
    syncPeriodIcon();
    // 切标的时同步（usSessionSel 在非美股下会重置，图标要跟着变）
    document.addEventListener('click', (e) => {
      if (e.target.closest('#watchlist .wl__row')) setTimeout(syncPeriodIcon, 0);
    }, true);
  })();

  /* 侧栏总资产迷你走势图。
     ⚠️ 为什么不用固定 viewBox + preserveAspectRatio="none"：
        旧写法把 100×24 的路径硬拉到实际 ~153×38（桌面）/ ~306×38（移动），
        横向被拉伸 50%~200%，纵向只用 18/24 → 视觉上是一条「扁」线。
        现在按**实际像素**画（1 值 = 1 px），纵横比自然、纵向占满、线宽不缩放。
     ⚠️ 为什么必须定义在 initViewSwitch 之前：`#account` 直达时 switchView 会同步执行，
        晚定义会撞 TDZ（const 未初始化）。 */
  const ACC_SPARK = { series: [] };
  function drawAccSpark() {
    // ⚠️ 不能用 initAccountData 内部的 $id —— 那个是函数作用域的局部变量，这里取不到。
    // ⚠️ `accSpark` 这个 id 挂在 **<path>** 上，不是 <svg>！要改 viewBox 必须拿到 svg，
    //    而尺寸也要用 svg 的（path 空 d 时自身 box 是 0×0，会让 `w<8` 判断误跳过）。
    const path = document.getElementById('accSpark');
    const svg = path && path.ownerSVGElement;
    const vs = ACC_SPARK.series;
    if (!svg || !path || vs.length < 2) return;
    const box = svg.getBoundingClientRect();
    const w = Math.round(box.width), h = Math.round(box.height);
    if (w < 8 || h < 8) return;                       // 还没布局好（视图仍隐藏），跳过
    const mn = Math.min(...vs), mx = Math.max(...vs), rg = mx - mn || 1;
    const pad = 3;
    // viewBox 与像素 1:1 —— 路径坐标直接用像素，横向纵向缩放一致，线不会被拉扁
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.removeAttribute('preserveAspectRatio');        // 1:1 时无需 none 拉伸
    path.setAttribute('d', vs.map((v, i) =>
      `${i ? 'L' : 'M'}${(i / (vs.length - 1) * (w - 1)).toFixed(2)} ` +
      `${(h - pad - (v - mn) / rg * (h - pad * 2)).toFixed(2)}`
    ).join(' '));
  }

  /* 左侧 rail 视图切换：自选(行情终端) / 账户 / 资讯 / 选股器 / 持仓 */
  (function initViewSwitch() {
    const items = document.querySelectorAll('.rail__item[data-view]');
    const accountView = $('#accountView');
    const tradeView = $('#tradeView');
    const screenView = $('#screenView');
    if (!items.length || !accountView) return;

    function switchView(view) {
      const isMarket = view === 'market';
      const isTrade = view === 'trade';
      const isComment = view === 'comment';
      const isScreen = view === 'screen';
      items.forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
      /* accountView 独占主区（自带侧栏 + 主区），所以资讯/选股视图下必须一起藏掉 ——
         否则它仍占着 flex 位置，右侧内容被挤到最右、文字溢出（实测过）。 */
      accountView.hidden = isMarket || isTrade || isComment || isScreen;
      if (tradeView) tradeView.hidden = !isTrade;
      if (screenView) screenView.hidden = !isScreen;
      // 侧栏迷你走势图：账户视图由 hidden 变可见后 clientWidth 才有值，必须重画一次
      // （账户数据是页面加载时拉的，那时视图还隐藏着，只能画到兜底尺寸）
      if (!isMarket && !isTrade) requestAnimationFrame(drawAccSpark);
      if (isScreen) mountHeatmap();
      if (isMobile()) {
        // 移动端：账户/交易/选股视图也要把自选/图表让出去，否则两者同屏叠在一起（残影）。
        // 退出时撤掉 is-comment-mode，回到「列表/图表」那一组互斥状态。
        document.body.classList.remove('is-comment-mode');
        if (!isMarket) {
          document.body.classList.remove('is-chart-mode');   // 账户/交易/选股页不显示图表
          const wl = document.querySelector('.watchlist');
          if (wl) wl.classList.add('is-collapsed');          // 也不显示自选列表
        } else if (drawChart) {
          drawChart();
        }
        return;
      }
      ['.watchlist', '.chart-area', '.comment-panel'].forEach((sel) => {
        const el = $(sel);
        if (!el) return;
        /* 桌面三栏：market 显示全部；comment **只显示资讯面板**；
           account（既非 market 也非 comment/trade）显示自选+图表、藏起资讯。
           ⚠️ 原来一律 `!isMarket` → 桌面点「资讯」时三个全被藏掉，资讯视图等于不存在
           （用户 2026-10-04：「桌面端点资讯应该也出来快讯流」）。 */
        const show = isMarket || (sel === '.comment-panel' && view === 'comment');
        el.classList.toggle('is-hidden-by-view', !show);
      });
      /* 桌面「资讯」时自选与图表都让位了，资讯面板**铺满主区**（原来固定 330px 窄抽屉，
         图表区那大片空白反而没人用）。用 body class 驱动，`is-hidden-by-view` 优先级更高，
         两者互不干扰。 */
      document.body.classList.toggle('is-comment-full', view === 'comment' && !isMobile());
      /* 资讯视图：面板**强制展开**。桌面打开时它默认是收起态（`is-collapsed` + 旁边显示
         `#cpExpand` 展开按钮），在资讯视图下那样会出现「一大片空白 + 一个孤零零的展开按钮」。
         这里直接展开并把展开按钮藏掉；切回自选时恢复原来的收起态。 */
      const cpPanel = $('.comment-panel'), cpExpandBtn = $('#cpExpand'), chartEl = $('.chart-area');
      if (cpPanel && chartEl) {
        if (view === 'comment') {
          cpPanel.classList.remove('is-collapsed');
          chartEl.classList.remove('cp-collapsed');
          if (cpExpandBtn) cpExpandBtn.hidden = true;
        } else {
          cpPanel.classList.add('is-collapsed');
          chartEl.classList.add('cp-collapsed');
          if (cpExpandBtn) cpExpandBtn.hidden = false;
        }
      }
      /* 切到资讯视图时重拉一次快讯（金十源是分钟级更新的流，刷新能拿到更新的内容）。
         移动端由 is-comment-mode 那套逻辑渲染，这里只在桌面走。 */
      if (view === 'comment') {
        if (typeof renderCpTab === 'function') renderCpTab();
        if (typeof fetchJin10 === 'function') fetchJin10();
      }
      if (isMarket) drawChart();      // 画布重新可见后按新尺寸重绘
    }

    items.forEach((btn) => btn.addEventListener('click', () => {
      // 移动端的「资讯」由移动端专属监听处理（切 body class），
      // 不走这里的桌面版三栏逻辑。
      if (isMobile() && btn.dataset.view === 'comment') return;
      switchView(btn.dataset.view);
    }));

    /* ---- 选股器：TickerTiles 热力图 ----
       ⚠️ 路径必须是 `/markets/heatmap/<key>/`：
            `/embed/<key>` 渲染的是全屏仪表盘（卡片列表），`/embed/heatmap/<key>` 是空白页。
       ⚠️ 手写懒加载：容器初始 `hidden`，若用 `loading="lazy"`，
          浏览器会因「元素不可见」无限期推迟加载（与资讯页内嵌 iframe 同一个坑）。 */
    const HEATMAP_BASE = 'https://tickertiles.com/markets/heatmap/';
    const screenFrame = $('#screenFrame');
    const screenLoading = $('#screenLoading');
    let heatKey = 'all-stocks';      // 用户 2026-10-05 定稿：默认打开「全部个股」
    let screenLoadTimer = 0;
    /* ---- 只显示热力图、把它放大的「虚拟视口」几何 ----
       TickerTiles 站点自带一堆 chrome，实测 2026-10-04（1684×894 视口下逐层量出来的）：
         y    0..43   顶部 appbar（logo / 搜索框 / App Store）
         y   60..104  指数切换行（S&P 500 / Nasdaq 100 / Russell 2000 / ETF or watchlist + 右侧 60s 下拉）
         y  112..134  heatmap-controls（指数 chip + **60s 刷新下拉**）
         y  140..160  heatmap-breadth（SPY +0.74% … / Compare SPY vs VOO）
         y  166..194  heatmap-window-row（1D/5D/1M/…/Sector/Ticker/Movers）
         y  200..869  **heatmap-canvas ← 真正的格子区，我们只要这个**
         x  277/287   左侧图标栏 260 + 内边距；canvas 左边界 287，宽 = 视口宽 − 314
       用户要求把上面四条全裁掉（用户 2026-10-04：「sp500……60s 那一行也不要显示了」），
       所以偏移取 canvas 的 x/y，尺寸取「容器 + 一圈边距」——
       站点会按更大的视口重排树图，格子更大且 500 只票全可见，不会裁掉边缘。
       （比 `transform: scale()` 好：scale 必然切掉一条边。）
       ⚠️ 窄屏（<721px）是另一套单列布局，必须单独给一组数：canvas x=23、y=284、
          宽 = 视口 − 46、高固定 948（与视口高无关）。 */
    const HM_CHROME = {
      /* 宽屏（桌面）：热力图内容区 x=287 y=200（站点 appbar 43 + 四条工具条） */
      wide: { x: 287, y: 200, padX: 314, padY: 225 },
      /* ⚠️ 窄屏这组数**必须在 iPhone UA 下量**（用户 2026-10-05 报「移动端没裁剪对」）：
         移动端站点会换成另一套布局 —— appbar 高 79（桌面 43）、指数 chip 与周期条**折行**
         （controls 74px、window-row 50px），所以内容区起点是 y=**308**而不是桌面量的 284。
         之前用「430px 宽但桌面 UA」量，拿到的是 284，真机（iPhone 15 Pro Max）就裁偏了。
         画布高度 = min(视口高 − 329, 924)（2,961 只票单列排完就封顶），故padY 取 329。 */
      narrow: { x: 23, y: 308, padX: 46, padY: 329 },
      /* 窄屏仪表盘（用户 2026-10-05 定稿：「移动端不用分三栏，就用 tickers 这种下拉到底的」）：
         **不缩放**（去掉 fixedScale → s=1），站点按面板真实宽度（430+18=448）排版 = 单列长图，
         与窄屏热力图一个路子；之前的 1/1.35 会让站点按 1.35 倍视口排版，挤成多栏小表。
         ⚠️ x/y/padX 是在 **iPhone 15 Pro Max UA + 448 宽 iframe** 下实测的：
            窄屏 appbar（.dev-appbar）高 **79**，第一张卡片（stage）从 y=60 起 ——
            两者重叠 19px（appbar 悬浮盖在卡片上），所以裁 **y=79** 正好把 appbar 整条切掉，
            又不会多吃卡片内容（被吃掉的那 19px 本来就被 appbar 遮着看不见）。
            ⚠️ 别再用缩放态量的 76，也别用 60（会漏出 appbar 底部那条 App Store 按钮）。
         `fullH`：下拉到底就停在**自选最后一格（XRT / 最后一个 tile）**，再往下全裁掉 ——
         站点自己的「About this page」区和页脚 © 2026 TickerTiles 一条都不露
         （用户 2026-10-05：「就到 xrt 就行，下面 about this page 以下都不要了」）。
         ⚠️ **fullH 同时决定站点渲染多少卡片**（站点按 iframe 视口懒渲染，切掉下面就真的没了）：
            给 2620 时 XRT 那个 tile 干脆不渲染，要 ≥ tile 底那一档才出来。
         ⚠️ 2026-10-05 量法（iPhone UA + 466 宽 × fullH 高视口，分段滚到底触发懒渲染后再回到顶部量）：
            Thematic ETFs 整节（含 XRT 最后一行）底 = **2754**；页脚 Terms 链接顶 = **2845**。
         ⚠️ 单看「内容底 2754」会取 2775，但**实测 2775 时底下那条「About this page ▸」折叠条又露出来**
            （它是卡片底边的收起把手，2757 起就露头）—— 真正干净的档位是 **2756**
            （截图验证：XRT 整行含底边线完整、下面 About 一丝不露；2757/2760/2766/2775 都会露出 About）。
            所以这里取「内容底 + 2px」而不是「内容底 + 20px」，⚠️ 别为了「多留点余量」往上加。
         ⚠️ 之前按估的「tile 底 ≈ 2675 / About 顶 ≈ 2695」给 2710，**XRT 被切掉 44px**
            （用户同日截图反馈「xrt 被截断了」）—— 估低的根因是站点懒渲染让卡片长高，
            量的时候没滚到底。别再按估数给，按上面实测的 2754/2845 档。
         ⚠️ 别按 `documentElement.scrollHeight`（2974，含页脚）给，也别给到 2845 以上，
            否则下拉到底会看到 About 标题 + 页脚链接。
         内部不再有滚动条，长图交给外层 `.screen-body` 竖向滚动（见 fitHeatmap 里的 narrowScroll）。 */
      narrowMarket: { x: 12, y: 79, padX: 18, padY: 79, fullH: 2756 },
      /* 「市场」视图 = Tickertiles 仪表盘（winners/losers/各市场表现/板块/因子）。
         实测 1800×1200 视口下：`.dashboard-stage` 内容区起点 x=276, y=59，宽 = 视口 − 292。
         缩放：站点按 **1.35 倍**视口排版，再用 `scale(1/1.35)` 缩回面板
         （用户 2026-10-05：「桌面端热力图市场改成先 1.35 倍，再 scale」）——
         一屏能看到比面板原生布局多 35% 的内容，卡片里的表格行不会被裁掉。
         ⚠️ 这个 1.35 **只用于桌面**：移动端要单列下拉，见上面的 narrowMarket。 */
      market: { x: 276, y: 59, padX: 292, padY: 59, fixedScale: 1 / 1.35 },
    };
    /* 站点布局画布 = 面板 × hmZoom，再由 CSS `transform: scale(1/hmZoom)` 缩回面板大小。
       ⚠️ 为什么要「放大后缩回」而不是直接把 iframe 设成面板大小（用户 2026-10-05）：
       TickerTiles 只在**它自己的坐标里**够大时才给格子画代码。实测 all-stocks（2,961 个格子）
       能显示代码的格子数：×1.0 = 125（4.2%）、×1.25 = 208、×1.5 = 273（9.2%）、×1.8 = 365。
       也就是说想看全市场（小框也要有代码），必须让它在更大的画布上排版；
       屏幕上每只股票看起来会变小，这是「信息密度」与「单只可读性」的取舍。
       窄屏不缩放（那边本来就是单列长图，缩了反而更看不清）。 */
    let hmZoom = 1.25;            // 桌面端默认 1.25 倍（用户 2026-10-05 定稿）
    /* 「市场」视图的 URL：Tickertiles 仪表盘，带 sort / 自选代码参数 */
    const MARKET_URL = 'https://tickertiles.com/?sort=size&names=SPY%2CQQQ%2CEWZ%2CCIBR%2CEWY';
    const isMarketView = () => heatKey === 'market';
    /* 缩放下拉只在「宽屏热力图」下有意义：
       - 市场仪表盘固定 1.35 倍（HM_CHROME.market.fixedScale）
       - 窄屏热力图/仪表盘固定 s = 1（单列长图，缩放反而看不清）
       所以这两种情况把下拉藏起来，免得给了个不起作用的控件。 */
    function syncZoomVisibility() {
      const zl = document.querySelector('.screen-zoom');
      if (!zl) return;
      const mobile = typeof isMobile === 'function' && isMobile();
      zl.style.display = (mobile || isMarketView()) ? 'none' : '';
    }
    function fitHeatmap() {
      const body = document.querySelector('.screen-body');
      if (!screenFrame || !body) return;
      const r = body.getBoundingClientRect();
      if (!r.width || !r.height) return;                 // 容器隐藏时别算（会算出 0 尺寸）
      const mobile = typeof isMobile === 'function' && isMobile();
      /* `s` = **显示缩放**（<1 表示站点按更大视口排版再缩回）。
         热力图：s = 1/hmZoom（站点画布 = 面板 × hmZoom）；
         市场仪表盘：桌面固定 1/1.35（HM_CHROME.market.fixedScale），窄屏 s = 1 单列；
         窄屏热力图：s = 1（单列长图，缩了更看不清）。 */
      const c = mobile
        ? (isMarketView() ? HM_CHROME.narrowMarket : HM_CHROME.narrow)
        : (isMarketView() ? HM_CHROME.market : HM_CHROME.wide);
      const s = c.fixedScale != null ? c.fixedScale : (mobile ? 1 : 1 / hmZoom);
      /* 窄屏「下拉到底」：`.screen-body` 默认 overflow:hidden（热力图靠 iframe 内部滚动），
         市场单列要整张长图交给外层滚，所以这里把 iframe 高度设成 `c.fullH`（站点单列全高）
         并给容器开竖向滚动。热力图那边 fullH 为空 → 保持原样（内部滚），互不影响。 */
      const narrowScroll = mobile && isMarketView() && c.fullH;
      if (narrowScroll) {
        body.style.overflowY = 'auto';
        body.style.overflowX = 'hidden';
        /* 容器高度由 flex 决定（不变），只有 iframe 变高 → 容器 scrollHeight 随之变大。 */
      } else {
        body.style.overflowY = '';
        body.style.overflowX = '';
      }
      /* iframe 按「面板 ÷ s + 边距」给尺寸，再用 transform 缩回并把内容区左上角对到面板左上角：
         `translate(tx,ty) scale(s)` 是先 scale 再 translate，所以要让内容区原点(c.x,c.y) 落到 (0,0)，
         需要 tx = −s·c.x、ty = −s·c.y（transform-origin 必须是 0 0）。 */
      screenFrame.style.width = Math.round(r.width / s + c.padX) + 'px';
      screenFrame.style.height = (narrowScroll ? c.fullH : Math.round(r.height / s + c.padY)) + 'px';
      screenFrame.style.left = '0px';
      screenFrame.style.top = '0px';
      screenFrame.style.transformOrigin = '0 0';
      /* ⚠️ s === 1 时**也必须**保留 translate —— 裁剪正是靠它把内容区左上角对到面板左上角。
         之前图省事写成 `transform: none`，结果移动端（s 固定 1）完全不裁剪，
         站点自己的导航 + 四条工具条全露出来（用户 2026-10-05 报「移动端没裁剪对」）。 */
      screenFrame.style.transform = 'translate(' + (-s * c.x) + 'px,' + (-s * c.y) + 'px) scale(' + s + ')';
    }
    function mountHeatmap() {
      if (!screenFrame) return;
      fitHeatmap();
      { const t = document.querySelector('.screen-head__title');
        if (t) t.textContent = isMarketView() ? '市场' : '美股热力图'; }
      syncZoomVisibility();
      /* ⚠️ 视图刚从 `display:none` 切出来时，**同步**读 `.screen-body` 拿到的是过期尺寸
         （实测 344×695，而真实值1390×775）—— 布局还没重排完。所以下一帧 + 一次延时再校两遍。 */
      requestAnimationFrame(fitHeatmap);
      setTimeout(fitHeatmap, 400);
      /* 「市场」不是热力图，走仪表盘地址（带 sort / names 参数） */
      const want = isMarketView() ? MARKET_URL : HEATMAP_BASE + heatKey + '/';
      if (screenFrame.getAttribute('src') !== want) {
        screenFrame.setAttribute('src', want);
        if (screenLoading) { screenLoading.hidden = false; screenLoading.textContent = isMarketView() ? '市场页加载中…' : '热力图加载中…'; }
        /* 兜底：iframe 的 load 事件在「src 由 JS 设置 + 首次渲染」时序下可能早于监听器绑定，
           提示就永远撤不掉。这里再挂一个 12s 定时器，到点无条件收起
           （真加载失败时页面本身是空白，提示文案由 error 分支负责）。 */
        clearTimeout(screenLoadTimer);
        screenLoadTimer = setTimeout(() => { if (screenLoading) screenLoading.hidden = true; }, 12000);
      }
    }
    if (screenFrame) {
      // 加载完成就撤掉「加载中」提示（iframe 的 load 事件在跨域时仍会触发）
      screenFrame.addEventListener('load', () => {
        clearTimeout(screenLoadTimer);
        if (screenLoading) screenLoading.hidden = true;
        fitHeatmap();                    // 字体/布局稳定后再校一次尺寸
      });
      screenFrame.addEventListener('error', () => { if (screenLoading) screenLoading.textContent = '热力图加载失败，请检查网络'; });
      /* 窗口尺寸变了要重算：热力图边距是固定像素，但可视区尺寸是容器的。 */
      window.addEventListener('resize', () => {
        if (screenView && !screenView.hidden) fitHeatmap();
      });
      const sw = document.getElementById('screenSwitch');
      if (sw) sw.addEventListener('click', (e) => {
        const b = e.target.closest('[data-screen-key]');
        if (!b || b.dataset.screenKey === heatKey) return;
        heatKey = b.dataset.screenKey;
        sw.querySelectorAll('[data-screen-key]').forEach((x) => x.classList.toggle('is-active', x === b));
        syncZoomVisibility();
        /* 标题也跟着换：热力图 vs 市场仪表盘 */
        const ttl = document.querySelector('.screen-head__title');
        if (ttl) ttl.textContent = isMarketView() ? '市场' : '美股热力图';
        mountHeatmap();
      });

      /* ---- 自动刷新间隔（头部那个「刷新 60s」下拉）----
         站点自带的 60s 下拉在 `heatmap-controls` 里（y=112），已经被我们裁掉了。
         跨域拿不到 iframe 内部状态，**唯一能做的外部手段就是定时重载 iframe**，
         所以这个下拉是「我们自己的刷新节奏」，不是去改它的选项。
         默认 60s（用户定稿），选择存localStorage，跨刷新保留。 */
      const REFRESH_KEY = 'futu_screen_refresh_v1';
      const DEFAULT_REFRESH = 60000;
      let refreshTimer = 0;
      function setHeatRefresh(ms, persist) {
        clearInterval(refreshTimer);
        refreshTimer = 0;
        if (ms > 0) {
          refreshTimer = setInterval(() => {
            if (document.hidden || !screenFrame) return;         // 页面不可见时不折腾
            /* 加个时间戳绕过 HTTP 缓存，否则重载回来的可能还是旧页面 */
            screenFrame.setAttribute('src', (isMarketView() ? MARKET_URL : HEATMAP_BASE + heatKey + '/?z=' + hmZoom) + '&r=' + Date.now());
          }, ms);
        }
        if (persist) { try { localStorage.setItem(REFRESH_KEY, String(ms)); } catch (e) { /* 隐私模式 */ } }
      }
      const refreshSel = document.getElementById('screenRefresh');
      if (refreshSel) {
        let init = DEFAULT_REFRESH;
        try {
          const v = parseInt(localStorage.getItem(REFRESH_KEY) || '', 10);
          if (!Number.isNaN(v) && v >= 0) init = v;                 // 存过的值优先
        } catch (e) { /* 隐私模式 */ }
        refreshSel.value = String(init);
        setHeatRefresh(init, false);
        refreshSel.addEventListener('change', () => setHeatRefresh(parseInt(refreshSel.value, 10) || 0, true));
      }

      /* ---- 缩放下拉 ----
         ⚠️ 改倍率**必须重载 iframe**：站点是按加载时的视口排版的，
            只改 CSS transform 的话，格子分布还停在旧尺寸，等于白改。 */
      const zoomSel = document.getElementById('screenZoom');
      if (zoomSel) {
        const ZOOM_KEY = 'futu_screen_zoom_v1';
        let z = parseFloat(localStorage.getItem(ZOOM_KEY) || '');
        if (!isFinite(z) || z < 1) z = 1.25;                         // 存过的值优先，默认 125%
        hmZoom = z;
        zoomSel.value = String(z);
        zoomSel.addEventListener('change', () => {
          hmZoom = parseFloat(zoomSel.value) || 1.25;
          try { localStorage.setItem(ZOOM_KEY, String(hmZoom)); } catch (e) { /* 隐私模式 */ }
          fitHeatmap();
          screenFrame.setAttribute('src', HEATMAP_BASE + heatKey + '/?z=' + hmZoom + '&r=' + Date.now());
        });
      }
    }

    // 支持 #account / #trade 直达（用正则取 hash，避免带上后面的查询串）
    const hash = (location.hash || '').replace(/^#/, '').split('?')[0];
    if (hash === 'account') switchView('account');
    else if (hash === 'trade') switchView('trade');
  })();

  /* 顶栏刷新按钮：行情视图重拉自选+当前标的；账户视图重跑账户数据加载 */
  (function initRefresh() {
    const btn = document.querySelector('.topbar .icon-btn[title="刷新"]');
    const accountView = $('#accountView');
    if (!btn || !accountView) return;
    let accLoading = false;
    btn.addEventListener('click', () => {
      if (!accountView.hidden) {
        if (accLoading) return;
        accLoading = true;
        /* ⚠️ 账户视图里走**增量刷新**（就是 15s 定时器那套 `TRADE_POS.refresh`），
           不再整页 `initAccountData()` 重跑一遍 —— 后者要把 Asset_parsed / 基金东财脚本 /
           Alpaca 分页全拉一遍（实测 4~8s），点一下刷新就卡住半分钟，用户看到的就是
           「点刷新之后证券半天出不来」。行情没就绪（还没加载过账户数据）时才退回全量初始化。 */
        const inc = TRADE_POS && TRADE_POS.refresh;
        if (typeof inc === 'function') {
          Promise.resolve(inc()).finally(() => { accLoading = false; });
        } else {
          Promise.resolve(initAccountData()).finally(() => { accLoading = false; });
        }
      } else {
        fetchWatchlist();
        fetchTxWatch();
        fetchFxWatch();
        const sel = APP_DATA.watchlist.find((x) => x.code === APP_DATA.quote.code)
                 || APP_DATA.watchlist.find((x) => x.live)
                 || APP_DATA.watchlist[0];
        if (sel) loadInstrument(sel.code);
      }
    });
  })();

  /* 「统计」tab：资产/分类 视角切换 + 展开/收起明细 */
  (function initAoDist() {
    const sw = document.getElementById('aoDistSwitch');
    if (sw) {
      sw.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-ao-dim]');
        if (!b || b.dataset.aoDim === aoDist.dim) return;
        sw.querySelectorAll('button').forEach((x) => x.classList.toggle('is-active', x === b));
        aoDist.dim = b.dataset.aoDim;
        aoDist.expanded = false;                 // 换视角时收起，回到一致的初始状态
        renderAoDist();
      });
    }
    const moreBtn = document.getElementById('aoDistMoreBtn');
    if (moreBtn) {
      moreBtn.addEventListener('click', () => {
        aoDist.expanded = !aoDist.expanded;
        renderAoDist();
      });
    }
    // 窗口尺寸变化 / 侧栏折叠都要重画环形图（canvas 尺寸变了）
    window.addEventListener('resize', () => { if (aoDist.dim) renderAoDist(); });
  })();

  /* 自选 / 资讯面板收起展开：收起后图表区留浮动展开按钮，画布随宽度重绘 */
  (function initPanelCollapse() {
    const wl = document.querySelector('.watchlist');
    const cp = document.querySelector('.comment-panel');
    const wlCollapse = $('#wlCollapse'), wlExpand = $('#wlExpand');
    const cpClose = document.querySelector('.cp__close'), cpExpand = $('#cpExpand');
    if (!wl || !cp || !wlCollapse || !wlExpand || !cpClose || !cpExpand) return;
    const chartArea = document.querySelector('.chart-area');
    // 布局动画（250ms）期间重绘两次：起始一帧 + 结束一帧，避免画布尺寸跳变卡顿
    const redraw = () => {
      const paint = () => { if (!($('#accountView') || {}).hidden) drawChart(); };
      requestAnimationFrame(paint);
      setTimeout(() => requestAnimationFrame(paint), 270);
    };
    wlCollapse.addEventListener('click', () => {
      // 移动端不提供收起/展开（列表与图表已按页互斥），此按钮在 <680px 下被 CSS 隐藏。
      // 这里再挡一道：防止桌面端收起后缩窄窗口 → 列表带着 is-collapsed 隐藏，
      // 而移动端的还原按钮又被 display:none，用户就再也看不到列表了。
      if (isMobile()) return;
      wl.classList.add('is-collapsed');
      chartArea.classList.add('wl-collapsed');
      wlExpand.hidden = false;
      redraw();
    });
    wlExpand.addEventListener('click', () => {
      if (isMobile()) return;
      wl.classList.remove('is-collapsed');
      chartArea.classList.remove('wl-collapsed');
      wlExpand.hidden = true;
      redraw();
    });
    cpClose.addEventListener('click', () => {
      cp.classList.add('is-collapsed');
      chartArea.classList.add('cp-collapsed');
      cpExpand.hidden = false;
      redraw();
    });
    cpExpand.addEventListener('click', () => {
      cp.classList.remove('is-collapsed');
      chartArea.classList.remove('cp-collapsed');
      cpExpand.hidden = true;
      redraw();
    });

    /* ---- 持仓侧栏收起/展开（2026-10-05 用户：「桌面端这里右边加个自选一样的收起箭头」）----
       复用自选那套 `.is-collapsed` + `.panel-expand--l`，但多一步：
       收起后**右侧主区变宽 430px**，「推算总资产」分时图是按宽度画 canvas 的
       （`drawAssetChart` 里量 `stage.clientWidth`），不重绘就会保持旧宽度、右侧留白。
       ⚠️ 这里**不能直接调 `refreshAssetChart`** —— 它在另一个闭包里，`typeof` 判断会静默跳过
       （实测侧栏收起了、canvas 仍是 1070px）。改走 window 自定义事件，由那个闭包自己监听。 */
    const tradeSide = document.querySelector('.watchlist--trade');
    const tradeCollapse = $('#tradeCollapse'), tradeExpand = $('#tradeExpand');
    if (tradeSide && tradeCollapse && tradeExpand) {
      /* 布局过渡 250ms 前后各请求一次：起始一帧让画布先跟上，过渡完再按最终宽度重画。 */
      const repaintAsset = () => {
        window.dispatchEvent(new CustomEvent('asset-chart-repaint'));
        setTimeout(() => window.dispatchEvent(new CustomEvent('asset-chart-repaint')), 280);
      };
      tradeCollapse.addEventListener('click', () => {
        if (isMobile()) return;          // 移动端按钮被 CSS 隐藏，这里再挡一道
        tradeSide.classList.add('is-collapsed');
        tradeExpand.hidden = false;
        /* 给 .trade-view 挂个状态位：CSS 用它给分时图头部留出左边距，
           否则左上角的展开按钮会压住大数字（用户 2026-10-05 报的遮挡）。
           与自选页 `.chart-area.wl-collapsed .quote-head { padding-left: 42px }` 同一思路。 */
        const tv = document.getElementById('tradeView');
        if (tv) tv.classList.add('is-side-collapsed');
        repaintAsset();
      });
      tradeExpand.addEventListener('click', () => {
        if (isMobile()) return;
        tradeSide.classList.remove('is-collapsed');
        tradeExpand.hidden = true;
        const tv = document.getElementById('tradeView');
        if (tv) tv.classList.remove('is-side-collapsed');
        repaintAsset();
      });
    }

    // 打开页面时资讯面板默认收起（首帧不播收起动画）
    cp.style.transition = 'none';
    cp.classList.add('is-collapsed');
    chartArea.classList.add('cp-collapsed');
    cpExpand.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => { cp.style.transition = ''; }));
  })();

  /* 账户内分类切换：顶部总资产大卡片=全部账户总览；证券 / 基金 / 现金（点击左侧摘要切换主区模板） */
  (function initAccCats() {
    const lines = document.querySelectorAll('.as-line[data-cat]');
    const pages = document.querySelectorAll('.acc-page');
    if (!lines.length || !pages.length) return;
    const topCard = document.querySelector('.acc-side__card');

    function activate(cat) {
      lines.forEach((x) => x.classList.toggle('is-active', x.dataset.cat === cat));
      pages.forEach((p) => { p.hidden = p.dataset.catPage !== cat; });
      if (topCard) topCard.classList.toggle('is-active', cat === 'total');
      /* 总览页的 canvas 在 hidden 期间尺寸为 0，切进来时（重）画。
         按当前 tab 分派：环形图也必须在这里重画（它的尺寸取自父容器，
         总览页 hidden 期间同样是 0）。 */
      if (cat === 'total') {
        if (aoState.mode === 'cal') drawAoCal();
        else if (aoState.mode === 'stat') renderAoDist();
        else drawAoChart();
      } else {
        aoState.hover = null;                         // 离开总览页时清掉十字光标
      }
    }

    lines.forEach((ln) => ln.addEventListener('click', () => activate(ln.dataset.cat)));

    // 顶部「总资产」大卡片 = 总览页入口
    if (topCard) {
      topCard.classList.add('is-clickable');
      topCard.addEventListener('click', () => activate('total'));
    }

    // 走势 tab（收益率 / 资产）与时间范围切换
    const tabs = document.querySelectorAll('#aoTabs [data-ao-tab]');
    const ranges = document.querySelectorAll('#aoRanges [data-ao-range]');
    /* 三个互斥视图（收益率/资产走势、收益日历、统计）共用同一批容器：
       走势图 `#aoChartWrap`、悬停统计行 `#aoStats`、时间范围 `#aoRanges`。
       ⚠️ 曾写成 showCal / showStat 两个各自独立的开关，互相把对方设好的 display 覆盖回去
       （切到「收益日历」时 showCal(false) 会把 chart/stats/ranges 全部恢复显示，
        即使当前并不是走势图 tab）。故合并成**单一入口** `applyMode`，
       按当前 mode 一次性决定每个容器该不该显示 —— 不存在覆盖问题。 */
    const applyMode = (mode) => {
      const isChart = mode === 'return' || mode === 'asset';
      const cal = document.getElementById('aoCal');
      const dist = document.getElementById('aoDist');
      const chart = document.getElementById('aoChartWrap');
      const stats = document.getElementById('aoStats');
      const ranges = document.getElementById('aoRanges');
      if (cal) cal.hidden = mode !== 'cal';
      // 分布图原先常驻在走势图上方，用户 2026-10-04 要求收进「统计」tab
      if (dist) dist.hidden = mode !== 'stat';
      if (chart) chart.style.display = isChart ? '' : 'none';
      if (stats) stats.style.display = isChart ? '' : 'none';
      if (ranges) ranges.style.display = isChart ? '' : 'none';
      /* 只重画当前可见的那一个。
         ⚠️ 统计页的环形图**必须等 hidden 摘掉之后**才能画：它按
         `wrap.clientWidth/Height` 定尺寸，而 hidden 期间父容器尺寸为 0，
            会走 `if (W<40) return` 直接跳过，canvas 保持默认 300x150（只画一半）。
            日历/走势图是 DOM/另有一套守卫，不受此影响。 */
      if (mode === 'cal') drawAoCal();
      else if (mode === 'stat') renderAoDist();
      else if (isChart) drawAoChart();
    };
    tabs.forEach((b) => b.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.toggle('is-active', x === b));
      aoState.mode = b.dataset.aoTab;
      aoState.hover = null;                           // 切换视图时清掉十字光标
      applyMode(aoState.mode);
    }));
    ranges.forEach((b) => b.addEventListener('click', () => {
      if (b.disabled) return;
      ranges.forEach((x) => x.classList.toggle('is-active', x === b));
      aoState.range = b.dataset.aoRange;
      aoState.hover = null;
      drawAoChart();
    }));
  })();

  /* ============ 移动端：侧栏折叠（A） + 走势图全屏（D） ============
     A：窄屏下侧栏「总资产卡 + 分类列表」占 313px，把总览页走势图挤到只露 45px。
        折叠成一条（总资产 + 箭头，约 44px），走势图拿到约 354px。
        折叠状态存 localStorage —— 看过明细的人不愿每次展开，不看的人一直清爽。
     D：点走势图（或右上角按钮）铺满全屏，关闭后把 canvas 归位并重绘。 */
  (function initMobileFoldAndFullscreen() {
    const side = document.getElementById('accSide');
    const foldBtn = document.getElementById('accSideFold');
    const foldBar = document.querySelector('.acc-side__foldbar');
    const sumEl = document.getElementById('accSideSum');
    const KEY = 'futu_acc_side_folded';
    /* 顶栏：展开态下「箭头往上一直到页面顶」的热区挂在这里（见下面 click 委托）。
       账户页折叠条在窄屏是贴在顶栏下沿的，所以顶栏空白就是用户说的「箭头往上到页面顶」。 */
    const topbar = document.querySelector('.topbar');
    const accountView = document.getElementById('accountView');
    const isNarrow = () => AC_MQ.matches;
    if (side && foldBtn) {
      const apply = (folded) => {
        side.classList.toggle('is-folded', folded);
        foldBtn.setAttribute('aria-expanded', folded ? 'false' : 'true');
        // 展开态给顶栏一个 pointer 光标（表示这整条能点收起）；折叠态撤掉
        if (topbar) topbar.classList.toggle('is-foldable', !folded && isNarrow());
        // 高度变了，侧栏迷你走势图和总览页图表都要按新尺寸重画
        requestAnimationFrame(() => { drawAccSpark(); drawAoChart(); renderAoDist(); });
      };
      // 默认展开（未存过）；只有显式存了 '1' 才折叠
      apply(localStorage.getItem(KEY) === '1');
      /** force 传 true = 强制收起、false = 强制展开、省略 = 反转 */
      const toggle = (force) => {
        const folded = force === undefined ? !side.classList.contains('is-folded') : !!force;
        apply(folded);
        try { localStorage.setItem(KEY, folded ? '1' : '0'); } catch (e) { /* 隐私模式忽略 */ }
      };
      foldBtn.addEventListener('click', (e) => {
        e.stopPropagation();          // 别冒泡到 foldBar 再切一次（切两次 = 没动）
        toggle();
      });
      /* 折叠条**整条可点**都展开/收起（用户 2026-10-04：「这界面的时候点横条的任意位置应该都是展开功能」）。
         之前左半是 `#accSideToTotal`「进总览页」、右半箭头才是展开 —— 同一横条两套语义，
         点左边直接跳页、点右边才展开，很容易误触。现在统一成 toggle。
         ⚠️ `#accSideToTotal` 自己的 click 监听也要在**折叠态**下让位（它 stopPropagation 会把
         点击拦在半路，导致左半边点了没反应）—— 那段代码里判断了 `is-folded` 就直接 return。 */
      if (foldBar) {
        foldBar.addEventListener('click', (e) => {
          if (e.target.closest('#accSideFold')) return;      // 箭头已在上方处理
          toggle();
        });
        foldBar.style.cursor = 'pointer';
      }

      /* ---- 展开态：热区从箭头往上「一直到页面顶」（顶栏整条）都能点收起 ----
         用户 2026-10-05：「这个收起点击范围太小，从箭头往上一直到页面顶都可以点击收起」。
         ⚠️ **不要**用 `position:fixed` 透明遮罩去盖住顶栏 —— 遮住之后顶栏的
         返回/前进/刷新按钮和搜索框也一起点不动了。改成在 .topbar 上做 click 委托：
         命中交互控件（button/a/input…）一律放行，剩下的空白与品牌文字都当成「收起」。
         ⚠️ 只在 **展开态 + 窄屏 + 账户视图可见** 时生效（回调里逐条守卫），否则在
         自选 / 资讯 / 选股视图点顶栏空白也会把账户侧栏莫名收起来。
         ⚠️ 折叠态不绑：那时点横条整条是「展开」，顶栏不该有第二种语义。 */
      if (topbar && accountView) {
        topbar.addEventListener('click', (e) => {
          if (accountView.hidden) return;                          // 不在账户视图
          if (!isNarrow() || side.classList.contains('is-folded')) return;
          if (e.target.closest('button, a, input, select, textarea, label')) return;
          toggle(true);                                            // 只收起，不反转（避免再点又展开）
        });
      }
    }

    // 折叠条上要显示总资产 —— 与 .acc-side__total 同步同一个数
    const total = document.getElementById('accTotalVal');
    // 折叠后总资产卡被收起，折叠条左侧的「总资产」就是进总览页的入口（替代它）
    const toTotal = document.getElementById('accSideToTotal');
    if (toTotal) toTotal.addEventListener('click', (e) => {
      /* 折叠态：整条横条 = 展开（用户 2026-10-04），本按钮**不做任何事也不拦事件**，
         让它自然冒泡到 foldBar 的 toggle —— 之前这里先 stopPropagation 再 return，
         点击被吞在半路，点了左半边「总资产」完全没反应。
         展开态下这个按钮是 `display:none`（CSS `.acc-side:not(.is-folded) .acc-side__toTotal{display:none}`），
         真正可点的只有折叠态，所以下面的「进总览」逻辑实际是兜底，正常走不到。 */
      if (side && side.classList.contains('is-folded')) return;      // 不 stopPropagation
      e.stopPropagation();
      // 复现 initAccCats 里 activate('total') 的行为（那边是独立 IIFE，变量取不到）
      document.querySelectorAll('.as-line[data-cat]').forEach((x) => x.classList.remove('is-active'));
      document.querySelectorAll('.acc-page').forEach((p) => { p.hidden = p.dataset.catPage !== 'total'; });
      const tc = document.querySelector('.acc-side__card');
      if (tc) tc.classList.add('is-active');
      requestAnimationFrame(drawAoChart);
    });
    if (total && sumEl && window.MutationObserver) {
      const sync = () => { sumEl.textContent = total.textContent; };
      new MutationObserver(sync).observe(total, { childList: true, characterData: true, subtree: true });
    }

    /* ---- D：走势图全屏 ---- */
    const fs = document.getElementById('aoFs');
    const fsChartWrap = document.getElementById('aoFsChartWrap');
    const fsStats = document.getElementById('aoFsStats');
    const fsTitle = document.getElementById('aoFsTitle');
    const fsClose = document.getElementById('aoFsClose');
    const fsBtn = document.getElementById('aoFsBtn');
    const chartWrap = document.getElementById('aoChartWrap');
    const statsEl = document.getElementById('aoStats');
    const canvas = document.getElementById('aoChart');
    if (!fs || !fsChartWrap || !fsStats || !chartWrap || !canvas) return;
    let homeParent = chartWrap, homeNext = null;
    let statsHome = statsEl ? statsEl.parentNode : null, statsNext = null;

    // 全屏顶部：走势图 tab 高亮 + 时间范围高亮，跟随 aoState 同步（定义在 openFs 之前，避免 TDZ 隐患）
    // 范围档位与主页面 #aoRanges 保持一致（用户 2026-10-04 定稿：近1月/近3月/今年以来/自始以来）
    const RANGE_LABEL = { '1m': '近1月', '3m': '近3月', 'ytd': '今年以来', 'all': '自始以来' };
    const syncFsUi = () => {
      document.querySelectorAll('#aoFsRanges [data-ao-range]').forEach((x) => {
        x.classList.toggle('is-active', x.dataset.aoRange === aoState.range);
      });
      document.querySelectorAll('#aoFsTabs [data-ao-fs-tab]').forEach((x) => {
        x.classList.toggle('is-active', (x.dataset.aoFsTab === 'asset') === (aoState.mode === 'asset'));
      });
      /* 日历与统计都不是 canvas：主页面切过去时走势图是隐藏的，
         全屏留着只会显示上一张过期图，直接退出。 */
      if ((aoState.mode === 'cal' || aoState.mode === 'stat') && !fs.hidden) closeFs();
    };

    const openFs = () => {
      if (!fs.hidden) return;
      // 记录两处原位置，关闭时精确归位
      homeParent = canvas.parentNode;
      homeNext = canvas.nextSibling;
      statsHome = statsEl.parentNode;
      statsNext = statsEl.nextSibling;
      fsStats.appendChild(statsEl);                   // 统计行搬进全屏，复用悬停逻辑
      fsChartWrap.appendChild(canvas);               // canvas 搬进全屏
      syncFsUi();
      fs.hidden = false;
      document.body.style.overflow = 'hidden';       // 锁背景滚动
      requestAnimationFrame(drawAoChart);            // 尺寸变了要重画
    };
    const closeFs = () => {
      if (fs.hidden) return;
      homeParent.insertBefore(canvas, homeNext);     // canvas 归位
      statsHome.insertBefore(statsEl, statsNext);    // 统计行也归位（不能塞回 fsStats，那是全屏容器）
      fs.hidden = true;
      document.body.style.overflow = '';
      requestAnimationFrame(drawAoChart);
    };
    if (fsBtn) fsBtn.addEventListener('click', (e) => { e.stopPropagation(); openFs(); });
    /* ⚠️ 不要再给图表加「点击进全屏」：那是移动端放大用的早期做法，桌面上点一下图表
       （想看某个点的数值、拖动查看）就整屏弹出来，非常误触（用户 2026-10-04 反馈）。
       现在**只有时间范围行左侧的全屏按钮**能进全屏，移动端同样有那个按钮。 */
    if (fsClose) fsClose.addEventListener('click', closeFs);
    // 全屏里的走势图 tab：点击走主页面的 peer，再回写高亮（与时间范围同一套做法）
    document.querySelectorAll('#aoFsTabs [data-ao-fs-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        const peer = document.querySelector(`#aoTabs [data-ao-tab="${b.dataset.aoFsTab}"]`);
        if (peer) peer.click();                      // 复用主页面的切换逻辑（含 drawAoChart）
        syncFsUi();
      });
    });
    // 全屏里的时间范围按钮与主页面的保持同步（点击走主页面的 peer，再回写高亮与标题）
    document.querySelectorAll('#aoFsRanges [data-ao-range]').forEach((b) => {
      b.addEventListener('click', () => {
        const peer = document.querySelector(`#aoRanges [data-ao-range="${b.dataset.aoRange}"]`);
        if (peer) peer.click();                      // 复用主页面的切换逻辑（含 drawAoChart）
        syncFsUi();
      });
    });
    // 主页面切范围/切模式时，全屏开着的话同步标题
    document.querySelectorAll('#aoRanges [data-ao-range], #aoTabs [data-ao-tab]').forEach((b) => {
      b.addEventListener('click', () => { if (!fs.hidden) syncFsUi(); });
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFs(); });
  })();

  /* ⚠️ 顺序必须先 placeAssetChart() 再 draw —— 节点换了容器，canvas 尺寸才跟着变；
     跨断点（桌面 ↔ 移动端）时还要 force 一次（浮层里是 88dvh、主区里是 300px，高度完全不同）。 */
  window.addEventListener('resize', () => {
    const wasMobile = AC_MQ.matches;
    placeAssetChart();
    drawChart(); drawAoChart(); drawAccSpark(); drawAssetChart(assetChartData);
    if (AC_MQ.matches !== wasMobile) refreshAssetChart(true);
  });
  document.addEventListener('DOMContentLoaded', renderAll);

  /* ---- 资产分时图的时段下拉（盘前/盘中/盘后/夜盘/24h/全天） ---- */
  (function initAssetSess() {
    const menu = document.getElementById('assetSessMenu');
    const btn = document.getElementById('assetSessBtn');
    const wrap = document.getElementById('assetSess');
    if (!menu || !btn || !wrap) return;
    menu.innerHTML = Object.keys(ASSET_SESS).map((k) => (
      '<button class="asset-sess__item" type="button" role="option" data-asset-sess="' + k + '" aria-selected="false">'
      + '<span class="ico">' + assetIconSvg(k) + '</span>'
      + '<span>' + ASSET_SESS[k].label + '</span>'
      + '<span class="asset-sess__tick"></span></button>'
    )).join('');
    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    /* 点空白处收起（下拉是绝对定位浮层，不关会挡住下面的列表） */
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-asset-sess]');
      if (!item) return;
      assetSessSel = item.dataset.assetSess;
      close();
      syncAssetSessUi();
      refreshAssetChart(true);           // 换时段必须强制重拉（不同时段窗口完全不同）
    });
    syncAssetSessUi();

    /* 切视图后画布才有尺寸 —— 立刻补一次（否则要等下一个 15s tick 才画出来）。 */
    document.querySelectorAll('.rail__item[data-view], [data-tab]').forEach((el) => {
      el.addEventListener('click', () => setTimeout(() => refreshAssetChart(true), 350));
    });
  })();

  /* ---- 移动端分时图交互：点「推算总资产」汇总框 **展开/收起**（页内块，不是浮层） ---- */
  (function initAssetSheet() {
    const sum = document.getElementById('tradeSum');
    const sheet = document.getElementById('assetSheet');
    if (!sum || !sheet) return;
    placeAssetChart();          // 初始落点：移动端先把节点搬进 #assetSheetBody（sheet 默认 hidden）
    /* 收起只切 `hidden`（页内块收起后 .wl__list 自动长回来）；
       ⚠️ 历史版本额外加了「锁背后滚动」那套，已按用户 2026-10-05 定稿删掉 ——
          现在要的就是「图表在下面、上面的列表能上下滚」，锁反而锁没了。 */
    const close = () => { if (!sheet.hidden) closeAssetSheet(); };
    /* ⚠️ 它是页面内的一块，切走视图会自动收起（hidden 元素里的 canvas 量不到尺寸） */
    document.querySelectorAll('.rail__item[data-view], [data-tab]').forEach((el) => {
      el.addEventListener('click', close);
    });
    /* 整块汇总框都可点：展开（再点一次收起）。
       ⚠️ 移动端汇总框里没有别的控件，不用排除目标；桌面端 AC_MQ 不匹配时直接 no-op。
       ⚠️ 但**来自图内部的点击必须忽略**：点「收起」按钮时事件先命中 closeBtn（收起），
          再冒泡到 sum 就被当成「又点了一次」重新展开 —— 结果就是永远关不掉
          （2026-10-05 实测复现）。closeBtn 在 #assetSheet 里，所以按这一点拦。 */
    sum.addEventListener('click', (e) => {
      if (!AC_MQ.matches) return;
      const t = e.target;
      if (t && t.closest && t.closest('#assetSheet')) return;
      if (sheet.hidden) openAssetSheet(); else closeAssetSheet();
    });
    const closeBtn = document.getElementById('assetSheetClose');
    if (closeBtn) closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    /* 断点跨过 680 时（比如桌面窗口拉窄/拉宽）把展开态复位 ——
       否则桌面端会残留一个挂在 aside 里的空容器（图表那时应该在右侧主区）。 */
    const onMq = () => { if (!AC_MQ.matches && !sheet.hidden) closeAssetSheet(); };
    if (AC_MQ.addEventListener) AC_MQ.addEventListener('change', onMq);
  })();

  // 打开页面默认选中 ORCL，立即拉其报价与分时（不等自选行情返回）
  loadInstrument('ORCL');
  if (document.readyState !== 'loading') renderAll();

  // 顶栏时钟（每秒走字）
  renderBrandClock();
  setInterval(renderBrandClock, 1000);

  // 自选列表接入 OKX 实时行情（启动即拉，每 15s 刷新）
  fetchWatchlist();
  setInterval(fetchWatchlist, 15000);

  /* 自选里的腾讯行（上证指数）独立拉取，同样 15s 一轮。
     启动延迟 3s 再首拉，避开和上面 OKX 那批同一秒发出去（两个源互不依赖，错开只是省并发）。 */
  setTimeout(fetchTxWatch, 3000);
  setInterval(fetchTxWatch, 15000);

  /* 持仓行情（交易页 + 账户页证券表）同样 15s 刷新一次。
     入口由 initAccountData 就绪后挂上（TRADE_POS.refresh），这里只负责按点调用；
     两者错开 3s，免得同一秒打两批请求。 */
  setInterval(() => {
    if (typeof TRADE_POS.refresh === 'function') TRADE_POS.refresh();
  }, 18000);

  /* 金十快讯（「推荐」tab）：script 标签直连 www.jin10.com/flash_newest.js。
     启动即预拉一份（切到「推荐」不用等），之后每 60s 重拉一次。
     60s 而非 30s：金十是分钟级更新的流，再密拉到的多半是同一份内容。 */
  fetchJin10();
  setInterval(() => { if (!document.hidden) fetchJin10(); }, 60000);

  /* 顶栏「刷新」按钮（移动端左侧唯一保留的按钮）：
     手动重拉一轮数据 = 自选行情 + 外汇行 + 当前标的图表/分时。
     行为与启动序列一致，按钮转圈给出反馈。 */
  const btnReload = document.getElementById('btnReload');
  if (btnReload) {
    /* 兜底超时：fetch() 本身没有超时上限，若某个源（frankfurter 外汇、
       Alpaca）在弱网/不可达时会挂住 Promise.all，按钮就一直转圈。
       这里给整体加 8s 上限，超时也照样恢复按钮。 */
    const withTimeout = (p, ms) => Promise.race([
      p, new Promise((r) => setTimeout(r, ms)),
    ]);

    btnReload.addEventListener('click', async () => {
      if (btnReload.disabled) return;
      btnReload.disabled = true;
      btnReload.classList.add('is-loading');       // CSS 里做旋转动画
      try {
        await withTimeout(Promise.all([
          fetchWatchlist(),
          typeof fetchTxWatch === 'function' ? fetchTxWatch() : Promise.resolve(),
          typeof fetchFxWatch === 'function' ? fetchFxWatch() : Promise.resolve(),
          loadInstrument((APP_DATA.quote || {}).code),   // 重画当前标的图表
        ]), 8000);
      } catch (e) {
        /* 静默失败：15s 定时任务会兜底重试 */
      } finally {
        btnReload.disabled = false;
        btnReload.classList.remove('is-loading');
      }
    });
  }

  /* 美元/离岸人民币：**只读** `fund_holdings.json` 的 `usdcnh_daily`（用户 2026-10-04 定稿）。
     数据由 `fund_holdings.py` 每天抓 frankfurter 写进文件，前端不再直连外币接口：
       - 浏览器直连 frankfurter 会偶发 `ERR_CERT_COMMON_NAME_INVALID`（静默失败 → 行没价）；
       - 也不需要每 60s 拉一次外网。
     ⚠️ 与K 线**同一份数据、同一口径** —— 图上末点就是这个价，不会出现割裂。
     周末与 ECB 假日不更新，`asOf` 停在最近一个交易日。 */
  async function fetchFxWatch() {
    const row = APP_DATA.watchlist.find((x) => x.code === 'USDCNH');
    if (!row) return;
    try {
      const rows = await loadFxSeries();          // 内部带 10 分钟缓存
      const last = rows[rows.length - 1];
      const prev = rows.length >= 2 ? rows[rows.length - 2].c : null;
      row.price = last.c;
      row.pct = prev ? +((last.c - prev) / prev * 100).toFixed(2) : null;
      row.change = prev != null ? +(last.c - prev).toFixed(5) : null;
      row.prevClose = prev;                       // 报价头 / 百分比轴的基准
      row.asOf = last.ts;
      renderWatchlist(APP_DATA.watchlist, APP_DATA.quote.code);
    } catch (e) { console.warn('[汇率] 读取 usdcnh_daily 失败：', e); }
  }
  fetchFxWatch();
  setInterval(fetchFxWatch, 60000);        // 读本地 usdcnh_daily（内部 10 分钟缓存），1 分钟刷一次足够

  /* 10年国债收益率：美国财政部官方 Daily Treasury Par Yield Curve（BC_10YEAR，日频 %）
     ⚠️ 曾用 FRED DGS10，但浏览器无法直连：
        - fred.stlouisfed.org/graph/fredgraph.csv —— 不发 Access-Control-Allow-Origin（Akamai 反爬）
        - alfred.stlouisfed.org/graph/api/series/ —— CORS 白名单写死 alfred 自己的域名
        - api.stlouisfed.org —— 需 api_key（项目无 key）
        财政部 home.treasury.gov 的 XML 源同样权威（同一条 H.15 数据）、且浏览器可直连，故改用之。 */
  const TREASURY_YIELD_URL =
    'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml' +
    '?data=daily_treasury_yield_curve&field_tdr_date_value=' + new Date().getFullYear();

  async function fetchTreasuryWatch() {
    try {
      // 同其他源：fetch 无内置超时，不可达时会一直挂着
      const r = await Promise.race([
        fetch(TREASURY_YIELD_URL),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000)),
      ]);
      if (!r.ok) return;
      const xml = await r.text();
      // Atom feed：<entry>…<d:NEW_DATE>2026-10-01T00:00:00</d:NEW_DATE>…<d:BC_10YEAR>5.24</d:BC_10YEAR>…</entry>
      const pts = [];
      const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
      let m;
      while ((m = entryRe.exec(xml)) !== null) {
        const d = /<d:NEW_DATE[^>]*>([\d-]{10})/.exec(m[1]);
        const y = /<d:BC_10YEAR[^>]*>([\d.]+)<\/d:BC_10YEAR>/.exec(m[1]);
        if (d && y) pts.push({ date: d[1], value: parseFloat(y[1]) });
      }
      if (pts.length < 2) return;
      const last = pts[pts.length - 1], prev = pts[pts.length - 2];
      const row = APP_DATA.watchlist.find((x) => x.code === '10Ymain');
      if (!row) return;
      row.price = last.value;                                  // 5.24（百分数，不除 100）
      row.pct = +((last.value - prev.value).toFixed(2));       // 收益率变动用「百分点」口径
      row.asOf = last.date;
      renderWatchlist(APP_DATA.watchlist, APP_DATA.quote.code);
    } catch (e) { console.warn('[美债] 财政部收益率拉取失败：', e); }
  }
  fetchTreasuryWatch();
  setInterval(fetchTreasuryWatch, 30 * 60 * 1000);   // 日频数据，30 分钟拉一次即可

  /* ===================== 账户实数据（Asset_parsed.json + fund_holdings.json） ===================== */

  /* ---- 全部账户总览页（品类/币种分布 + 收益率/资产走势） ---- */
  const aoState = { ready: false, mode: 'return', range: '1m', series: [], hover: null };

  /* 基金历史净值查询：date 当日或之前最近一条
     ⚠️ nav 行的时间戳是 **毫秒数字**（如 1765209600000），早前直接 String(row[0]).slice(0,10)
        当字符串比较（"1765209600" <= "2025-12-09" 恒为真）→ 永远返回最后一条，
        表现为「日变动恒为 0」。这里按数字/字符串分别归一化后再比较。 */
  function navOn(hist, date) {
    if (!hist || !hist.length) return null;
    const key = (v) => (typeof v === 'number' ? navOnDate(v) : String(v).slice(0, 10));
    let last = null;
    for (const row of hist) {
      if (key(row[0]) <= date) last = row[1];
      else break;
    }
    return last;
  }

  /* ms 时间戳 → 'YYYY-MM-DD'：按 UTC+8 取日。
     ⚠️ QDII 基金按**美东交易日**计净值，东财 pingzhongdata 的 x 是「北京时间零点的 UTC 值」，
     用 UTC 取日会整体少一天（实测嘉实 000043：东财标 2026-09-28 的 6.33，新浪标 2026-09-29 的 6.33，
     逐条比对 6.146/6.224/6.271/6.392/6.412/6.352/6.348/6.317/6.33 全部一致，仅日期差 1 天）。 */
  function navOnDate(ts) {
    return new Date(ts + 8 * 3600e3).toISOString().slice(0, 10);
  }

  /* -------------------------------------------------------------------
     「统计」tab：个人净资产分布 —— **环形图**（富途「个人净资产分布」样式）
     -------------------------------------------------------------------
     三个视角（`aoDist.dim`），各自独立成环：
       - 'asset' 每个持仓一扇区，颜色**按所属分类取同色系**（ORCL 红色系 / 000043 黄色系…）
       - 'cat'   品类：证券(红) / 基金(黄) / 现金(绿)
       - 'cur'   币种：美元(蓝) / 人民币(橙)
     **排序：三个视角都纯按占比从大到小**，12 点方向起顺时针
       （用户 2026-10-04：「资产我说是按百分比顺时针排，同一类别的不要都放一块」）。
       分类只影响**颜色**，不影响排序位置。
     数据由 `setAoDistData()` 送进来，绘制与图例分离，15s 刷新时只重绘不重建结构。 */
  const aoDist = { dim: 'asset', data: { asset: [], cat: [], cur: [] }, total: 0, expanded: false, dirty: false };

  /* 分类主色（用户 2026-10-04 指定）：证券=红、基金=黄、现金=绿。
     币种沿用蓝/橙两色以便与分类区分。
     分类名统一用「证券」（用户 2026-10-04：「股票改成证券」），
     不再保留 `股票` 这个别名 —— 之前留它是为了掩盖键名不匹配的 bug，已修根因。 */
  const AO_CAT_COLOR = { 证券: '#e8453c', 基金: '#f0a020', 现金: '#12a05c', 美元: '#2e6bff', 人民币: '#ff8f1f' };

  /* 资产视角的**同色系梯度**：同一分类下的不同持仓在主色深浅上错开，
     这样「ORCL/TQQQ 都是红的、000043/270023 都是黄的」，一眼能看出归属
     （用户 2026-10-04：「资产里的细项按分类用同色系的颜色」）。
     档位向白插值，**跨度要够大**才看得出差别（第一版只到 0.16，四档几乎同色）。 */
  const AO_SHADES = [0, 0.22, 0.4, 0.55, 0.68];
  function aoShade(hex, idx) {
    const k = AO_SHADES[idx % AO_SHADES.length];
    if (!k) return hex;
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const mix = (c) => Math.round(c + (255 - c) * k);       // 向白插值
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((c) => mix(c).toString(16).padStart(2, '0')).join('');
  }

  /* 金额千分位（环形图中心/明细列用）。
     ⚠️ 不能用账户视图闭包里的 `f2` —— `renderAoDist` 定义在那个闭包**之外**，
        直接调会抛 `f2 is not defined`（2026-10-04 实测踩到）。同理 `fmt` 虽全局可用但无千分位。 */
  const aoMoney = (v) => (v == null || !isFinite(v)
    ? '--'
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  /* 送数据 + 重绘。
     assetList = [{name, code, val, cat, icon, brand}]（每个持仓一项；cat 用于取同色系主色，
                icon 是 Asset_parsed.json 里那张 base64 图（`data:image/...`））
     groups    = { cat: [{name,val}...], cur: [{name,val}...] }（分类/币种两组）
     三个视角各自**独立成环**（用户 2026-10-04：「环形图 现金证券基金 和 美元人民币 分开画」）：
       资产 = 全部持仓；分类 = 现金/股票/基金；币种 = 美元/人民币。
       ⚠️ 绝不能把两组塞进同一个环 —— 各组占比之和都为 100%，角度会累加到 720°、扇区重叠。 */
  function setAoDistData(assetList, groups, total) {
    /* 资产视角排序：**纯按占比降序**（12 点起顺时针，从大到小）。
       ⚠️ 曾一度改成「按分类成组」（红→红→黄→黄→绿→绿），用户明确否决：
       「同一类别的不要都放一块啊」—— 同类聚成一块会让大额持仓挤在一起、
       环上看不出谁大谁小。**排序只看金额，颜色才看分类**，两件事互不影响。
       同色系仍然生效：颜色按 `cat` 取主色 + 该类内的出现序号做深浅梯度
      （所以红色系里ORCL 是主色、TQQQ 是浅红，视觉上仍能认出同类）。 */
    const sorted = (assetList || []).filter((x) => x && x.val > 0)
      .sort((a, b) => b.val - a.val);
    const seen = {};
    aoDist.data.asset = sorted.map((x) => {
      const cat = x.cat || '其他';
      const base = AO_CAT_COLOR[cat] || '#b06be0';
      const i = seen[cat] = (seen[cat] || 0);
      return {
        name: x.name, code: x.code || '', val: x.val, cat,
        color: aoShade(base, i),
        icon: x.icon || '',          // base64 data URI，环内/列表里画图标
        brand: x.brand || '',        // 机构名（可选，列表里备用）
      };
    });
    const g = groups || {};
    /* 分类/币种视角：也按金额降序，主色直接取 AO_CAT_COLOR。 */
    const paint = (arr) => (arr || []).filter((x) => x && x.val > 0)
      .sort((a, b) => b.val - a.val)
      .map((x) => ({ name: x.name, code: '', val: x.val, color: AO_CAT_COLOR[x.name] || '#b06be0' }));
    aoDist.data.cat = paint(g.cat);
    aoDist.data.cur = paint(g.cur);
    aoDist.total = total > 0 ? total : 0;
    /* 数据到达时总览页可能还 hidden（canvas 父容器尺寸 0，画了也白画）。
       打个标记，等真正切到「统计」tab 时由 applyMode 补画一次。 */
    aoDist.dirty = true;
    renderAoDist();
  }

  /* 当前视角的数据集（环形图与列表共用 —— 三个视角都是「一组数据对应一个环」） */
  function aoDistCurrent() {
    if (aoDist.dim === 'cat') return aoDist.data.cat;
    if (aoDist.dim === 'cur') return aoDist.data.cur;
    return aoDist.data.asset;
  }

  /* 环形图 + 明细列表
     三个视角（资产 / 分类 / 币种）结构完全相同：一个数据集 → 一个环 + 一份列表。
     数据源统一走 `aoDistCurrent()`，不再有「图和列表用不同源」的情况。 */
  function renderAoDist() {
    const canvas = document.getElementById('aoDonut');
    const list = document.getElementById('aoDistList');
    if (!canvas || !list) return;
    const items = aoDistCurrent();
    const total = aoDist.total;

    // 中心总额
    const hole = document.getElementById('aoDonutTotal');
    if (hole) hole.textContent = total > 0 ? '¥' + aoMoney(total) : '--';

    if (!items.length || total <= 0) {
      list.innerHTML = '<li class="cp__item cp__item--empty">暂无数据</li>';
      drawAoDonut([], []);
      return;
    }

    /* 各视角的数据集之和都等于总资产（分类/币种由调用方保证口径），
       统一除以总资产即扇区占比。 */
    const pcts = items.map((x) => x.val / total);
    drawAoDonut(items, pcts);

    /* 明细列表：资产视角项多（十几只持仓），默认只显示 ≥2% 的，「展开其余」后全显示；
       分类/币种视角项数少（3 / 2），始终全列、不给展开按钮。
       ⚠️ 过滤后**不能**再用 `shown.map((x,i)=>pcts[i])` 取占比 —— `i` 是过滤前的下标，
          会让百分比与名称错位（实测建设银行 12.8% 被显示在最后一位、看着像 2.9%）。
          正确做法：过滤时把 {item, pct} 成对取出。 */
    const MIN_PCT = 0.02;
    const pairs = items.map((x, i) => ({ x: x, pct: pcts[i] }));
    const shown = (aoDist.expanded || aoDist.dim !== 'asset')
      ? pairs
      : pairs.filter((r) => r.pct >= MIN_PCT);
    const hidden = pairs.length - shown.length;

    list.innerHTML = shown.map((r) => {
      const x = r.x;
      /* 名称与代码相同时不重复显示（ORCL / ORCL -> 只写一次） */
      const dup = x.name === x.code;
      /* 图标：有则显示 18px 方形 logo，没有就退回色块圆点 */
      const badge = x.icon
        ? `<img class="ao-dlist__icon" src="${x.icon}" alt="" loading="lazy">`
        : `<i class="dot" style="background:${x.color}"></i>`;
      return `
      <li>
        ${badge}
        <span class="ao-dlist__name">${x.name}${x.code && !dup ? `<em>${x.code}</em>` : ''}</span>
        <b class="num">${(r.pct * 100).toFixed(1)}%</b>
        <i class="num">${'¥' + aoMoney(x.val)}</i>
      </li>`;
    }).join('');

    // 展开/收起
    const more = document.getElementById('aoDistMore');
    const btn = document.getElementById('aoDistMoreBtn');
    const txt = document.getElementById('aoDistMoreTxt');
    if (more) {
      // 只有资产视角项数多、需要折叠；分类/币种视角项数少，始终全列
      more.hidden = aoDist.dim !== 'asset' || hidden <= 0;
      if (txt) txt.textContent = aoDist.expanded ? '收起' : `展开其余 ${hidden} 项`;
      if (btn) btn.classList.toggle('is-open', aoDist.expanded);
    }
  }

  /* ---- 扇区图标：Asset_parsed.json 里的 base64 图（data URI），异步解码后缓存 ---- */
  const aoIconCache = {};        // src -> HTMLImageElement（已 decode）
  const aoIconPending = {};      // src -> true（正在加载，避免重复建Image）
  function aoIcon(src) {
    if (!src) return null;
    const hit = aoIconCache[src];
    if (hit) return hit.complete && hit.naturalWidth ? hit : null;
    if (aoIconPending[src]) return null;
    aoIconPending[src] = true;
    const img = new Image();
    img.onload = () => { aoIconCache[src] = img; renderAoDist(); };   // 到位后重画
    img.onerror = () => { delete aoIconPending[src]; };
    img.src = src;
    return null;
  }

  /* canvas 环形图：扇区 + 扇区内「图标 + 百分比 + 代码」标签
     顺时针从 12 点起，按传入顺序（调用方已排成金额从大到小）。
     中心孔半径 = R * 0.44（用户 2026-10-04：「中间的圆圈可以小一点」，原 0.62）。 */
  function drawAoDonut(items, pcts) {
    const canvas = document.getElementById('aoDonut');
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (W < 40 || H < 40) return;                      // 隐藏时不画
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!items || !items.length) return;

    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) / 2 - 4;                  // 外半径
    /* 内孔半径比例。改动史：0.62（初版）→ 0.44（用户嫌中心圈太大要小）→ 0.56（又嫌太小）。
       0.56 下中心足以放下「¥1,052,221.97」而不溢出，环带也还够放图标+百分比。 */
    const rIn = R * 0.56;
    const band = R - rIn;                              // 环带宽度

    // 起始角从 12 点方向，顺时针
    let a0 = -Math.PI / 2;
    items.forEach((x, i) => {
      const frac = Math.max(0, Math.min(1, pcts ? pcts[i] : 0));
      const a1 = a0 + frac * Math.PI * 2;
      // 扇区之间留 0.6° 白缝，视觉更清爽
      const gap = 0.006;
      const s = a0 + gap, e = Math.max(s + 0.001, a1 - gap);
      ctx.beginPath();
      ctx.arc(cx, cy, R, s, e);
      ctx.arc(cx, cy, rIn, e, s, true);
      ctx.closePath();
      ctx.fillStyle = x.color;
      ctx.fill();
      a0 = a1;
    });

    /* 扇区内标签（用户 2026-10-04 定稿，第三次改法）。
       前两版都失败，根因是**排布方向**：
         v1 沿半径分三行（图标内/百分比中/代码外）→ 文字横着放却分散在不同半径上，互相压、也压出扇区；
         v2 横向一行 [图标]代码 + 百分比靠内 → 图标和代码分居扇区中线两侧，
            靠外那端到圆心更远、扇区边界也更外扩，于是「中点处够宽」≠「整行在扇区内」，
            文字照样压到白色分隔线上（截图实测 0.88 / 0.78 两档余量都不够）。
       现版：**竖排三行**（图标 / 代码 / 百分比）作为一个整体，圆心角对齐、径向居中放在环带里。
         竖排时每行都关于中线**对称**，文字两端到圆心距离相同，
         于是半角公式 `r·sin(半角)` 就是精确的可用半宽，不必再逐点验算。
         放不下的扇区（半宽 < 行宽/2）直接整块不画。 */
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    /* 极坐标 → 直角坐标：r 是到圆心的距离，ang 是相对12 点方向顺时针的弧度 */
    const at = (r, ang) => [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
    const CODE_FONT = '9px "PingFang SC", "Microsoft YaHei", sans-serif';
    const PCT_FONT = '600 11.5px "PingFang SC", "Microsoft YaHei", sans-serif';
    items.forEach((x, i) => {
      const frac = Math.max(0, Math.min(1, pcts ? pcts[i] : 0));
      if (frac < 0.035) return;                        // <3.5% 不写标签
      const mid = a0Of(pcts, i);                       // 该扇区中点角
      const img = x.icon ? aoIcon(x.icon) : null;
      const half = frac * Math.PI;                      // 扇区半角（弧度）

      /* 三行统一用**最宽那一行**的半宽做判定，保证整块都不越界。 */
      ctx.font = CODE_FONT;
      const codeW = x.code ? ctx.measureText(x.code).width : 0;
      const pctTxt = (frac * 100).toFixed(1) + '%';
      ctx.font = PCT_FONT;
      const pctW = ctx.measureText(pctTxt).width;
      const iconS = img ? Math.min(18, band * 0.30) : 0;
      const rowW = Math.max(iconS, Math.max(codeW, pctW));
      /* 整块的径向中心：环带正中。竖排三行总高 = 图标 + 间距 + 代码 + 间距 + 百分比，
         放在环带正中时上下留白对称，视觉最稳。 */
      const rMid = rIn + band * 0.5;
      /* 竖排时行关于中线对称，可用半宽 = rMid·sin(半角)，这是精确值。留 6% 边。 */
      if (rowW / 2 > rMid * Math.sin(half) * 0.94) return;   // 放不下就整块不画

      const [rx, ry] = at(rMid, mid);
      /* 竖排偏移（屏幕 y 方向）：上= 负。整体高度逐行累加。 */
      const GAP = 2.5;
      const hIcon = iconS, hCode = x.code ? 10 : 0, hPct = 13;
      const totalH = hIcon + (hIcon && hCode ? GAP : 0) + hCode + (hCode ? GAP : 0) + hPct;
      let cy = ry - totalH / 2;

      if (img) {
        const s2 = iconS, bx = rx - s2 / 2, by = cy;
        cy += hIcon;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        const rr = s2 * 0.22;
        ctx.beginPath();
        ctx.moveTo(bx + rr, by);
        ctx.arcTo(bx + s2, by, bx + s2, by + s2, rr);
        ctx.arcTo(bx + s2, by + s2, bx, by + s2, rr);
        ctx.arcTo(bx, by + s2, bx, by, rr);
        ctx.arcTo(bx, by, bx + s2, by, rr);
        ctx.closePath();
        ctx.fill();
        ctx.clip();
        const ir = img.naturalWidth / img.naturalHeight || 1;   // logo 等比缩放居中
        let dw = s2 - 3, dh = dw / ir;
        if (dh > s2 - 3) { dh = s2 - 3; dw = dh * ir; }
        ctx.drawImage(img, bx + (s2 - dw) / 2, by + (s2 - dh) / 2, dw, dh);
        ctx.restore();
        if (hCode) cy += GAP;
      }
      if (x.code) {
        ctx.fillStyle = 'rgba(255,255,255,0.94)';
        ctx.font = CODE_FONT;
        ctx.fillText(x.code, rx, cy + 4);
        cy += hCode + GAP;
      }
      ctx.fillStyle = 'rgba(255,255,255,0.97)';
      ctx.font = PCT_FONT;
      ctx.fillText(pctTxt, rx, cy + 5);
    });
  }

  /* 第 i 个扇区的起始角（12 点起顺时针）；与 drawAoDonut 的累加口径保持一致 */
  function a0Of(pcts, i) {
    let a = -Math.PI / 2;
    for (let k = 0; k < i; k++) a += Math.max(0, Math.min(1, pcts[k])) * Math.PI * 2;
    return a + (Math.max(0, Math.min(1, pcts[i])) * Math.PI * 2) / 2;
  }

  /* 总览页 canvas：收益率走势（百分比轴）/ 资产走势（金额轴）
     仿富途：鼠标滑过显示十字光标（横线 + 竖线），底部贴日期标签、右侧贴数值标签，
     顶部统计行同步显示该日的「资产净值 · CNY」与「当日收益」。 */
  const aoGeo = { data: null, vals: null, isPct: false, first: 0, X: null, Y: null,
                  padL: 0, padR: 0, padT: 0, padB: 0, plotW: 0, plotH: 0, W: 0, H: 0 };

  function aoFormatDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return String(s || '');
    const wk = '日一二三四五六'[new Date(+m[1], +m[2] - 1, +m[3]).getDay()];
    return m[1] + '/' + m[2] + '/' + m[3] + ' 星期' + wk;
  }

  function drawAoChart() {
    const canvas = document.getElementById('aoChart');
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (W < 60 || H < 60) return;                     // 页面 hidden 时不画
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const all = aoState.series || [];
    let data;
    /* 时间范围（用户 2026-10-04 定稿）：近1月 / 近3月 / 今年以来 / 自始以来。
       ⚠️ 序列起点是 **2026-02-06**（IBKR 净值第一天，Asset_parsed.json 的
          totalNetValueDaily 从这天开始），所以：
            - 「今年以来」与「自始以来」在当前数据下**范围相同**（都是 02-06 起）
            - 「近3月」= 最近 90 个自然日
          保留两档是为了口径完整：等IBKR 净值攒满一年后，两者才会分叉。
       「近1月/近3月」按**自然日**切（与旧版的「最近 30 个数据点」不同：
       数据点会随休市日变稀，按点数切出来的实际跨度不稳定）。 */
    if (aoState.range === 'all') {
      data = all;
    } else if (aoState.range === 'ytd') {
      const ymd = new Date().getFullYear() + '-01-01';
      data = all.filter((p) => p.date >= ymd);
    } else {
      const days = aoState.range === '3m' ? 90 : 30;
      const from = new Date(Date.now() - days * 864e5).toLocaleDateString('sv-SE');
      data = all.filter((p) => p.date >= from);
    }
    if (data.length < 2) return;
    const first = data[0].cny;
    const isPct = aoState.mode === 'return';
    const vals = data.map((p) => isPct ? (first ? (p.cny / first - 1) * 100 : 0) : p.cny);
    // 资产走势：恒橙色线 + 橙渐变（仿富途）；收益率走势：涨绿跌红
    const upTrend = vals[vals.length - 1] >= (isPct ? 0 : first);
    const lineC = isPct ? (upTrend ? '#00a86b' : '#ea3b3b') : '#ff8f1f';
    const fillC = isPct ? (upTrend ? 'rgba(0,168,107,0.12)' : 'rgba(234,59,59,0.12)')
                        : 'rgba(255,143,31,0.10)';

    // padR = 右侧「刻度 / 悬停胶囊」列宽。两者都用 9px、整数千分位，并让胶囊与刻度
    // 共享同一条左边界和同一个列宽 AO_TICK_COL_W，视觉上是一列，不会像胶囊那样向右突出。
    const padL = 12, padR = 58, padT = 14, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    let lo = Math.min(...vals, isPct ? 0 : first);
    let hi = Math.max(...vals, isPct ? 0 : first);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const span = hi - lo;
    const yMin = lo - span * 0.08, yMax = hi + span * 0.08;
    const X = (i) => padL + (i / (data.length - 1)) * plotW;
    const Y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    const FONT = '10px "PingFang SC","Microsoft YaHei",sans-serif';       // 起止日期
    const TICK_FONT = '9px "PingFang SC","Microsoft YaHei",sans-serif';    // 纵轴刻度：数字较长，单独用小一号

    // 缓存几何参数，供 mousemove 画光标复用（避免每次重算）
    aoGeo.data = data; aoGeo.vals = vals; aoGeo.isPct = isPct; aoGeo.first = first;
    aoGeo.X = X; aoGeo.Y = Y; aoGeo.lineC = lineC;
    aoGeo.padL = padL; aoGeo.padR = padR; aoGeo.padT = padT; aoGeo.padB = padB;
    aoGeo.plotW = plotW; aoGeo.plotH = plotH; aoGeo.W = W; aoGeo.H = H;
    aoGeo.tickFont = TICK_FONT; aoGeo.tickColW = padR - 7;   // 供悬停胶囊对齐复用

    ctx.font = TICK_FONT;
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {                    // 网格 + 右侧纵轴
      const y = padT + (i / 4) * plotH;
      const v = yMax - (i / 4) * (yMax - yMin);
      ctx.strokeStyle = 'rgba(15,23,42,0.06)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#949aab';
      ctx.textAlign = 'left';
      ctx.fillText(isPct
        ? ((v > 0 ? '+' : '') + v.toFixed(2) + '%')
        : v.toLocaleString('en-US', { maximumFractionDigits: 0 }),
        padL + plotW + 4, y);
    }

    ctx.beginPath();                                  // 主曲线 + 渐变填充
    vals.forEach((v, i) => { i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); });
    ctx.strokeStyle = lineC;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineTo(X(vals.length - 1), padT + plotH);
    ctx.lineTo(X(0), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = fillC;
    ctx.fill();

    ctx.font = FONT;                                  // 起止日期
    ctx.fillStyle = '#949aab';
    ctx.textAlign = 'left';
    ctx.fillText(data[0].date, padL, H - 10);
    ctx.textAlign = 'right';
    ctx.fillText(data[data.length - 1].date, padL + plotW, H - 10);

    if (aoState.hover != null) drawAoCross(aoState.hover);
    else aoStatDefault();
  }

  /* 顶部统计行：恒显区间累计收益 / 区间收益率（跟随末点，与光标位置无关）。
     ⚠️ 原先还有一套「悬停时把统计行换成 日期 + 资产净值 / 当日收益」（aoSetStat 的 point/dayGain 分支
      + `.ao-stats.is-hover` CSS + `.ao-stat--hover` 节点），2026-10-05 按用户要求整套删除，
     读数口径固定，勿再加回来。 */
  function aoStatDefault() {
    const d = aoGeo.data;
    if (!d || d.length < 2) return;
    const gain = d[d.length - 1].cny - aoGeo.first;
    const pctV = aoGeo.first ? gain / aoGeo.first * 100 : 0;
    aoSetStat(gain, pctV);
  }

  function aoSetStat(gain, pctV) {
    const setT = (id, txt, trend) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = txt;
      el.classList.remove('up', 'down');
      if (trend > 0) el.classList.add('up'); else if (trend < 0) el.classList.add('down');
    };
    setT('aoStatVal', (gain > 0 ? '+' : '') + gain.toFixed(2), gain);
    setT('aoStatPct', (pctV > 0 ? '+' : '') + pctV.toFixed(2) + '%', pctV);
  }

  /* 十字光标层：竖线（日期）+ 横线（数值）+ 底部日期胶囊 + 右侧数值胶囊 + 交点圆点 */
  function drawAoCross(idx) {
    const canvas = document.getElementById('aoChart');
    if (!canvas || !aoGeo.data) return;
    const d = aoGeo.data, vals = aoGeo.vals;
    if (idx < 0 || idx >= d.length) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { X, Y, padL, padT, padB, padR, plotW, plotH, W, H, isPct, first } = aoGeo;
    const x = X(idx), y = Y(vals[idx]);

    ctx.save();
    ctx.strokeStyle = 'rgba(15,23,42,0.28)';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, aoGeo.padT); ctx.lineTo(x, aoGeo.padT + plotH); ctx.stroke();   // 竖线
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();   // 横线
    ctx.setLineDash([]);

    ctx.beginPath();                                  // 交点圆点
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = aoGeo.lineC;
    ctx.fill();

    ctx.font = '10px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'middle';

    // 底部日期胶囊（黑底白字）
    const label = aoFormatDate(d[idx].date);
    const tw = ctx.measureText(label).width + 14;
    const bx = Math.min(Math.max(x - tw / 2, padL), padL + plotW - tw);
    ctx.fillStyle = 'rgba(20,23,31,0.92)';
    ctx.fillRect(bx, H - padB + 4, tw, 17);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(label, bx + tw / 2, H - padB + 13);

    // 右侧数值胶囊（黑底白字）：与纵轴刻度**同宽同左边界**，视觉上就是同一列的「高亮态」。
    // 数字用整数千分位（和刻度一致），精确到分的数值由顶部统计行承担。
    const vtxt = isPct
      ? (vals[idx] > 0 ? '+' : '') + vals[idx].toFixed(2) + '%'
      : d[idx].cny.toLocaleString('en-US', { maximumFractionDigits: 0 });
    ctx.font = aoGeo.tickFont || '9px "PingFang SC","Microsoft YaHei",sans-serif';
    const colW = aoGeo.tickColW || (padR - 8);
    const vw = Math.min(ctx.measureText(vtxt).width + 6, colW);
    const vy = Math.min(Math.max(y - 7.5, padT), padT + plotH - 15);
    const vx = padL + plotW + 4;
    ctx.fillStyle = 'rgba(20,23,31,0.92)';
    ctx.fillRect(vx, vy, vw, 15);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    // 文字过长时按可用宽度压缩绘制，保证完整可见
    ctx.fillText(vtxt, vx + vw / 2, vy + 7.5, vw - 4);
    ctx.restore();

    /* 顶部统计行固定在区间口径，**不跟随光标**（用户 2026-10-05 删掉悬停切换那套）。
       只在没有光标时写一次，避免每帧 move 都重设文本/颜色类。 */
    if (aoState.hover == null) aoStatDefault();
  }

  /* 绑定鼠标/触摸交互：横向取最近数据点，显示横纵坐标引线
     ⚠️ 事件必须绑在 **canvas 自身**，不能绑 `#aoChartWrap`：
        全屏时 `openFs()` 会把 canvas **搬到 `#aoFsChartWrap`**（同一个节点搬家，不是复制），
        绑在旧容器上的监听就跟着失效 → 全屏里拖动没反应（用户 2026-10-04）。
        canvas 自己一直在 DOM 里，搬到哪里监听都跟着走。 */
  (function initAoHover() {
    const canvas = document.getElementById('aoChart');
    if (!canvas) return;
    const pick = (clientX) => {
      const d = aoGeo.data;
      if (!d || d.length < 2) return null;
      const r = canvas.getBoundingClientRect();
      const x = clientX - r.left;
      const i = Math.round((x - aoGeo.padL) / aoGeo.plotW * (d.length - 1));
      return Math.min(Math.max(i, 0), d.length - 1);
    };
    const clear = () => {
      aoState.hover = null;
      drawAoChart();
    };
    canvas.addEventListener('mousemove', (e) => {
      const i = pick(e.clientX);
      if (i == null || i === aoState.hover) return;
      aoState.hover = i;
      drawAoChart();
    });
    canvas.addEventListener('mouseleave', clear);

    /* ---- 触摸（移动端）：原来**只绑了 mousemove**，手指按住拖动不会出横纵坐标引线
       （用户 2026-10-04：「移动端资产走势全屏后也要能移动看tab」= 要能拖动看十字引线）。
       用 Pointer Events 统一处理：桌面（mouse）与触屏（touch）走同一套逻辑，
       比分别绑 touch/mouse 更稳，也不会在触摸后残留 mousemove 的幽灵事件。 */
    if (window.PointerEvent) {
      const onPointer = (e) => {
        const i = pick(e.clientX);
        if (i == null) return;
        if (i !== aoState.hover) { aoState.hover = i; drawAoChart(); }
      };
      // 手指按下即出引线（富途行为：点一下就显示，不一定要拖）
      canvas.addEventListener('pointerdown', (e) => { onPointer(e); });
      canvas.addEventListener('pointermove', (e) => {
        /* 只在「按住」或「有鼠标」时更新：
           - touch 要 `e.buttons` 或已处于 hover 态才动，避免手指轻扫页面就乱跳引线；
           - mouse 无 `buttons` 概念（移动时为 0），故单独放行。 */
        if (e.pointerType === 'mouse' || e.buttons || aoState.hover != null) onPointer(e);
      });
      canvas.addEventListener('pointerup', clear);
      canvas.addEventListener('pointercancel', clear);
      canvas.addEventListener('pointerleave', clear);
      /* 触摸时页面可能跟着滚动/缩放 → 阻止图表内的手势冒泡到页面，
         否则手指横向滑动会被当成「横向滚动页面」，引线只闪一下就没了。 */
      canvas.addEventListener('touchmove', (e) => { if (aoState.hover != null) e.preventDefault(); }, { passive: false });
    }
    // 兜底：光标开着时，若指针已不在画布范围内则清除。
    // 不用「统计行 vs 画布」的 leave 冒泡判断（鼠标从画布移到上方统计行时 leave 也会触发，
    // 但指针其实还在总览区内），改为按坐标判定，稳定可靠。
    document.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right
                  && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) clear();
    });
    window.addEventListener('blur', clear);
  })();

  /* ===================== 收益日历 =====================
     数据源与走势图完全一致：aoState.series = [{ date:'YYYY-MM-DD', cny }]（每日总资产）。

     ⚠️ 口径必须剔除外部现金流，否则会和侧栏「累计收益」差 17 万（实测 33.9 万 vs 16.1 万）：
       ① **入金**：IBKR 净值本身含入金，入金当天净值跳升 → 那笔钱是本金不是收益；
       ② **基金申购 / TQQQ 买入**：同理，申购当天总资产增加也不是收益；
       ③ **废值段**：totalNetValueDaily 前 28 天（2026-02-06 ~ 03-17）净值恒为 1.42，
          真实值从 03-18 的 1450.52 起。拿 1.42 当基线会让 03-18 的跳升全被算成收益。
     剔除后日收益 = 当日净值 − 前日净值 − 当日净入金；
     收益率分母用「前一日净值 + 当日净入金/2」（Modified Dietz，与资金明细页 TWR 同口径）。 */
  const calState = { mode: 'month', y: 0, m: 0 };      // m: 0-11
  /* calIndex 依赖的运行时数据，由 initAccountData 填（见文件末尾）：
     CAL_FX_MAP     'YYYY-MM-DD' → 当日 USD→CNY（fund_holdings.json 的 usdcnh_daily，**逐日**）
     CAL_TQQQ_SHARES  TQQQ 股数
     CAL_TQQQ_MAP   'YYYY-MM-DD' → **TQQQ 自己的**收盘价（Alpaca 日线）
     ⚠️ 不要再用 `qqq_daily`（那是 QQQ ETF，价格 ≈742）配 TQQQ 股数：
        TQQQ ≈ 3× 杠杆后的 ETF，价格 ≈81，差 9 倍，市值与日差全错。 */
  let CAL_FX = 0;
  let CAL_FX_MAP = {};
  let CAL_FX_KEYS = null;
  let CAL_TQQQ_SHARES = 0;
  let CAL_TQQQ_MAP = {};

  /* 某日汇率：`usdcnh_daily` 只有 ECB 交易日（周末/节假日不出数），
     所以取「≤ 该日最近的一条」；早于序列起点就用最早那条。 */
  function fxOn(date) {
    if (!CAL_FX_MAP) return CAL_FX || 0;
    if (!CAL_FX_KEYS) CAL_FX_KEYS = Object.keys(CAL_FX_MAP).sort();
    if (!CAL_FX_KEYS.length) return CAL_FX || 0;
    if (date <= CAL_FX_KEYS[0]) return CAL_FX_MAP[CAL_FX_KEYS[0]];
    let lo = 0, hi = CAL_FX_KEYS.length - 1, best = 0;
    while (lo <= hi) {                       // 二分找 ≤ date 的最后一条
      const mid = (lo + hi) >> 1;
      if (CAL_FX_KEYS[mid] <= date) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return CAL_FX_MAP[CAL_FX_KEYS[best]];
  }

  /* 某日 TQQQ 收盘价：同样取「≤ 该日最近的一条」（TQQQ 在 IBKR 之外手动买入，
     日线与净值日期不重合）。找不到返回 null（不拿 QQQ 顶替 —— 量级差 9 倍）。 */
  function tqqqCloseOn(date) {
    if (!CAL_TQQQ_MAP || !Object.keys(CAL_TQQQ_MAP).length) return null;
    if (CAL_TQQQ_MAP[date] != null) return CAL_TQQQ_MAP[date];
    return qqqOn(CAL_TQQQ_MAP, date);
  }
  /* 证券入金（CNY）—— `electronicFundTransfers` × 当前汇率，见 initAccountData 处的说明。
     入金当天 IBKR 净值会跳升，不扣掉就会被算成当日暴涨（实测 03-20 凭空 +85,104）。 */
  let CAL_STOCK_FLOW = {};

  /* TQQQ 在某日的收盘价：**≤ 该日最近一条**（周末/节假日沿用上一交易日）。
     TQQQ 在 IBKR 之外手动买入，日线与净值日期不重合，所以必须向前找。 */
  function qqqOn(map, date) {
    const ks = Object.keys(map).sort();
    let best = null;
    for (const k of ks) { if (k <= date) best = k; else break; }
    return best != null ? map[best] : null;
  }


  /* ===================================================================
     收益日历的每日盈亏 —— **证券 + 基金两段独立相加**（用户 2026-10-04 定稿）
     ===================================================================
     口径（用户原话：「收益日历不要算现金，只算基金和证券」）：

     ① **证券** = IBKR 净值日差 + TQQQ 日线日差，**统一按当前汇率**（FX）折人民币。
        - IBKR 净值来自 `detailState.stock`（= Asset_parsed.json 的 totalNetValueDaily）。
        - 废值段（02-06 ~ 03-17，净值恒为 1.42）必须剔除 —— 那是 IBKR 的占位噪声，不是真实资产。
        - TQQQ 用 `fund_holdings.json` 的 `qqq_daily`（439 根日线，覆盖 2025-01 起）。
        - 入金**不做扣减**（用户：「不算之前的汇率，就按现在的汇率换成人民币算每天的盈亏」）
          —— 汇率波动因此不影响收益曲线，IBKR 入金也不当成「当日投入」剔掉。

     ② **基金** = Σ基金份额 × 当日净值，逐日与前一日比。
        - 基准 = **2026-02-06 的申购值 483,199.29**（= 5 只基金首日申购 shares×price 之和）。
        - 中途 06-04 买入建信 539002（7,778.96）当天要**扣除这笔成本**，
          否则那天会被算成凭空暴增（用户：「当天扣除它的成本」）。
        - 之后正常按天加减。

     ③ **不含现金** —— 各银行账户余额恒定，本来就不产生损益，算进去只会污染曲线。

     收益率分母：当日证券权益（净值×FX + TQQQ）+ 基金市值，即「当日在投资产」，
     不含现金 —— 与「只算基金和证券」的口径一致。
     =================================================================== */
  const CAL_BASE = {
    /* 基金基准日与**真实成本**。
       ⚠️ 首日基线要用「真实成本」而不是「当日市值」（用户 2026-10-04：「算到最后应该就是
          +161065.08 吧」→ 要求与侧栏同源）。侧栏的基金累计 = Σ份额×净值 − Σ(份额×成本)，
          所以日历的基金段也必须从成本起算，否则会多算/少算「开局那一天」。
       fundTotalCost = **全部**申购的 shares×price 之和 = 483,199.29(02-06) + 7,779(06-04 建信)
                      = 490,978；旧的 fundBaseValue 只统计基准日当天的 483,199.29，别用。 */
    fundBaseDate: '2026-02-06',
    fundTotalCost: 0,
  };
  /* 证券侧的本金：**forexTrades 的 CNH 之和** = 167,599.89 ≈ 167,600（用户 2026-10-04：
     「日历证券应该是167600，你把json里CNY加起来就看出来了」）。
     这 4 笔 cnh 是**实际掏口袋的人民币**，已经是 CNY，不需要再折汇率：
       2026-02-10  17,600.00  = TQQQ 买入（55 股 @ 49.56 = 2,725.8 USD，在 IBKR 之外）
       2026-03-20  99,999.96  = 14,517.68 USD
       2026-06-25  39,999.94  =  5,879.88 USD
       2026-07-15   9,999.99  =  1,475.60 USD
     ⚠️ 不要再用 `electronicFundTransfers`（IBKR 入账，USD，合计 21,841.22）—— 口径不同：
        EFT 里 03-18 那笔 1,449.10 USD 在 forexTrades 里根本没有，而 TQQQ 那 17,600 也不在 EFT 里。 */
  let CAL_TQQQ_BASE_CNY = 17600;

  /* 收益日历收益率 —— **Modified Dietz（修正 Dietz）**，不是简单相除。
     -------------------------------------------------------------------
       R = G / (BMV + Σ wᵢ · CFᵢ)
       G  = 区间内已扣掉现金流的净收益（本项目里就是各日 `gain` 之和 = 月度 own）
       BMV = 期初在投资产（不含现金）
       wᵢ = (区间总天数 − 第 i 笔入金距区间起点的天数) / 区间总天数
     分子**不能**直接用 EMV − BMV：calIndex 里每个交易日已`gainStock -= stockFlows[date]`，
     所以 EMV − BMV 里含着 Σ CF，会把"新投的本金"算成收益。用已扣流水的 G 才对。

     为什么必须加权（用户 2026-10-05）：
       03-20 入金 99,999.96，若分母只用「上月末市值」，后续赚的钱会被这 10 万新本金稀释
       → 3 月被低估成 −7.07%；按日加权（03-20 是当月第 20 天，剩 12/31 ≈ 38.7% 的时间在场）
       → **−6.55%**。这就是"简单加权"与"时间加权"的分别：每一笔本金按**实际在场时间**定权重，
       因此它是 TWR（时间加权收益率）的标准近似做法。
       ⚠️ 只加权**证券入金**：基金申购成本已含在首日基线 fundTotalCost 里，
          再当现金流加权会重复计算（侧栏口径也是一次性减）。
     ------------------------------------------------------------------- */
  function calDietzPct(gain, bmv, flows, totalDays) {
    if (gain == null || !(bmv > 0) || !(totalDays > 0)) return null;
    let wsum = 0;
    for (let i = 0; i < flows.length; i++) {
      const f = flows[i];
      if (!f || !f.amt) continue;
      /* off = 该笔入金距区间起点的天数（0 = 区间第一天）。
         日视图传 0.5 —— 视作当天中午到账，权重按半日算（Modified Dietz 的通行做法）。 */
      const w = Math.max(0, Math.min(1, (totalDays - f.off) / totalDays));
      wsum += f.amt * w;
    }
    const den = bmv + wsum;
    return den > 0 ? gain / den * 100 : null;
  }

  /* 'YYYY-MM-DD' → 年内第几天（1-based），年视图加权用 */
  function calDoy(dateStr) {
    const y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7), d = +dateStr.slice(8, 10);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5) + 1;
  }

  function calIndex() {
    const fundFlows = (detailState && detailState.fundFlows) || {};
    /* 证券入金（forexTrades.cnh，逐日扣）—— 见 initAccountData 处的口径说明 */
    const stockFlows = CAL_STOCK_FLOW;
    /* ---- ① 证券：IBKR 净值（跳过废值段）× **当日汇率** ---- */
    const stockRows = ((detailState && detailState.stock) || [])
      .filter((r) => r.value > 100)                 // 废值段净值恒为 1.42
      .map((r) => ({ date: r.date, usd: r.value, cny: r.value * fxOn(r.date) }));
    /* ---- ② TQQQ：**自己的**日线收盘 × 股数 × 当日汇率 ---- */
    const tqqqShares = CAL_TQQQ_SHARES;
    /* ---- ③ 基金：Σ 份额 × 当日净值（已是人民币，不折算） ---- */
    const fundRows = ((detailState && detailState.fund) || []).filter((r) => r.value != null);

    /* 合并所有出现的日期，按时间排序 —— 证券 / TQQQ / 基金三者的交易日不完全重合。
       ⚠️ 一律从**基金基准日 02-06** 起算：基金 nav 回溯到 2025-12、IBKR 净值从 02-06 才开始，
          若不截断，1 月会出现「有基线无前值」的假数据（实测凭空 +19,182），
          2 月则把 02-06 的申购总额当成当日暴跌（实测 -483,977）。 */
    const from = CAL_BASE.fundBaseDate;
    const dates = new Set();
    stockRows.forEach((r) => { if (r.date >= from) dates.add(r.date); });
    Object.keys(CAL_TQQQ_MAP).forEach((d) => { if (d >= from) dates.add(d); });
    fundRows.forEach((r) => { if (r.date >= from) dates.add(r.date); });
    const allDates = [...dates].sort();

    /* 基线：证券取首个有效净值日，基金取基准日（02-06）。 */
    const stockByDate = {};
    stockRows.forEach((r) => { stockByDate[r.date] = r.cny; });
    const fundByDate = {};
    fundRows.forEach((r) => { fundByDate[r.date] = r.value; });

    const byDate = {}, days = [], months = [];
    /* ⚠️ **首日基线 = 真实成本**（用户 2026-10-04 定稿，要与侧栏 161,065.08 同源）：
         基金 = Σ(份额×成本) = 490,978（含 06-04 建信那笔，所以**不再**逐日扣申购）
         TQQQ = forexTrades 里 02-10 那笔 cnh = 17,600
         证券 = 0（IBKR 那 1,449.10 USD 初始转入侧栏也没算本金，这里同样不算 → 算进收益）
       以前是拿「首日市值」当基线、再逐日扣入金/申购，结果与侧栏差 2 万多。 */
    let prevStock = 0, prevQ = CAL_TQQQ_BASE_CNY, prevFund = CAL_BASE.fundTotalCost;
    /* 三段各自的「上一次已知值」，用于**分母** —— 缺口日（周末/节假日/某段没数据）
       必须沿用上一次的市值，不能当 0，否则分母会剧烈跳变（实测 02-13 481,992 →
       02-17 18,372 → 02-24 495,019），每日涨跌幅与月度收益率跟着失真。 */
    let lastStock = 0, lastQ = 0, lastFund = 0;
    let mKey = null, cur = null;
    for (const date of allDates) {
      const stock = stockByDate[date] != null ? stockByDate[date] : null;
      const fund = fundByDate[date] != null ? fundByDate[date] : null;
      /* TQQQ 当日市值 = **TQQQ 自己的收盘价** × 股数 × 当日汇率
         （该日若无日线，沿用最近一条 ≤ 该日）。 */
      const qClose = tqqqCloseOn(date);
      const q = qClose != null ? qClose * tqqqShares * fxOn(date) : null;
      /* 期初在投资产 = 循环变量更新**之前**的三段之和（Dietz 的 BMV）。
         ⚠️ 必须在下面改 prev* 之前取，否则读到的已是当日值。 */
      const bmv = prevStock + prevQ + prevFund;

      /* 证券日盈亏 = (IBKR 净值 + TQQQ 市值) 与前一段已知值的差，两段独立相加。
         ⚠️ 逐日扣掉 `forexTrades.cnh` 的当日入金（03-20 99,999.96 / 06-25 39,999.94 /
            07-15 9,999.99）：入金当天净值会跳升，不扣就是当日暴涨（实测 03-20 凭空 +85,104）。
            TQQQ 的 17,600 已作为 TQQQ 段的首日基线，不在这里重复扣。 */
      let gainStock = 0, hasStock = false;
      const flow = stockFlows[date] || 0;
      if (stock != null) { gainStock += stock - prevStock; prevStock = stock; lastStock = stock; hasStock = true; }
      if (q != null) { gainStock += q - prevQ; prevQ = q; lastQ = q; hasStock = true; }
      if (hasStock && flow) gainStock -= flow;
      /* 基金日盈亏 = 当日市值 − 前一段已知值。
         ⚠️ 申购成本**不再**逐日扣：06-04 建信那笔 7,779 已包含在首日基线 fundTotalCost 里，
            再扣一次就重复了（侧栏口径是 Σ(份额×成本) 一次性减）。 */
      let gainFund = 0, hasFund = false;
      if (fund != null) { gainFund = fund - prevFund; prevFund = fund; lastFund = fund; hasFund = true; }
      const gain = hasStock || hasFund ? gainStock + gainFund : null;
      /* 分母 = 当日在投资产（证券权益含 TQQQ + 基金市值），**不含现金**；
         三段都取「最近一次已知值」，缺口日不再掉到 0。 */
      const den = lastStock + lastQ + lastFund;
      /* 日收益率同样用 Modified Dietz：BMV = 前一段已知日的市值，
         当日入金视作**中午到账**（off = 0.5 → 权重 50%）。
         分子 gain 已扣掉当日入金，所以不用再减一次。 */
      const pct = gain != null
        ? calDietzPct(gain, bmv > 0 ? bmv : den, flow ? [{ off: 0.5, amt: flow }] : [], 1)
        : null;

      const rec = { date, cny: den, gain, pct, flow: fundFlows[date] || 0, gainStock, gainFund };
      byDate[date] = rec;
      days.push(rec);
      const ym = date.slice(0, 7);
      if (ym !== mKey) { mKey = ym; cur = { ym, y: +date.slice(0, 4), m: +date.slice(5, 7) - 1, first: den, last: den }; months.push(cur); }
      cur.last = den;
    }
    /* 各月 own = 该月每日 gain 之和；pct = **Modified Dietz**（见 calDietzPct 的说明）。
       own 已经逐日扣掉了当月入金，所以它就是 Dietz 公式的分子 (EMV − BMV)；
       分母要在 BMV 上加「当月入金按在场天数加权」，否则新投的钱会稀释收益率。
       ⚠️ 只加权**证券入金**（stockFlows）：基金申购成本已包含在首日基线 fundTotalCost 里，
          再当现金流加权就是重复计算（侧栏口径也是一次性减）。 */
    let run = 0;
    for (let i = 0; i < months.length; i++) {
      const m = months[i];
      const bmv = i > 0 ? months[i - 1].last : m.first;
      m.days = days.filter((d) => d.date.slice(0, 7) === m.ym);
      m.own = m.days.reduce((s2, d) => s2 + (d.gain || 0), 0);
      run += m.own;
      m.gain = run;
      /* 当月入金：off = 距当月 1 号的天数（0-based），当月总天数用自然月天数 */
      const dim = new Date(m.y, m.m + 1, 0).getDate();
      const flows = [];
      m.days.forEach((d) => {
        const f = stockFlows[d.date] || 0;
        if (f) flows.push({ off: +d.date.slice(8, 10) - 1, amt: f });
      });
      m.flows = flows;
      m.flow = flows.reduce((s2, f) => s2 + f.amt, 0);
      /* 分子 = own（已扣当月入金），分母 = 上月末市值 + 加权入金 */
      m.pct = calDietzPct(m.own, bmv, flows, dim);
    }
    /* 年视图（区间合计的收益率）：跨 12 个月**连续加权**，不是各月 pct 的平均。
       分母 = 上年最后月的市值 + 当年所有入金按「距 1/1 的天数」加权。 */
    const yearStats = {};
    months.forEach((m, i) => {
      const st = yearStats[m.y] || (yearStats[m.y] = { y: m.y, own: 0, first: m.first, last: m.last, flows: [] });
      st.own += m.own;
      st.last = m.last;
      (m.flows || []).forEach((f) => st.flows.push({ off: calDoy(m.ym + '-01') - 1 + f.off, amt: f.amt }));
      st.bmv = i > 0 ? months[i - 1].last : m.first;
    });
    Object.values(yearStats).forEach((st) => {
      const dim = (st.y % 4 === 0 && st.y % 100 !== 0) || st.y % 400 === 0 ? 366 : 365;
      st.pct = calDietzPct(st.own, st.bmv, st.flows, dim);
    });
    return { byDate, days, months, yearStats };
  }

  /* 日历金额**只显示整数**（用户 2026-10-04 定稿）：格子里原本是 +3,208.15 这种两位小数，
     移动端每格只有约 58px 宽，小数位把数字挤到几乎贴边；取整后清爽很多，精度损失对读数无影响。 */
  function calFmt(n) {
    if (n == null) return '--';
    return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function calPctText(v) { return v == null ? '--' : (v > 0 ? '+' : '') + v.toFixed(2) + '%'; }
  function calCls(v) { return v == null ? 'ao-cal__none' : v > 0 ? 'ao-cal__up' : v < 0 ? 'ao-cal__down' : 'ao-cal__flat'; }

  function drawAoCal() {
    const body = document.getElementById('aoCalBody');
    if (!body || !aoState.series || !aoState.series.length) return;
    const idx = calIndex();
    if (!calState.y) {                                  // 首次进入：定位到最新有数据的那天
      const last = idx.days[idx.days.length - 1].date;
      calState.y = +last.slice(0, 4); calState.m = +last.slice(5, 7) - 1;
    }
    const today = new Date().toLocaleDateString('sv-SE');
    const label = document.getElementById('aoCalLabel');
    const sumLbl = document.getElementById('aoCalSumLabel');
    const sumEl = document.getElementById('aoCalSum');
    const pctEl = document.getElementById('aoCalPct');
    const prevBtn = document.getElementById('aoCalPrev');
    const nextBtn = document.getElementById('aoCalNext');

    const first = idx.days[0].date, lastDate = idx.days[idx.days.length - 1].date;
    const isYear = calState.mode === 'year';
    label.textContent = isYear ? String(calState.y) : calState.y + '/' + String(calState.m + 1).padStart(2, '0');
    const months = idx.months.filter((x) => x.y === calState.y && (isYear || x.m === calState.m));
    /* 区间合计 = 各月 own 之和（own = 该月每日「证券+基金」盈亏之和）。
       新口径下逐日与汇总已经是同一套算法，不需要再借侧栏的值 ——
       用户 2026-10-04 定的口径是「只算基金和证券，不算现金，按当前汇率折算」，
       侧栏那个「存量−成本」的口径包含现金与历史汇率，与日历不再同源。 */
    const gain = months.reduce((s, x) => s + (x.own || 0), 0);
    /* 区间收益率：月视图直接用该月的 Modified Dietz 值；年视图用跨 12 个月连续加权的
       yearStats（**不是**各月 pct 求平均 —— 简单平均既不是 TWR 也不是 Dietz，
       会让"入金多的月份"和"没有入金的月份"被同等对待）。 */
    const pctVal = isYear
      ? ((idx.yearStats && idx.yearStats[calState.y]) ? idx.yearStats[calState.y].pct : null)
      : (months.length ? months[0].pct : null);
    sumLbl.textContent = (isYear ? calState.y + '年收益 · CNY' : (calState.m + 1) + '月收益 · CNY');
    sumEl.textContent = (gain > 0 ? '+' : '') + calFmt(gain);
    sumEl.className = 'num ' + calCls(gain);
    pctEl.textContent = calPctText(pctVal);
    pctEl.className = 'num ' + calCls(pctVal);
    // 首尾边界：年视图不跨年跳（数据只有 2026），月视图到最新月为止
    const minY = +first.slice(0, 4), maxY = +lastDate.slice(0, 4);
    prevBtn.disabled = isYear ? calState.y <= minY : (calState.y < minY || (calState.y === minY && calState.m <= +first.slice(5, 7) - 1));
    nextBtn.disabled = isYear ? calState.y >= maxY : (calState.y > maxY || (calState.y === maxY && calState.m >= +lastDate.slice(5, 7) - 1));

    if (isYear) {
      body.innerHTML = '<div class="ao-cal__grid--year">' + Array.from({ length: 12 }, (_, m) => {
        const rec = idx.months.find((x) => x.y === calState.y && x.m === m);
        const isCur = calState.y === +today.slice(0, 4) && m === +today.slice(5, 7) - 1;
        return '<div class="ao-cal__cell' + (rec ? '' : ' is-empty') + (isCur ? ' is-today' : '') + '">' +
          '<h5>' + (m + 1) + '月</h5>' +
          (rec
            ? '<b class="n num ' + calCls(rec.own) + '">' + (rec.own > 0 ? '+' : '') + calFmt(rec.own) + '</b>' +
              '<span class="p ' + calCls(rec.pct) + '">' + calPctText(rec.pct) + '</span>'
            : '<span class="n ao-cal__none">--</span>') +
        '</div>';
      }).join('') + '</div>';
    } else {
      const firstDow = new Date(calState.y, calState.m, 1).getDay();     // 0=周日
      const daysInM = new Date(calState.y, calState.m + 1, 0).getDate();
      let html = '<div class="ao-cal__dow">' + ['日', '一', '二', '三', '四', '五', '六']
        .map((d) => '<span>' + d + '</span>').join('') + '</div><div class="ao-cal__grid--month">';
      for (let i = 0; i < firstDow; i++) html += '<div class="ao-cal__day is-pad"></div>';
      for (let d = 1; d <= daysInM; d++) {
        const key = calState.y + '-' + String(calState.m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const rec = idx.byDate[key];
        const future = key > today;
        html += '<div class="ao-cal__day' + (key === today ? ' is-today' : '') + (future ? ' is-future' : '') + '">' +
          '<span class="d">' + d + '</span>' +
          (rec && rec.gain != null
            ? '<b class="n num ' + calCls(rec.gain) + '">' + (rec.gain > 0 ? '+' : '') + calFmt(rec.gain) + '</b>' +
              '<span class="p ' + calCls(rec.pct) + '">' + calPctText(rec.pct) + '</span>'
            : '<span class="n ao-cal__none">--</span>') +
        '</div>';
      }
      body.innerHTML = html + '</div>';
    }
  }

  /* 日历交互：月/年切换、上一期、下一期 */
  (function initAoCal() {
    const root = document.getElementById('aoCal');
    if (!root) return;
    const sw = document.getElementById('aoCalSwitch');
    const step = (delta) => {
      if (calState.mode === 'year') calState.y += delta;
      else {
        calState.m += delta;
        if (calState.m < 0) { calState.m = 11; calState.y--; }
        if (calState.m > 11) { calState.m = 0; calState.y++; }
      }
      drawAoCal();
    };
    sw.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ao-cal]');
      if (!b) return;
      sw.querySelectorAll('button').forEach((x) => x.classList.toggle('is-active', x === b));
      calState.mode = b.dataset.aoCal;
      drawAoCal();
    });
    document.getElementById('aoCalPrev').addEventListener('click', () => step(-1));
    document.getElementById('aoCalNext').addEventListener('click', () => step(1));
  })();

  /* ===================== 账户表头排序（双三角图标，点击升/降切换） ===================== */
  /* 默认排序（用户 2026-10-04：「证券基金现金表格默认按市值大到小排序」）：
     三张表的默认键就是各自的**市值列** —— stock=`value`、fund=`amount`、cash=`cny`，
     `dir: -1` 表示降序（大→小）。点表头可切换；点别的列就用那个列的键。
     三个弹窗里的历史表（stockH/fundH/cashH）**不参与**默认排序，仍按原始顺序（时间倒序），
     与用户诉求无关、别顺手改。 */
  const ACC_SORT = {
    stock: { key: 'value', dir: -1 }, fund: { key: 'amount', dir: -1 }, cash: { key: 'cny', dir: -1 },
    stockH: { key: null, dir: -1 }, fundH: { key: null, dir: -1 }, cashH: { key: null, dir: -1 },
  };
  const ACC_RENDERERS = {};                          // kind -> render 函数，由 initAccountData 填充

  function accSorted(kind, rows) {
    const st = ACC_SORT[kind];
    if (!st || !st.key) return rows;
    const k = st.key, dir = st.dir;
    return rows.slice().sort((a, b) => {
      const av = a[k], bv = b[k];
      const aBad = av == null || (typeof av === 'number' && !isFinite(av));
      const bBad = bv == null || (typeof bv === 'number' && !isFinite(bv));
      if (aBad && bBad) return 0;
      if (aBad) return 1;                             // 空值恒排最后
      if (bBad) return -1;
      const cmp = (typeof av === 'number' && typeof bv === 'number')
        ? av - bv
        : String(av).localeCompare(String(bv), 'zh-Hans-CN');
      return cmp * dir;
    });
  }

  function accSortUI(kind) {
    const st = ACC_SORT[kind];
    const table = document.querySelector('.acc-table[data-sort-table="' + kind + '"]');
    if (!table || !st) return;
    table.querySelectorAll('th[data-sort]').forEach((th) => {
      const on = th.dataset.sort === st.key;
      th.classList.toggle('is-asc', on && st.dir > 0);
      th.classList.toggle('is-desc', on && st.dir < 0);
    });
  }

  function accRender(kind) {
    const fn = ACC_RENDERERS[kind];
    if (!fn) return;
    fn();
    accSortUI(kind);
  }

  (function initAccTableSort() {
    document.querySelectorAll('.acc-table[data-sort-table]').forEach((table) => {
      const kind = table.dataset.sortTable;
      if (!ACC_SORT[kind]) return;
      table.querySelectorAll('th[data-sort]').forEach((th) => {
        th.addEventListener('click', () => {
          const st = ACC_SORT[kind];
          if (st.key === th.dataset.sort) st.dir = -st.dir;   // 同列再点：升↔降
          else { st.key = th.dataset.sort; st.dir = -1; }     // 换列：默认从大到小
          accRender(kind);
        });
      });
    });
  })();

  /* 账户页「持仓 / 历史」子页切换（每个 .acc-page 内 .acc-tabs 的第 1 个=持仓、最后 1 个=历史） */
  (function initAccSubTabs() {
    document.querySelectorAll('.acc-page').forEach((page) => {
      const tabs = page.querySelector('.acc-tabs');
      if (!tabs) return;
      const kind = page.dataset.catPage;
      const hist = page.querySelector('.acc-history');
      const panel = page.querySelector('[data-detail]');   // 资金明细面板（页面内展开）
      const assetPanel = page.querySelector('[data-asset]'); // 资产面板（指标卡已常驻其中，只切显隐）
      const metrics = page.querySelector('.acc-metrics');    // 旧顶部指标区（已删除，保留兜底分支）
      // 若顶部指标卡仍存在（证券页 = 资产 + 现金明细；基金/现金 = 资产 1 张），随 tab 进/出面板
      const assetCards = metrics ? [...metrics.querySelectorAll('.acc-metric')] : [];
      // 持仓区的块级元素（排除历史/资金明细/资产面板内部的表格容器）
      // 注：.acc-filter（筛选行）已按用户要求整行删除，这里同步移除选择器
      const posBlocks = () => [...page.querySelectorAll('.acc-metrics, .acc-actions, .acc-sumline, .acc-table-wrap')]
        .filter((el) => (!hist || !hist.contains(el)) && (!panel || !panel.contains(el)) && (!assetPanel || !assetPanel.contains(el)));
      // 「资产」tab：显示资产面板（卡片常驻其中）；切走时隐藏。若顶部还有指标卡则一并搬走/搬回
      function syncAssetCard(isAsset) {
        if (!assetPanel) return;
        assetPanel.hidden = !isAsset;
        if (!metrics || !assetCards.length) return;
        if (isAsset) {
          assetCards.forEach((card) => {
            if (card.parentNode === metrics) metrics.removeChild(card);
            assetPanel.appendChild(card);
          });
          metrics.hidden = true;
        } else {
          assetCards.forEach((card) => {
            if (card.parentNode === assetPanel) assetPanel.removeChild(card);
            metrics.appendChild(card);
          });
          metrics.hidden = false;
        }
      }
      tabs.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          // 按 tab 文案/属性判断（4 个 tab：持仓/资产/历史/资金明细）
          const isHist = /历史/.test(btn.textContent || '');
          const isDetail = btn.hasAttribute('data-detail-tab');
          const isAsset = btn.hasAttribute('data-asset-tab');
          if (hist) hist.hidden = !isHist;
          posBlocks().forEach((el) => { el.hidden = isHist || isDetail || isAsset; });
          if (panel) panel.hidden = !isDetail;
          syncAssetCard(isAsset);
          tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === btn));
          if (isDetail) openDetail(btn.dataset.detailTab, panel);
          else if (!isHist) accRender(kind);
        });
      });
      // 页面首次显示在「持仓」时，确保历史面板为隐藏
      if (hist) hist.hidden = true;
    });
  })();

  /* ===================== 资金明细弹窗（每日净值列表） ===================== */
  const detailState = { stock: [], fund: [], cash: [], cat: null, panel: null, page: 0, per: 30, fx: 7, flows: {}, fundFlows: {} };
  const DETAIL_TITLE = { stock: '证券资金明细', fund: '基金资金明细', cash: '现金资金明细' };
  // 证券账户以 USD 计价，弹窗直接显示美元（不再折 CNY + 括注）；
  // 基金/现金是人民币口径，保持 CNY。
  const DETAIL_COLS = {
    stock: ['日期', '净值 · USD', '当日盈亏 · USD', '当日涨跌', '累计涨跌 · TWR'],
    fund:  ['日期', '净值 · CNY', '当日盈亏', '当日涨跌', '累计涨跌 · TWR'],
    cash:  ['日期', '净值 · CNY', '当日盈亏', '当日涨跌', '累计涨跌 · TWR'],
  };

  /* 每日一行（**现金流调整后的 TWR**，Modified Dietz 日链式）：
       组合日收益  P_t = V_t − V_{t−1} − CF_t        （剔除当日外部净投入的影响）
       日收益率    r_t = P_t / (V_{t−1} + CF_t/2)     ← 分母含「当日入金折半」，这是 Dietz 的关键
       TWR 累计    cum = Π(1 + r_i) − 1             （几何链接，剔除中途投入/赎回的规模效应）
     ⚠️ 分母为什么必须带 CF_t/2（曾算错，用户 2026-10-03 指出 TWR 只有 14.76%、明显偏低）：
       用 V_{t−1} 做分母时，大额入金当天会被当成「巨亏」——
       2026-03-20 前日净值仅 1,454.82，当入金 13,032 后净值 14,085.69，
       真实盈亏 = 14,085.69 − 13,032 − 1,454.82 = −401.13，
       但除以 1,454.82 得 **−27.57%**，一天吞掉近 28 个百分点。
       加上 CF/2（假设资金当日均半日投入）后当日为 −5.03%，全期 TWR 从 14.76% 修正为 **52.07%**，
       与「累计收益 +82,699 / 本金 167,600 ≈ +49%」量级一致。
     CF_t（外部现金流）按类别取：
       证券 = electronicFundTransfers（IBKR 的 Electronic Fund Transfer，credit=入金/debit=出金）
       基金 = seed.pa_funds[].trades 的申购金额（shares × price，按日汇总，type=buy/redempt 视作流出）
     两者都强制从 **2026-02-06**（首个有持仓的交易日）起算：早于它的行（基金 nav 回溯到 2025-12）
     视为「无持仓期」，不参与 TWR，收益率与累计显示 --。 */
  const DETAIL_BASE_DATE = '2026-02-06';

  function detailRows(cat, flows) {
    const rows = detailState[cat] || [];
    const cfMap = flows || {};
    const all = rows.map((r, i) => {
      const prev = i > 0 ? rows[i - 1].value : null;
      const flow = cfMap[r.date] || 0;       // 当日外部净投入（CNY）
      return {
        ...r,
        // 日收益率 = (V_t − V_{t−1} − CF_t) / (V_{t−1} + CF_t/2)
        // 分母含当日入金折半，否则大额入金当天会被误算成巨亏（详见 detailState 上方注释）
        r1: (() => {
          const den = prev == null ? 0 : prev + flow * 0.5;
          return den > 0 ? (r.value - prev - flow) / den : null;
        })(),
        flow,                                                    // 当日外部现金流
        chg: prev == null ? null : r.value - prev,             // 净值差额（含投入）
        gain: prev == null ? null : r.value - prev - flow,     // 组合收益（剔除投入）
      };
    });
    // 强制从 2026-02-06 起算
    const startIdx = all.findIndex((r) => r.date >= DETAIL_BASE_DATE);
    const s0 = startIdx >= 0 ? startIdx : 0;
    let cumFactor = 1;
    return all.map((r, i) => {
      const inBase = i >= s0;
      if (inBase && r.r1 != null && i > s0) cumFactor *= (1 + r.r1);
      return {
        ...r,
        chgCum: inBase ? r.value - all[s0].value : null,        // 累计盈亏额
        cum: inBase ? (cumFactor - 1) * 100 : null,             // TWR 累计涨跌 %
        base: all[s0] ? all[s0].date : null,                    // 基准日
        inBase,
      };
    });
  }

  function renderDetail() {
    const cat = detailState.cat;
    if (!cat) return;
    const rows = detailRows(cat, cat === 'fund' ? detailState.fundFlows : detailState.flows)
      .slice().reverse();   // 最新的排最前
    const panel = detailState.panel;
    if (!panel) return;
    const body = panel.querySelector('[data-dbody]');
    const pageCount = Math.max(1, Math.ceil(rows.length / detailState.per));
    if (detailState.page >= pageCount) detailState.page = pageCount - 1;
    const start = detailState.page * detailState.per;
    const slice = rows.slice(start, start + detailState.per);
    const f2 = (v) => (v == null || !isFinite(v) ? '--' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const sgn = (v) => (v == null ? '--' : (v > 0 ? '+' : '') + f2(v));
    const pctS = (v) => (v == null ? '--' : (v > 0 ? '+' : '') + v.toFixed(2) + '%');
    const cls = (v) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');

    // 表头按类别
    const headRow = panel.querySelector('[data-dhead]');
    if (headRow) {
      const cols = DETAIL_COLS[cat] || DETAIL_COLS.stock;
      headRow.innerHTML = cols.map((c) => '<th>' + c + '</th>').join('');
    }

    if (body) {
      body.innerHTML = slice.map((r) => {
        // 当日盈亏显示「组合收益」（已剔除当日入金）；有入金时附小字说明
        const chgMain = r.gain;
        const flowNote = r.flow ? `<span class="dlg-sub"> ${cat === 'stock' ? '入金' : '申购'} ${f2(r.flow)}</span>` : '';
        return `<tr class="${r.inBase ? '' : 'is-prebase'}"><td>${r.date}</td>` +
          `<td class="num">${f2(r.value)}</td>` +
          `<td class="num ${cls(chgMain)}">${sgn(chgMain)}${flowNote}</td>` +
          `<td class="num ${cls(r.r1)}">${pctS(r.r1 == null ? null : r.r1 * 100)}</td>` +
          `<td class="num ${cls(r.cum)}">${pctS(r.cum)}</td></tr>`;
      }).join('');
    }
    if (!rows.length && body) body.innerHTML = '<tr><td class="acc-empty__txt" colspan="5">暂无数据</td></tr>';
    // ⚠️ 顶部汇总（最新净值/最新当日盈亏/累计组合收益/累计涨跌·TWR）已按用户要求删除：
    //    这四项在下面每日表格里都有对应列（净值/当日盈亏/日涨跌/累计涨跌），完全重复。
    const cnt = panel.querySelector('[data-dcount]');
    const pg = panel.querySelector('[data-dpage]');
    const prev = panel.querySelector('[data-dprev]');
    const next = panel.querySelector('[data-dnext]');
    if (cnt) cnt.textContent = rows.length + ' 条记录';
    if (pg) pg.textContent = (detailState.page + 1) + ' / ' + pageCount;
    if (prev) prev.disabled = detailState.page <= 0;
    if (next) next.disabled = detailState.page >= pageCount - 1;
  }

  /* 资金明细改成「页面内 tab 就地展开」（不再走弹窗）：
     openDetail(cat, panel) —— panel = 当前页内的 .acc-detail 容器 */
  function openDetail(cat, panel) {
    detailState.cat = cat;
    detailState.panel = panel || null;
    detailState.page = 0;
    renderDetail();
  }

  document.querySelectorAll('.acc-detail').forEach((panel) => {
    const prev = panel.querySelector('[data-dprev]');
    const next = panel.querySelector('[data-dnext]');
    if (prev) prev.addEventListener('click', () => { detailState.page--; renderDetail(); });
    if (next) next.addEventListener('click', () => { detailState.page++; renderDetail(); });
  });

  async function initAccountData() {
    const ACC_API = 'https://data.alpaca.markets';
    const ACC_HDR = {
      'APCA-API-KEY-ID': 'PKEUEXIJARHLHWZYLWR6UAOGBS',
      'APCA-API-SECRET-KEY': '8QmudbfguaxQnFRq13YU1B5GY94F5AEx3Tz7m66LUFyc',
    };

    const $id = (i) => document.getElementById(i);
    const f2 = (v, sign) => {
      if (v == null || !isFinite(v)) return '--';
      const s = v.toFixed(2);
      return sign && v > 0 ? '+' + s : s;
    };
    const pctS = (v) => (v == null || !isFinite(v)) ? '--' : (v > 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
    function setTxt(id, txt, trend) {
      const el = $id(id);
      if (!el) return;
      el.textContent = txt;
      el.classList.remove('up', 'down');
      if (trend > 0) el.classList.add('up');
      else if (trend < 0) el.classList.add('down');
    }
    async function accJson(url, opts) {
      try {
        // 本地 JSON 会被浏览器缓存（数据文件每天由 workflow 更新），加时间戳强制取最新
        const u = /^https?:/i.test(url) ? url : url + '?_t=' + Date.now();
        /* fetch() 没有内置超时，源不可达时会永远挂着（实测 frankfurter 挂 15s+），
           上游 await 会连带把整个 initAccountData 卡死 → 整页全是 `--`。
           这里统一加 8s 上限，失败返回 null 让调用方走本地兜底口径。 */
        const r = await Promise.race([
          fetch(u, opts),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
        ]);
        if (!r.ok) { console.warn('[acc] fail', r.status, url); throw new Error(r.status); }
        return await r.json();
      } catch (e) { if (e && e.message && e.message !== 'Failed to fetch') console.warn('[acc] err', url, e.message); return null; }
    }
    // 美东日期串（Alpaca start 参数用）
    const etDate = (offsetDays) => {
      const d = new Date(Date.now() - offsetDays * 86400e3);
      return d.toISOString().slice(0, 10);
    };
    // 日线数组 -> [最新价参考, 前收]：bars 升序，最后一根是今日（未完结），前一根收盘即前收
    /* 日线数组（**升序**，最后一根是最新交易日）→ [现价, 昨收]
       昨收 = 倒数第二根（用户 2026-10-04 定稿：「昨收就是现价的前一根，138.07 是对的」）。
       休市日最后一根已完结（= 最新交易日收盘），倒数第二根就是它的**前一交易日**收盘；
       这正是「现价相对前一根」的语义，不按日期做特例。 */
    const prevCloseOf = (bars) => {
      if (!bars || !bars.length) return [null, null];
      const last = bars[bars.length - 1];
      const prev = bars.length >= 2 ? bars[bars.length - 2] : null;
      return [last.c, prev ? prev.c : null];
    };

    /* ---- Alpaca 拉取：美股 latest trade + 期权 snapshot，日线取前收 ---- */
    const tqqqBars = {};              // TQQQ 每日收盘价（供总资产曲线按日补 TQQQ 市值）
    /* TQQQ 全区间日线：IBKR 净值(totalNetValueDaily)不含 TQQQ（TQQQ 在 IBKR 之外手动买入），
       画总资产曲线时必须按日补上 TQQQ 市值，否则历史点整体偏低约 2.9 万、末点换实时值时会假跳升。
       日线默认只拉 30 天，这里单独拉覆盖整个净值序列区间。 */
    async function accTqqqDaily() {
      const firstDate = (asset && asset.totalNetValueDaily && asset.totalNetValueDaily[0]
        && asset.totalNetValueDaily[0].date) || '2026-02-01';
      const d = await accJson(
        /* 同样用默认 SIP 口径（不加 feed=iex）：这条序列用于给历史点补 TQQQ 市值，
           必须和其余持仓一样是全市场收盘价，否则整条资产曲线偏。 */
        `${ACC_API}/v2/stocks/bars?symbols=TQQQ&timeframe=1Day&start=${firstDate}&limit=400`,
        { headers: ACC_HDR });
      const bars = d && d.bars && d.bars.TQQQ;
      if (!bars || !bars.length) return tqqqBars;
      for (const b of bars) tqqqBars[String(b.t).slice(0, 10)] = b.c;   // 升序
      return tqqqBars;
    }
    async function accAlpacaQuotes(stockSyms, optSyms) {
      const res = { stock: {}, opt: {} };
      const put = (store, k, patch) => { if (!store[k]) store[k] = {}; Object.assign(store[k], patch); };
      const start = etDate(12);

      /* Alpaca 不可达时（弱网/被墙/本机开发）绝不能把整个 initAccountData 卡死在这里 ——
         下面所有基于本地 JSON 的计算（净值、基金、现金、TWR）都还没跑，
         结果就是整页全是 `--`。
         给每批请求加 9s 上限：超时 → res 保持为空 → 后面走 JSON 兜底口径
         （市值用 holdings[].positionValue，价格用 markPrice）。
         ⚠️ 原为 4s，实测 Alpaca 单请求常耗 1.0~1.5s、并发时偶尔超 4s → **整批结果被丢弃**，
         页面瞬间从 Alpaca 价（142.41）掉到 OKX 兜底（142.5），下一个周期又跳回来 = 现价闪跳。
         accJson 自身已有 8s 上限，这里给 9s 留足余量，只兜「accJson 也没兜住」的极端情况。 */
      /* ⚠️ 三个端点**各自**独立超时，不要再套一个总的 `Promise.all + 9s race`：
         旧写法里只要最慢的那条（期权 snapshots 通常最慢）超 9s，**整批结果被一起丢掉**，
         表现就是「账户里所有证券现价一起消失」，而 Alpaca 其实只是慢了几百毫秒。
         现在每条自己兜底：股票慢了不影响期权，期权挂了也不影响股票现价。
         （局部名用 accRace，避开下面腾讯段那个 `withTimeout`—— 同作用域，不能重名。） */
      const accRace = (p, ms) => Promise.race([
        p, new Promise((r) => setTimeout(() => r(null), ms)),
      ]);
      await Promise.all([
        /* 现价来源 = **日线最后一根的收盘价**（用户 2026-10-04 定稿：「账户orcl现价应该是142.30」）。
           为什么不用 `trades/latest`：免费账户的逐笔成交**只有 IEX 有数据**
           （实测 feed=sip / feed=otc 返回空），所以「最新成交价」必然是 IEX 那一笔 = 142.41；
           而全市场真实收盘是 142.30（成交量 3543 万 vs IEX 的 65.7 万）。账户账面要跟券商对得上，必须用 SIP。
           ⚠️ 代价：日线粒度下**盘中拿不到分时价**（最后一根未完结日线会随成交跳动，够用但不精细）。
           若将来有 SIP 权限，可改回 trades/latest + `feed=sip`。
           日线同时给出昨收（倒数第二根），一次请求两件事，不存在两个端点抢同一字段 → 不会闪跳。
           ⚠️ **不要加 `feed=iex`**（用户纠正过一次）：feed=iex → 10-02 C=142.41、成交量 65.7 万（仅 IEX）；
              SIP/默认 → 10-02 C=**142.30**、成交量 3543 万（全市场合并）。 */
        stockSyms.length && accRace(
          /* 多标的同样是分页的（每页 ~9~10 个代码），必须翻页 —— 见 alpacaPaged 注释。 */
          alpacaPaged(`${ACC_API}/v2/stocks/bars?symbols=${stockSyms.join(',')}&timeframe=1Day&start=${start}&limit=30`, 'bars', 3),
          9000,
        ).then((bars) => {
          for (const [k, v] of Object.entries(bars || {})) {
            const [now, prev] = prevCloseOf(v);
            put(res.stock, k, { price: now, prevClose: prev });
          }
        }),
        /* 期权仍走 snapshots / bars（期权没有 IEX/SIP 这个区分问题），同样翻页。 */
        optSyms.length && accRace(
          alpacaPaged(`${ACC_API}/v1beta1/options/snapshots?symbols=${optSyms.join(',')}`, 'snapshots', 3), 9000,
        ).then((snaps) => {
          for (const [k, s] of Object.entries(snaps || {})) {
            const qt = (s && s.latestQuote) || {};
            const mid = (qt.bp > 0 && qt.ap > 0) ? (qt.bp + qt.ap) / 2 : (s.dailyBar ? s.dailyBar.c : null);
            put(res.opt, k, { price: mid });
          }
        }),
        optSyms.length && accRace(
          alpacaPaged(`${ACC_API}/v1beta1/options/bars?symbols=${optSyms.join(',')}&timeframe=1Day&start=${start}&limit=30`, 'bars', 3), 9000,
        ).then((bars) => {
          for (const [k, v] of Object.entries(bars || {})) {
            const [, prev] = prevCloseOf(v);
            put(res.opt, k, { prevClose: prev });
          }
        }),
      ]);
      return res;
    }

    /* ---- 东方财富 pingzhongdata（script 标签引入，免 CORS）取最新两日净值 ----
       返回 [最新净值, 前一日净值, 净值日期文本]。
       ⚠️ QDII 基金净值有 1~3 天滞后，必须把日期带出来让用户看到数据到几号。 */
    function accFundNav(code) {
      return new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://fund.eastmoney.com/pingzhongdata/' + code + '.js';
        let settled = false;
        const finish = (l, p, d) => {
          if (settled) return;
          settled = true;
          s.remove();
          try { delete window.Data_netWorthTrend; } catch (e) { window.Data_netWorthTrend = undefined; }
          resolve([l, p, d || null]);
        };
        s.onload = () => {
          const arr = window.Data_netWorthTrend;
          // Data_netWorthTrend 每项是 { x: 时间戳(ms), y: 净值 }
          if (arr && arr.length >= 2) finish(arr[arr.length - 1].y, arr[arr.length - 2].y, navDate(arr[arr.length - 1].x));
          else finish(null, null);
        };
        s.onerror = () => finish(null, null);
        setTimeout(() => finish(null, null), 4000);
        document.head.appendChild(s);
      });
    }

    /* 净值时间戳 → 'MM-DD' 或 'YYYY-MM-DD'（按东财口径，x 是当日 0 点） */
    function navDate(ts) {
      const n = Number(ts);
      if (!isFinite(n) || n <= 0) return null;
      const d = new Date(n);
      if (isNaN(d.getTime())) return null;
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    /* 日期归一化：'2026-10-01'（带横线）与 '20261001'（8 位）两种写法在项目里都存在
       —— qqq_daily 是前者，_daily_quotes / navDate 是后者。比较前必须统一成 8 位字符串。
       ⚠️ 不归一化会全错：'2026-10-01' <= '20260929' 为 true（因为 '1' < '9'），
          会把 10-01 误当成基准日，导致 QQQ 系基金涨跌恒为 0。 */
    const ymd = (s) => String(s || '').replace(/-/g, '');

    /* ---- 本地数据 ---- */
    const asset = await accJson('Asset_parsed.json');
    if (!asset) return;
    const fundH = await accJson('fund_holdings.json');
    const seed = asset.seed || {};
    /* 账户折人民币的汇率：**统一取 `fund_holdings.json` 的 `usdcnh_daily` 最后一条**
       （= 自选里「美元/离岸人民币」那一行、= 收益日历 `fxOn(最后一天)`，三处同源）。
       用户 2026-10-05定稿：「应该是 6.7046 吧，侧栏不要用 seed，按自选里最新汇率来」。
       ⚠️ 原来这里是 `seed.pa_fx = 6.737816`（IBKR 快照时的手工汇率），再用一个**不稳定的**
          `frankfurter.dev/v1/latest` 实时调用去覆盖它 —— 那个调用会因本机 HTTPS 拦截而失败，
          于是侧栏时而 6.7378 时而 6.7046，**收益日历与侧栏对不上**（实测差 53 CNY）。
          现在改成读本地 JSON：确定、无网络请求、三处口径一致。 */
    let FX = seed.pa_fx || 7;                 // 兜底：Asset_parsed.json 的手工汇率
    {
      const rows = (fundH && fundH.usdcnh_daily) || [];
      let lastRow = null;
      for (const r of rows) {
        const d = String((r && r.d) || '');
        if (!d || !r.c) continue;
        if (!lastRow || d > lastRow.d) lastRow = { d, c: +r.c };
      }
      if (lastRow && lastRow.c > 0) FX = lastRow.c;
      else console.warn('[账户] usdcnh_daily 缺失，汇率回落 seed.pa_fx', FX);
    }

    /* ---- 汇率序列（QDII 基金的外汇敞口）—— 基金是人民币计价，资产是外币，
         人民币净值 = Σ(外币资产 × 该货币兑人民币)，所以估值必须叠加一层汇率变动。
         一次请求拿全币种：`?base=USD&symbols=CNY,JPY,KRW,HKD`，其余币种用交叉汇率：
             XXX/CNY = (USD/CNY) ÷ (USD/XXX)
         ⚠️ 不要直接请求 `?base=KRW&symbols=CNY`：KRW/CNY ≈ 0.005 只给到 3 位有效数字，
            日间 0.4% 的波动会被四舍五入吃掉一大半；走 USD 交叉（USD/KRW ≈ 1353，5 位有效）
            精度高一个量级。同理 JPY/CNY ≈ 0.0426 也只有 3 位。
         数据是欧洲央行日频参考价（北京时间约 16:00 出当日，周末/欧洲假期不更新）。 */
    const FX_SERIES = {};                 // { USD: [{ d:'20260929', v:6.7034 }, …], JPY: […], KRW: […], HKD: […] }
    /* ---- 估值是否叠加「期间汇率变动」—— 2026-10-04 用户定稿：**不叠加** ----
       基金估值只看**成分股本身**的涨跌，不叠「外币兑人民币」的期间变动。
       人民币净值里已经隐含了汇率，但汇率每天都在动、且各基金持有币种不同，
       叠加后会让同一只基金因汇率噪声出现与持仓无关的涨跌，掩盖真实表现。
       代码全部保留（loadFxSeries / fxChgOn / toCny），只由这一个开关控制：
       ① estimateFund 里的 `toCny()` 恒返回 chg；② 汇率贡献恒 0；
       ③ loadFxSeries 不会发请求（省一次空等）。要恢复改成 true 即可。 */
    const FX_IN_VAL = false;
    const FX_CACHE_KEY = 'futu_fx_series_v1';
    async function loadFxSeries(startDate) {
      const parse = (j) => {
        const out = {};
        Object.keys((j && j.rates) || {}).forEach((d) => {
          const r = j.rates[d];
          if (!(r && r.CNY > 0)) return;
          (out.USD = out.USD || []).push({ d: ymd(d), v: r.CNY });
          ['JPY', 'KRW', 'HKD'].forEach((c) => {
            if (r[c] > 0) (out[c] = out[c] || []).push({ d: ymd(d), v: r.CNY / r[c] });
          });
        });
        Object.keys(out).forEach((k) => out[k].sort((a, b) => (a.d < b.d ? -1 : 1)));
        return out;
      };
      const url = `https://api.frankfurter.dev/v1/${startDate}..?base=USD&symbols=CNY,JPY,KRW,HKD`;
      // ⚠️ 必须**合并进** FX_SERIES 而不是整体替换：VAL.fx 持有的是同一个对象引用，
      //    重新赋值会让估值模块继续读到空对象（汇率层静默失效，表现为「汇率 +0.000%」）。
      const merge = (out) => { Object.keys(out).forEach((k) => { FX_SERIES[k] = out[k]; }); };
      /* ① 优先读随仓库更新的本地快照 fx_rates.json（由 fetch_fx.py / 每日 workflow 生成）。
            浏览器直连 frankfurter 会被本机 HTTPS 拦截随机掐断，本地文件最稳。 */
      try {
        const snap = await accJson('fx_rates.json');
        const out = parse(snap);
        if (Object.keys(out).length) { merge(out); return; }
      } catch (e) { /* 文件缺失/损坏 → 退回在线接口 */ }
      try {
        // 偶发超时，失败再试一次（换用不带 startDate 的 30 天窗口，排除是参数问题）
        let j = await Promise.race([accJson(url), new Promise((r) => setTimeout(r, 6000))]);
        if (!j || !j.rates) j = await Promise.race([accJson(url), new Promise((r) => setTimeout(r, 6000))]);
        const out = parse(j);
        if (Object.keys(out).length) {
          merge(out);
          try { localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ at: Date.now(), data: out })); } catch (e) {}
          return;
        }
      } catch (e) { console.warn('[汇率序列] 拉取失败：', e); }
      // 兜底：读上次缓存（欧洲央行日频参考价，隔天用不失真）
      try {
        const c = JSON.parse(localStorage.getItem(FX_CACHE_KEY) || 'null');
        if (c && c.data && Object.keys(c.data).length) {
          merge(c.data);
          VAL_FX_FROM_CACHE = new Date(c.at);
          console.warn('[汇率序列] 用本地缓存（抓于 ' + VAL_FX_FROM_CACHE.toLocaleString() + '）');
        }
      } catch (e) {}
    }
    let VAL_FX_FROM_CACHE = null;      // 非 null 表示本次汇率用的缓存（调试/排查用）

    /* ================= 基金实时估值（季报持仓加权） =================
       2026-01 监管要求全行业下架「基金实时估值」，公开接口已不可用，这里**自己算**：
         基金估算涨跌 = Σ(重仓权重 × 该股人民币口径涨跌) + 残余股票×QQQ + 闲置仓位的汇兑损益
       —— 注意公式里的涨跌是**人民币口径**：基金以人民币计价、资产是外币，
         所以每个成分都要在自己本币涨跌上再叠一层「该货币兑人民币」的涨跌（详见 fxChgOn）。
       区间口径：基准日 = 该基金最新净值日（QDII 按**美东**交易日计），终点 = 各市场最新可得价。
       行情来源（按市场分）：
         美股     → OKX 永续（`OKX_API_BASE`，instId = `<code>-USDT-SWAP`），复用现有 fetchers；
         日/韩/港/A → `fund_holdings.json` 的 `_daily_quotes`（东方财富日线，已抓好）；
         QQQ      → `qqq_daily`（438 根日线，含 9-29 基准与 10-01 最新）；
         汇率      → frankfurter 日频参考价（USD/JPY/KRW/HKD → CNY，见 loadFxSeries）；
         取不到   → 回落 QQQ 涨跌（用户规则：未知的股票都按 QQQ 推算）。
       ⚠️ 已知脏数据：jp285A 在 `_daily_quotes` 里 9-28=53340 → 9-29=17880 断层（单位/复权口径不一致），
          由此算出的涨幅无意义 —— 检测到这种断层就标记不可用并走 QQQ 兜底。

       ⚠️ OKX 并非所有代码都有永续合约，个别标的要用同一公司的另一类股份顶替（比 QQQ 兜底准得多）：
          GOOG（谷歌-C）没有 `GOOG-USDT-SWAP`，用 GOOGL（谷歌-A）的行情 —— A/C 两类股同股不同权，
          同属 Alphabet，价格长期贴合，基金季报里两者也常混用。 */
    const VAL = { qqq: [], dq: {}, splits: {}, dqDirty: new Set(), txUs: {} };
    {
      const FH = fundH || {};
      // 日期格式必须归一化后再比较（ymd 已在上面定义，详见那里注释）
      VAL.fx = FX_SERIES;                 // 各货币兑人民币日频序列（见 loadFxSeries）
      // QQQ 日线（升序，日期归一化为 8 位）：基准日按每只基金的 navDate 现查，终点恒为最后一条
      VAL.qqq = (FH.qqq_daily || []).map((r) => ({ d: ymd(r.d), c: r.c }))
        .sort((a, b) => (a.d < b.d ? -1 : 1));
      // 非美标的：逐条存 {date, close, prevClose}（同样归一化）
      Object.keys(FH._daily_quotes || {}).forEach((k) => {
        VAL.dq[k] = (FH._daily_quotes[k] || []).map((r) => ({
          d: ymd(r.date), c: r.close, pc: r.prevClose,
        })).sort((a, b) => (a.d < b.d ? -1 : 1));
      });
      /* ---- 拆股自动识别与前复权 ----
         原理：拆股当日的 `prevClose` 会被数据源**按新股本口径**给出，而前一日 `close` 仍是旧口径，
           两者比值就是拆股比例。实测 jp285A（铠侠 1:3 拆股）：
             20260928 close=53340  →  20260929 prevClose=17780，且 53340 / 3 = 17780 ✓
         做法：从后往前扫，遇到「前一日 close ÷ 当日 prevClose ≈ 整数倍（1.5~10）」就判定为拆股，
           把**该日之前**所有 close 与 prevClose 同除以该比例（向前复权，保证历史可比）。 */
      const SPLIT_RATIOS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1.5, 2.5, 3.5];
      const findSplits = (arr) => {
        const hits = [];
        for (let i = 1; i < arr.length; i++) {
          const prev = arr[i - 1], cur = arr[i];
          if (!(prev.c > 0) || !(cur.pc > 0)) continue;
          const ratio = prev.c / cur.pc;
          for (const k of SPLIT_RATIOS) {
            // 容差 2%：数据源四舍五入到 0.5~1 个价位单位时会带小误差
            if (Math.abs(ratio / k - 1) < 0.02) {
              // 排除「真的暴涨/暴跌」：要求当日 prevClose 与前一日 close 同量级时才可能是拆股
              hits.push({ at: cur.d, k });
              break;
            }
          }
        }
        return hits;
      };
      const applySplits = (arr, hits) => {
        if (!hits.length) return arr;
        // 从最新一次拆股往前回溯累计因子：拆股日**之前**的记录要除以所有后续拆股比例
        const out = arr.map((r) => ({ ...r }));
        for (const h of hits) {
          const idx = out.findIndex((r) => r.d === h.at);
          if (idx <= 0) continue;
          for (let i = 0; i < idx; i++) {           // 拆股日之前（含当日 prevClose 对应的前一日）全部按新口径折算
            out[i].c /= h.k;
            if (out[i].pc) out[i].pc /= h.k;
          }
        }
        return out;
      };
      Object.keys(VAL.dq).forEach((k) => {
        const hits = findSplits(VAL.dq[k]);
        if (hits.length) {
          VAL.dq[k] = applySplits(VAL.dq[k], hits);
          VAL.splits[k] = hits;
        }
      });
      // 复权后仍存在 >50% 的断层才判定为脏数据（拆股已处理，剩下的才是真异常）
      Object.keys(VAL.dq).forEach((k) => {
        const arr = VAL.dq[k];
        for (let i = 1; i < arr.length; i++) {
          if (arr[i - 1].c > 0 && Math.abs(arr[i].c / arr[i - 1].c - 1) > 0.5) { VAL.dqDirty.add(k); break; }
        }
      });
    }
    /* QQQ 区间涨幅：基准 = 基准日**之前最近的一条**（该市场基准日未必有交易），
       终点 = 最后一条。⚠️ 基准日必须由调用方按各基金 navDate 传入 ——
       早前写成模块级常量（基准恒等于最后一条）会导致所有 QQQ 系基金涨跌恒为 0。 */
    function qqqChgOn(baseDate) {
      if (!VAL.qqq.length) return null;
      const bd = String(baseDate || '').replace(/-/g, '');
      let bi = -1;
      for (let i = 0; i < VAL.qqq.length; i++) if (VAL.qqq[i].d <= bd) bi = i;
      if (bi < 0) bi = 0;
      const last = VAL.qqq[VAL.qqq.length - 1];
      if (last.d <= VAL.qqq[bi].d) return 0;
      return last.c / VAL.qqq[bi].c - 1;
    }

    /* ---- 汇率（QDII 的人民币折算层）----
       基金用人民币计价，但资产是外币：客户经理不做汇率对冲时（QDII 股票基金基本不对冲），
         人民币净值 = Σ(某只股票的外币市值 × 该货币兑人民币)
       所以单个成分对基金净值的贡献是**两个涨幅相乘**，不是相加：
         人民币口径涨跌 = (1 + 股票本币涨跌) × (1 + 该货币兑人民币涨跌) − 1
       例如 SK 海力士本币 +4.31%、韩元兑人民币 +0.39%，对基金就是 (1.0431×1.0039 − 1) = +4.72%。 */
    const CUR_OF = { us: 'USD', jp: 'JPY', kr: 'KRW', hk: 'HKD', sz: 'CNY', sh: 'CNY', cn: 'CNY' };
    /* 某货币兑人民币在区间内的涨跌（小数）；CNY 恒 0；序列缺失返回 null（调用方退回美元）。 */
    function fxChgOn(cur, baseDate) {
      if (!cur || cur === 'CNY') return 0;
      const arr = VAL.fx[cur];
      if (!arr || !arr.length) return null;
      const bd = ymd(baseDate);
      let bi = -1;
      for (let i = 0; i < arr.length; i++) if (arr[i].d <= bd) bi = i;
      if (bi < 0) bi = 0;
      const last = arr[arr.length - 1];
      if (last.d <= arr[bi].d) return 0;                    // 基准日之后汇率没再更新
      return last.v / arr[bi].v - 1;
    }

    /* 单个标的的区间涨跌（小数，如 0.0056）；
       baseDate = 基金净值日（'YYYY-MM-DD'）；取不到返回 null → 走 QQQ 兜底。
       非美标的用复权后的序列（拆股已前复权，见上）；美股走腾讯交易所日线。
       ⚠️ 返回的是**本币**涨跌，人民币口径要再乘汇率（见 estimateFund 里的 toCny）。 */
    /* -------------------------------------------------------------------
       OKX 永续 —— **只服务「持仓」页**（用户 2026-10-04 定稿：
       「持仓里面 orcl 和 tqqq 的现价应该用 okx 的」）。
       为什么持仓页要另用一个源：OKX 股票永续 7×24 连续报价，盘中/周末都在动，
       反映的是「此刻真实价格」；而账户页那个是 IBKR/Alpaca 的**账面收盘价**
       （休市日就停在最后一个收盘，= 142.30）。两者之差就是持仓页的「较基准涨跌」。
       ⚠️ 别再把 OKX 用作**账户页**的兜底（上一轮已按要求移除）：
          账户页现价必须是券商口径，否则和 IBKR 对不上账。
       ⚠️ OKX 永续只挂一个上市代码：谷歌只有 GOOGL，没有 GOOG-USDT-SWAP，
          而部分基金季报持仓写的是 GOOG（谷歌-C）→ 用 GOOGL 的行情顶替
          （A/C 同股不同权，价格长期贴合约 0.1%）。 */
    const OKX_API_BASE = 'https://www.cnoyu.org/api/v5';
    const OKX_ALIAS = { GOOG: 'GOOGL' };
    const okxInst = (code) => `${OKX_ALIAS[code] || code}-USDT-SWAP`;
    const VAL_OKX = {};                        // code -> { now, prevClose }
    const okxGet = async (url, tries) => {
      for (let i = 0; i <= (tries || 2); i++) {
        const r = await fetch(url);
        if (r.status === 429) { await new Promise((s) => setTimeout(s, 350 * (i + 1))); continue; }
        return r.json();
      }
      return null;
    };
    /* 拉持仓股/ETF 的 OKX永续现价 + 昨收（分批 4 个，避免 429）。
       昨收取「日期早于今天」的最后一根日线：当天那根会随行情实时变动，
       取倒数第二根会得到 ≈0% 的假涨跌。
       `opt.nowOnly`：**只要现价、不拉日线**（省一半请求）。基金成分股估值只需要现价 ——
       涨跌基准是 Alpaca 净值日收盘，不需要 OKX 昨收；成分股有 20+ 个，
       每个多一次 candles 请求很容易撞 OKX 的 20 次/2秒 限流。 */
    async function loadOkxTradeQuotes(codes, opt) {
      const list = [...new Set((codes || []).filter(Boolean).map((c) => String(c).toUpperCase()))];
      if (!list.length) return;
      const needPrev = !(opt && opt.nowOnly);
      const instMap = new Map();               // instId -> 原始代码[]
      list.forEach((c) => {
        const inst = okxInst(c);
        if (!instMap.has(inst)) instMap.set(inst, []);
        instMap.get(inst).push(c);
      });
      const todayUtc = new Date().toISOString().slice(0, 10);
      const batches = chunk([...instMap.keys()], 4);
      for (const batch of batches) {
        await Promise.all(batch.map(async (inst) => {
          try {
            const tj = await okxGet(`${OKX_API_BASE}/market/ticker?instId=${inst}`);
            const now = (tj && tj.data && tj.data[0]) ? +tj.data[0].last : null;
            let prevClose = null;
            if (needPrev) {
              const j = await okxGet(`${OKX_API_BASE}/market/candles?instId=${inst}&bar=1Dutc&limit=6`);
              const rows = ((j && j.data) || []).map((x) => ({
                d: new Date(+x[0]).toISOString().slice(0, 10), close: +x[4],
              })).sort((a, b) => (a.d < b.d ? -1 : 1));
              for (const r of rows) if (r.d < todayUtc) prevClose = r.close;
            }
            if (now == null && prevClose == null) return;
            (instMap.get(inst) || []).forEach((c) => {
              VAL_OKX[c] = VAL_OKX[c] || {};
              if (now != null) VAL_OKX[c].now = now;
              if (prevClose != null) VAL_OKX[c].prevClose = prevClose;
            });
          } catch (e) { /* 单个失败就回落腾讯 / 账户价 */ }
        }));
      }
    }

    /* 腾讯只挂**一个**上市代码，且 A/C 两类股是两个独立代码（不像 OKX 永续那样合并）。
       探测到的后缀按代码缓存起来，避免每轮都试3 次。
       ⚠️ 缓存在 **localStorage** 里跨刷新存活（后缀是稳定的静态事实，没必要每次重新探测）。
          这不是为了省请求好看，而是**防触发腾讯 WAF**：一次探测最坏打 3 个请求，
          20+ 成分股 × 3 = 60+ 请求，一次页面加载就可能把本机 IP 打进限流，
          之后 fqkline 持续返回 **501 + 无 CORS 头**（实测被限流后连冷��� 30s+ 都不恢复）。
          限流一旦触发，整条美股估值链又会退化成 QQQ 兜底 —— 症状和 WAF 拦截一模一样，
          但根因完全不同，别混淆。 */
    const US_SUFFIXES = ['.OQ', '.N', '.A'];   // 纳斯达克 / 纽交所 / 美国交易所
    const TX_US_CACHE_KEY = 'futu_tx_us_suffix_v1';
    let txUsCache = {};
    try { txUsCache = JSON.parse(localStorage.getItem(TX_US_CACHE_KEY) || '{}') || {}; }
    catch (e) { txUsCache = {}; }
    const txUsCacheSave = () => {
      try { localStorage.setItem(TX_US_CACHE_KEY, JSON.stringify(txUsCache)); } catch (e) { /* 隐私模式等 */ }
    };
    /* ⚠️ 必须是无 www 的 ifzq.gtimg.cn —— web. 那个域名的 fqkline 被腾讯 WAF 拦（501 + 无 CORS 头），
       后果是整条美股估值链断掉：txGetUsDay 返回 null → VAL.txUs 全空 → 每只基金的成分股
       全部退化成 QQQ 兜底，持仓页基金涨跌「一动不动」。详见 TX_FQ_BASE 上方的说明。 */
    const TX_US_BASE = 'https://ifzq.gtimg.cn/appstock/app/fqkline/get';
    /* 腾讯返回的日线里，最后一根早于这个日期就说明是脏数据（见 probeTxUs 注释） */
    const TX_US_MIN_DATE = '2026-01-01';
    /* 超时**reject**（不是 resolve undefined）：探测代码的后缀时要靠异常跳到下一个候选 */
    const withTimeout = (p, ms) => Promise.race([
      p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms || 8000)),
    ]);

    /* 探测失败是否**值得重试**。
       区分两种失败（2026-10-04 踩过，症状相同但处理相反）：
         - 501 / WAF 拦截页：本机被限流，**继续试其他后缀纯属浪费**（还加重限流）→ 放弃。
         - 后缀猜错（code≠0 / rows 脏数据）：换后缀是对的。
       返回 true = 该代码本轮不再试（留到下一轮 refresh 再来）。 */
    let txWafBlocked = false;
    function markTxFailure(err) {
      const s = String((err && (err.status || err.message)) || '');
      if (/501|WAF|waf\.tencent/.test(s)) txWafBlocked = true;
    }
    const txResetWaf = () => { txWafBlocked = false; };
    const txIsWaf = () => txWafBlocked;

    /* 代码 -> 腾讯合约代码（usORCL.N）。未探测过时返回首个候选。 */
    function txUsInst(code) {
      const c = String(code || '').toUpperCase();
      return txUsCache[c] || ('us' + c + US_SUFFIXES[0]);
    }

    /* 探测一个代码在腾讯的交易所后缀。
       ⚠️ 不带后缀（`usAAPL`）虽然也返回 code=0，但会给**远古垃圾数据**——
          实测 AAPL 末根是 2026-10-02、往前第二根却是 2011-06-02；
          而 `usMU` 直接连接被重置。所以必须带后缀，且要校验末根日期是最近的。 */
    async function probeTxUs(code) {
      const c = String(code || '').toUpperCase();
      if (txUsCache[c]) return txUsCache[c];
      if (txIsWaf()) return null;                  // 限流中，本轮不再打腾讯
      for (const sfx of US_SUFFIXES) {
        const key = 'us' + c + sfx;
        try {
          const j = await txGetUsDay(key, 4);
          const rows = j && j.rows;
          if (rows && rows.length >= 2 && String(rows[rows.length - 1][0]) >= TX_US_MIN_DATE) {
            txUsCache[c] = key;
            txUsCacheSave();
            return key;
          }
        } catch (e) {
          markTxFailure(e);
          if (txIsWaf()) return null;              // 被限流：别再试剩下两个后缀
        }
      }
      return null;                                // 三种后缀全失败 → 走 QQQ 兜底
    }
    /* 拉腾讯美股日线，返回 { key, rows }；rows = [[日期,开,收,高,低,量], ...]（升序）
       ⚠️ 非 2xx **抛异常并带上 status**：调用方靠它区分「限流 501」和「代码不存在」。
          早前这里一律 `r.ok ? r.json() : null`，把 501 吞成 null → 上层以为只是这个代码查不到，
          于是继续试另外两个后缀，白白再打两个请求加深限流。 */
    async function txGetUsDay(key, limit) {
      const u = `${TX_US_BASE}?param=${key},day,,,${limit || 320},qfq`;
      const j = await withTimeout(
        fetch(u).then((r) => {
          if (!r.ok) { const e = new Error('http ' + r.status); e.status = r.status; throw e; }
          return r.json();
        }), 8000);
      if (!j || j.code !== 0) return null;
      const node = (j.data || {})[key];
      if (!node) return null;
      const rows = node.day || node.qfqday || null;
      if (!rows || !rows.length) return null;
      return { key, rows, qt: (node.qt || {})[key] || null };
    }

    function symbolChg(code, mkt, baseDate) {
      const bd = String(baseDate || '').replace(/-/g, '');
      const pick = (arr) => {
        if (!arr || !arr.length || VAL.dqDirty.has(mkt + code)) return null;
        // 基准日必须存在（该市场那天有交易）；取不到就退到基准日之前最近的一条
        let bi = -1;
        for (let i = 0; i < arr.length; i++) if (arr[i].d <= bd) bi = i;
        if (bi < 0) bi = 0;
        const last = arr[arr.length - 1];
        if (last.d <= arr[bi].d) return 0;                  // 基准日之后没更新
        return last.c / arr[bi].c - 1;
      };
      if (mkt === 'us') {
        const k = code.toUpperCase();
        /* 腾讯 A/C 两类股是两个独立代码，直接按各自代码取即可（不再需要 GOOG→GOOGL 别名） */
        const q = VAL.txUs[k];                 // Alpaca：base = 净值日那天的收盘
        /* ⚠️ 现价 = **OKX 永续**，基准 = Alpaca 净值日收盘（用户 2026-10-04 定稿：
           「持仓里最新价格都用 okx 读，qqq 也是，成分股 nvda 之类也都用 okx，
             只是基准按照基金最新更新的时间那天的 alpaca 收盘价」）。
           OKX 永续 7×24 连续报价，**周末/休市也在动**，所以「一动不动」的问题从根上消失；
           Alpaca 只负责提供那个固定的基准价。
           取不到 OKX 时依次回落 Alpaca 现价 → OKX 昨收 → 文件日线（`qqqChgOn`）。 */
        const ok = VAL_OKX[k];
        const now = (ok && ok.now != null) ? ok.now : (q ? q.now : null);
        if (q && q.base != null && now != null && q.base > 0) return now / q.base - 1;
        if (ok && ok.now != null && ok.prevClose > 0) return ok.now / ok.prevClose - 1;
        if (/^QQQ$/i.test(code)) return qqqChgOn(baseDate);   // 最后兜底：静态文件日线
        return null;
      }
      return pick(VAL.dq[mkt + code]);                      // jp285A / kr000660 / hk02513 / sz300408
    }

    /* 拉美股行情 —— 数据源：**腾讯 gtimg**（用户 2026-10-04 定稿，替换原OKX 永续）。
       两个用途：
         ① 基金估值：基准 = 基金净值日（baseDate）那天的美东收盘，最新 = 现价；
         ② 证券现价：Alpaca 限流/不可达时用腾讯现价补上（TQQQ 也要，它不在 funds.items 里）。
       `baseDate` 为空时只取现价（不找基准），供 ② 使用。
       腾讯一次 `fqkline` 就同时给到「日线序列 + qt 快照（现价/昨收/涨跌幅）」，
       所以基准、昨收、现价三个数都能从**同一个响应**里取，不用分多次请求。
       ⚠️ 限流：一次 Promise.all 打 20+ 并发会被腾讯返 429，这里分批 4 个。 */
    const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

    /* ---- 基金成分股行情：**优先 Alpaca，腾讯兜底**（2026-10-04 改）----
       为什么换主源：腾讯 fqkline 的 WAF 会**按 IP 限流**，实测一次页面加载（20+ 成分股 ×
       3 个候选后缀探测）就能把本机打进去，之后持续 501 且**响应不带 CORS 头** ——
       浏览器只报「CORS policy」错误，看不出是限流，排查时极易误判成「域名没 CORS」。
       而 Alpaca `/v2/stocks/bars` 是账户本来就在用的源，CORS 稳定、一次请求给全市场
       所需日线（既能取现价也能取净值基准日那天的收盘），限流阈值也宽得多。
       结果：估值不再因为腾讯抽风而整体退化成 QQQ 兜底 —— 那正是「基金盈亏一动不动」的成因。
       Alpaca 拉不到（非成分股/未授权/网络不通）时，仍由下面的腾讯路径兜底，再不行才用 QQQ。 */
    /* 一批 bars → 写进 VAL.txUs（now = 最新收盘 / prevClose = 前一根 / base = 净值日那根） */
    function applyAlpacaBars(code, v, baseDate) {
      const bars = (v || []).slice().sort((a, b) => String(a.t) < String(b.t) ? -1 : 1);
      if (!bars.length) return false;
      const rec = VAL.txUs[code] = VAL.txUs[code] || {};
      rec.now = bars[bars.length - 1].c;
      if (bars.length >= 2) rec.prevClose = bars[bars.length - 2].c;
      /* 基准 = 净值日那天的收盘；取不到就退到该日之前最近的一条（那天休市）。 */
      let bi = -1;
      const bd = String(baseDate || '').slice(0, 10);
      if (bd) for (let i = 0; i < bars.length; i++) if (String(bars[i].t).slice(0, 10) <= bd) bi = i;
      if (bi >= 0) rec.base = bars[bi].c;
      rec.alpaca = true;
      return true;
    }

    /* ⚠️⚠️ Alpaca 多标的 bars 是**分页**的，不是「随机丢符号」（2026-10-04 查明）：
       `GET /v2/stocks/bars?symbols=<20个>` 只返回**按字母序的前 9~10 个**，
       响应里带 `next_page_token`，必须跟着它翻页才能拿到剩下的（实测 20 个 → 3 页：9+9+2）。
       **看起来像随机丢**只是因为不同 symbols 集合的首批字母不同 —— 我先前据此误判成
       「随机丢符号」，改用「缺哪个就单标的补拉」，结果每轮多打 10 次请求、串行带 120ms 间隔，
       把 Alpaca 调用拖长，撞上 `accAlpacaQuotes` 的 9s 全批超时 → **证券现价整批消失**
       （用户报的「账户里证券的现价都出不来了」）。
       ⚠️ **不是被限流**：实测每轮 `X-Ratelimit-Remaining: 199`（上限 200/分钟），
       请求量远低于阈值。**别再用补拉的方式绕分页**。
       本函数：自动翻页合并，`key` 是响应里的数据字段名（bars / snapshots）。 */
    async function alpacaPaged(urlBase, key, maxPages, budgetMs) {
      const out = {};
      let token = null;
      /* ⚠️ 整批翻页的**总预算**（默认 8s）。原来每页各自重试 2 次、每次 accJson 兜 8s，
         3 页最坏能磨十几秒，而这整批是 `await` 在渲染前面的 —— 用户 2026-10-05 报
         「账户里基金现金都秒出，证券非常慢甚至出不来」，成因就在这里。
         超预算就带**已取到的部分**返回，缺的由 computeRow 按「腾讯 → IBKR 快照 markPrice」补。 */
      const budget = budgetMs || 8000;
      const t0 = Date.now();
      for (let i = 0; i < (maxPages || 5); i++) {
        if (Date.now() - t0 > budget) {
          console.warn('[alpaca] 翻页超预算 %dms，保留已取到的 %d 个代码', Date.now() - t0, Object.keys(out).length);
          break;
        }
        const url = urlBase + (token ? '&page_token=' + encodeURIComponent(token) : '');
        /* 每页重试 1 次：`accJson` 内部 8s 超时返回 null，某一页超时若直接 break，
           **整批数据就都没了**（实测偶发，表现是所有成分股突然退化成 QQQ 兜底）。
           重试仍失败就保留已取到的部分，不清空。 */
        let d = null;
        for (let a = 0; a < 2 && !d; a++) {
          d = await accJson(url, { headers: ACC_HDR });
          if (!d) await new Promise((s) => setTimeout(s, 400));
        }
        if (!d) { console.warn('[alpaca] 第 %d 页拉取失败，保留已取到的 %d 个代码', i + 1, Object.keys(out).length); break; }
        const part = d[key];
        if (part && typeof part === 'object') Object.assign(out, part);
        token = d.next_page_token || null;
        if (!token) break;                                   // 没有下一页 → 收齐了
      }
      return out;
    }

    /* 基金估值需要的**全部美股代码**（含 QQQ）。
       嘉实纳斯达克100（016532/016533）的成分只有 QQQ 一个，所以 QQQ 绝不能排除。 */
    function usComponentCodes() {
      const s = new Set();
      funds.forEach((f) => (f.items || []).forEach((it) => {
        if (it.m === 'us') s.add(String(it.c).toUpperCase());
      }));
      return [...s];
    }

    async function loadUsQuotesAlpaca(baseDate) {
      /* Alpaca 只负责**基准价**（净值日那天的收盘）；现价由 OKX 提供。
         这里仍然把 Alpaca 的 now/prevClose 也存下来，作为 OKX 拉不到时的回落。 */
      const list = usComponentCodes();
      if (!list.length) return;
      /* 基准日可能远在 40 天前（QDII 净值滞后），start 要留足回溯窗口。 */
      const start = baseDate || etDate(12);
      /* 一次批量 + 跟着 next_page_token 翻页（20 个代码 = 3 次请求），比「逐个补拉」少 8 次。 */
      try {
        const bars = await alpacaPaged(
          `${ACC_API}/v2/stocks/bars?symbols=${list.join(',')}&timeframe=1Day&start=${start}&limit=90`, 'bars', 5);
        Object.entries(bars).forEach(([k, v]) => applyAlpacaBars(String(k).toUpperCase(), v, baseDate));
      } catch (e) { console.warn('[alpaca] 成分股基准拉取失败', e); }
    }

    async function loadUsQuotes(baseDate, extraCodes) {
      const codes = new Set();
      funds.forEach((f) => (f.items || []).forEach((it) => { if (it.m === 'us' && !/^QQQ$/i.test(it.c)) codes.add(it.c.toUpperCase()); }));
      (extraCodes || []).forEach((c) => codes.add(String(c). toUpperCase()));
      if (!codes.size) return;
      txResetWaf();          // 每轮重新尝试：限流是暂时的，不能永久放弃腾讯
      const list = [...codes];
      /* 批次大小 4 → **3**，且批间加 150ms 间隔。
         腾讯 WAF 对突发请求很敏感：并发 4 × 无间隔实测能把本机 IP 打进限流，
         之后 fqkline 持续 501（且 501 响应没有 CORS 头 → 浏览器报 CORS 错误，
         很容易被误判成「域名没 CORS」而走错方向）。
         后缀缓存已落localStorage，第二轮起probeTxUs 不再发探测请求，量降一半以上。 */
      const batches = chunk(list, 3);
      for (const batch of batches) {
        if (txIsWaf()) break;                      // 已限流：剩余代码留到下一轮
        await Promise.all(batch.map(async (code) => {
          try {
            /* Alpaca 已经给出**完整**数据（now + base）的代码就跳过：
               腾讯既慢又容易撞 WAF，没必要为已有数据再打一轮请求。
               判定：baseDate 为空时只要 now；否则 now 和 base 都得齐。 */
            const pre = VAL.txUs[code];
            if (pre && pre.now != null && (!baseDate || pre.base != null)) return;
            const key = await probeTxUs(code);
            if (!key) return;
            /* 基准日可能远在 40 天前（QDII 净值滞后），要多拉一些日线才够回溯。
               baseDate 为空时只要 6 根就够（现价 + 昨收）。 */
            const d = await txGetUsDay(key, baseDate ? 90 : 6);
            if (!d) return;
            const rows = d.rows;
            const rec = VAL.txUs[code] = VAL.txUs[code] || {};
            /* 现价优先用 qt 快照（腾讯给的是最新成交价，含盘中），
               拿不到就退回日线末根收盘。 */
            const snapLast = d.qt && d.qt.length > 3 ? parseFloat(d.qt[3]) : NaN;
            rec.now = Number.isFinite(snapLast) && snapLast > 0 ? snapLast : parseFloat(rows[rows.length - 1][2]);
            /* 昨收：qt[4] 是腾讯给的昨收；没有就取「日期早于末根那根」的收盘
               —— 末根是当天未完结的K 线，不能拿它当昨收。 */
            const snapPrev = d.qt && d.qt.length > 4 ? parseFloat(d.qt[4]) : NaN;
            if (Number.isFinite(snapPrev) && snapPrev > 0) rec.prevClose = snapPrev;
            else if (rows.length >= 2) rec.prevClose = parseFloat(rows[rows.length - 2][2]);
            /* 基准 = baseDate 那天的收盘（QDII 按美东交易日计，腾讯日线日期就是美东日）。
               取不到就退到该日之前最近的一条（那天休市的情况）。 */
            if (baseDate) {
              let bi = -1;
              for (let i = 0; i < rows.length; i++) if (String(rows[i][0]) <= baseDate) bi = i;
              if (bi >= 0) rec.base = parseFloat(rows[bi][2]);
            }
          } catch (e) { markTxFailure(e); }        // 单个失败就走 QQQ 兜底 / 快照兜底
        }));
        await new Promise((r) => setTimeout(r, 150));   // 批间限速，别把 WAF 打出限流
      }
    }

    /* 逐只基金算估值：返回 { navEst, chg, parts }，chg 为小数。 */
    /* 逐只基金算估值：返回 { chg（人民币口径，小数）, fxChg（纯汇率贡献）, parts }。 */
    function estimateFund(f, baseDate) {
      const items = f.items || [];
      const alloc = f.alloc || {};
      const stockW = alloc.stock || 0;
      const bondW = alloc.bond || 0;                       // 债券：无利息 → 原币价值不变
      const cashW = alloc.cash || 0;                       // 现金：同上
      /* 未披露股票仓位（季报只列前十大重仓，剩下那部分按 QQQ 推算）用的 QQQ 涨幅。
         ⚠️ 必须走 `symbolChg('QQQ','us',…)`（**实时 OKX 现价 / Alpaca 净值日基准**），
            不能直接用 `qqqChgOn()` —— 后者读的是 `fund_holdings.json` 的静态日线文件，
            一天才更新一次。两者混用会让「持有 QQQ 的基金」和「按 QQQ 推算的残余仓位」
            用了两个不同的 QQQ 涨跌（实测同一天 1.83% vs 1.58%）。
            `symbolChg` 内部拉不到 OKX 时会自动回退到 `qqqChgOn`，不会开天窗。 */
      const qc = symbolChg('QQQ', 'us', baseDate);
      // 汇率层：FX_IN_VAL=false（用户定稿）时恒 0 → 人民币口径涨跌 == 本币涨跌
      const fxUsd = FX_IN_VAL ? fxChgOn('USD', baseDate) : 0;
      const fxUsdV = fxUsd == null ? 0 : fxUsd;            // 序列缺失 → 汇率层整体作废（=0）
      /* 本币涨跌 → 人民币口径：两个涨幅相乘（-1 后才可分权重相加）。
         该货币没有汇率数据时退回美元，宁可用错币种也不要把这一层吞掉。 */
      const toCny = (chg, cur) => {
        if (!FX_IN_VAL) return chg;                        // 开关关闭 → 人民币口径 == 本币涨跌
        const fx = fxChgOn(cur, baseDate);
        return (1 + chg) * (1 + (fx == null ? fxUsdV : fx)) - 1;
      };
      let acc = 0, wsum = 0, fxAcc = 0;
      const parts = [];
      items.forEach((it) => {
        let c = symbolChg(it.c, it.m, baseDate);
        let viaQqq = false;
        if (c == null) { c = qc == null ? 0 : qc; viaQqq = true; }   // 未知 → QQQ
        if (c == null) return;
        const cur = CUR_OF[it.m] || 'USD';
        const fx = FX_IN_VAL ? fxChgOn(cur, baseDate) : 0;
        const fxv = fx == null ? fxUsdV : fx;
        const cn = toCny(c, cur);
        const w = (it.p || 0) / 100;
        acc += w * cn;
        fxAcc += w * fxv;                                 // 纯汇率贡献（拆开给用户看）
        wsum += it.p || 0;
        parts.push({ code: it.c, m: it.m, w: it.p, chg: c, cnyChg: cn, fxChg: fxv, cur, viaQqq });
      });
      // 未披露的股票仓位（stockW − 已列权重）同样按 QQQ 推算，并叠加美元汇率
      const residual = Math.max(0, stockW - wsum);
      if (residual > 0.01 && qc != null) {
        acc += residual / 100 * ((1 + qc) * (1 + fxUsdV) - 1);
        fxAcc += residual / 100 * fxUsdV;
      }
      /* 债券 + 现金：不计利息（原币价值不变），但 QDII 持的是外币，汇兑损益照算 ——
         美元涨 1% 时这部分也有 1% 的人民币收益。**未归类**的仓位（季报 alloc 三项加起来
         不足 100% 的差额）既不知道币种也不知涨跌，保守记为 0。 */
      const idleW = Math.max(0, bondW + cashW);
      if (idleW > 0.01) { acc += idleW / 100 * fxUsdV; fxAcc += idleW / 100 * fxUsdV; }
      const chg = acc;
      return { chg, fxChg: fxAcc, parts, bondW, cashW, idleW, residual, qqq: qc, fxUsd: fxUsdV,
               navEst: f.navL != null ? f.navL * (1 + chg) : null };
    }

    /* ---- 基金：份额 × 最新净值（pingzhongdata，失败回退 fund_holdings.json） ---- */
    const funds = (seed.pa_funds || []).map((f) => {
      const t = (f.trades && f.trades[0]) || {};
      return { code: f.code, name: f.name, shares: t.shares || 0, cost: t.price || 0, navL: null, navP: null,
               trades: f.trades || [],                       // 历史·订单用（可能不止一笔）
               hist: (fundH && fundH[f.code] && Array.isArray(fundH[f.code].nav)) ? fundH[f.code].nav : null,
               // 推算用：季报持仓（items）+ 仓位配置（alloc）
               items: (fundH && fundH[f.code] && fundH[f.code].items) || [],
               alloc: (fundH && fundH[f.code] && fundH[f.code].alloc) || null };
    });
    /* ⚠️ TQQQ 全区间日线（总资产曲线要用）**提前起**，不排在后面 await：
       它只是一条 Alpaca 请求，但国内慢网实测能拖十几秒；排在基金那批后面就变成
       「6s 预算 + 4s 预算」串行叠加，整页白等十几秒。提前起 → 跟基金那条并行跑，
       下面那次 race 只是「万一还没回来」的兜底。 */
    /* TQQQ 全区间日线：**只发不收**是原来漏 TQQQ 的第二层原因 ——
       它属于最慢梯队（可能要十几秒），到货时环形图早就画完了。
       这里接上：日线一落地就重建环形图（TQQQ 现价的首选来源就是它，
       比等 Alpaca 正股那一梯队更早到），顺带刷新走势图末点。 */
    const pTqqq = accTqqqDaily().then(() => {
      if (typeof rebuildAoDist === 'function') rebuildAoDist();
      if (typeof refreshAoTail === 'function') refreshAoTail();
    }).catch(() => {});
    /* 6 只基金的 pingzhongdata 并行拉取 —— 原来串行时每只不可达要等 8s 超时，
       6×8=48s，导致「总资产」要半分钟才出数（基金/现金反而是齐的）。
       并行后总耗时 = 最慢的那一只。 */
    await Promise.all(funds.map(async (f) => {
      const [l, p, d] = await accFundNav(f.code);
      if (l != null) { f.navL = l; f.navP = p; f.navDate = d; }
      else if (fundH && fundH[f.code] && Array.isArray(fundH[f.code].nav) && fundH[f.code].nav.length >= 2) {
        const nav = fundH[f.code].nav;
        f.navL = nav[nav.length - 1][1];
        f.navP = nav[nav.length - 2][1];
        f.navDate = navDate(nav[nav.length - 1][0]);      // 回退数据源同样带日期
      }
    }));
    /* 拉美股行情后逐只算估值（基准日 = 各基金自己的 navDate，即最新净值日）。
       账户持仓的股票现价也靠这批数据补（Alpaca 不可达时），但 holdings 在下方才声明，
       所以这里只拉基金重仓的代码，持仓代码在 holdings 建好后再补拉一次。
       汇率序列跟行情**并行**拉 —— 两条链路互不依赖，串着跑会白白多等一个 RTT。
       区间起点往前多留 10 天缓冲：基金净值日可能比今天早好几天（QDII 滞后 1~3 天）。 */
    {
      const usBase = funds.find((f) => f.navDate) ? funds.find((f) => f.navDate).navDate : null;
      const back = new Date(Date.now() - 40 * 86400e3).toISOString().slice(0, 10);
      /* ⚠️ 上面这台 Promise.all 里 **Alpaca 是最慢的一路**（国内慢网实测 8~16s 甚至直接挂住），
         而它是整个账户页的必经 `await` —— Alpaca 一挂，页面三块（基金/现金/证券）会一起空等
         20s+（用户报的「账户里基金现金都很快，证券非常慢甚至出不来」，慢网时连基金也一起卡）。
         给这一批 **6s 预算**：到点还没拿到就**先按「官方净值 + QQQ 兜底」把账户页画出来**
         （基金表本身只看官方净值，不受影响），慢的两路（Alpaca 基准 / 腾讯基准）在后台继续跑，
         到手再补一次估值 + 汇总。页面从此「先出数 → 再升级」，不再被单个源按住。 */
      const compo = usComponentCodes();
      const baseReady = () => !compo.length || compo.some((c) => {
        const r = VAL.txUs[c]; return r && r.base != null;
      });
      const pBase = loadUsQuotesAlpaca(usBase);        // Alpaca：只取净值日那天的**基准收盘**
      await Promise.race([
        Promise.all([
          pBase,
          loadOkxTradeQuotes(compo, { nowOnly: true }),   // OKX：全部美股成分的**实时价**
          loadUsQuotes(usBase),                           // 腾讯基准（慢，可能被预算截断）
          FX_IN_VAL ? loadFxSeries(back) : Promise.resolve(),
        ]),
        new Promise((r) => setTimeout(r, 6000)),
      ]);
      if (!baseReady()) {
        /* 慢网兜底：先出数；这几路谁跑完谁补一次估值（见 estimateAllFunds 的注释）。 */
        Promise.resolve(Promise.all([
          pBase,
          loadOkxTradeQuotes(compo, { nowOnly: true }),
          loadUsQuotes(usBase),
          FX_IN_VAL ? loadFxSeries(back) : Promise.resolve(),
        ])).then(() => { if (baseReady()) { estimateAllFunds(); paintFundSummary(); } }).catch(() => {});
      }
    }
    /* 逐只基金算估值并累加汇总（fundAmount / fundYesterday / fundCum）。
       ⚠️ 抽成函数是因为慢网时被 6s 预算截断过一次，Alpaca 基准到手后要**补算一遍**
          （否则基金估值永远停在 QQQ 兜底上）。 */
    let fundAmount = 0, fundYesterday = 0, fundCum = 0;
    function estimateAllFunds() {
      fundAmount = 0; fundYesterday = 0; fundCum = 0;
      funds.forEach((f) => {
      f.amount = f.shares * (f.navL || 0);
      f.yest = f.navP != null ? f.shares * (f.navL - f.navP) : null;
      f.cum = f.cost ? f.shares * (f.navL - f.cost) : null;
      // 涨跌比例（与「昨日收益」「持仓收益」两列配套）：
      //   昨日涨跌 = (最新净值 − 前一日净值) ÷ 前一日净值
      //   持仓涨跌 = (最新净值 − 成本) ÷ 成本
      f.yestPct = f.navP ? (f.navL - f.navP) / f.navP : null;
      f.cumPct = f.cost ? (f.navL - f.cost) / f.cost : null;
      // 实时估值：官方净值停更期间用季报持仓加权推算（详见 VAL 模块注释）
      if (f.items && f.items.length && f.navDate) {
        const est = estimateFund(f, f.navDate);
        f.estChg = est.chg;
        f.estNav = est.navEst;
        f.estAmount = est.navEst != null ? f.shares * est.navEst : null;
        f.estDelta = f.estAmount != null ? f.estAmount - f.amount : null;   // 相对官方净值的增量
        f.estParts = est.parts;
        f.estFxChg = est.fxChg;                                      // 其中纯汇率贡献
        f.estFxUsd = est.fxUsd;                                      // 本基金基准日 → 今天的美元汇率涨跌
        f.estBondW = est.bondW; f.estCashW = est.cashW; f.estResidual = est.residual;
      }
      fundAmount += f.amount;
      if (f.yest != null) fundYesterday += f.yest;
      if (f.cum != null) fundCum += f.cum;
    });
    }
    estimateAllFunds();
    const fundTbody = $id('fundTbody');
    if (fundTbody) {
      // 排序键挂到行对象上：funds 已带 name/code/amount/shares/yest/cum
      funds.forEach((f) => { f.cur = 'CNY'; });
      ACC_RENDERERS.fund = () => {
        fundTbody.innerHTML = accSorted('fund', funds).map((f) =>
          `<tr><td class="td-name"><div class="td-clamp">${f.name}</div></td>` +
          // 净值日期**每只基金各写各的**（QDII 滞后天数不同，统一取最旧那个会掩盖差异）。
          // ⚠️ 顺序必须与 thead 的 `data-sort-table="fund"` 一致：名称 | 净值 | ISIN | 金额 …
          `<td class="num td-navdate">${f.navDate ? String(f.navDate).slice(5) : '--'}</td>` +
          `<td class="num">${f.code}</td>` +
          `<td class="num">${f2(f.amount)}</td><td class="num">${f.shares.toFixed(2)}</td>` +
          `<td class="num ${f.yest > 0 ? 'up' : f.yest < 0 ? 'down' : ''}">${f2(f.yest, true)}</td>` +
          `<td class="num ${f.yestPct > 0 ? 'up' : f.yestPct < 0 ? 'down' : ''}">${pctS(f.yestPct)}</td>` +
          `<td class="num ${f.cum > 0 ? 'up' : f.cum < 0 ? 'down' : ''}">${f2(f.cum, true)}</td>` +
          `<td class="num ${f.cumPct > 0 ? 'up' : f.cumPct < 0 ? 'down' : ''}">${pctS(f.cumPct)}</td>` +
          `<td>${f.cur}</td></tr>`
        ).join('');
      };
      accRender('fund');
    }
    /* 基金侧栏/汇总那几行（抽成函数：慢网兜底补算估值后要跟着重写一次） */
    function paintFundSummary() {
      setTxt('fundMYest', f2(fundYesterday, true), fundYesterday);
      setTxt('fundMCum', f2(fundCum, true), fundCum);
      /* 净值更新日期不再集中显示（用户 2026-10-04：上方汇总行删除，改为**表格里每只基金各写一列**，
         QDII 各基金滞后天数不同，集中取「最旧」那个会掩盖差异）。见 fund 渲染器里的 td-navdate。 */
      setTxt('accFundVal', f2(fundAmount));
      setTxt('accFundNote', f2(fundYesterday, true), fundYesterday);
      // 昨日涨跌幅 = 昨日收益 ÷ 昨日市值（今日市值 − 昨日收益）
      const fundYestBase = fundAmount - fundYesterday;
      setTxt('accFundNotePct', fundYestBase ? pctS(fundYesterday / fundYestBase) : '--', fundYesterday);
      setTxt('accFundCum', f2(fundCum, true), fundCum);
      // 累计涨跌幅 = 累计收益 ÷ 成本（今日市值 − 累计收益）
      const fundCumBase = fundAmount - fundCum;
      setTxt('accFundCumPct', fundCumBase > 0 ? pctS(fundCum / fundCumBase) : '--', fundCum);
      // 注：汇总行不再放比例（用户要求比例只出现在**表格列**里 → 昨日涨跌 / 持仓涨跌），
      // 侧栏那两处 accFundNotePct / accFundCumPct 保留。
    }
    paintFundSummary();

    /* ---- 历史·订单（仅 seed.pa_funds 申购记录）
       注：TQQQ 属于证券持仓，已在证券页「历史·成交」中列示，这里不再重复。 */
    const fundOrders = [];
    funds.forEach((f) => (f.trades || []).forEach((t) => {
      const shares = t.shares || 0, price = t.price || 0;
      const isSell = /sell|redeem|out/i.test(t.type || '');
      fundOrders.push({
        type: isSell ? '卖出' : '买入', name: f.name, code: f.code,
        amount: shares * price, shares, cur: 'CNY',
        date: t.date, source: '手动', detail: f.code,
        _sortSide: isSell ? 1 : 0,
      });
    }));
    const fundHistBody = $id('fundHistBody');
    if (fundHistBody) {
      ACC_RENDERERS.fundH = () => {
        /* ⚠️ 列序必须与 index.html 里基金历史表的 `<thead>` 一致（项目名称 → 交易类型 → 金额/份额 …），
           表头与 tbody 错位不会报错，只会整列显示成 `--`（记忆里的老坑）。 */
        fundHistBody.innerHTML = accSorted('fundH', fundOrders).map((r) =>
          `<tr><td>${r.name}</td>` +
          `<td>${r.type} <span class="td-code">已完成</span></td>` +
          `<td class="num">${f2(r.amount)} / ${r.shares}</td>` +
          `<td>${r.cur}</td><td class="num">${r.date}</td><td>${r.source}</td><td>${r.detail}</td></tr>`
        ).join('');
      };
      accRender('fundH');
      setTxt('fundHistCount', fundOrders.length, 1);
    }

    /* ---- 现金：pa_cash 各账户余额汇总（盈透证券余额已含在 IBKR 净值里，剔除防重复计算） ---- */
    const cashRows = (seed.pa_cash || [])
      .filter((c) => !/盈透|IBKR/i.test(c.note || ''))
      .map((c) => {
      const bal = (c.transactions || []).reduce((s, t) => s + t.amount * (t.type === 'in' ? 1 : -1), 0);
      const cur = (c.currency || '').toUpperCase();
      return { note: c.note || c.currency, cur, bal, cny: cur === 'USD' ? bal * FX : bal };
    });
    const cashCny = cashRows.reduce((s, r) => s + r.cny, 0);
    const cashTbody = $id('cashTbody');
    if (cashTbody) {
      ACC_RENDERERS.cash = () => {
        /* ⚠️ td 个数必须与 thead 的 10 列**严格一致**（名称/ISIN/市值/持有面值/参考中间价/
           持仓成本/应计利息/已获利息/持仓收益/币种），否则整行错位 —— 之前多写了一个 `--`，
           把「币种」顶到第 11 列，页面上「币种」表头下面全是 `--`（用户 2026-10-04 发现）。 */
        cashTbody.innerHTML = accSorted('cash', cashRows).map((r) =>
          `<tr><td class="td-name"><div class="td-clamp">${r.note}</div></td><td class="num">--</td>` +
          `<td class="num">${f2(r.cny)}</td><td class="num">${f2(r.bal)}</td>` +
          `<td class="num">--</td><td class="num">--</td><td class="num">--</td><td class="num">--</td>` +
          `<td class="num">--</td><td>${r.cur}</td></tr>`
        ).join('');
      };
      accRender('cash');
    }
    setTxt('accCashVal', f2(cashCny));

    /* ---- 历史·成交订单（forexTrades 换汇 + 各现金账户出入金） ---- */
    const cashOrders = [];
    (asset.forexTrades || []).forEach((t) => {
      const isSell = /^SELL/i.test(t.buySell || '');
      cashOrders.push({
        name: '美元/离岸人民币 换汇', side: isSell ? '卖出' : '买入',
        date: t.date, face: t.usd, price: t.rate, interest: null,
        amount: t.cnh, cur: 'CNH', _sortSide: isSell ? 1 : 0,
      });
    });
    (seed.pa_cash || []).forEach((c) => (c.transactions || []).forEach((t) => {
      const cur = (c.currency || '').toUpperCase();
      const isOut = t.type === 'out';
      cashOrders.push({
        name: c.note || cur, side: isOut ? '取出' : '存入',
        date: t.date, face: t.amount, price: null, interest: null,
        amount: t.amount, cur,                       // 成交金额按账户原币展示，与「币种」列一致
        _sortSide: isOut ? 1 : 0,
      });
    }));
    const cashHistBody = $id('cashHistBody');
    if (cashHistBody) {
      ACC_RENDERERS.cashH = () => {
        cashHistBody.innerHTML = accSorted('cashH', cashOrders).map((r) =>
          `<tr><td>${r.name}</td>` +
          `<td class="${r._sortSide ? 'down' : 'up'}">${r.side}</td>` +
          `<td class="num">${r.date}</td>` +
          `<td class="num">${f2(r.face, true)}</td>` +
          `<td class="num">${r.price == null ? '--' : r.price.toFixed(4)}</td>` +
          `<td class="num">--</td>` +
          `<td class="num">${f2(r.amount)}</td>` +
          `<td>${r.cur}</td></tr>`
        ).join('');
      };
      accRender('cashH');
    }

    /* ---- 证券：IBKR 持仓（正股 + 期权）+ TQQQ，Alpaca 实时价 ---- */
    const holdings = (asset.holdings || []).map((h) => {
      const flat = h.symbol.replace(/\s+/g, '');
      const isOpt = /\d{6}[CP]\d{8}$/.test(flat);
      let name = h.symbol.trim(), code = flat;
      if (isOpt) {
        const m = flat.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
        if (m) name = `${m[1]} ${m[2]} ${parseInt(m[4], 10) / 1000} ${m[3] === 'C' ? 'call' : 'put'}`;
      }
      /* ⚠️ `mark0`(IBKR 快照 markPrice) 与 `posVal0`(快照市值) **已不再参与任何取价/汇总** ——
         2026-10-05 用户要求「账户里只用 Alpaca 实时报价」「市值合计也不用保留 IBKR 快照兜底」。
         保留这两个字段只是为了映射完整、方便日后查 JSON；别再拿它们当兜底用。
         TQQQ 那行它们恒为 0（TQQQ 不在 IBKR 持仓里），这正是当初「ORCL 有价、TQQK 没价」
         那种不一致的根源。 */
      return { raw: h.symbol.trim(), occ: flat, opt: isOpt, name, code, pos: h.position, cost: h.costBasisPrice, mark0: h.markPrice, posVal0: h.positionValue };
    });
    const tqqq = (seed.pa_us && seed.pa_us[0]) || null;
    if (tqqq) holdings.push({ raw: tqqq.symbol, occ: tqqq.symbol, opt: false, name: tqqq.name, code: tqqq.symbol, pos: 0, cost: 0, mark0: 0, posVal0: 0, tqqqShares: (tqqq.trades && tqqq.trades[0] && tqqq.trades[0].shares) || 0, tqqqCost: (tqqq.trades && tqqq.trades[0] && tqqq.trades[0].price) || 0 });

    const stockSyms = holdings.filter((h) => !h.opt).map((h) => h.code);
    const optSyms = holdings.filter((h) => h.opt).map((h) => h.occ);
    /* ⚠️ 这里**不再** await 证券行情：Alpaca 分页 + 重试 + 弱网最坏能磨几十秒，
       而下面所有汇总/表格都排在这条 await 后面 —— 一慢就整页证券开天窗（用户 2026-10-05）。
       改成「先拿本地快照画一版 → 行情到手再原地升级」，见下方 paintStock。 */
    /* TQQQ 全区间日线：上面已经提前起了，这里只等一个短预算（提前起通常早就回来了），
       没回来就**先出数**（历史曲线暂时缺 TQQQ 那段），日线到手后整体重算一次。 */
    await Promise.race([pTqqq, new Promise((r) => setTimeout(r, 2500))]);
    if (!Object.keys(tqqqBars).length) {
      pTqqq.then(() => { if (Object.keys(tqqqBars).length) rebuildAoSeries(); });
    }

    /* IBKR 现金：优先用 cashDaily 里 IBKR 直接给的余额，
       别用「最近净值 − 持仓市值」推算 ——
       后者把两个不同日期的口径相减（lastNV 是净值日、holdings[].positionValue 是快照日），
       持仓一变就推出巨额负现金（实测 -39550 CNY 的证券净值就是这么来的）。
       cashDaily 缺失时才退回推算。 */
    const lastNV = asset.totalNetValueDaily && asset.totalNetValueDaily.length
      ? asset.totalNetValueDaily[asset.totalNetValueDaily.length - 1].value : 0;
    const filePosVal = (asset.holdings || []).reduce((s, h) => s + (h.positionValue || 0), 0);
    const cashDaily = asset.cashDaily || [];
    const cashFromDaily = cashDaily.length ? cashDaily[cashDaily.length - 1].value : null;
    const ibkrCash = (cashFromDaily != null && isFinite(cashFromDaily))
      ? cashFromDaily
      : lastNV - filePosVal;
    /* ⚠️ `cashDaily` 只是**现金余额**，不含 IBKR 的应计利息；
       `Asset_parsed.json` 的 `ibkrAccruedInterest`（当前 7.93 USD）才是账户权益的一部分。
       这正是「侧栏 vs 收益日历」差 53 CNY 的根源（用户 2026-10-05 指出）：
         日历用 `totalNetValueDaily`（含利息）→ 32,847.97
         侧栏用 (cashDaily + 持仓)   （不含利息）→ 32,840.04，差 7.93 USD。
       所以证券权益/现金总值一律用 `ibkrCashAll = ibkrCash + ibkrInterest`。 */
    const ibkrInterest = +asset.ibkrAccruedInterest || 0;
    const ibkrCashAll = ibkrCash + ibkrInterest;

    let rtPosVal = 0, todayPnlUsd = 0;
    const stockTbody = $id('stockTbody');
    const rows = [];
    /* 单只持仓 → 行数据。抽成函数是为了**定时刷新**：交易页原先只在 initAccountData
       跑一次，自选列表 15s 一刷、交易页却停在打开那一刻，同一只 ORCL 两个页面两个价
       （用户 2026-10-04 报「现价还是 142.41」）。刷新时用 Object.assign 原地更新，
       rows 的元素引用不变，ACC_RENDERERS.stock / TRADE_POS.stock 都能看到新值。 */
    const computeRow = (h, qq) => {
      let pAcct = null, prevClose = null, qty = 0, cost = 0, mult = 1, src = '';
      if (h.opt) {
        const o = (qq && qq.opt && qq.opt[h.occ]) || {};
        pAcct = o.price; prevClose = o.prevClose;
        qty = h.pos; cost = h.cost; mult = 100;
      } else if (h.tqqqShares != null) {
        const s = (qq && qq.stock && qq.stock[h.code]) || {};
        // ⚠️ 不用 tqqq.price（种子文件里的**快照价**，会长期陈旧）当现价：
        //    Alpaca → 腾讯 → 快照，三级兜底由下方统一处理。
        pAcct = s.price; prevClose = s.prevClose;
        qty = h.tqqqShares; cost = h.tqqqCost;
      } else {
        const s = (qq && qq.stock && qq.stock[h.code]) || {};
        pAcct = s.price; prevClose = s.prevClose;
        qty = h.pos; cost = h.cost;
      }
      /* ① 账户页现价 pAcct：**只认 Alpaca 实时报价**（QBOX 累积盒，由 accAlpacaQuotes 写入）。
         用户 2026-10-05：「账户里面的证券不要 IBKR 先写，因为 TQQQ IBKR 里根本没有，抓一个 ORCL 也没用。
         就用 Alpaca 实时报价，也不用腾讯 gtimg 兜底，Alpaca 挂了就挂了。」
         —— 原来那三级兜底（Alpaca → 腾讯 → IBKR 快照 markPrice）的问题正是**不一致**：
           `mark0` 只有真在 IBKR 持仓里的行有（ORCL 有，TQQQ 的 mark0 恒为 0），
           于是 Alpaca 一挂，同一张表里 ORCL 仍显示 142.30 看着"正常"、TQQQ 直接 `--`，
           看着像只有一只股票出问题。统一成「只有 Alpaca」后，全挂就整列 `--`，语义一致。
         ⚠️ 保留 prevClose 也只来自 Alpaca（今日盈亏/今日涨跌靠它），拿不到就一起空。
         ⚠️ 绝不能把 `seed.pa_us[0].price`（= 71.69，建仓当时的旧价）当兜底 ——
            那会算出「看着正常但完全错误」的数字（TQQQ 真实 81.01，市值差 3,585）。 */
      const k = String(h.code || '').toUpperCase();
      if (pAcct > 0) src = 'Alpaca';
      /* ② 持仓页现价 pTrade：**OKX 永续优先**（用户 2026-10-04 定稿：
         「持仓里面 orcl 和 tqqq 的现价应该用 okx 的」）。
         OKX 永续 7×24 连续报价，盘中/周末都在动，反映当下真实价格；
         账户页那个是 Alpaca 的账面收盘价（休市日停在上一收盘）。
         取不到时回落腾讯 → 账户价，保证持仓页不出现空行（这条链**没动**，
         用户这次只要求账户页只用 Alpaca）。 */
      const tx = VAL.txUs[k];
      const ok = VAL_OKX[k];
      const pTrade = (ok && ok.now) ? ok.now : ((tx && tx.now) ? tx.now : pAcct);
      const value = pAcct != null ? qty * pAcct * mult : null;          // 账户页市值（账面口径）
      const tradeValue = pTrade != null ? qty * pTrade * mult : null;   // 交易页市值（OKX 口径）
      const pnl = pAcct != null ? (pAcct - cost) * qty * mult : null;
      const pnlRatio = pAcct != null && cost ? (pAcct - cost) / cost : null;
      const todayPnl = pAcct != null && prevClose != null ? (pAcct - prevClose) * qty * mult : null;
      // 账户页「今日涨跌」= (账户现价 − 昨收) ÷ 昨收（与「今日盈亏」列配套）
      const todayPct = pAcct != null && prevClose ? (pAcct - prevClose) / prevClose : null;
      /* 交易页「较基准」：基准 = **账户页那个现价**（用户 2026-10-04：「涨跌幅就是和账户里的现价对比」）。
         即 (OKX 现价 − 账户现价) ÷ 账户现价，而不是对昨收。 */
      const tradeChgUsd = (pTrade != null && pAcct != null) ? (pTrade - pAcct) * qty * mult : null;
      const tradePct = (pTrade != null && pAcct) ? (pTrade - pAcct) / pAcct : null;
      const cny = (v) => v == null ? null : v * FX;
      return {
        h, price: pAcct, pTrade, pAcct, prevClose, qty, cost, mult, src,
        value, tradeValue, pnl, pnlRatio, todayPnl, todayPct,
        tradeChgUsd, tradePct,
        // 排序键 + 交易页要用：code/name/valueCny(账户市值) / pnlCny(累计) / tradeValueCny / tradeChgCny
        code: h.code, name: h.name,
        valueCny: cny(value), pnlCny: cny(pnl), todayCny: cny(todayPnl),
        tradeValueCny: cny(tradeValue), tradeChgCny: cny(tradeChgUsd),
      };
    };
    /* ---- 证券表「画一遍」抽成函数，一共画两遍：
           ① 先拿**本地快照价**（IBKR 每日 markPrice / positionValue）画 —— 不等任何网络，
              证券立刻就有数、不会空表；
           ② 行情（Alpaca / 腾讯 / OKX）到手后再 `paintStock(q)` **原地升级**。
         为什么必须两遍（用户 2026-10-05 报「账户里基金现金都很快，证券非常慢甚至出不来」）：
           Alpaca 那几路是**分页 + 重试**的（stocks/bars / 期权 snapshots / 期权 bars 三端点），
           任何一路慢下来都会把整块结算压住；同一时间基金（东财脚本 + 本地 nav）与
           现金（纯本地 JSON）早算完了，看上去就只剩证券卡着。
         ⚠️ 两遍画必须**复用同一个行对象**（`rowByH` + Object.assign）：
           ACC_RENDERERS.stock、TRADE_POS.stock 都持有 rows 里的对象引用，
           第二遍若 push 新对象，交易页那份列表会停在旧价上（就是以前「刷新价格不动」的坑）。 */
    const rowByH = new Map();
    /* ⚠️ 行情**累积盒** QBOX：每一路行情（Alpaca / 腾讯 / OKX 之后的重画）都往里
       `Object.assign` 增量合并，而不是「整批替换」—— 与 VAL.fx 那个坑同源：
       整批替换会让先到的一路结果被后到（或空）的那一路抹掉。
       `stagePaint(patch)` 不传 patch 时表示「本地缓存已更新，按现有累积数据重画」。 */
    const QBOX = { stock: {}, opt: {} };
    const mergeQ = (p) => {
      if (!p) return;
      if (p.stock) Object.assign(QBOX.stock, p.stock);
      if (p.opt) Object.assign(QBOX.opt, p.opt);
    };
    function paintStock(q) {
      mergeQ(q);
      rtPosVal = 0; todayPnlUsd = 0;
      holdings.forEach((h) => {
        const next = computeRow(h, QBOX);
        let r = rowByH.get(h);
        if (!r) { r = next; rowByH.set(h, r); rows.push(r); }
        else Object.assign(r, next);
        if (r.value != null) rtPosVal += r.value;
        /* ⚠️ 2026-10-05：这里原来还有 `else if (h.posVal0 != null) rtPosVal += h.posVal0`
           —— 用 IBKR 每日快照市值兜底。用户要求去掉（「市值合计也不用保留 ibkr 快照兜底，
           没有意义」）：没有实时价就不计入，市值曲线/总资产会如实偏低，
           而不是拿一份旧快照充数让人看不出「行情没到」。 */
        if (r.todayPnl != null) todayPnlUsd += r.todayPnl;
      });
      if (!stockTbody) return;
      // 排序键 code/name/valueCny/pnlCny/todayCny 已由 computeRow 一并写入
      ACC_RENDERERS.stock = () => {
        stockTbody.innerHTML = accSorted('stock', rows).map((r) => {
          // 价格列用 USD 原值（期权 3 位小数，便于和市值对账），金额列（市值/盈亏）折 CNY
          const c = (v) => v == null ? '--' : v * FX;
          const pf = (v) => v == null ? '--' : (r.mult === 100 ? v.toFixed(3) : f2(v));
          const cls = (v) => v > 0 ? 'up' : v < 0 ? 'down' : '';
          return `<tr><td>${r.code}</td><td class="td-name"><div class="td-clamp">${r.name}</div></td>` +
            `<td class="num">${r.qty}</td>` +
            `<td class="num">${pf(r.price)}</td><td class="num">${pf(r.cost)}</td>` +
            `<td class="num">${f2(c(r.value))}</td>` +
            `<td class="num ${cls(r.pnlRatio)}">${pctS(r.pnlRatio)}</td>` +
            `<td class="num ${cls(r.pnl)}">${f2(c(r.pnl), true)}</td>` +
            `<td class="num ${cls(r.todayPnl)}">${f2(c(r.todayPnl), true)}</td>` +
            `<td class="num ${cls(r.todayPct)}">${pctS(r.todayPct)}</td></tr>`;
        }).join('');
        const empty = $id('stockEmpty');
        if (empty) empty.hidden = true;
      };
      accRender('stock');
      renderStockSum();          // 侧栏「证券 / 今日盈亏 / 累计盈亏」随第一行一起落定
    }
    /* ① 第一遍：快照价，零等待 —— 证券表与侧栏证券值秒出，不再空表 + `--` */
    paintStock({ stock: {}, opt: {} });

    /* ---- 持仓股行情：**分梯队「谁先到先画」，不再 `await` 一个四路 Promise.all ----
       ⚠️ 为什么（用户 2026-10-05 报「账户里基金和现金刷新都很快，证券的数据就非常慢，甚至出不来」）：
       基金 = 东财脚本 + 本地 nav、现金 = 纯本地 JSON，**都没有慢网络**，所以永远秒出；
       证券却要过 Alpaca（分页三端点 + 重试，慢时 8s+）、腾讯（辰慢且易撞 WAF，实测单次 19s）
       与 OKX。原写法把这四路塞进同一个 `Promise.all` 之后才画第二遍 → **谁最慢谁决定整块
       什么时候出数**，而基金/现金早算完，看上去就只剩证券卡着；Alpaca 那边一挂（超时/被墙），
       `paintStock` 那次重画被拖掉，表里就停在快照值甚至出不来。
       现在改成：OKX 到手先画 → 腾讯到手再画 → Alpaca 最后画，各自带硬超时封顶，
       任何一路慢/失败都不再压住整块（证券永远「先出快照值 → 逐路升级」）。
       holdings 在这里才声明完，所以补拉放在这里。 */
    const heldCodes = holdings.filter((h) => !h.opt).map((h) => h.code).filter(Boolean);
    const withCap = (p, ms) => Promise.race([
      Promise.resolve(p), new Promise((r) => setTimeout(() => r(null), ms)),
    ]);
    /* 每一路到手就画一次：patch 省略 = 缓存已更新、按现有累积数据重画。 */
    const stagePaint = (patch) => { if (patch) mergeQ(patch); paintStock(); recalcStockTotals(); };

    /* 第 1 梯队：OKX 永续（7×24、最快，<1s）—— 持仓页现价立刻有数。
       ⚠️ 这第一下是**同步**的，此时 `totalCny` / `nv` 那些底下才声明的 const 还在 TDZ，
       所以只用 `paintStock()` 画表（跟以前第一遍一致），汇总/总资产交给下面的异步梯队去 `recalcStockTotals()`。 */
    paintStock();
    withCap(loadOkxTradeQuotes(heldCodes), 6000).then(() => stagePaint());
    /* 基金成分股的实时价也走 OKX（用户 2026-10-04 定稿：持仓里所有最新价格都用 OKX）。
       heldCodes 与成分股代码合并去重，一次拉完；只要现价不拉日线，省一半请求。 */
    withCap(loadOkxTradeQuotes([...heldCodes, ...usComponentCodes()], { nowOnly: true }), 6000)
      .then(() => stagePaint());
    /* 第 2 梯队：腾讯 —— 账户页现价的第二级兜底（Alpaca 挂掉时靠它），慢但不阻塞前面 */
    withCap(loadUsQuotes(null, heldCodes), 8000).then(() => stagePaint());
    /* 第 3 梯队：Alpaca —— 账户页现价主力（base 已在初始化时锚定，这里只补现价） */
    withCap(loadUsQuotesAlpaca(null), 8000).then(() => stagePaint());
    withCap(accAlpacaQuotes(stockSyms, optSyms), 9000).then((patch) => {
      stagePaint(patch);
      /* 全部梯队收工后再兜一次底：补画走势图末点（init 那条曲线用的是第一梯队之前的快照价） */
      refreshAoTail();
    });

    /* 证券口径的全部汇总 DOM。抽成函数是为了让 15s 定时刷新能重画
       （原来这些 setTxt 只在初始化跑一次，行情变了数字不动）。 */
    function renderStockSum() {
      const posVal = () => rows.reduce((s, r) => s + (r.value != null ? r.value : 0), 0)   // 2026-10-05 起不再兜 IBKR 快照市值;
      const longVal = () => rows.filter((r) => r.value != null && r.qty > 0).reduce((s, r) => s + r.value, 0);
      const shortVal = () => rows.filter((r) => r.value != null && r.qty < 0).reduce((s, r) => s + r.value, 0);
      const todayUsd = () => rows.reduce((s, r) => s + (r.todayPnl || 0), 0);
      const rtVal = posVal();
      const stockEquityCny = (ibkrCashAll + rtVal) * FX;
      const stockTodayCny = todayUsd() * FX;
      const stockPnlCny = rows.reduce((s, r) => s + (r.pnl || 0), 0) * FX;
      // 证券累计盈亏（CNY）= 证券权益实时折算 − 人民币本金 167,600（forexTrades 四笔 CNH 合计，含 TQQQ 的 17,600）
      // 口径：实际掏口袋的人民币，换汇手续费/点差自动计入盈亏；usInvest=167600 互证
      const stockCumCny = stockEquityCny - 167600;
      setTxt('mStockVal', f2(rtVal * FX));
      setTxt('mStockLong', f2(longVal() * FX));
      setTxt('mStockShort', f2(shortVal() * FX));
      // 累计收益（资产列）= 证券累计盈亏（净值口径，含已实现盈亏/汇兑/利息）
      setTxt('mPnlTotal', f2(stockCumCny, true), stockCumCny);
      // 资产卡每行后面备注美元原值（证券账户以 USD 计价，CNY 只是折算视图）
      const usdNote = (id, v) => setTxt(id, v == null ? '' : f2(v) + ' USD');
      usdNote('mStockValUsd', rtVal);
      usdNote('mStockLongUsd', longVal());
      usdNote('mStockShortUsd', shortVal());
      usdNote('mPnlTotalUsd', (ibkrCashAll + rtVal) - 167600 / FX);
      // 证券净值 = 证券账户权益 = (盈透现金 + 持仓实时市值) 折 CNY，与「总资产」里的证券口径一致
      setTxt('mStockEquity', f2(stockEquityCny));
      usdNote('mStockEquityUsd', ibkrCashAll + rtVal);
      /* 现金总值（已并入「资产」卡，排在证券净值上面）= 盈透账户现金 **+ 应计利息** 折 CNY。
         ⚠️ 现金是负数（保证金借方 −9,849.96 USD），利息 +7.93 也要算进权益，
            否则与「总资产」里的证券口径（用 totalNetValueDaily）差 7.93 USD。
            右侧括注美元原值并**备注利息**，让「现金为负」这件事看得懂。 */
      setTxt('mCashCny', f2(ibkrCashAll * FX));
      /* ⚠️ 美元原值**别**把「（含利息 …）」拼进来（2026-10-05 用户：「这个含利息另起一行
         自动居右，现在这个表错行了很难看」）—— 拼在同一个 <i> 里，nowrap 长文本会把整行挤歪。
         现在由 #mCashInterest 单独一行、右对齐（见 .m-note-r / .m-int）。 */
      setTxt('mCashUsd', f2(ibkrCashAll) + ' USD');
      /* 利息为 0 时留空，别留一行孤零零的「含利息 0.00」 */
      const intEl = $id('mCashInterest');
      if (intEl) intEl.textContent = ibkrInterest ? '含利息 ' + f2(ibkrInterest) : '';
      setTxt('accStockVal', f2(stockEquityCny));
      setTxt('accStockNote', f2(stockTodayCny, true), stockTodayCny);
      setTxt('accStockPct', stockEquityCny - stockTodayCny ? pctS(stockTodayCny / (stockEquityCny - stockTodayCny)) : '--', stockTodayCny);
      setTxt('accStockCum', f2(stockCumCny, true), stockCumCny);
      // 累计涨跌幅 = 累计盈亏 ÷ 本金 167,600（与上一行同源口径）
      setTxt('accStockCumPct', pctS(stockCumCny / 167600), stockCumCny);
    }
    renderStockSum();
    /* ⚠️ 下面四个口径改成 `let`：分梯队刷新时每个梯队都要**重算**一遍
       （原来只在 init 里算一次，证券行情到了之后总资产/曲线还停在快照价上）。
       `recalcStockTotals()` 就是「证券表画完 → 侧栏 + 总资产 + 走势末点」这一串的后处理。 */
    let stockEquityCny = (ibkrCashAll + rtPosVal) * FX;   // ↓ 供下方总资产/曲线沿用
    let stockTodayCny = todayPnlUsd * FX;
    let stockPnlCny = rows.reduce((s, r) => s + (r.pnl || 0), 0) * FX;
    let stockCumCny = (ibkrCashAll + rtPosVal) * FX - 167600;
    function recalcStockTotals() {
      stockEquityCny = (ibkrCashAll + rtPosVal) * FX;
      stockTodayCny = todayPnlUsd * FX;
      stockPnlCny = rows.reduce((s, r) => s + (r.pnl || 0), 0) * FX;
      stockCumCny = stockEquityCny - 167600;
      renderStockSum();               // 侧栏「证券 / 今日盈亏 / 累计盈亏」+ 资产卡
      refreshAoTail();                // 走势图末点（今天）= 实时正股价外推，跟着行情走
      totalCny = renderAccTotal();    // 账户页总资产 + 累计（函数声明已提升）
      TRADE_POS.totalCny = totalCny;
      /* ⚠️ 交易页那一列也要跟着重画：`renderTradeList()` 内部会调 `renderTradeSum()`
         （持仓页「推算总资产 / 差额」）并顺带触发分时图重画（内部 60s 节流）。
         漏掉这一步的症状：账户页数字都对了，**持仓页还是快照价 + 空图**（OKX 那一梯队白拉了）。 */
      if (typeof renderTradeList === 'function') renderTradeList();
      /* 环形图（个人净资产分布）也要重建 —— 它的数据里有 TQQQ，现价来自 Alpaca 日线，
         而 Alpaca 属于**最慢那一梯队**。不跟着重算的话，环形图永远定格在
         「Alpaca 到达前」那一版：TQQQ 那一项缺失、中心总额偏低约 2.9 万
         （用户 2026-10-05 报的「这个图没算tqqq啊」）。函数声明已提升，可安全后调。 */
      if (typeof rebuildAoDist === 'function') rebuildAoDist();
    }

    /* ---- 历史·成交（Asset_parsed.trades 88 条 + TQQQ 手动买入） ---- */
    // 证券持仓表已有名称映射，复用它把期权 symbol 拆成「名称 + 代码」
    const nameOf = {};
    holdings.forEach((h) => { nameOf[h.code] = h.name; });
    const tradeRows = (asset.trades || []).map((t) => {
      const flat = String(t.symbol || '').replace(/\s+/g, '');
      const isOpt = /\d{6}[CP]\d{8}$/.test(flat);
      let name = flat, code = flat, mult = 1, sub = null;
      if (isOpt) {
        const m = flat.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
        /* ⚠️ 期权名**不把 call/put 拼进 name**（原来是 `ORCL 261002 143 call`）：
           首列是 table-layout:auto，`white-space:normal` 也压不下 max-content，
           多 3 个字符就是 +34px 列宽。改成「第一行 `ORCL 261002 143` +
           第二行灰小字 `call`」（CSS 里 .td-code 是 block），列宽直接降到 ~165px。 */
        if (m) { name = `${m[1]} ${m[2]} ${parseInt(m[4], 10) / 1000}`; sub = m[3] === 'C' ? 'call' : 'put'; code = m[1]; mult = 100; }
      } else if (nameOf[flat]) { name = nameOf[flat]; }
      const qty = Math.abs(t.quantity || 0);
      const isSell = /^SELL/i.test(t.buySell || '');
      /* 代码已被名称吃掉就不再渲染第二行（期权：name 已以 code 开头；未映射中文名的正股：name===code） */
      const dupCode = !sub && name.trim().toUpperCase() === code.toUpperCase();
      return {
        name, code, sub, dupCode, side: isSell ? '卖出' : '买入',
        price: t.price,
        amount: qty * (t.price || 0) * mult,              // 成交金额按原币（USD），与「币种」列一致
        amountCny: qty * (t.price || 0) * mult * FX,      // 成交金额（CNY），头部汇总行已删，留给明细用
        realized: t.realized || 0,                        // 该笔已实现盈亏（USD 原币，期权已含 ×100）
        qty, date: t.date, market: '美股', cur: 'USD',
        decimals: mult === 100 ? 3 : 2,                   // 期权价格 3 位小数
        _sortSide: isSell ? 1 : 0,
      };
    });
    // TQQQ 在 JSON 里是 seed.pa_us 的手动买入（非 IBKR 成交），并入成交历史
    (seed.pa_us || []).forEach((u) => (u.trades || []).forEach((t) => {
      const qty = Math.abs(t.shares || 0);
      const isSell = /^sell/i.test(t.type || '');
      const amt = qty * (t.price || 0);
      tradeRows.push({
        name: u.name || u.symbol, code: u.symbol, dupCode: (u.name || u.symbol) === u.symbol,
        side: isSell ? '卖出' : '买入',
        price: t.price, amount: amt, amountCny: amt * FX, realized: null, qty,
        date: t.date, market: '美股', cur: 'USD', decimals: 2,
        _sortSide: isSell ? 1 : 0,
      });
    }));
    const stockHistBody = $id('stockHistBody');
    if (stockHistBody) {
      ACC_RENDERERS.stockH = () => {
        stockHistBody.innerHTML = accSorted('stockH', tradeRows).map((r) =>
          /* ⚠️ 首列「名称/代码」两行：名称在上，灰色小字**换行**在下（CSS 里 .td-code 是 block）：
             期权第二行是 call/put，正股第二行是代码。第二行重复（期权 name 已含 ORCL、未映射的正股
             name===code）就不渲染。
             ⚠️ 别把 call/put 拼进第一行 —— auto 布局下列宽不会小于内容 max-content，
                多 3 个字符就 +34px（实测首列 250.5px → 212px → 165px 的三段优化全靠这个拆分）。 */
          `<tr><td>${r.name}${r.sub ? `<span class="td-code">${r.sub}</span>`
            : (r.dupCode ? '' : `<span class="td-code">${r.code}</span>`)}</td>` +
          `<td class="${r._sortSide ? 'down' : 'up'}">${r.side}</td>` +
          `<td class="num">${r.price == null ? '--' : r.price.toFixed(r.decimals)}</td>` +
          `<td class="num">${f2(r.amount)} / ${r.qty}</td>` +
          `<td class="num">${r.date}</td><td>${r.market}</td><td>${r.cur}</td>` +
          `<td class="num ${r.realized == null ? '' : r.realized > 0 ? 'up' : r.realized < 0 ? 'down' : ''}">` +
          `${r.realized == null ? '--' : f2(r.realized, true)}</td></tr>`
        ).join('');      };
      accRender('stockH');
      setTxt('stockHistCount', tradeRows.length, 1);
      /* 「总成交额: CNY」行已按用户要求删除（2026-10-04），这里不再统计 amtSum。
         `tradeRows[].amountCny` 字段保留（成交明细表里可能用到）。 */
      const realSum = tradeRows.reduce((s, r) => s + (r.realized || 0), 0);
      setTxt('stockHistRealized', f2(realSum, true), realSum);
    }

    /* ---- 侧栏总资产 + 走势 ----
       抽成函数：15s 刷新时证券实时价会变，总资产/今日盈亏/累计盈亏都得跟着重算，
       否则账户页「证券表在跳、总资产不动」。基金按官方净值（fundAmount）不随盘中变。 */
    function renderAccTotal() {
      const rtVal = rows.reduce((s, r) => s + (r.value != null ? r.value : 0), 0)   // 2026-10-05 起不再兜 IBKR 快照市值;
      const eqCny = (ibkrCashAll + rtVal) * FX;
      const todayCny = rows.reduce((s, r) => s + (r.todayPnl || 0), 0) * FX + fundYesterday;
      const tot = eqCny + fundAmount + cashCny;
      const yestBase = tot - todayCny;
      setTxt('accTotalVal', f2(tot));
      setTxt('accTotalNote', f2(todayCny, true), todayCny);
      // 今日涨跌幅 = 今日盈亏 ÷ 昨日总资产（今日总资产 − 今日盈亏）
      setTxt('accTotalNotePct', yestBase > 0 ? pctS(todayCny / yestBase) : '--', todayCny);
      // 累计盈亏 = 证券累计(IBKR净值+TQQQ市值-入金-买入成本) + 基金累计(净值-JSON成本)
      const cumCny = (eqCny - 167600) + fundCum;
      setTxt('accTotalCum', f2(cumCny, true), cumCny);
      // 累计涨跌幅 = 累计盈亏 ÷ 总投入本金（证券本金 167,600 + 基金成本）
      const costBase = 167600 + (fundAmount - fundCum);
      setTxt('accTotalCumPct', costBase > 0 ? pctS(cumCny / costBase) : '--', cumCny);
      return tot;
    }
    /* ⚠️ 必须是 `let`：分梯队刷新时 `recalcStockTotals()` 会重算总资产并回写这个值
       （写成 const 会在异步梯队里抛 TypeError）。 */
    let totalCny = renderAccTotal();
    const nv = asset.totalNetValueDaily || [];
    const tail = nv.slice(-80);
    ACC_SPARK.series = tail.map((p) => p.value);
    drawAccSpark();

    /* ---- 全部账户总览页：资产分布环形图 + 每日总资产序列 ---- */

    /* 图标解析：Asset_parsed.json 顶层 `icons` 是**富途 app 的品牌图标库**（39 个 base64 图片），
       各项的 `icon.img` 形如 `'@b64:3'` 指向其中下标。
       ⚠️ JSON 里**只有 12 条**持仓真的引用了图标（6 只基金 + 6 个现金账户 + TQQQ），
          其余 27 个是库里的备用图标 —— 包括甲骨文（索引 38，红 O 形 logo）。
          所以美股正股要靠下面这张**代码 → 库下标**的手工对照表补上，
          否则 ORCL 会没图标（用户 2026-10-04：「orcl也有图标啊」）。
       下标由逐个解码识别（渲染成网格肉眼比对）得出，见下表。 */
    const ICON_MAP = (() => {
      const map = {};
      (asset.icons || []).forEach((dataUri, i) => { map['@b64:' + i] = dataUri; });
      const pick = (ic) => (ic && ic.img && map[ic.img]) || '';
      const put = (code, ic) => { if (code && pick(ic)) map[code] = pick(ic); };
      (seed.pa_funds || []).forEach((f) => put(f.code, f.icon));
      (seed.pa_cash || []).forEach((c) => put(c.id, c.icon));
      (seed.pa_us || []).forEach((u) => put(u.symbol, u.icon));
      /* 库里没被持仓引用的品牌图标 → 代码对照。
         下标由「把 39 个图标渲染成网格逐个肉眼辨认」得出（2026-10-04）。
         ⚠️ 只写**能确认**的，宁缺勿滥：第一版我凭logo 猜了十几个，十几个都错
         （把支付宝「支」当 Google、把中信银行当高盛…），已全部删掉。
           0 嘉实  1 广发  2 微软  3 ProShares  4 NVIDIA  5 汇丰  6 建设银行
           7 农业银行  8 中国银行  9 建设银行(?)  10 蚂蚁  11 嘉实理财  12 邮储
           13 兴证  14 Visa  15 中信  16 微信  17 支付宝  18 汇丰中国  19 东方财富
           20 兴业  21 高盛  22 富途  23 华泰  24 华泰证券  25 博时  26 citi
           27 京东  28 摩根士丹利  29 理财通  30 兴业银行  31 平安  32 PayPal
           33 VISA  34 万事达  35 美国运通  36 Apple Pay  37 G Pay  38 Oracle */
      const CODE_ICON = {
        ORCL: '@b64:38',   // Oracle
        NVDA: '@b64:4',    // NVIDIA
        MSFT: '@b64:2',    // 微软四色方块
        TQQQ: '@b64:3',    // ProShares（seed.pa_us 里已引用同一张）
      };
      Object.keys(CODE_ICON).forEach((code) => {
        if (!map[code] && map[CODE_ICON[code]]) map[code] = map[CODE_ICON[code]];
      });
      /* 现金账户：除 id 外**再按账户名（note）建一份键**。
         ⚠️ 这是修「环形图里广发银行/农业银行显示成 CNY、图标也没了」：
            调用方传的是 `c.note`（账户名）当 code，而这里只按 `c.id` 建了键 → 查不到。
         顺带把币种兜底也改成**取该币种第一笔**（原先 `!map[k]` 只认第一笔，
            但汇丰中国 @b64:5 在前，USD 分不到图标；这里按币种各自记首个）。 */
      (seed.pa_cash || []).forEach((c) => {
        if (c.note) put(String(c.note), c.icon);            // 账户名：环形图/列表用这个
        if (c.currency) put('cash:' + String(c.currency).toUpperCase(), c.icon);
      });
      return map;
    })();
    /* 图标查找：证券/基金用代码 → 现金用账户名 → 最后才按币种兜底。 */
    const iconOf = (code, cur) => ICON_MAP[code] || ICON_MAP['cash:' + String(cur || '').toUpperCase()] || '';

    /* 环形图数据重建：抽成函数（2026-10-05）。
       ⚠️ 原来这段是 init 里**一次性**执行的直线代码，于是「TQQQ 市值取不到」就永远定格：
          TQQQ 现价来自 Alpaca 日线（tqqqBars / VAL.txUs.TQQQ），而账户页是**分梯队**加载的，
          环形图往往在 Alpaca 到达前就画完了 → TQQQ 那一项永远缺失、中心总额偏低约 2.9 万
          （用户 2026-10-05：「这个图没算tqqq啊」）。
       改法同 rebuildAoSeries：函数声明会被提升，所以既能在这里调、也能在
       recalcStockTotals()（梯队重算链）里调，后到的数据会自动补上。 */
    function rebuildAoDist() {
      /* 「资产」视角：每个持仓一扇区（对齐富途「个人净资产分布」）。
         数据源拼接：证券 rows（实时市值折 CNY）+ 基金逐只（份额×净值）+ 现金各账户。
         ⚠️ 现金按**账户**分列（而不是笼统一个「现金」）—— 与富途一致，
            IBKR 的 USD 现金和各 CNY 账户在「币种」维度上是不同的东西。
         ⚠️ 证券市值 = rows 里的实时价折 CNY（valueCny），**没有实时价就不进环**
            （2026-10-05 起不再退回 Asset_parsed.json 的快照市值 posVal0×FX）。
         `cat` 决定配色归属（红/黄/绿，同分类在资产视角下取同色系梯度）。 */
      const assetItems = [];
      rows.forEach((r) => {
        // 2026-10-05：不再用 IBKR 快照市值 posVal0 兜底 —— 没有实时价就不进环
        const v = r.valueCny != null && r.valueCny > 0 ? r.valueCny : null;
        if (v > 0) assetItems.push({
          name: r.name || r.code, code: r.code || '', val: v,
          cat: '证券', icon: iconOf(r.code),
        });
      });
      funds.forEach((f) => {
        const amt = f.shares > 0 && f.navL != null ? f.shares * f.navL : 0;
        if (amt > 0) assetItems.push({
          name: f.name, code: f.code, val: amt, cat: '基金', icon: iconOf(f.code),
        });
      });
      cashRows.forEach((c) => {
        if (c.cny > 0) assetItems.push({
          /* code 用**账户名**（广发银行/ 农业银行 / 汇丰中国…），不是币种。
             用户 2026-10-04：「广发银行，农业银行不是写 CNY，就写广发银行，农业银行」。
             账户名同时是 ICON_MAP 的键（见上面 ICON_MAP 的 note 建键），
             所以环内/列表里都能拿到各银行自己的 logo。币种挪到 cur 字段备用。 */
          name: c.note, code: c.note, val: c.cny, cat: '现金',
          icon: iconOf(c.note, c.cur),
        });
      });

      /* ⚠️ **TQQQ 兜底**（用户 2026-10-05：「这个图没算tqqq啊」）。
         根因不是「漏了他」，而是**他被过滤掉了**：TQQQ 在 app.js:5324 被 push 进 `holdings`，
         所以 `rows` 里一直有这一行；但它的现价只能来自 Alpaca，而 Alpaca 多标的 bars
         **按字母序分页**（只返回前 9~10 个，TQQQ 排在最后常被漏掉），
         现价取不到时 `rows.forEach` 里那个 `if (v > 0)` 就把整项丢掉 ——
         环上没这一扇区，`rtPosVal`/`totalCny` 也不含它（中心总额偏低约 2.9 万）。
         所以这里只在 **rows 里那行拿不到价**时，用 TQQQ 自己的 Alpaca 日线补一项；
         ⚠️ 千万别无条件 push —— rows 里已经有它时会变成两条 TQQQ、各占 2.8%，
         扇区之和比中心总额多出整整一份（实测多 29,872.68）。
         取价与 `rebuildAoSeries()` 同口径：股数 = tqqq.trades[0].shares
         （⚠️ 不是 tqqq.tqqqShares，原始对象上没这字段）。 */
      const tqqqSharesAo = (tqqq && tqqq.trades && tqqq.trades[0] && tqqq.trades[0].shares) || 0;
      let tqqqCnyAo = 0;                      // 只在「需要兜底」时才非 0 → 各口径统一加这一份
      // 只认实时市值（不再看快照 posVal0）：判断「rows 里 TQQQ 有没有价」
      const tqqqInRows = rows.some((r) => /^TQQQ$/i.test(String(r.code || ''))
        && r.valueCny != null && r.valueCny > 0);
      if (!tqqqInRows && tqqqSharesAo) {
        const todayBjAo = new Date().toLocaleDateString('sv-SE');
        let pxAo = (VAL.txUs && VAL.txUs.TQQQ && VAL.txUs.TQQQ.now) || 0;
        if (!(pxAo > 0) && tqqqBars) {
          const keysAo = Object.keys(tqqqBars).sort();
          let bestAo = null;
          for (const k of keysAo) { if (k <= todayBjAo) bestAo = k; else break; }
          if (bestAo) pxAo = tqqqBars[bestAo];
        }
        if (pxAo > 0) {
          tqqqCnyAo = pxAo * tqqqSharesAo * FX;
          assetItems.push({
            name: tqqq.name || '三倍做多纳指ETF', code: 'TQQQ', val: tqqqCnyAo,
            cat: '证券', icon: iconOf('TQQQ'),
          });
        } else {
          console.warn('[环形图] TQQQ 现价未到（Alpaca 分页未覆盖 / 日线仍在路上），该项暂缺');
        }
      }

      const cnyPart = fundAmount + cashRows.filter((r) => r.cur !== 'USD').reduce((s, r) => s + r.bal, 0);
      /* 中心总额 / 分类 / 币种三处统一加上 `tqqqCnyAo`：
         兜底 push 的那一项必须同时进总额，否则「各扇区之和 > 中心数字」、占比失真。
         rows 里本来就有价时 `tqqqCnyAo === 0`，这三个口径一点不动。 */
      const totalWithTqqq = totalCny + tqqqCnyAo;
      setAoDistData(assetItems, {
        cat: [
          { name: '现金', val: cashCny },
          { name: '证券', val: stockEquityCny + tqqqCnyAo },
          { name: '基金', val: fundAmount },
        ],
        cur: [
          { name: '美元', val: totalWithTqqq - cnyPart },
          { name: '人民币', val: cnyPart },
        ],
      }, totalWithTqqq);
    }

    rebuildAoDist();

    /* 每日总资产 = IBKR 净值×FX + TQQQ 市值 + Σ基金份额×当日nav + 现金常数；
       末点替换/追加为实时总资产，与侧栏数字一致。
       ⚠️ TQQQ 必须在历史点里按日补上：IBKR 的 totalNetValueDaily 不含它（TQQQ 是 IBKR 之外
       手动买入的，存在 seed.pa_us），而侧栏 stockEquityCny 含它 —— 漏补会让所有历史点
       整体偏低约 2.9 万 CNY，末点换成实时值时曲线末端假跳升。
       ⚠️ 整段抽成 `rebuildAoSeries()`，两个原因：
          ① 慢网时 TQQQ 全区间日线（Alpaca）晚到，要整体重算一次（否则历史点永远缺 TQQQ 那段）；
          ② 分梯队刷新后证券现价会变，曲线末端必须跟着重算（原来只在 init 跑一次，
             表现就是「证券表在跳、曲线末端不动」）。 */
    function rebuildAoSeries() {
    const todayBj = new Date().toLocaleDateString('sv-SE');
    // ⚠️ tqqq 是 seed.pa_us[0] 原始对象，股数在 tqqq.trades[0].shares（不是 tqqq.tqqqShares，
    //    那个字段只存在于上面 holdings 里的副本上，写错会让 TQQQ 市值恒为 0）。
    const tqqqShares = (tqqq && tqqq.trades && tqqq.trades[0] && tqqq.trades[0].shares) || 0;   // 55 股
    // TQQQ 当日市值（USD）：优先用 Alpaca 日线收盘；取不到（节假日/未收录）则沿用最近一条
    const tqqqValueOn = (d) => {
      if (!tqqqShares) return 0;
      if (tqqqBars[d] != null) return tqqqBars[d] * tqqqShares;
      const keys = Object.keys(tqqqBars).sort();
      let best = null;
      for (const k of keys) { if (k <= d) best = k; else break; }
      return best ? tqqqBars[best] * tqqqShares : 0;
    };
    const aoSeries = nv.map((row) => {
      const fundPart = funds.reduce((s, f) => {
        const v = navOn(f.hist, row.date);
        return s + (v != null ? f.shares * v : (f.amount || 0));
      }, 0);
      /*带上 `nv`（IBKR 原始净值，USD）。calIndex 的废值段过滤要用它 ——
        判据不能看 cny：cny 含基金/现金（合计70 多万），哪怕 IBKR 净值只有 1.42
        也远大于阈值，前 28 天的占位噪声会一行都滤不掉（用户 2026-10-04 发现的偏差）。 */
      return { date: row.date, cny: row.value * FX + tqqqValueOn(row.date) * FX + fundPart + cashCny, nv: row.value };
    });
    if (aoSeries.length) {
      /* 末点（今天）用**与历史点相同的口径**外推：以最后一条 IBKR 净值为锚，
         只叠加【正股实时价相对文件快照的变动】。
         不用侧栏 totalCny 的原因：它对全部持仓（含期权）做实时重算，而期权临近/已到期时
         Alpaca 报价会剧烈跳动（实测 ORCL 261002C00143000 从 0.32 跳到 1.995，×100 乘数放大后
         造成 4 万级偏差），会让曲线末端假跳升。IBKR 官方净值里已含融资余额(-9,840.56)等项目，
         只有正股价格是可可靠外推的部分。 */
      const lastRow = nv[nv.length - 1];
      const stockDeltaUsd = rows.reduce((s, r) => {
        if (r.h.opt || r.h.tqqqShares != null) return s;
        const fileMark = (asset.holdings.find((h) => h.symbol.replace(/\s+/g, '') === r.h.occ) || {}).markPrice;
        return s + (fileMark != null && r.price != null ? (r.price - fileMark) * r.qty : 0);
      }, 0);
      const projCny = lastRow.value * FX
        + tqqqValueOn(todayBj) * FX
        + fundAmount
        + cashCny
        + stockDeltaUsd * FX;
      if (aoSeries[aoSeries.length - 1].date === todayBj) {
        aoSeries[aoSeries.length - 1].cny = projCny;
        aoSeries[aoSeries.length - 1].nv = null;       // 外推值，不是真实 IBKR 净值
      } else {
        aoSeries.push({ date: todayBj, cny: projCny, nv: null });
      }
    }
    aoState.series = aoSeries;
    return aoSeries;
    }
    rebuildAoSeries();
    /* `recalcStockTotals()` 每个行情梯队都会调一次：重算曲线 + 重画。
       （口径见上面注释：末点只叠加正股相对文件快照的变动，不含期权——
        期权临近到期时 Alpaca 报价会剧烈跳动，放进去会让曲线末端假跳升。） */
    function refreshAoTail() {
      if (!aoState.series || !aoState.series.length) return;
      rebuildAoSeries();
      drawAoChart();
    }

    /* ---- 交易视图用：把证券 / 基金持仓发布出去 ----
       交易页那份列表要显示「市值 / 盈亏」和持仓汇总，只有持仓才有这些数（自选列表没有仓位概念），
       所以把 rows / funds / 账户总资产挂到共享对象上，交易页去读。渲染函数随后会重画。 */
    TRADE_POS.stock = rows.filter((r) => r.qty);          // 剔除已清仓（qty=0）
    TRADE_POS.fund = funds.filter((f) => f.shares);
    TRADE_POS.splits = VAL.splits;      // 识别到的拆股（键 = 市场+代码），供调试/展示
    TRADE_POS.fx = FX;
    TRADE_POS.totalCny = totalCny;      // 账户页口径：证券权益 + 基金 + 现金
    TRADE_POS.cashCny = cashCny;        // 各银行账户现金
    TRADE_POS.ibkrCashCny = ibkrCashAll * FX;  // 盈透账户内现金 **+ 应计利息**（未投出去的部分）
    TRADE_POS.ready = true;
    /* 行情定时刷新入口（15s，与自选列表同频，由模块级定时器调用）。
       为什么要它：交易页原先只在初始化取一次价，页面开着不动就永远停在打开那一刻的数
       （用户 2026-10-04 报「ORCL 现价还是 142.41」）—— 严格说那次是周末休市、
       Alpaca 最后成交就是 10-02 收盘的 142.41，价格本就不该动；但盘中开着不动也必须会动。
       ⚠️ 基金估值只更新现价部分：`loadUsQuotes(baseDate=null)` 会刷 `now` 而**保留** `base`
          （估值基准仍是各基金自己的 navDate），然后重跑 estimateFund。 */
    /* 本轮行情到手 → 重算并重画**一趟**。patch = 本轮新到的那批行情（Alpaca 那路），
       其余（腾讯 / OKX）只更新了本地缓存，靠 `refreshPaint` 以空 patch 再画一遍。
       ⚠️ 要走分梯队调用（下面 `pFast` / `pTx` / `pAlp`），不能整轮等齐：
          「谁先到先画」是这套账户页「证券秒出」的关键，见 boot 处那段的说明。 */
    let refreshing = false;
    function refreshPaint(patch) {
      mergeQ(patch);                               // 增量合并进累积盒（别整批替换，会抹掉先到一路的结果）
      rows.forEach((r) => {
        const prevAcct = r.pAcct;                    // 记住本轮之前的账户价（Alpaca 口径）
        /* ⚠️ 传 QBOX 而不是本轮那批：分梯队刷新时先到的结果要留着，
           后到的一趟只是再算一遍全量（行对象仍是原地更新，引用不变）。 */
        const next = computeRow(r.h, QBOX);
        /* 抗闪跳（用户 2026-10-04：「现价一直跳，142.30 / 142.41」）：
           若这一轮 **Alpaca 本身**没取到价（弱网/限流），computeRow 会按设计退到腾讯兜底 →
           现价从 142.41 变成腾讯的 142.30，下个周期 Alpaca 恢复又跳回来。
             这里沿用上一轮的账户价：只有 Alpaca 真给到新价才更新。
             「取不到数据」应表现为「数字不动」，而不是「数字乱跳」—— 前者正常，后者像坏了。
             ⚠️ 判断依据是 **Alpaca 有没有给价**，不能看 `next.pAcct > 0`（那时已被腾讯兜底填成 >0 了）。
             ⚠️ 判据只看**本批 patch**（腾讯/OKX 那两趟 patch 为空 → 直接沿用旧价，不参与判断）；
             ⚠️ 只锁**账户页**口径（pAcct）；持仓页 pTrade 用 OKX 永续实时价，
                本就该每轮都动，不受这段抗闪跳影响。 */
        const kk = String(r.code || r.h.code || '').toUpperCase();
        const alpacaOk = patch
          ? (r.h.opt
            ? !!(patch.opt && patch.opt[r.h.occ] && patch.opt[r.h.occ].price > 0)    // 期权走 snapshots
            : !!(patch.stock && patch.stock[kk] && patch.stock[kk].price > 0))       // 正股/TQQQ 走 bars
          : false;
        if (!alpacaOk && prevAcct > 0) {
          next.pAcct = prevAcct; next.price = prevAcct; next.src = r.src || '';
          next.value = prevAcct * next.qty * next.mult;
          next.tradeValue = next.pTrade != null ? next.pTrade * next.qty * next.mult : next.value;
          next.pnl = (prevAcct - next.cost) * next.qty * next.mult;
          next.pnlRatio = next.cost ? (prevAcct - next.cost) / next.cost : null;
          next.todayPnl = next.prevClose != null ? (prevAcct - next.prevClose) * next.qty * next.mult : null;
          next.todayPct = next.prevClose ? (prevAcct - next.prevClose) / next.prevClose : null;
          const fx2 = next.value != null ? FX : 1;
          next.valueCny = next.value != null ? next.value * fx2 : null;
          next.pnlCny = next.pnl != null ? next.pnl * fx2 : null;
          next.todayCny = next.todayPnl != null ? next.todayPnl * fx2 : null;
          next.tradeValueCny = next.tradeValue != null ? next.tradeValue * fx2 : null;
          next.tradeChgCny = next.tradeChgUsd != null ? next.tradeChgUsd * fx2 : null;
        }
        Object.assign(r, next);                   // 原地更新，引用不变
      });
      funds.forEach((f) => {
        if (!(f.items && f.items.length && f.navDate)) return;
        const est = estimateFund(f, f.navDate);
        f.estChg = est.chg; f.estNav = est.navEst;
        f.estAmount = est.navEst != null ? f.shares * est.navEst : null;
        f.estDelta = f.estAmount != null ? f.estAmount - f.amount : null;
        f.estParts = est.parts;
      });
      if (ACC_RENDERERS.stock) accRender('stock');
      renderStockSum();
      refreshAoTail();                             // 曲线末端跟着现价走
      totalCny = renderAccTotal();                 // 账户页总资产跟着现价走，别让两边脱节
      TRADE_POS.totalCny = totalCny;
      if (typeof renderTradeList === 'function') renderTradeList();
      if (typeof rebuildAoDist === 'function') rebuildAoDist();   // 同上：环形图跟着现价重算
    }
    TRADE_POS.refresh = async () => {
      if (document.hidden || refreshing) return;   // 页面不可见时省一次请求；上一轮没跑完不叠轮
      refreshing = true;
      try {
        const held2 = holdings.filter((h) => !h.opt).map((h) => h.code).filter(Boolean);
        /* 三路同时起，**不 await 整轮**：谁先到谁先画。
           ⚠️ 原来是 `await accAlpacaQuotes(...)` 之后才拉另外三路 —— Alpaca 一慢（分页三端点 +
           弱网，实测 8~9s）整轮 15s 刷新就压在那儿不动，用户看到的就是「证券一直不出数」。 */
        /* ⚠️ 持仓代码那一路**单独起、单独画**：它只有一页、最快（<1s），
           而基金成分股那一路（几十个代码 + 腾讯三后缀）能拖几秒 ——
           塞进同一个 Promise.all 的话「先到」的 OKX 也会被拖成后到。
           基金成分股刷新现价时 base 保持不变（见 loadUsQuotesAlpaca 注释；`baseDate` 传 null
           → 只更新 now，估值基准仍锚在各基金自己的 navDate 上）。 */
        const pOkx = loadOkxTradeQuotes(held2);
        const pRest = Promise.all([
          loadOkxTradeQuotes([...held2, ...usComponentCodes()], { nowOnly: true }),
          loadUsQuotesAlpaca(null),
        ]);
        const pTx = withCap(loadUsQuotes(null, held2), 8000);
        const pAlp = withCap(accAlpacaQuotes(stockSyms, optSyms), 9000);
        pOkx.then(() => refreshPaint()).catch(() => {});
        pRest.then(() => refreshPaint()).catch(() => {});
        pTx.then(() => refreshPaint()).catch(() => {});
        pAlp.then((patch) => refreshPaint(patch)).catch(() => {});
        await Promise.all([pOkx, pRest, pTx, pAlp]);
      } catch (e) { /* 单次失败跳过，下个周期再试；页面仍显示上一轮的数据 */ }
      refreshing = false;                         // 三路都收工才放行下一轮，避免叠轮
    };
    if (typeof renderTradeList === 'function') renderTradeList();
    aoState.ready = true;
    drawAoChart();

    /* ---- 资金明细弹窗数据：三类账户的每日净值序列（从两个 JSON 读取） ---- */
    // 证券：IBKR 每日净值 totalNetValueDaily，单位 USD（账户本币，弹窗直接显示美元）
    detailState.fx = FX;
    // 外部现金流（入金/出金）→ TWR 剔除项：electronicFundTransfers 是 IBKR 的 EFT 流水
    // （credit=入金、debit=出金，单位 USD），按日汇总（与 value 同为 USD，无需折算）
    const flowMap = {};
    (asset.electronicFundTransfers || []).forEach((t) => {
      const amt = (t.credit || 0) - (t.debit || 0);
      flowMap[t.date] = (flowMap[t.date] || 0) + amt;
    });
    detailState.flows = flowMap;
    detailState.stock = (asset.totalNetValueDaily || []).map((r) => ({
      date: r.date, value: r.value, cur: 'USD', src: 'IBKR 净值', accrued: null,
    }));
    // 现金：暂不展示 —— cashDaily 是盈透的现金余额（可为负 = 融资占用），
    // 与现金页「各银行账户余额」口径不同，先留空避免误读。
    detailState.cash = [];
    // 基金：Σ 基金份额 × 当日净值（nav 数组 [ms 时间戳, 净值]）
    const navDates = new Set();
    funds.forEach((f) => (f.hist || []).forEach((row) => navDates.add(navOnDate(row[0]))));
    // 基金的外部现金流 = 申购（buy）金额，赎回（sell/redeem）视作流出取负
    const fundFlow = {};
    funds.forEach((f) => (f.trades || []).forEach((t) => {
      const amt = (t.shares || 0) * (t.price || 0);
      const isOut = /sell|redeem|out/i.test(t.type || '');
      fundFlow[t.date] = (fundFlow[t.date] || 0) + (isOut ? -amt : amt);
    }));
    detailState.fundFlows = fundFlow;
    detailState.fund = [...navDates].sort().map((d) => {
      let v = 0, ok = false;
      funds.forEach((f) => {
        if (!f.shares) return;
        const nav = navOn(f.hist, d);
        if (nav != null) { v += f.shares * nav; ok = true; }
      });
      return { date: d, value: ok ? v : null, cur: 'CNY', src: 'Σ 份额×净值', accrued: null };
    }).filter((r) => r.value != null);

    /* ---- 收益日历的数据准备（见 calIndex 处的口径说明）----
       ① CAL_FX_MAP：**逐日** USD→CNY（`fund_holdings.json` 的 `usdcnh_daily`，由 fund_holdings.py
          每天从 frankfurter 抓。用户 2026-10-04：「既然每天汇率 json 里都有了，收益日历当然也可以算了」）
       ② TQQQ 股数 + **TQQQ 自己的**日线（`tqqqBars`，Alpaca）
       ③ 校验基金基准：02-06 申购总额应为 483,199.29（用户给的基准值） */
    CAL_FX = FX;
    CAL_FX_MAP = {};
    CAL_FX_KEYS = null;
    /* usdcnh_daily 的 d 形如 '2026-10-02'，统一成 'YYYY-MM-DD'（8 位串也兼容）。 */
    ((fundH && fundH.usdcnh_daily) || []).forEach((r) => {
      const d = String((r && r.d) || '');
      if (!d) return;
      CAL_FX_MAP[/^\d{8}$/.test(d) ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) : d] = +r.c;
    });
    if (!Object.keys(CAL_FX_MAP).length) {
      console.warn('[日历] usdcnh_daily 缺失，逐日汇率退回当前汇率', FX);
    }
    /* TQQQ 股数在 rebuildAoSeries 里是局部变量，这里按同一口径再取一份给日历用
       （⚠️ 别写 `tqqq.tqqqShares` —— 那是 holdings 副本上的字段，原始 tqqq 对象上没有）。 */
    CAL_TQQQ_SHARES = (tqqq && tqqq.trades && tqqq.trades[0] && tqqq.trades[0].shares) || 0;
    /* ⚠️ 用 TQQQ 自己的收盘价，**不是** `qqq_daily`（QQQ ETF，价差 9 倍）。 */
    CAL_TQQQ_MAP = tqqqBars || {};
    if (!Object.keys(CAL_TQQQ_MAP).length) console.warn('[日历] TQQQ 日线缺失，TQQQ 市值按 0 计');
    /* 基准校验 + **基金总成本**（首日基线用）。
       `fundTotalCost` = 全部申购的 shares×price 之和 = 483,199.29(02-06) + 7,779(06-04) = 490,978。
       ⚠️ 旧代码只统计基准日当天的 483,199.29，漏掉 06-04 那笔 → 合计会差 7,779。 */
    {
      let base = 0, total = 0;
      funds.forEach((f) => (f.trades || []).forEach((t) => {
        const c = (t.shares || 0) * (t.price || 0);
        total += c;
        if (t.date === CAL_BASE.fundBaseDate) base += c;
      }));
      CAL_BASE.fundBaseValue = base;
      CAL_BASE.fundTotalCost = total;
      if (Math.abs(base - 483199.29) > 1) {
        console.warn('[日历] 基金基准 %.2f 与预期 483,199.29 不符，请核对申购数据' % base);
      }
    }
    /* 证券本金：forexTrades 的 CNH（已在 CAL_BASE 注释里列明细）。
       只需取出 **TQQQ 那一笔**（按 TQQQ 成交日匹配）当它的首日基线，
       其余三笔（03-20 / 06-25 / 07-15）本质是 IBKR 的本金，已包含在净值里了，
       侧栏也是一次性拿 167,600 去减，所以这里**不再逐日扣**。 */
    {
      const tqqqTradeDate = (tqqq && tqqq.trades && tqqq.trades[0] && tqqq.trades[0].date) || '';
      const cnh = ((asset.forexTrades) || [])
        .filter((t) => t && t.date === tqqqTradeDate)
        .reduce((s2, t) => s2 + (t.cnh || 0), 0);
      CAL_TQQQ_BASE_CNY = cnh > 0 ? cnh : 17600;
      const totalCnh = ((asset.forexTrades) || []).reduce((s2, t) => s2 + ((t && t.cnh) || 0), 0);
      CAL_BASE.stockTotalCny = totalCnh;                    // 展示/核对用，理论 167,599.89
    }
    /* 证券入金（CNY）—— **`forexTrades.cnh`，逐日扣减**（用户 2026-10-04 定稿：
       「日历证券应该是 167600，你把 json 里 CNY 加起来就看出来了」）。
       ⚠️ 不要再用 `electronicFundTransfers`（IBKR 入账，USD，合计 21,841.22 再乘汇率）——
          那是另一个口径：EFT 里 03-18 那笔 1,449.10 USD 在 forexTrades 里根本没有，
          而 TQQQ 的 17,600 也不在 EFT 里（TQQQ 在 IBKR 之外手动买入）。
       forexTrades.cnh 才是**实际掏口袋的人民币**，合计 167,599.89 ≈ 侧栏用的 167,600：
         2026-02-10 17,600.00（TQQQ 买入）→ **已作为 TQQQ 首日基线，这里跳过**
         2026-03-20 99,999.96 / 2026-06-25 39,999.94 / 2026-07-15 9,999.99 → 逐日扣
       ⚠️ 已经是 CNH，**不要再乘汇率**。 */
    CAL_STOCK_FLOW = {};
    {
      const tqqqTd = (tqqq && tqqq.trades && tqqq.trades[0] && tqqq.trades[0].date) || '';
      ((asset.forexTrades) || []).forEach((t) => {
        if (!t || !t.date || !t.cnh) return;
        if (t.date === tqqqTd) return;                     // 已是 TQQQ 的首日基线
        CAL_STOCK_FLOW[t.date] = (CAL_STOCK_FLOW[t.date] || 0) + t.cnh;
      });
    }
  }
  initAccountData();
})();
