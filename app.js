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
    watchlist: [
      { code: '000001',  name: '上证指数',           market: '沪',    price: 3842.19,  pct: 0.31,  extPrice: null,     extPct: null },
      { code: 'USDCNH',  name: '美元/离岸人民币',     market: '外汇',  price: 6.70626,  pct: -0.02, extPrice: null,     extPct: null },
      { code: '10Ymain', name: '10年国债收益率期货',  market: '债',    price: 5.223,    pct: -0.44, extPrice: null,     extPct: null },
      { code: 'CLmain',  name: 'WTI原油期货主连',     market: 'NYMEX', price: 90.30,    pct: 1.03,  extPrice: null,     extPct: null, instId: 'CL-USDT-SWAP',   live: true },
      { code: 'TQQQ',    name: '三倍做多纳指ETF',     market: 'US',    price: 77.460,   pct: 0.55,  extPrice: 78.300,   extPct: 1.08, instId: 'TQQQ-USDT-SWAP', live: true },
      { code: 'NQmain',  name: '纳斯达克100指数期货', market: 'CME',   price: 30723.25, pct: 0.36,  extPrice: null,     extPct: null, instId: 'US100-USDT-SWAP', live: true },
      { code: 'ORCL',    name: '甲骨文',             market: 'US',    price: 137.790,  pct: 3.91,  extPrice: 137.095,  extPct: -0.50, instId: 'ORCL-USDT-SWAP', live: true },
      { code: 'NVDA',    name: '英伟达',             market: 'US',    price: 227.210,  pct: -0.72, extPrice: 228.799,  extPct: 0.70, instId: 'NVDA-USDT-SWAP', live: true },
      { code: 'MSFT',    name: '微软',               market: 'US',    price: 508.960,  pct: -0.05, extPrice: 510.240,  extPct: 0.25, instId: 'MSFT-USDT-SWAP', live: true },
      { code: 'SNDK',    name: '闪迪',               market: 'US',    price: 1729.760, pct: 0.98,  extPrice: 1735.940, extPct: 0.36, instId: 'SNDK-USDT-SWAP', live: true },
      { code: 'HOOD',    name: '罗宾汉',             market: 'US',    price: 122.300,  pct: 2.85,  extPrice: null,     extPct: null, instId: 'HOOD-USDT-SWAP', live: true },
      { code: 'BTC-USDT', name: 'BTC', market: 'USDT', price: 0, pct: 0, extPrice: null, extPct: null, instId: 'BTC-USDT', live: true },
      { code: 'OKB-USDT', name: 'OKB', market: 'USDT', price: 0, pct: 0, extPrice: null, extPct: null, instId: 'OKB-USDT', live: true },
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

    // 5日：1m 细粒度按美东日分组，只保留最近 N 个交易日（对齐富途的「五日」分时图）
    if (cfg.sessions) {
      const raw = await fetchRawCandles(instId, cfg.limit);
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
    for (let p = 0; p < 6 && fetched < total; p++) {
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

  function renderWatchlist(list, activeCode) {
    const ul = $('#watchlist');
    const session = usSession();                    // 美股延长时段标签（盘中为 null）
    ul.innerHTML = list.map((it) => {
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

      return `
        <li class="wl__row${active}" data-code="${it.code}">
          <span class="wl-name">
            <b>${it.name}</b>
            <span>${it.code}${it.market ? ' · ' + it.market : ''}</span>
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
        if (picked) loadInstrument(picked.code);
      });
    });
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
    const ticks = 6;
    for (let i = 0; i < ticks; i++) {
      const idx = Math.round((i / (ticks - 1)) * (series.length - 1));
      ctx.fillText(series[idx].t, X(idx), H - padB / 2 - 2);
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
      if (!li || li.dataset.session === usSessionSel) { menu.hidden = true; return; }
      usSessionSel = li.dataset.session;
      menu.querySelectorAll('li').forEach((x) => x.classList.toggle('is-sel', x === li));
      menu.hidden = true;
      if (APP_DATA.quote.code) loadInstrument(APP_DATA.quote.code);
    });

    // 点击面板其它区域时收起
    document.addEventListener('click', (e) => {
      if (menu.hidden || menu.contains(e.target) || periodTab.contains(e.target)) return;
      menu.hidden = true;
    });
  })();

  /* 左侧 rail 视图切换：自选(行情终端) / 账户 */
  (function initViewSwitch() {
    const items = document.querySelectorAll('.rail__item[data-view]');
    const accountView = $('#accountView');
    if (!items.length || !accountView) return;

    function switchView(view) {
      const isMarket = view === 'market';
      items.forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
      accountView.hidden = isMarket;
      ['.watchlist', '.chart-area', '.comment-panel'].forEach((sel) => {
        const el = $(sel);
        if (el) el.classList.toggle('is-hidden-by-view', !isMarket);
      });
      if (isMarket) drawChart();      // 画布重新可见后按新尺寸重绘
    }

    items.forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));

    // 支持 #account 直达账户视图
    if (location.hash === '#account') switchView('account');
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
      wl.classList.add('is-collapsed');
      chartArea.classList.add('wl-collapsed');
      wlExpand.hidden = false;
      redraw();
    });
    wlExpand.addEventListener('click', () => {
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
    const title = document.getElementById('accHeadTitle');
    const topCard = document.querySelector('.acc-side__card');

    function activate(cat) {
      lines.forEach((x) => x.classList.toggle('is-active', x.dataset.cat === cat));
      pages.forEach((p) => { p.hidden = p.dataset.catPage !== cat; });
      if (title) title.textContent = cat === 'total' ? '全部账户' : '盈透证券账户(U18576039)';
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
    tabs.forEach((b) => b.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.toggle('is-active', x === b));
      aoState.mode = b.dataset.aoTab;
      aoState.hover = null;                           // 切换视图时清掉十字光标
      drawAoChart();
    }));
    ranges.forEach((b) => b.addEventListener('click', () => {
      if (b.disabled) return;
      ranges.forEach((x) => x.classList.toggle('is-active', x === b));
      aoState.range = b.dataset.aoRange;
      aoState.hover = null;
      drawAoChart();
    }));
  })();

  window.addEventListener('resize', () => { drawChart(); drawAoChart(); });
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

  // 美元/离岸人民币：frankfurter 日频参考价（最新 vs 前一交易日），更新自选「外汇」行
  async function fetchFxWatch() {
    try {
      const start = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
      const end = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
      const r = await fetch(`https://api.frankfurter.dev/v1/${start}..${end}?base=USD&symbols=CNY`);
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
      const r = await fetch(TREASURY_YIELD_URL);
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

    const padL = 12, padR = 84, padT = 14, padB = 26;   // 纵轴刻度在右侧；padR 兼顾刻度与悬停胶囊
    const plotW = W - padL - padR, plotH = H - padT - padB;
    let lo = Math.min(...vals, isPct ? 0 : first);
    let hi = Math.max(...vals, isPct ? 0 : first);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const span = hi - lo;
    const yMin = lo - span * 0.08, yMax = hi + span * 0.08;
    const X = (i) => padL + (i / (data.length - 1)) * plotW;
    const Y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    const FONT = '10px "PingFang SC","Microsoft YaHei",sans-serif';

    // 缓存几何参数，供 mousemove 画光标复用（避免每次重算）
    aoGeo.data = data; aoGeo.vals = vals; aoGeo.isPct = isPct; aoGeo.first = first;
    aoGeo.X = X; aoGeo.Y = Y; aoGeo.lineC = lineC;
    aoGeo.padL = padL; aoGeo.padR = padR; aoGeo.padT = padT; aoGeo.padB = padB;
    aoGeo.plotW = plotW; aoGeo.plotH = plotH; aoGeo.W = W; aoGeo.H = H;

    ctx.font = FONT;
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
        padL + plotW + 6, y);
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

    // 右侧数值胶囊（黑底白字）：右对齐到画布右缘，避免 padR 不够宽时文字被裁切
    const vtxt = isPct
      ? (vals[idx] > 0 ? '+' : '') + vals[idx].toFixed(2) + '%'
      : d[idx].cny.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    ctx.font = 'bold 11px "PingFang SC","Microsoft YaHei",sans-serif';
    const vw = Math.min(ctx.measureText(vtxt).width + 14, W - 4);
    const vy = Math.min(Math.max(y - 9, padT), padT + plotH - 18);
    const vx = W - vw - 2;
    ctx.fillStyle = 'rgba(20,23,31,0.92)';
    ctx.fillRect(vx, vy, vw, 18);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    // 文字过长时按可用宽度压缩绘制，保证完整可见
    ctx.fillText(vtxt, vx + vw / 2, vy + 9, vw - 8);
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
      // 持仓区的块级元素（排除历史面板内部的表格容器）
      const posBlocks = () => [...page.querySelectorAll('.acc-metrics, .acc-actions, .acc-filter, .acc-sumline, .acc-table-wrap')]
        .filter((el) => !hist || !hist.contains(el));
      tabs.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          // 按 tab 文案判断（证券页有 4 个 tab：持仓/订单/历史/今日统计，历史不是最后一个）
          const isHist = /历史/.test(btn.textContent || '');
          if (hist) hist.hidden = !isHist;
          posBlocks().forEach((el) => { el.hidden = isHist; });
          tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === btn));
          if (!isHist) accRender(kind);
        });
      });
      // 页面首次显示在「持仓」时，确保历史面板为隐藏
      if (hist) hist.hidden = true;
    });
  })();

  /* ===================== 资金明细弹窗（每日净值列表） ===================== */
  const detailState = { stock: [], fund: [], cash: [], cat: null, page: 0, per: 30, fx: 7, flows: {}, fundFlows: {} };
  const DETAIL_TITLE = { stock: '证券资金明细', fund: '基金资金明细', cash: '现金资金明细' };
  // 证券账户以 USD 计价，弹窗直接显示美元（不再折 CNY + 括注）；
  // 基金/现金是人民币口径，保持 CNY。
  const DETAIL_COLS = {
    stock: ['日期', '净值 · USD', '当日盈亏 · USD', '当日涨跌', '累计涨跌 · TWR'],
    fund:  ['日期', '净值 · CNY', '当日盈亏', '当日涨跌', '累计涨跌 · TWR'],
    cash:  ['日期', '净值 · CNY', '当日盈亏', '当日涨跌', '累计涨跌 · TWR'],
  };

  /* 每日一行（**现金流调整后的 TWR**，Modified Dietz 简化式）：
       组合日收益  P_t = V_t − V_{t−1} − CF_t        （剔除当日外部净投入的影响）
       日收益率    r_t = P_t / V_{t−1}
       TWR 累计    cum = Π(1 + r_i) − 1             （几何链接，剔除中途投入/赎回的规模效应）
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
        r1: prev ? (r.value - prev - flow) / prev : null,      // 当日收益率（已剔除投入）
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
    const body = document.getElementById('dlgBody');
    const empty = document.getElementById('dlgEmpty');
    const pageCount = Math.max(1, Math.ceil(rows.length / detailState.per));
    if (detailState.page >= pageCount) detailState.page = pageCount - 1;
    const start = detailState.page * detailState.per;
    const slice = rows.slice(start, start + detailState.per);
    const f2 = (v) => (v == null || !isFinite(v) ? '--' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const sgn = (v) => (v == null ? '--' : (v > 0 ? '+' : '') + f2(v));
    const pctS = (v) => (v == null ? '--' : (v > 0 ? '+' : '') + v.toFixed(2) + '%');
    const cls = (v) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');

    // 表头按类别
    const headRow = document.getElementById('dlgHeadRow');
    if (headRow) {
      const cols = DETAIL_COLS[cat] || DETAIL_COLS.stock;
      headRow.innerHTML = cols.map((c) => '<th>' + c + '</th>').join('');
    }

    if (empty) empty.hidden = rows.length > 0;
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
    // 顶部汇总（TWR 累计）
    const sumEl = document.getElementById('dlgSum');
    const last = rows[0];                                   // rows 已 reverse，最新在前
    const baseDate = last && last.base ? last.base : (rows[rows.length - 1] || {}).date;
    const baseRow = rows.find((r) => r.date === baseDate) || rows[rows.length - 1] || null;   // TWR 基准日
    const curLabel = cat === 'stock' ? 'USD' : 'CNY';
    if (sumEl) {
      if (!rows.length) {
        sumEl.innerHTML = '<div><span>暂无每日数据</span><b>--</b></div>';
      } else {
        // 累计组合收益 = 最新净值 − 基准日净值 − 期间所有投入（与 TWR 口径一致的金额版）
        // 累计组合收益 = 最新净值 − 基准日净值 − 期间新增投入
        // 基准日当天的投入已体现在基准日净值里（那就是建仓成本），不再重复扣除
        const baseRows = rows.filter((r) => r.inBase && r.date !== baseDate);
        const totalFlow = baseRows.reduce((s, r) => s + (r.flow || 0), 0);
        const totalGain = baseRow && last ? last.value - baseRow.value - totalFlow : 0;
        const totalPct = last ? last.cum : 0;                     // TWR 累计涨跌
        sumEl.innerHTML =
          `<div><span>最新净值 · ${curLabel}（${last ? last.date : '--'}）</span><b>${f2(last && last.value)}</b></div>` +
          `<div><span>最新当日盈亏</span><b class="${cls(last && last.gain)}">${sgn(last && last.gain)}</b></div>` +
          `<div><span>累计组合收益（自 ${baseDate}）</span><b class="${cls(totalGain)}">${sgn(totalGain)}</b></div>` +
          `<div><span>累计涨跌 · TWR</span><b class="${cls(totalPct)}">${pctS(totalPct)}</b></div>`;
      }
    }
    const cnt = document.getElementById('dlgCount');
    const pg = document.getElementById('dlgPage');
    const prev = document.getElementById('dlgPrev');
    const next = document.getElementById('dlgNext');
    if (cnt) cnt.textContent = rows.length + ' 条记录';
    if (pg) pg.textContent = (detailState.page + 1) + ' / ' + pageCount;
    if (prev) prev.disabled = detailState.page <= 0;
    if (next) next.disabled = detailState.page >= pageCount - 1;
  }

  function openDetail(cat) {
    detailState.cat = cat;
    detailState.page = 0;
    const dlg = document.getElementById('detailDlg');
    const title = document.getElementById('dlgTitle');
    if (title) title.textContent = DETAIL_TITLE[cat] || '资金明细';
    if (dlg) dlg.hidden = false;
    renderDetail();
  }

  function closeDetail() {
    const dlg = document.getElementById('detailDlg');
    if (dlg) dlg.hidden = true;
  }

  (function initDetailDlg() {
    document.querySelectorAll('[data-detail]').forEach((btn) => {
      btn.addEventListener('click', () => openDetail(btn.dataset.detail));
    });
    document.querySelectorAll('[data-dlg-close]').forEach((el) => el.addEventListener('click', closeDetail));
    const prev = document.getElementById('dlgPrev');
    const next = document.getElementById('dlgNext');
    if (prev) prev.addEventListener('click', () => { detailState.page--; renderDetail(); });
    if (next) next.addEventListener('click', () => { detailState.page++; renderDetail(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });
  })();

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
        const r = await fetch(u, opts);
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
      await Promise.all([
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
      ]);
      return res;
    }

    /* ---- 东方财富 pingzhongdata（script 标签引入，免 CORS）取最新两日净值 ---- */
    function accFundNav(code) {
      return new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://fund.eastmoney.com/pingzhongdata/' + code + '.js';
        let settled = false;
        const finish = (l, p) => {
          if (settled) return;
          settled = true;
          s.remove();
          try { delete window.Data_netWorthTrend; } catch (e) { window.Data_netWorthTrend = undefined; }
          resolve([l, p]);
        };
        s.onload = () => {
          const arr = window.Data_netWorthTrend;
          if (arr && arr.length >= 2) finish(arr[arr.length - 1].y, arr[arr.length - 2].y);
          else finish(null, null);
        };
        s.onerror = () => finish(null, null);
        setTimeout(() => finish(null, null), 8000);
        document.head.appendChild(s);
      });
    }

    /* ---- 本地数据 ---- */
    const asset = await accJson('Asset_parsed.json');
    if (!asset) return;
    const fundH = await accJson('fund_holdings.json');
    const seed = asset.seed || {};
    let FX = seed.pa_fx || 7;                 // 兜底：Asset_parsed.json 的手工汇率
    try {                                     // 优先 frankfurter（欧央行日频参考价）
      const fxr = await accJson('https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY');
      if (fxr && fxr.rates && fxr.rates.CNY) FX = fxr.rates.CNY;
    } catch (e) {}

    /* ---- 基金：份额 × 最新净值（pingzhongdata，失败回退 fund_holdings.json） ---- */
    const funds = (seed.pa_funds || []).map((f) => {
      const t = (f.trades && f.trades[0]) || {};
      return { code: f.code, name: f.name, shares: t.shares || 0, cost: t.price || 0, navL: null, navP: null,
               trades: f.trades || [],                       // 历史·订单用（可能不止一笔）
               hist: (fundH && fundH[f.code] && Array.isArray(fundH[f.code].nav)) ? fundH[f.code].nav : null };
    });
    for (const f of funds) {
      const [l, p] = await accFundNav(f.code);
      if (l != null) { f.navL = l; f.navP = p; }
      else if (fundH && fundH[f.code] && Array.isArray(fundH[f.code].nav) && fundH[f.code].nav.length >= 2) {
        const nav = fundH[f.code].nav;
        f.navL = nav[nav.length - 1][1];
        f.navP = nav[nav.length - 2][1];
      }
    }
    let fundAmount = 0, fundYesterday = 0, fundCum = 0;
    funds.forEach((f) => {
      f.amount = f.shares * (f.navL || 0);
      f.yest = f.navP != null ? f.shares * (f.navL - f.navP) : null;
      f.cum = f.cost ? f.shares * (f.navL - f.cost) : null;
      fundAmount += f.amount;
      if (f.yest != null) fundYesterday += f.yest;
      if (f.cum != null) fundCum += f.cum;
    });
    const fundTbody = $id('fundTbody');
    if (fundTbody) {
      // 排序键挂到行对象上：funds 已带 name/code/amount/shares/yest/cum，权重另算
      funds.forEach((f) => { f.weight = fundAmount ? (f.amount / fundAmount * 100) : 0; f.cur = 'CNY'; });
      ACC_RENDERERS.fund = () => {
        fundTbody.innerHTML = accSorted('fund', funds).map((f) =>
          `<tr><td class="td-link up">交易</td><td>${f.name}</td><td class="num">${f.code}</td>` +
          `<td class="num">${f2(f.amount)}</td><td class="num">${f.shares.toFixed(2)}</td>` +
          `<td class="num ${f.yest > 0 ? 'up' : f.yest < 0 ? 'down' : ''}">${f2(f.yest, true)}</td>` +
          `<td class="num ${f.cum > 0 ? 'up' : f.cum < 0 ? 'down' : ''}">${f2(f.cum, true)}</td>` +
          `<td class="num">${f.weight.toFixed(2)}%</td><td>${f.cur}</td></tr>`
        ).join('');
      };
      accRender('fund');
    }
    setTxt('fundSumVal', f2(fundAmount));
    setTxt('fundSumProfit', f2(fundCum, true), fundCum);
    setTxt('fundMYest', f2(fundYesterday, true), fundYesterday);
    setTxt('fundMCum', f2(fundCum, true), fundCum);
    setTxt('accFundVal', f2(fundAmount));
    setTxt('accFundNote', f2(fundYesterday, true), fundYesterday);

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
          `<tr><td class="td-link up">交易</td><td>${r.note}</td><td class="num">--</td>` +
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

    // IBKR 现金 = 最近净值 - 文件持仓市值（近似），再按实时价修正总权益
    const lastNV = asset.totalNetValueDaily && asset.totalNetValueDaily.length
      ? asset.totalNetValueDaily[asset.totalNetValueDaily.length - 1].value : 0;
    const filePosVal = (asset.holdings || []).reduce((s, h) => s + h.positionValue, 0);
    const ibkrCash = lastNV - filePosVal;

    let rtPosVal = 0, todayPnlUsd = 0;
    const stockTbody = $id('stockTbody');
    const rows = [];
    holdings.forEach((h) => {
      let price = null, prevClose = null, qty = 0, cost = 0, mult = 1;
      if (h.opt) {
        const o = q.opt[h.occ] || {};
        price = o.price; prevClose = o.prevClose;
        qty = h.pos; cost = h.cost; mult = 100;
      } else if (h.tqqqShares != null) {
        const s = q.stock[h.code] || {};
        price = s.price || tqqq.price; prevClose = s.prevClose;
        qty = h.tqqqShares; cost = h.tqqqCost;
      } else {
        const s = q.stock[h.code] || {};
        price = s.price; prevClose = s.prevClose;
        qty = h.pos; cost = h.cost;
      }
      const value = price != null ? qty * price * mult : null;
      const pnl = price != null ? (price - cost) * qty * mult : null;
      const pnlRatio = price != null && cost ? (price - cost) / cost : null;
      const todayPnl = price != null && prevClose != null ? (price - prevClose) * qty * mult : null;
      if (value != null) rtPosVal += value;
      if (todayPnl != null) todayPnlUsd += todayPnl;
      rows.push({ h, price, prevClose, qty, cost, mult, value, pnl, pnlRatio, todayPnl });
    });

    if (stockTbody) {
      // 排序键：code/name/qty/price/cost/value(CNY)/ratio/pnl(CNY)/today(CNY)
      rows.forEach((r) => {
        const cny = (v) => v == null ? null : v * FX;
        r.code = r.h.code; r.name = r.h.name;
        r.valueCny = cny(r.value); r.pnlCny = cny(r.pnl); r.todayCny = cny(r.todayPnl);
      });
      ACC_RENDERERS.stock = () => {
        stockTbody.innerHTML = accSorted('stock', rows).map((r) => {
          // 价格列用 USD 原值（期权 3 位小数，便于和市值对账），金额列（市值/盈亏）折 CNY
          const c = (v) => v == null ? '--' : v * FX;
          const pf = (v) => v == null ? '--' : (r.mult === 100 ? v.toFixed(3) : f2(v));
          const cls = (v) => v > 0 ? 'up' : v < 0 ? 'down' : '';
          return `<tr><td class="td-link up">交易</td><td>${r.code}</td><td>${r.name}</td>` +
            `<td class="num">${r.qty}</td><td class="num">${r.qty}</td>` +
            `<td class="num">${pf(r.price)}</td><td class="num">${pf(r.cost)}</td>` +
            `<td class="num">${f2(c(r.value))}</td>` +
            `<td class="num ${cls(r.pnlRatio)}">${pctS(r.pnlRatio)}</td>` +
            `<td class="num ${cls(r.pnl)}">${f2(c(r.pnl), true)}</td>` +
            `<td class="num ${cls(r.todayPnl)}">${f2(c(r.todayPnl), true)}</td></tr>`;
        }).join('');
        const empty = $id('stockEmpty');
        if (empty) empty.hidden = true;
      };
      accRender('stock');
    }
    const stockEquityCny = (ibkrCash + rtPosVal) * FX;
    const stockTodayCny = todayPnlUsd * FX;
    const stockPnlCny = rows.reduce((s, r) => s + (r.pnl || 0), 0) * FX;
    // 证券累计盈亏（CNY）= 证券权益实时折算 − 人民币本金 167,600（forexTrades 四笔 CNH 合计，含 TQQQ 的 17,600）
    // 口径：实际掏口袋的人民币，换汇手续费/点差自动计入盈亏；usInvest=167600 互证
    const stockCumCny = (ibkrCash + rtPosVal) * FX - 167600;
    setTxt('stockSumVal', f2(rtPosVal * FX));
    setTxt('stockSumToday', f2(stockTodayCny, true), stockTodayCny);
    setTxt('stockSumPnl', f2(stockPnlCny, true), stockPnlCny);
    setTxt('mStockVal', f2(rtPosVal * FX));
    setTxt('mStockLong', f2(rows.filter((r) => r.value != null && r.qty > 0).reduce((s, r) => s + r.value, 0) * FX));
    setTxt('mStockShort', f2(rows.filter((r) => r.value != null && r.qty < 0).reduce((s, r) => s + r.value, 0) * FX));
    // 累计收益（资产列）= 证券累计盈亏（净值口径，含已实现盈亏/汇兑/利息）
    setTxt('mPnlTotal', f2(stockCumCny, true), stockCumCny);
    // 资产卡每行后面备注美元原值（证券账户以 USD 计价，CNY 只是折算视图）
    const usdNote = (id, v) => setTxt(id, v == null ? '' : f2(v) + ' USD');
    usdNote('mStockValUsd', rtPosVal);
    usdNote('mStockLongUsd', rows.filter((r) => r.value != null && r.qty > 0).reduce((s, r) => s + r.value, 0));
    usdNote('mStockShortUsd', rows.filter((r) => r.value != null && r.qty < 0).reduce((s, r) => s + r.value, 0));
    usdNote('mPnlTotalUsd', (ibkrCash + rtPosVal) - 167600 / FX);
    setTxt('mCashCny', f2(ibkrCash * FX));
    setTxt('mCashUsd', f2(ibkrCash));
    setTxt('accStockVal', f2(stockEquityCny));
    setTxt('accStockNote', f2(stockTodayCny, true), stockTodayCny);
    setTxt('accStockPct', stockEquityCny - stockTodayCny ? pctS(stockTodayCny / (stockEquityCny - stockTodayCny)) : '--', stockTodayCny);

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

    /* ---- 侧栏总资产 + 走势 ---- */
    const totalCny = stockEquityCny + fundAmount + cashCny;
    setTxt('accTotalVal', f2(totalCny));
    setTxt('accTotalVal2', f2(totalCny));
    setTxt('accTotalNote', f2(stockTodayCny + fundYesterday, true), stockTodayCny + fundYesterday);
    // 累计盈亏 = 证券累计(IBKR净值+TQQQ市值-入金-买入成本) + 基金累计(净值-JSON成本)
    setTxt('accTotalCum', f2(stockCumCny + fundCum, true), stockCumCny + fundCum);
    const nv = asset.totalNetValueDaily || [];
    const tail = nv.slice(-80);
    const spark = $id('accSpark');
    if (spark && tail.length >= 2) {
      const vs = tail.map((p) => p.value);
      const mn = Math.min(...vs), mx = Math.max(...vs), rg = mx - mn || 1;
      spark.setAttribute('d', vs.map((v, i) =>
        `${i ? 'L' : 'M'}${(i / (vs.length - 1) * 100).toFixed(2)} ${(20 - (v - mn) / rg * 18 + 2).toFixed(2)}`
      ).join(' '));
    }

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
  }
  initAccountData();
})();
