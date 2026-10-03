/* =====================================================================
   资产看板 · 行情终端（框架）
   ---------------------------------------------------------------------
   数据层说明：
     - 自选列表（watchlist）：带 instId 的行来自 OKX 公开行情接口（镜像域名
       cnoyu.org）——加密货币走现货（BTC-USDT），股票/指数/商品走 USDT 永续
       （如 ORCL-USDT-SWAP）；其余行（上证指数/美元离岸/10Y/花旗/嘉信）无对应品种，静态占位。
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
    //   - 不带 instId 的行：静态占位（OKX 无对应品种：上证指数/美元离岸/10Y/花旗/嘉信）
    //   - price/pct 为主显示，extPrice/extPct 为次级「盘前」显示
    /* 自选列表。cat = 分类归属（对应顶部 全部/美股/沪深/期货/加密货币 五个 tab）：
       us=美股  cn=A股/沪深  fut=期货  ccy=加密货币  fx=外汇(归入期货)  bond=债券(归入期货)
       market 字段仍保留原始交易所标识（沪深/外汇/NYMEX/CME/US/USDT 等）用于副行显示，两套不要混。 */
    watchlist: [
      // ⚠️ 前三行是**静态行**：OKX 没有对应品种（无 instId），点进去也没有 K 线。
      //   asOf = 数据时间备注，会显示在副行末尾；拉到日频数据后由 fetchFxWatch / fetchTreasuryWatch
      //   覆盖成真实日期，拉不到就保持「快照」（值是硬编码的截图快照，日期无从考证）。
      { code: '000001',  name: '上证指数',           market: '沪深',  cat: 'cn',  price: 3842.19,  pct: 0.31,  extPrice: null,     extPct: null, asOf: '快照' },
      { code: 'USDCNH',  name: '美元/离岸人民币',     market: '外汇',  cat: 'fx',  price: 6.70626,  pct: -0.02, extPrice: null,     extPct: null, asOf: '快照' },
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
    d5:   { bar: '1m',   limit: 1200, label: '5日', sessions: 5 },   // 1m 切最近 5 个美东交易日
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

    // 5日：1m 细粒度按美东日分组，只保留最近 N 个交易日（对齐富途的「5日」分时图）
    if (cfg.sessions) {
      // OKX 1m 单次上限 300 根；一个美东交易日约 390 根，要 N 天就得 ×N 再留余量。
      // 之前写 1200（≈1 天）导致「5日」实际只画得出当天，横轴退化成一个刻度。
      const need = cfg.sessions * 430;
      const raw = await fetchRawCandles(instId, Math.max(cfg.limit || 0, need));
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

  /* 翻页拉取原始 1m K 线（最新在前），拼够 total 根为止（单页上限 300） */
  async function fetchRawCandles(instId, total) {
    const pages = [];
    let fetched = 0, after = null;
    // OKX candles 单次上限 300 根。翻页上限按 total 动态算够，
    // 保证能覆盖调用方要的区间（5日需要 5×390≈1950 根，8 页才够；
    // 写死 6 页只有 1800 根 → 5日图只画得出 1 天）。
    const maxPages = Math.min(12, Math.ceil(total / 300) + 1);
    for (let p = 0; p < maxPages && fetched < total; p++) {
      const url = OKX_API_BASE + '/market/candles?instId=' + encodeURIComponent(instId) +
        '&bar=1m&limit=300' + (after ? '&after=' + after : '');
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

    // 从最新往回找最近的该时段窗口：先跳过更新的非本时段 K 线（head），
    // 再向更早延伸（tail），直到遇到第一个不属于该时段的 K 线
    let head = -1;
    for (let i = 0; i < raw.length; i++) {
      if (sess.match(etMinutes(+raw[i][0]))) { head = i; break; }
    }
    if (head < 0) throw new Error('该时段暂无数据');
    let tail = head;
    while (tail + 1 < raw.length && sess.match(etMinutes(+raw[tail + 1][0]))) tail++;

    // 全天窗口最多 24h（1440 根）
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

    // 无 instId 的行（上证指数/美元离岸/10Y）没有数据源 -> 分时图显示空白背景
    if (!item || !item.instId) {
      APP_DATA.series = null;
      drawChart();
      return;
    }

    try {
      let series;
      if (chartMode === 'time') {
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
  let wlTradeCat = 'all';      // 交易页自选分类（与行情页独立）

  /* ---- 交易页持仓数据（由 initAccountData 数据就绪时填充，见 aoState.series 赋值处） ---- */
  const TRADE_POS = { stock: [], fund: [], fx: 1, totalCny: null, cashCny: 0, ibkrCashCny: 0, ready: false };

  /* 交易页持仓汇总。**推算总资产 = 上面那 8 行的市值之和 + 现金**（用户 2026-10-04 要求：
     「推算总资产不应该是交易里市值加起来吗」）—— 所以这里的两项构成必须与**行内所见**完全同口径：
       持仓市值合计 = Σ证券 valueCny + Σ基金 estAmount（基金用估算市值，即行里那个数）
       现金         = 盈透账户内现金 + 各银行账户现金（都不在持仓列表里，单独列一行）
     与账户总资产差额 = 推算总资产 − 账户页 totalCny（账户页是**账面口径**：基金按官方净值 navL、
       证券按同一时刻实时价），所以它现在 ≈ 基金的实时估值增量（正常几厘到 1 个点），
       不再是恒 0；恒 0 会被「基金估值 vs 官方净值」的差吃掉，反而看不清。 */
  function renderTradeSum() {
    const box = document.getElementById('tradeSum');
    if (!box) return;
    if (!TRADE_POS.ready || TRADE_POS.totalCny == null) { box.hidden = true; return; }
    box.hidden = false;
    const f2 = (v, sign) => {
      if (v == null || !isFinite(v)) return '--';
      const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return (sign ? (v > 0 ? '+' : v < 0 ? '-' : '') : (v < 0 ? '-' : '')) + s;
    };
    const fx = TRADE_POS.fx || 1;
    /* 推算总资产 = **上面 8 行的市值求和 + 现金**（用户 2026-10-04 定稿）。
       市值取值必须与行内所见完全一致，否则「加起来」对不上：
         证券 = tradeValueCny（OKX 价 × 数量），兜底 valueCny → 快照 posVal0
         基金 = estAmount（无估值时回退官方净值市值 amount） */
    let stockNow = 0;
    TRADE_POS.stock.forEach((r) => {
      const v = r.tradeValueCny != null ? r.tradeValueCny
        : (r.valueCny != null ? r.valueCny
          : (r.h && r.h.posVal0 != null ? r.h.posVal0 * fx : null));
      if (v != null) stockNow += v;
    });
    let fundNow = 0;
    TRADE_POS.fund.forEach((f) => { fundNow += (f.estAmount != null ? f.estAmount : f.amount) || 0; });
    const posSum = stockNow + fundNow;                    // 持仓市值合计（= 8 行求和）
    const cashSum = TRADE_POS.ibkrCashCny + TRADE_POS.cashCny;
    const estCny = posSum + cashSum;                      // 推算总资产
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
       证券：现价取 OKX 永续、盈亏 = (OKX 现价 − 账户页现价) × 数量 × FX
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
         涨跌幅 = (OKX 现价 − **账户页那个现价**) ÷ 账户现价（tradePct 是小数，fmtPct 要百分数）。 */
      price: r.pTrade != null ? r.pTrade : r.price, cur: 'USD',
      pct: r.tradePct != null ? r.tradePct * 100 : null,
      // 市值按交易页的 OKX 价算（= 现价 × 份额），与「现价」列自洽
      value: r.tradeValueCny != null ? r.tradeValueCny
          : (r.valueCny != null ? r.valueCny
            : (r.h && r.h.posVal0 != null ? r.h.posVal0 * fx : null)),
      // 「较基准」盈亏 = (OKX 现价 − 账户现价) × 数量 × 汇率
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
      // 悬停提示里拆出汇率那一层：估值是「本币涨跌 × 汇率变动」的合成结果，
      // 报表上看整体涨跌看不出汇率贡献了多少，这里给个数字方便核对。
      fxNote: f.estFxChg != null && f.estChg != null
        ? `估值 ${(f.estChg * 100).toFixed(2)}%（其中汇率 ${f.estFxChg >= 0 ? '+' : ''}${(f.estFxChg * 100).toFixed(3)}%）`
        : '',
    }));
    /* 默认按**市值从大到小**排（用户 2026-10-04 定稿）：一眼看出仓位重心，也和「市值/盈亏」列一致。
       排序用行内那个 value（= 现价 × 份额，证券用 OKX 价、基金用估算市值），
       缺失（null）当 0 沉到末尾。切分类 tab 后仍按同一规则排。 */
    const byValueDesc = (a, b) => (b.value || 0) - (a.value || 0);
    let list = stock.concat(fund).sort(byValueDesc);
    if (wlTradeCat !== 'all') {
      // 交易页分类复用自选分类的取值：us → 证券，ccy/其它 → 全部（基金归到「全部」）
      if (wlTradeCat === 'us') list = stock.slice().sort(byValueDesc);
      else if (wlTradeCat === 'fut' || wlTradeCat === 'ccy') list = [];
    }
    if (!TRADE_POS.ready) {
      ul.innerHTML = '<li class="wl__row wl__row--empty"><span class="wl-name"><b>加载中…</b></span></li>';
      const s0 = document.getElementById('tradeSum'); if (s0) s0.hidden = true;
      return;
    }
    // 汇总按「全部」口径算，不随分类 tab 变（切到「证券」时仍显示整体推算总资产）
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
            <b class="num">${f2(it.value)}</b>
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
      /* 数据时间备注：只给**无 K 线**的静态行加（USDCNH / 10Y 国债 / 上证指数 —— OKX 没有对应品种，
         点进去也没有分时图）。有 instId 的实时行不显示，避免看着像过期数据。
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
    const span = (hi - lo) || 1;
    const yMin = lo - span * 0.08;
    const yMax = hi + span * 0.08;

    const X = (i) => padL + (i / (series.length - 1)) * plotW;
    const Y = (p) => padT + (1 - (p - yMin) / (yMax - yMin)) * plotH;

    // 百分比轴基准：分时用「前一日美东收盘」（与报价头一致，保证图上读数 = 报价头涨跌幅）；
    // K 线周期用「该周期首根收盘」，否则整个周期的涨跌幅会挤在同一侧。
    const prevClose = chartMode === 'time'
      ? (APP_DATA.quote.prevClose || series[0].price)
      : series[0].price;

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

    /* --- 最新价水平线 --- */
    const lastY0 = Y(series[series.length - 1].price);
    ctx.strokeStyle = (APP_DATA.quote.changePct >= 0) ? 'rgba(0,168,107,0.85)' : 'rgba(234,59,59,0.85)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(padL, lastY0); ctx.lineTo(padL + plotW, lastY0); ctx.stroke();
    ctx.setLineDash([]);

    /* --- 最新价标签：左端实时价、右端涨跌幅（与两侧纵轴一致：左价格轴、右百分比轴） --- */
    const lastPrice = series[series.length - 1].price;
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
    const maxVol = Math.max.apply(null, series.map((d) => d.vol)) || 1;
    const bw = Math.max(1, plotW / series.length - 0.4);
    ctx.fillStyle = THEME.volBar;
    for (let i = 0; i < series.length; i++) {
      const h = (series[i].vol / maxVol) * volH;
      ctx.fillRect(X(i) - bw / 2, volTop + volH - h, bw, h);
    }
    ctx.fillStyle = THEME.axisText;
    ctx.textAlign = 'left';
    ctx.fillText('成交量 VOL: ' + fmt(series[series.length - 1].vol, 3), padL, volTop - 4);

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
      for (let i = 0; i < ticks; i++) {
        const idx = Math.round((i / (ticks - 1)) * (series.length - 1));
        ctx.fillText(series[idx].t, X(idx), H - padB / 2 - 2);
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
    renderComments(APP_DATA.comments);
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

      // 自选分类切换：全部 / 美股 / 沪深 / 期货 / 加密货币
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

  /* 左侧 rail 视图切换：自选(行情终端) / 账户 / 交易 */
  (function initViewSwitch() {
    const items = document.querySelectorAll('.rail__item[data-view]');
    const accountView = $('#accountView');
    const tradeView = $('#tradeView');
    if (!items.length || !accountView) return;

    function switchView(view) {
      const isMarket = view === 'market';
      const isTrade = view === 'trade';
      items.forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
      accountView.hidden = isMarket || isTrade;
      if (tradeView) tradeView.hidden = !isTrade;
      // 侧栏迷你走势图：账户视图由 hidden 变可见后 clientWidth 才有值，必须重画一次
      // （账户数据是页面加载时拉的，那时视图还隐藏着，只能画到兜底尺寸）
      if (!isMarket && !isTrade) requestAnimationFrame(drawAccSpark);
      if (isMobile()) {
        // 移动端：账户/交易视图也要把自选/图表让出去，否则两者同屏叠在一起（残影）。
        // 退出时撤掉 is-comment-mode，回到「列表/图表」那一组互斥状态。
        document.body.classList.remove('is-comment-mode');
        if (!isMarket) {
          document.body.classList.remove('is-chart-mode');   // 账户/交易页不显示图表
          const wl = document.querySelector('.watchlist');
          if (wl) wl.classList.add('is-collapsed');          // 也不显示自选列表
        } else if (drawChart) {
          drawChart();
        }
        return;
      }
      ['.watchlist', '.chart-area', '.comment-panel'].forEach((sel) => {
        const el = $(sel);
        if (el) el.classList.toggle('is-hidden-by-view', !isMarket);
      });
      if (isMarket) drawChart();      // 画布重新可见后按新尺寸重绘
    }

    items.forEach((btn) => btn.addEventListener('click', () => {
      // 移动端的「资讯」由移动端专属监听处理（切 body class），
      // 不走这里的桌面版三栏逻辑。
      if (isMobile() && btn.dataset.view === 'comment') return;
      switchView(btn.dataset.view);
    }));

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
        Promise.resolve(initAccountData()).finally(() => { accLoading = false; });
      } else {
        fetchWatchlist();
        fetchFxWatch();
        const sel = APP_DATA.watchlist.find((x) => x.code === APP_DATA.quote.code)
                 || APP_DATA.watchlist.find((x) => x.live)
                 || APP_DATA.watchlist[0];
        if (sel) loadInstrument(sel.code);
      }
    });
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
      // 总览页的 canvas 在 hidden 期间尺寸为 0，切进来时（重）画
      if (cat === 'total') drawAoChart();
      else aoState.hover = null;                    // 离开总览页时清掉十字光标
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
    // 收益日历：切到该 tab 时显示日历、隐藏走势图 + 统计行 + 时间范围按钮（它们对日历无意义）
    const showCal = (on) => {
      const cal = document.getElementById('aoCal');
      const chart = document.getElementById('aoChartWrap');
      const stats = document.getElementById('aoStats');
      const ranges = document.getElementById('aoRanges');
      if (cal) cal.hidden = !on;
      if (chart) chart.style.display = on ? 'none' : '';
      if (stats) stats.style.display = on ? 'none' : '';
      if (ranges) ranges.style.display = on ? 'none' : '';
      if (on) drawAoCal(); else drawAoChart();
    };
    tabs.forEach((b) => b.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.toggle('is-active', x === b));
      aoState.mode = b.dataset.aoTab;
      aoState.hover = null;                           // 切换视图时清掉十字光标
      showCal(b.dataset.aoTab === 'cal');
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
    const sumEl = document.getElementById('accSideSum');
    const KEY = 'futu_acc_side_folded';
    if (side && foldBtn) {
      const apply = (folded) => {
        side.classList.toggle('is-folded', folded);
        foldBtn.setAttribute('aria-expanded', folded ? 'false' : 'true');
        // 高度变了，侧栏迷你走势图和总览页图表都要按新尺寸重画
        requestAnimationFrame(() => { drawAccSpark(); drawAoChart(); });
      };
      // 默认展开（未存过）；只有显式存了 '1' 才折叠
      apply(localStorage.getItem(KEY) === '1');
      foldBtn.addEventListener('click', () => {
        const folded = !side.classList.contains('is-folded');
        apply(folded);
        try { localStorage.setItem(KEY, folded ? '1' : '0'); } catch (e) { /* 隐私模式忽略 */ }
      });
    }

    // 折叠条上要显示总资产 —— 与 .acc-side__total 同步同一个数
    const total = document.getElementById('accTotalVal');
    // 折叠后总资产卡被收起，折叠条左侧的「总资产」就是进总览页的入口（替代它）
    const toTotal = document.getElementById('accSideToTotal');
    if (toTotal) toTotal.addEventListener('click', () => {
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

    // 全屏顶部标题 + 时间范围高亮，跟随 aoState 同步（定义在 openFs 之前，避免 TDZ 隐患）
    const RANGE_LABEL = { '1w': '近1周', '1m': '近1月', 'ytd': '年初至今' };
    const syncFsUi = () => {
      if (!fsTitle) return;
      fsTitle.textContent = (aoState.mode === 'asset' ? '资产走势' : '收益率走势') + ' · ' + (RANGE_LABEL[aoState.range] || '');
      document.querySelectorAll('#aoFsRanges [data-ao-range]').forEach((x) => {
        x.classList.toggle('is-active', x.dataset.aoRange === aoState.range);
      });
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
    // 点图表空白处也能进全屏（按钮区域已在上面 stopPropagation）
    chartWrap.addEventListener('click', (e) => { if (e.target === canvas) openFs(); });
    if (fsClose) fsClose.addEventListener('click', closeFs);
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

  window.addEventListener('resize', () => { drawChart(); drawAoChart(); drawAccSpark(); });
  document.addEventListener('DOMContentLoaded', renderAll);

  // 打开页面默认选中 ORCL，立即拉其报价与分时（不等自选行情返回）
  loadInstrument('ORCL');
  if (document.readyState !== 'loading') renderAll();

  // 顶栏时钟（每秒走字）
  renderBrandClock();
  setInterval(renderBrandClock, 1000);

  // 自选列表接入 OKX 实时行情（启动即拉，每 15s 刷新）
  fetchWatchlist();
  setInterval(fetchWatchlist, 15000);

  /* 持仓行情（交易页 + 账户页证券表）同样 15s 刷新一次。
     入口由 initAccountData 就绪后挂上（TRADE_POS.refresh），这里只负责按点调用；
     两者错开 3s，免得同一秒打两批请求。 */
  setInterval(() => {
    if (typeof TRADE_POS.refresh === 'function') TRADE_POS.refresh();
  }, 18000);

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

  // 美元/离岸人民币：frankfurter 日频参考价（最新 vs 前一交易日），更新自选「外汇」行
  async function fetchFxWatch() {
    try {
      const start = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
      const end = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
      // 同 accJson：fetch 无内置超时，源挂住会一直占着一个 pending
      const r = await Promise.race([
        fetch(`https://api.frankfurter.dev/v1/${start}..${end}?base=USD&symbols=CNY`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ]);
      if (!r.ok) return;
      const d = await r.json();
      const days = Object.keys(d.rates || {}).sort();
      if (!days.length) return;
      const rate = d.rates[days[days.length - 1]].CNY;
      const prev = days.length >= 2 ? d.rates[days[days.length - 2]].CNY : null;
      const row = APP_DATA.watchlist.find((x) => x.code === 'USDCNH');
      if (!row) return;
      row.price = rate;
      row.pct = prev ? +((rate - prev) / prev * 100).toFixed(2) : null;
      row.asOf = days[days.length - 1];      // ECB 参考价的最新可得日期（副行显示用）
      renderWatchlist(APP_DATA.watchlist, APP_DATA.quote.code);
    } catch (e) { console.warn('[汇率] frankfurter 拉取失败：', e); }
  }
  fetchFxWatch();

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
  const aoState = { ready: false, mode: 'return', range: '1w', series: [], hover: null };

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

  /* 分布条 + 图例（品类 / 币种通用） */
  function renderAoDist(barId, legendId, items, total) {
    const bar = document.getElementById(barId);
    const legend = document.getElementById(legendId);
    if (!bar || !legend) return;
    const pctOf = (v) => (total > 0 ? v / total * 100 : 0);
    bar.innerHTML = items.map((it) =>
      `<span style="width:${pctOf(it.val).toFixed(2)}%;background:${it.color}"></span>`
    ).join('');
    legend.innerHTML = items.map((it) =>
      `<li><i class="dot" style="background:${it.color}"></i><span>${it.name}</span><b class="num">${pctOf(it.val).toFixed(2)}%</b></li>`
    ).join('');
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
    if (aoState.range === 'ytd') {
      const ymd = new Date().getFullYear() + '-01-01';
      data = all.filter((p) => p.date >= ymd);
    } else {
      data = all.slice(-(aoState.range === '1m' ? 30 : 7));
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

  /* 顶部统计行默认（未悬停）：区间累计收益 / 收益率 */
  function aoStatDefault() {
    const stats = document.getElementById('aoStats');
    if (stats) stats.classList.remove('is-hover');   // 无光标 → 回到区间统计
    const d = aoGeo.data;
    if (!d || d.length < 2) return;
    const gain = d[d.length - 1].cny - aoGeo.first;
    const pctV = aoGeo.first ? gain / aoGeo.first * 100 : 0;
    aoSetStat(gain, pctV, d[d.length - 1], null);
  }

  function aoSetStat(gain, pctV, point, dayGain) {
    const setT = (id, txt, trend) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = txt;
      el.classList.remove('up', 'down');
      if (trend > 0) el.classList.add('up'); else if (trend < 0) el.classList.add('down');
    };
    setT('aoStatVal', (gain > 0 ? '+' : '') + gain.toFixed(2), gain);
    setT('aoStatPct', (pctV > 0 ? '+' : '') + pctV.toFixed(2) + '%', pctV);
    // 悬停时顶部显示该日净值与当日收益（富途口径）
    const d = aoGeo.data;
    const i = point && point.__i;
    if (d && i != null && dayGain != null) {
      const dt = document.getElementById('aoStatDate');
      const nm = document.getElementById('aoStatName');
      const pc = document.getElementById('aoStatPoint');
      const dg = document.getElementById('aoStatDay');
      if (dt) dt.textContent = aoFormatDate(point.date);
      if (nm) nm.textContent = '资产净值 · CNY';
      if (pc) pc.textContent = point.cny.toFixed(2);
      if (dg) { dg.textContent = (dayGain > 0 ? '+' : '') + dayGain.toFixed(2); dg.classList.remove('up', 'down'); if (dayGain > 0) dg.classList.add('up'); else if (dayGain < 0) dg.classList.add('down'); }
    }
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

    // 顶部统计行同步（悬停时显示该日净值/当日收益，未悬停显示区间累计）
    const stats = document.getElementById('aoStats');
    if (stats) stats.classList.toggle('is-hover', aoState.hover != null);
    if (aoState.hover == null) { aoStatDefault(); return; }
    const gain = d[idx].cny - first;
    const pctV = first ? gain / first * 100 : 0;
    const prev = idx > 0 ? d[idx - 1].cny : null;
    const pt = Object.assign({}, d[idx], { __i: idx });
    aoSetStat(gain, pctV, pt, prev == null ? 0 : d[idx].cny - prev);
  }

  /* 绑定鼠标交互：横向取最近数据点 */
  (function initAoHover() {
    const wrap = document.getElementById('aoChartWrap');
    const canvas = document.getElementById('aoChart');
    if (!wrap || !canvas) return;
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
    wrap.addEventListener('mousemove', (e) => {
      const i = pick(e.clientX);
      if (i == null || i === aoState.hover) return;
      aoState.hover = i;
      drawAoChart();
    });
    wrap.addEventListener('mouseleave', clear);
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

  // TQQQ 买入等 detailState 之外的现金流，由 initAccountData 填进来
  const calExtraFlows = {};

  // 每日外部现金流（CNY 正数=投入）。**惰性求值**：detailState 在本文件更下方才声明
  // （const 有 TDZ），模块加载时立即读取会 ReferenceError。
  let calFlowCache = null;
  function calFlows() {
    if (calFlowCache) return calFlowCache;
    const map = {};
    const add = (d, cny) => { if (d && cny) map[d] = (map[d] || 0) + cny; };
    const fx = (detailState && detailState.fx) || 1;
    Object.keys((detailState && detailState.flows) || {}).forEach((d) => add(d, detailState.flows[d] * fx));
    Object.keys((detailState && detailState.fundFlows) || {}).forEach((d) => add(d, detailState.fundFlows[d]));
    Object.keys(calExtraFlows).forEach((d) => add(d, calExtraFlows[d]));
    calFlowCache = map;
    return map;
  }

  function calIndex() {
    const flows = calFlows();
    // 跳过废值段：totalNetValueDaily 前 28 天净值恒为 1.42（真实值从 03-18 起）
    const all = aoState.series || [];
    const s = all.filter((d, i) => i === 0 || d.cny > 100 || all[i - 1].cny <= 100);
    const byDate = {}, days = [], months = [];
    let mKey = null, cur = null;
    for (let i = 0; i < s.length; i++) {
      const d = s[i];
      const prev = i > 0 ? s[i - 1] : null;
      const fl = prev ? (flows[d.date] || 0) : 0;   // 首日的投入已在基线里，不重复扣
      const gain = prev ? d.cny - prev.cny - fl : null;
      const den = prev ? prev.cny + fl / 2 : null;    // Modified Dietz：分母加当日投入的一半
      const pct = den ? gain / den * 100 : null;
      const rec = { date: d.date, cny: d.cny, gain, pct, flow: fl };
      byDate[d.date] = rec;
      days.push(rec);
      const ym = d.date.slice(0, 7);
      if (ym !== mKey) { mKey = ym; cur = { ym, y: +d.date.slice(0, 4), m: +d.date.slice(5, 7) - 1, first: d.cny, last: d.cny }; months.push(cur); }
      cur.last = d.cny;
    }
    // own = 本月自己的净收益；gain = 截至本月的累计净收益；
    // pct = **本月**收益率（own ÷ 上月末净值），不是累计 —— 否则亏损月会显示正的累计收益率
    let run = 0;
    for (let i = 0; i < months.length; i++) {
      const prevBase = i > 0 ? months[i - 1].last : months[i].first;
      months[i].days = days.filter((d) => d.date.slice(0, 7) === months[i].ym);
      months[i].own = months[i].days.reduce((s2, d) => s2 + (d.gain || 0), 0);
      run += months[i].own;
      months[i].gain = run;
      months[i].pct = prevBase ? months[i].own / prevBase * 100 : null;
    }
    return { byDate, days, months };
  }

  function calFmt(n) {
    if (n == null) return '--';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    // 区间合计：年视图 = 该年各月 own 之和；月视图 = 该月 own
    const months = idx.months.filter((x) => x.y === calState.y && (isYear || x.m === calState.m));
    const gain = months.reduce((s, x) => s + (x.own || 0), 0);
    const base = (() => {
      if (!months.length) return null;
      const i0 = idx.months.indexOf(months[0]);
      return i0 > 0 ? idx.months[i0 - 1].last : months[0].first;
    })();
    sumLbl.textContent = (isYear ? calState.y + '年收益 · CNY' : (calState.m + 1) + '月收益 · CNY');
    sumEl.textContent = (gain > 0 ? '+' : '') + calFmt(gain);
    sumEl.className = 'num ' + calCls(gain);
    pctEl.textContent = calPctText(base ? gain / base * 100 : null);
    pctEl.className = 'num ' + calCls(base ? gain / base * 100 : null);
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
  const ACC_SORT = {
    stock: { key: null, dir: -1 }, fund: { key: null, dir: -1 }, cash: { key: null, dir: -1 },
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
        `${ACC_API}/v2/stocks/bars?symbols=TQQQ&timeframe=1Day&start=${firstDate}&limit=400&feed=iex`,
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
         给每批请求加 4s 上限：超时 → res 保持为空 → 后面走 JSON 兜底口径
         （市值用 holdings[].positionValue，价格用 markPrice）。 */
      const withTimeout = (p, ms) => Promise.race([
        p, new Promise((r) => setTimeout(r, ms)),
      ]);

      await withTimeout(Promise.all([
        stockSyms.length && accJson(`${ACC_API}/v2/stocks/trades/latest?symbols=${stockSyms.join(',')}`, { headers: ACC_HDR })
          .then((d) => { if (d && d.trades) for (const [k, v] of Object.entries(d.trades)) { const t = v.trade || v; put(res.stock, k, { price: t ? t.p : null }); } }),
        stockSyms.length && accJson(`${ACC_API}/v2/stocks/bars?symbols=${stockSyms.join(',')}&timeframe=1Day&start=${start}&limit=30`, { headers: ACC_HDR })
          .then((d) => { if (d && d.bars) for (const [k, v] of Object.entries(d.bars)) { const [now, prev] = prevCloseOf(v); put(res.stock, k, { price: now, prevClose: prev }); } }),
        optSyms.length && accJson(`${ACC_API}/v1beta1/options/snapshots?symbols=${optSyms.join(',')}`, { headers: ACC_HDR })
          .then((d) => {
            if (!d || !d.snapshots) return;
            for (const [k, s] of Object.entries(d.snapshots)) {
              const qt = s.latestQuote || {};
              const mid = (qt.bp > 0 && qt.ap > 0) ? (qt.bp + qt.ap) / 2 : (s.dailyBar ? s.dailyBar.c : null);
              put(res.opt, k, { price: mid });
            }
          }),
        optSyms.length && accJson(`${ACC_API}/v1beta1/options/bars?symbols=${optSyms.join(',')}&timeframe=1Day&start=${start}&limit=30`, { headers: ACC_HDR })
          .then((d) => { if (d && d.bars) for (const [k, v] of Object.entries(d.bars)) { const [, prev] = prevCloseOf(v); put(res.opt, k, { prevClose: prev }); } }),
      ]), 4000);
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
    let FX = seed.pa_fx || 7;                 // 兜底：Asset_parsed.json 的手工汇率
    /* frankfurter 只作「锦上添花」的实时汇率，失败就用 pa_fx。
       accJson 里已有 8s 上限，这里再压到 3s：不可达时不该让整页干等，
       汇率差 0.1% 对总资产影响远小于加载延迟带来的体感损失。 */
    try {
      const fxr = await Promise.race([
        accJson('https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY'),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      if (fxr && fxr.rates && fxr.rates.CNY) FX = fxr.rates.CNY;
    } catch (e) {}

    /* ---- 汇率序列（QDII 基金的外汇敞口）—— 基金是人民币计价，资产是外币，
         人民币净值 = Σ(外币资产 × 该货币兑人民币)，所以估值必须叠加一层汇率变动。
         一次请求拿全币种：`?base=USD&symbols=CNY,JPY,KRW,HKD`，其余币种用交叉汇率：
             XXX/CNY = (USD/CNY) ÷ (USD/XXX)
         ⚠️ 不要直接请求 `?base=KRW&symbols=CNY`：KRW/CNY ≈ 0.005 只给到 3 位有效数字，
            日间 0.4% 的波动会被四舍五入吃掉一大半；走 USD 交叉（USD/KRW ≈ 1353，5 位有效）
            精度高一个量级。同理 JPY/CNY ≈ 0.0426 也只有 3 位。
         数据是欧洲央行日频参考价（北京时间约 16:00 出当日，周末/欧洲假期不更新）。 */
    const FX_SERIES = {};                 // { USD: [{ d:'20260929', v:6.7034 }, …], JPY: […], KRW: […], HKD: […] }
    /* ---- 估值是否叠加「期间汇率变动」—— 2026-10-03 用户定稿：**叠加** ----
       基金是人民币计价、资产是外币，人民币净值 = Σ(外币资产 × 该货币兑人民币)，
       所以每个成分都要在本币涨跌上再乘一层该货币兑人民币的涨跌（详见 estimateFund / fxChgOn）。
       实测 frankfurter 是可达的（curl 与浏览器都能取到 9-25~10-02 的序列），
       但偶发超时 —— 所以加了 localStorage 缓存：拉到就存，拉不到就用上一份（日频数据，隔天不失真）。
       要临时退回「不含汇率」的口径，把这里改成 false 即可（下面 3 处调用会跟着走）。 */
    const FX_IN_VAL = true;
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
    const VAL = { qqq: [], dq: {}, splits: {}, dqDirty: new Set(), okx: {} };
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
       非美标的用复权后的序列（拆股已前复权，见上）；美股 OKX 永续自带连续合约处理。
       ⚠️ 返回的是**本币**涨跌，人民币口径要再乘汇率（见 estimateFund 里的 toCny）。 */
    /* OKX 股票永续只挂**一个**上市代码：谷歌只有 GOOGL，没有 GOOG-USDT-SWAP。
       而部分基金的季报持仓写的是 GOOG（谷歌-C），直接查会 404 → 该股被判为「未知」走 QQQ 兜底。
       两者同为 Alphabet 普通股，价格长期贴合约 0.1%，所以 GOOG 直接复用 GOOGL 的行情。 */
    const OKX_ALIAS = { GOOG: 'GOOGL' };
    const okxInst = (code) => `${OKX_ALIAS[code] || code}-USDT-SWAP`;

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
        if (/^QQQ$/i.test(code)) return qqqChgOn(baseDate);    // QQQ 走专用日线
        const k = code.toUpperCase();
        // 读行情时也要过别名：拉的是 GOOGL 的合约，持仓/重仓里写的却是 GOOG
        const ok = VAL.okx[k] || (OKX_ALIAS[k] ? VAL.okx[OKX_ALIAS[k]] : null);
        if (ok && ok.base != null && ok.now != null && ok.base > 0) return ok.now / ok.base - 1;
        return null;                                        // → QQQ 兜底
      }
      return pick(VAL.dq[mkt + code]);                      // jp285A / kr000660 / hk02513 / sz300408
    }

    /* 拉美股行情（两个用途）：
       ① 基金估值：基准 = 基金净值日的美东收盘（OKX 1H 线 15:00-16:00 那根），最新 = ticker 现价；
       ② 证券现价：Alpaca 不可达时用 OKX 现价补上（TQQQ 也要，它不在 funds.items 里）。
       `baseDate` 为空时只取现价（不找基准），供 ② 使用。
       ⚠️ 必须**限流**：一次 Promise.all 打 20+ 个并发会被 OKX 返 429（实测持仓股 ORCL/TQQQ
       恰好排在最后被限流掉，现价变 `--`）。这里分批 4 个 + 429 退避重试。 */
    const okxGet = async (url, tries) => {
      for (let i = 0; i <= (tries || 2); i++) {
        const r = await fetch(url);
        if (r.status === 429) { await new Promise((s) => setTimeout(s, 350 * (i + 1))); continue; }
        return r.json();
      }
      return null;
    };
    const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

    async function loadUsQuotes(baseDate, extraCodes) {
      const codes = new Set();
      funds.forEach((f) => (f.items || []).forEach((it) => { if (it.m === 'us' && !/^QQQ$/i.test(it.c)) codes.add(it.c.toUpperCase()); }));
      (extraCodes || []).forEach((c) => codes.add(String(c).toUpperCase()));
      if (!codes.size) return;
      /* 按**实际合约**去重：GOOG 与 GOOGL 都指向 GOOGL-USDT-SWAP，
         不合并会白打一次请求（还多占一次 429 额度）。 */
      const instMap = new Map();                          // instId -> 需要这个合约的原始代码[]
      [...codes].forEach((c) => {
        const inst = okxInst(c);
        if (!instMap.has(inst)) instMap.set(inst, []);
        instMap.get(inst).push(c);
      });
      const batches = chunk([...instMap.keys()], 4);      // 4 个一批，避免 429
      for (const batch of batches) {
        await Promise.all(batch.map(async (inst) => {
          try {
            let base = null;
            if (baseDate) {
              const j = await okxGet(`${OKX_API_BASE}/market/candles?instId=${inst}&bar=1H&limit=120`);
              const rows = ((j && j.data) || []).map((x) => ({ ts: +x[0], close: +x[4] }));
              for (const it of rows) {
                const d = new Date(it.ts);
                const et = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
                const etH = Number(d.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit' }));
                if (et === baseDate && etH >= 15 && etH < 16) base = it.close;
              }
            }
            const tj = await okxGet(`${OKX_API_BASE}/market/ticker?instId=${inst}`);
            const now = (tj && tj.data && tj.data[0]) ? +tj.data[0].last : null;
            if (now != null) {
              // ⚠️ 合并而非覆盖：loadUsQuotes 会被调用两次（先基金重仓带 baseDate、
              //    再持仓股 baseDate=null），若直接 `= { now, base }` 会把上一轮拿到的
              //    基准价清成 null，基金估值就全退回 QQQ 兜底了。
              (instMap.get(inst) || []).forEach((c) => {
                VAL.okx[c] = VAL.okx[c] || {};
                VAL.okx[c].now = now;
                if (base != null) VAL.okx[c].base = base;
              });
            }
          } catch (e) { /* 单个失败就走 QQQ 兜底 / 快照兜底 */ }
        }));
      }
      // 持仓股再补一次「昨收」：只拉现价(baseDate 为 null)时 prevClose 是空的，
      // 交易页涨跌列会一直显示 --。取**最近一根已完结**的日线收盘。
      const held = (extraCodes || []).map((c) => String(c).toUpperCase());
      if (held.length) {
        const todayUtc = new Date().toISOString().slice(0, 10);
        await Promise.all(held.map(async (c) => {
          if (!VAL.okx[c] || VAL.okx[c].prevClose) return;
          try {
            const j = await okxGet(`${OKX_API_BASE}/market/candles?instId=${okxInst(c)}&bar=1Dutc&limit=6`);
            const rows = ((j && j.data) || []).map((x) => ({
              d: new Date(+x[0]).toISOString().slice(0, 10), close: +x[4],
            })).sort((a, b) => (a.d < b.d ? -1 : 1));
            // ⚠️ 不能用「倒数第二根」：OKX 当天那根日线会随行情实时变动（收 10-02 的盘时
            // 最老一根就是今天，close 已等于现价），取倒数第二根会得到 ≈0% 的假涨跌。
            // 正确做法：取**日期早于今天**的最后一根。
            let prev = null;
            for (const r of rows) if (r.d < todayUtc) prev = r;
            if (prev) VAL.okx[c].prevClose = prev.close;
          } catch (e) {}
        }));
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
      const qc = qqqChgOn(baseDate);                       // 本基金基准日下的 QQQ 涨幅（兜底用）
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
      // 汇率序列只在开关打开时才拉（frankfurter 本机不可达，关着就省掉一次 6s 空等）
      await Promise.all([loadUsQuotes(usBase), FX_IN_VAL ? loadFxSeries(back) : Promise.resolve()]);
    }
    let fundAmount = 0, fundYesterday = 0, fundCum = 0;
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
    const fundTbody = $id('fundTbody');
    if (fundTbody) {
      // 排序键挂到行对象上：funds 已带 name/code/amount/shares/yest/cum
      funds.forEach((f) => { f.cur = 'CNY'; });
      ACC_RENDERERS.fund = () => {
        fundTbody.innerHTML = accSorted('fund', funds).map((f) =>
          `<tr><td>${f.name}</td><td class="num">${f.code}</td>` +
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
    setTxt('fundSumVal', f2(fundAmount));
    setTxt('fundSumYesterday', f2(fundYesterday, true), fundYesterday);
    setTxt('fundSumProfit', f2(fundCum, true), fundCum);
    setTxt('fundMYest', f2(fundYesterday, true), fundYesterday);
    setTxt('fundMCum', f2(fundCum, true), fundCum);
    // 净值更新日期：QDII 各基金滞后天数不同，取**最旧**那个日期（最保守，不会让人误以为数据更新）
    // ⚠️ 变量名不要用 navDates —— 下面「历史·净值」段已用同名（`new Set()`），const 重名会直接语法报错。
    const fundNavDates = funds.map((f) => f.navDate).filter(Boolean).sort();
    setTxt('fundNavDate', fundNavDates.length ? fundNavDates[0] : '--');
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
        fundHistBody.innerHTML = accSorted('fundH', fundOrders).map((r) =>
          `<tr><td>${r.type} <span class="td-code">已完成</span></td>` +
          `<td>${r.name}</td>` +
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
        cashTbody.innerHTML = accSorted('cash', cashRows).map((r) =>
          `<tr><td>${r.note}</td><td class="num">--</td>` +
          `<td class="num">${f2(r.cny)}</td><td class="num">${f2(r.bal)}</td>` +
          `<td class="num">--</td><td class="num">--</td><td class="num">--</td><td class="num">--</td>` +
          `<td class="num">--</td><td class="num">--</td><td>${r.cur}</td></tr>`
        ).join('');
      };
      accRender('cash');
    }
    setTxt('cashSumVal', f2(cashCny));
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
      return { raw: h.symbol.trim(), occ: flat, opt: isOpt, name, code, pos: h.position, cost: h.costBasisPrice, mark0: h.markPrice, posVal0: h.positionValue };
    });
    const tqqq = (seed.pa_us && seed.pa_us[0]) || null;
    if (tqqq) holdings.push({ raw: tqqq.symbol, occ: tqqq.symbol, opt: false, name: tqqq.name, code: tqqq.symbol, pos: 0, cost: 0, mark0: 0, posVal0: 0, tqqqShares: (tqqq.trades && tqqq.trades[0] && tqqq.trades[0].shares) || 0, tqqqCost: (tqqq.trades && tqqq.trades[0] && tqqq.trades[0].price) || 0 });

    const stockSyms = holdings.filter((h) => !h.opt).map((h) => h.code);
    const optSyms = holdings.filter((h) => h.opt).map((h) => h.occ);
    const q = await accAlpacaQuotes(stockSyms, optSyms);
    await accTqqqDaily();        // TQQQ 全区间日线（总资产曲线要用）

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
        //    Alpaca → OKX → 快照，三级兜底由下方统一处理。
        pAcct = s.price; prevClose = s.prevClose;
        qty = h.tqqqShares; cost = h.tqqqCost;
      } else {
        const s = (qq && qq.stock && qq.stock[h.code]) || {};
        pAcct = s.price; prevClose = s.prevClose;
        qty = h.pos; cost = h.cost;
      }
      /* ① 账户页现价 pAcct：Alpaca → OKX → 快照（IBKR markPrice）。
         ⚠️ Alpaca 已有价时**不覆盖**：它是真实正股报价，休市日就停在上一个收盘（正确的行为）。 */
      const k = String(h.code || '').toUpperCase();
      const ok = VAL.okx[k] || (OKX_ALIAS[k] ? VAL.okx[OKX_ALIAS[k]] : null);
      if (pAcct == null || !(pAcct > 0)) {
        if (ok && ok.now) { pAcct = ok.now; src = 'okx'; if (!(prevClose > 0)) prevClose = ok.prevClose != null ? ok.prevClose : prevClose; }
        else if (h.tqqqShares != null && tqqq.price) { pAcct = tqqq.price; src = '快照'; }
      }
      /* ② 交易页现价 pTrade：**OKX 优先**（用户 2026-10-04 定稿）。
         OKX 股票永续 7×24 连续报价，盘中/周末都在动，能反映当下真实价格；
         账户页那个是 IBKR/Alpaca 的休市快照价。两者之差就是交易页的「较基准涨跌」。
         OKX 取不到时才回落账户价，保证不出现空行。 */
      const pTrade = (ok && ok.now) ? ok.now : pAcct;
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
    /* 持仓股票也拉一遍 OKX 行情（Alpaca 不可达时靠它给现价）。
       holdings 在这里才声明完，所以补拉放在 forEach 之前。 */
    await loadUsQuotes(null, holdings.filter((h) => !h.opt).map((h) => h.code).filter(Boolean));
    holdings.forEach((h) => {
      const r = computeRow(h, q);
      if (r.value != null) rtPosVal += r.value;
      else if (h.posVal0 != null) rtPosVal += h.posVal0;   // 取不到实时价 → 用 JSON 快照市值兜底
      if (r.todayPnl != null) todayPnlUsd += r.todayPnl;
      rows.push(r);
    });

    if (stockTbody) {
      // 排序键 code/name/valueCny/pnlCny/todayCny 已由 computeRow 一并写入
      ACC_RENDERERS.stock = () => {
        stockTbody.innerHTML = accSorted('stock', rows).map((r) => {
          // 价格列用 USD 原值（期权 3 位小数，便于和市值对账），金额列（市值/盈亏）折 CNY
          const c = (v) => v == null ? '--' : v * FX;
          const pf = (v) => v == null ? '--' : (r.mult === 100 ? v.toFixed(3) : f2(v));
          const cls = (v) => v > 0 ? 'up' : v < 0 ? 'down' : '';
          return `<tr><td>${r.code}</td><td>${r.name}</td>` +
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
    }
    /* 证券口径的全部汇总 DOM。抽成函数是为了让 15s 定时刷新能重画
       （原来这些 setTxt 只在初始化跑一次，行情变了数字不动）。 */
    function renderStockSum() {
      const posVal = () => rows.reduce((s, r) => s + (r.value != null ? r.value : (r.h.posVal0 || 0)), 0);
      const longVal = () => rows.filter((r) => r.value != null && r.qty > 0).reduce((s, r) => s + r.value, 0);
      const shortVal = () => rows.filter((r) => r.value != null && r.qty < 0).reduce((s, r) => s + r.value, 0);
      const todayUsd = () => rows.reduce((s, r) => s + (r.todayPnl || 0), 0);
      const rtVal = posVal();
      const stockEquityCny = (ibkrCash + rtVal) * FX;
      const stockTodayCny = todayUsd() * FX;
      const stockPnlCny = rows.reduce((s, r) => s + (r.pnl || 0), 0) * FX;
      // 证券累计盈亏（CNY）= 证券权益实时折算 − 人民币本金 167,600（forexTrades 四笔 CNH 合计，含 TQQQ 的 17,600）
      // 口径：实际掏口袋的人民币，换汇手续费/点差自动计入盈亏；usInvest=167600 互证
      const stockCumCny = stockEquityCny - 167600;
      setTxt('stockSumVal', f2(rtVal * FX));
      setTxt('stockSumToday', f2(stockTodayCny, true), stockTodayCny);
      setTxt('stockSumPnl', f2(stockPnlCny, true), stockPnlCny);
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
      usdNote('mPnlTotalUsd', (ibkrCash + rtVal) - 167600 / FX);
      // 证券净值 = 证券账户权益 = (盈透现金 + 持仓实时市值) 折 CNY，与「总资产」里的证券口径一致
      setTxt('mStockEquity', f2(stockEquityCny));
      usdNote('mStockEquityUsd', ibkrCash + rtVal);
      // 现金总值（已并入「资产」卡，排在证券净值上面）= 盈透账户现金折 CNY，右侧括注美元原值
      setTxt('mCashCny', f2(ibkrCash * FX));
      usdNote('mCashUsd', ibkrCash);
      setTxt('accStockVal', f2(stockEquityCny));
      setTxt('accStockNote', f2(stockTodayCny, true), stockTodayCny);
      setTxt('accStockPct', stockEquityCny - stockTodayCny ? pctS(stockTodayCny / (stockEquityCny - stockTodayCny)) : '--', stockTodayCny);
      setTxt('accStockCum', f2(stockCumCny, true), stockCumCny);
      // 累计涨跌幅 = 累计盈亏 ÷ 本金 167,600（与上一行同源口径）
      setTxt('accStockCumPct', pctS(stockCumCny / 167600), stockCumCny);
    }
    renderStockSum();
    const stockEquityCny = (ibkrCash + rtPosVal) * FX;   // ↓ 供下方总资产/曲线沿用
    const stockTodayCny = todayPnlUsd * FX;
    const stockPnlCny = rows.reduce((s, r) => s + (r.pnl || 0), 0) * FX;
    const stockCumCny = (ibkrCash + rtPosVal) * FX - 167600;

    /* ---- 历史·成交（Asset_parsed.trades 88 条 + TQQQ 手动买入） ---- */
    // 证券持仓表已有名称映射，复用它把期权 symbol 拆成「名称 + 代码」
    const nameOf = {};
    holdings.forEach((h) => { nameOf[h.code] = h.name; });
    const tradeRows = (asset.trades || []).map((t) => {
      const flat = String(t.symbol || '').replace(/\s+/g, '');
      const isOpt = /\d{6}[CP]\d{8}$/.test(flat);
      let name = flat, code = flat, mult = 1;
      if (isOpt) {
        const m = flat.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
        if (m) { name = `${m[1]} ${m[2]} ${parseInt(m[4], 10) / 1000} ${m[3] === 'C' ? 'call' : 'put'}`; code = m[1]; mult = 100; }
      } else if (nameOf[flat]) { name = nameOf[flat]; }
      const qty = Math.abs(t.quantity || 0);
      const isSell = /^SELL/i.test(t.buySell || '');
      return {
        name, code, side: isSell ? '卖出' : '买入',
        price: t.price,
        amount: qty * (t.price || 0) * mult,              // 成交金额按原币（USD），与「币种」列一致
        amountCny: qty * (t.price || 0) * mult * FX,      // 头部「总成交额: CNY」用
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
        name: u.name || u.symbol, code: u.symbol, side: isSell ? '卖出' : '买入',
        price: t.price, amount: amt, amountCny: amt * FX, realized: null, qty,
        date: t.date, market: '美股', cur: 'USD', decimals: 2,
        _sortSide: isSell ? 1 : 0,
      });
    }));
    const stockHistBody = $id('stockHistBody');
    if (stockHistBody) {
      ACC_RENDERERS.stockH = () => {
        stockHistBody.innerHTML = accSorted('stockH', tradeRows).map((r) =>
          `<tr><td>${r.name} <span class="td-code">${r.code}</span></td>` +
          `<td class="${r._sortSide ? 'down' : 'up'}">${r.side}</td>` +
          `<td class="num">${r.price == null ? '--' : r.price.toFixed(r.decimals)}</td>` +
          `<td class="num">${f2(r.amount)} / ${r.qty}</td>` +
          `<td class="num">${r.date}</td><td>${r.market}</td><td>${r.cur}</td>` +
          `<td class="num ${r.realized == null ? '' : r.realized > 0 ? 'up' : r.realized < 0 ? 'down' : ''}">` +
          `${r.realized == null ? '--' : f2(r.realized, true)}</td></tr>`
        ).join('');      };
      accRender('stockH');
      const amtSum = tradeRows.reduce((s, r) => s + (r.amountCny || 0), 0);
      setTxt('stockHistCount', tradeRows.length, 1);
      setTxt('stockHistAmt', f2(amtSum), amtSum);
      const realSum = tradeRows.reduce((s, r) => s + (r.realized || 0), 0);
      setTxt('stockHistRealized', f2(realSum, true), realSum);
    }

    /* ---- 侧栏总资产 + 走势 ----
       抽成函数：15s 刷新时证券实时价会变，总资产/今日盈亏/累计盈亏都得跟着重算，
       否则账户页「证券表在跳、总资产不动」。基金按官方净值（fundAmount）不随盘中变。 */
    function renderAccTotal() {
      const rtVal = rows.reduce((s, r) => s + (r.value != null ? r.value : (r.h.posVal0 || 0)), 0);
      const eqCny = (ibkrCash + rtVal) * FX;
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
    const totalCny = renderAccTotal();
    const nv = asset.totalNetValueDaily || [];
    const tail = nv.slice(-80);
    ACC_SPARK.series = tail.map((p) => p.value);
    drawAccSpark();

    /* ---- 全部账户总览页：品类/币种分布 + 每日总资产序列 ---- */

    renderAoDist('aoCatBar', 'aoCatLegend', [
      { name: '现金', val: cashCny,        color: '#00a86b' },
      { name: '股票', val: stockEquityCny, color: '#13c2c2' },
      { name: '基金', val: fundAmount,     color: '#2e6bff' },
    ], totalCny);
    const cnyPart = fundAmount + cashRows.filter((r) => r.cur !== 'USD').reduce((s, r) => s + r.bal, 0);
    renderAoDist('aoCurBar', 'aoCurLegend', [
      { name: '美元（含折算）', val: totalCny - cnyPart, color: '#2e6bff' },
      { name: '人民币',         val: cnyPart,            color: '#ff8f1f' },
    ], totalCny);

    /* 每日总资产 = IBKR 净值×FX + TQQQ 市值 + Σ基金份额×当日nav + 现金常数；
       末点替换/追加为实时总资产，与侧栏数字一致。
       ⚠️ TQQQ 必须在历史点里按日补上：IBKR 的 totalNetValueDaily 不含它（TQQQ 是 IBKR 之外
       手动买入的，存在 seed.pa_us），而侧栏 stockEquityCny 含它 —— 漏补会让所有历史点
       整体偏低约 2.9 万 CNY，末点换成实时值时曲线末端假跳升。 */
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
      return { date: row.date, cny: row.value * FX + tqqqValueOn(row.date) * FX + fundPart + cashCny };
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
      if (aoSeries[aoSeries.length - 1].date === todayBj) aoSeries[aoSeries.length - 1].cny = projCny;
      else aoSeries.push({ date: todayBj, cny: projCny });
    }
    aoState.series = aoSeries;

    /* ---- 交易视图用：把证券 / 基金持仓发布出去 ----
       交易页那份列表要显示「市值 / 盈亏」和持仓汇总，只有持仓才有这些数（自选列表没有仓位概念），
       所以把 rows / funds / 账户总资产挂到共享对象上，交易页去读。渲染函数随后会重画。 */
    TRADE_POS.stock = rows.filter((r) => r.qty);          // 剔除已清仓（qty=0）
    TRADE_POS.fund = funds.filter((f) => f.shares);
    TRADE_POS.splits = VAL.splits;      // 识别到的拆股（键 = 市场+代码），供调试/展示
    if (window.__VALDEBUG) window.__VALDEBUG(VAL, funds, symbolChg, qqqChgOn);
    TRADE_POS.fx = FX;
    TRADE_POS.totalCny = totalCny;      // 账户页口径：证券权益 + 基金 + 现金
    TRADE_POS.cashCny = cashCny;        // 各银行账户现金
    TRADE_POS.ibkrCashCny = ibkrCash * FX;  // 盈透账户内现金（未投出去的部分）
    TRADE_POS.ready = true;
    /* 行情定时刷新入口（15s，与自选列表同频，由模块级定时器调用）。
       为什么要它：交易页原先只在初始化取一次价，页面开着不动就永远停在打开那一刻的数
       （用户 2026-10-04 报「ORCL 现价还是 142.41」）—— 严格说那次是周末休市、
       Alpaca 最后成交就是 10-02 收盘的 142.41，价格本就不该动；但盘中开着不动也必须会动。
       ⚠️ 基金估值只更新现价部分：`loadUsQuotes(baseDate=null)` 会刷 `now` 而**保留** `base`
          （估值基准仍是各基金自己的 navDate），然后重跑 estimateFund。 */
    TRADE_POS.refresh = async () => {
      if (document.hidden) return;                 // 页面不可见时省一次请求
      try {
        const q2 = await accAlpacaQuotes(stockSyms, optSyms);
        await loadUsQuotes(null, holdings.filter((h) => !h.opt).map((h) => h.code).filter(Boolean));
        rows.forEach((r) => { Object.assign(r, computeRow(r.h, q2)); });   // 原地更新，引用不变
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
        TRADE_POS.totalCny = renderAccTotal();     // 账户页总资产跟着现价走，别让两边脱节
        if (typeof renderTradeList === 'function') renderTradeList();
      } catch (e) { /* 单次失败跳过，下个周期再试；页面仍显示上一轮的数据 */ }
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

    /* ---- 收益日历用的 TQQQ 买入现金流 ----
       TQQQ 在 seed.pa_us 里，既不在 detailState.flows（IBKR 入金）也不在 fundFlows（基金申购），
       但它的买入当天总资产会跳升、却不是收益，必须单独登记，否则日历会虚高。 */
    Object.keys(calExtraFlows).forEach((k) => delete calExtraFlows[k]);
    ((asset.seed && asset.seed.pa_us) || []).forEach((a) => (a.trades || []).forEach((t) => {
      const cny = (t.amount != null ? t.amount : (t.shares || 0) * (t.price || 0)) * FX;
      calExtraFlows[t.date] = (calExtraFlows[t.date] || 0) + cny;
    }));
  }
  initAccountData();
})();
