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
    // [{ t: 'HH:MM', price, avg, vol }, ...]
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
     分时图数据：OKX K 线接口（1m，取最近 N 根）
     - 端点 /market/candles?instId=...&bar=1m&limit=N
     - 返回 data 为 [ts, open, high, low, close, vol, ...]，最新在前
     - 均价(avg) 用累计 VWAP：Σ(close*vol) / Σ(vol)
     ------------------------------------------------------------------- */
  async function fetchCandles(instId, limit) {
    limit = limit || 100;
    const res = await fetch(
      OKX_API_BASE + '/market/candles?instId=' + encodeURIComponent(instId) +
      '&bar=1m&limit=' + limit
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.code !== '0' || !json.data || !json.data.length) throw new Error('empty payload');
    const rows = json.data.slice().reverse();          // 旧 -> 新
    let cumVol = 0, cumPV = 0;
    return rows.map((r) => {
      const close = parseFloat(r[4]);
      const vol = parseFloat(r[5]) || 0;
      cumVol += vol; cumPV += close * vol;
      const d = new Date(+r[0]);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return {
        t: hh + ':' + mm,
        price: close,
        avg: cumVol ? cumPV / cumVol : close,
        vol: vol,
      };
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
  let usSessionSel = 'regular';   // 默认盘中（与富途一致）

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

    let cumVol = 0, cumPV = 0;
    return rows.map((r) => {
      const close = parseFloat(r[4]);
      const vol = parseFloat(r[5]) || 0;
      cumVol += vol; cumPV += close * vol;
      const d = new Date(new Date(+r[0]).toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return { t: hh + ':' + mm, price: close, avg: cumVol ? cumPV / cumVol : close, vol: vol };
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

    // 分时下拉入口仅美股显示；非美股时收起菜单
    const pt = $('#periodTab');
    const menu = $('#usSessionMenu');
    if (pt) pt.classList.toggle('has-caret', !!(item && item.market === 'US'));
    if (menu && !(item && item.market === 'US')) menu.hidden = true;

    // 无 instId 的行（上证指数/美元离岸/10Y）没有数据源 -> 分时图显示空白背景
    if (!item || !item.instId) {
      APP_DATA.series = null;
      drawChart();
      return;
    }

    try {
      // 美股：按选中时段（盘前/盘中/盘后/夜盘/全天）切分；其余：最近 100 分钟
      const series = (item.market === 'US')
        ? await fetchUsSessionSeries(item.instId, usSessionSel)
        : await fetchCandles(item.instId);
      APP_DATA.series = series;
      drawChart();
    } catch (e) {
      console.warn('[分时] 拉取失败，沿用上次数据：', e);
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
      '&bar=1H&limit=72'                           // 72h 覆盖周末（最远回到周一凌晨找周五收盘）
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.code !== '0' || !json.data || !json.data.length) throw new Error('empty payload');
    const now = Date.now();
    for (const r of json.data) {                   // 最新在前 → 第一根命中的即最近已完成交易日
      const ts = +r[0];
      const et = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const dow = et.getDay();
      if (dow >= 1 && dow <= 5 && et.getHours() === 15 && ts + 3600e3 <= now) {
        return parseFloat(r[4]);
      }
    }
    return null;
  }

  function getPrevCloseET(instId) {
    const c = prevCloseCache[instId];
    if (c && Date.now() - c.at < BASE_TTL) return Promise.resolve(c.value);
    return fetchPrevCloseET(instId).then((v) => {
      if (v) prevCloseCache[instId] = { value: v, at: Date.now() };
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
          ? prevCloseCache[instId].value
          : open;
        const pct = base ? (last - base) / base * 100 : 0;
        item.price = last;
        item.pct = +pct.toFixed(2);
        item.change = +(last - base).toFixed(last < 1 ? 6 : 2);
        item.prevClose = base;
        // 美股：副行显示延长时段（盘前/盘后/夜盘）行情，基准 = UTC0 开盘价（≈美东晚间夜盘起点）
        if (item.market === 'US') {
          const sod = parseFloat(d.sodUtc0);
          item.extPrice = last;
          item.extPct = sod ? +((last - sod) / sod * 100).toFixed(2) : null;
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
    avgLine:    '#ff9f43',
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
      const c = cls(it.pct);
      const isUS = it.market === 'US';
      // 美股副行：延长时段行情，小字一律灰色（不带涨跌色）；正常时段不显示
      const showExt = isUS && it.extPrice !== null && session;
      const extRow = showExt ? `<i class="wl-sub num">${fmt(it.extPrice, 3)}</i>` : '';
      const extPctCell = showExt ? `<i class="wl-sub num">${fmtPct(it.extPct)}</i>` : '';

      return `
        <li class="wl__row${active}" data-code="${it.code}">
          <span class="wl-name">
            <b>${it.name}</b>
            <span>${it.code}${it.market ? ' · ' + it.market : ''}</span>
          </span>
          <span class="wl-price num ${c}">${fmt(it.price, it.price < 10 ? 5 : 3)}${extRow}</span>
          <span class="wl-pct num ${c}">${fmtPct(it.pct)}${extPctCell}</span>
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
    const avgs = series.map((d) => d.avg);
    const lo = Math.min.apply(null, prices.concat(avgs));
    const hi = Math.max.apply(null, prices.concat(avgs));
    const span = (hi - lo) || 1;
    const yMin = lo - span * 0.08;
    const yMax = hi + span * 0.08;

    const X = (i) => padL + (i / (series.length - 1)) * plotW;
    const Y = (p) => padT + (1 - (p - yMin) / (yMax - yMin)) * plotH;

    // 百分比轴基准与报价头一致（前一日美东收盘），保证图上读数 = 报价头涨跌幅
    const prevClose = APP_DATA.quote.prevClose || series[0].price;

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

    /* --- 均价线 --- */
    ctx.beginPath();
    ctx.moveTo(X(0), Y(series[0].avg));
    for (let i = 1; i < series.length; i++) ctx.lineTo(X(i), Y(series[i].avg));
    ctx.strokeStyle = THEME.avgLine;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    /* --- 最新价水平线 --- */
    const lastY = Y(series[series.length - 1].price);
    ctx.strokeStyle = (APP_DATA.quote.changePct >= 0) ? 'rgba(0,168,107,0.85)' : 'rgba(234,59,59,0.85)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(padL, lastY); ctx.lineTo(padL + plotW, lastY); ctx.stroke();
    ctx.setLineDash([]);

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
      menu.hidden = !menu.hidden;
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
    const redraw = () => { if (!($('#accountView') || {}).hidden) drawChart(); };
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

    // 打开页面时资讯面板默认收起
    cp.classList.add('is-collapsed');
    chartArea.classList.add('cp-collapsed');
    cpExpand.hidden = false;
  })();

  /* 账户内分类切换：证券 / 基金 / 现金（点击左侧摘要列表切换主区模板） */
  (function initAccCats() {
    const lines = document.querySelectorAll('.as-group .as-line[data-cat]');
    const pages = document.querySelectorAll('.acc-page');
    if (!lines.length || !pages.length) return;

    lines.forEach((ln) => ln.addEventListener('click', () => {
      const cat = ln.dataset.cat;
      lines.forEach((x) => x.classList.toggle('is-active', x === ln));
      pages.forEach((p) => { p.hidden = p.dataset.catPage !== cat; });
    }));
  })();

  window.addEventListener('resize', () => drawChart());
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

  /* ===================== 账户实数据（Asset_parsed.json + fund_holdings.json） ===================== */
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
        const r = await fetch(url, opts);
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
      return { code: f.code, name: f.name, shares: t.shares || 0, cost: t.price || 0, navL: null, navP: null };
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
      fundTbody.innerHTML = funds.map((f) => {
        const w = fundAmount ? (f.amount / fundAmount * 100).toFixed(2) + '%' : '--';
        return `<tr><td class="td-link up">交易</td><td>${f.name}</td><td class="num">${f.code}</td>` +
          `<td class="num">${f2(f.amount)}</td><td class="num">${f.shares.toFixed(2)}</td>` +
          `<td class="num ${f.yest > 0 ? 'up' : f.yest < 0 ? 'down' : ''}">${f2(f.yest, true)}</td>` +
          `<td class="num ${f.cum > 0 ? 'up' : f.cum < 0 ? 'down' : ''}">${f2(f.cum, true)}</td>` +
          `<td class="num">${w}</td><td>CNY</td></tr>`;
      }).join('');
    }
    setTxt('fundSumVal', f2(fundAmount), fundAmount > 0 ? 1 : 0);
    setTxt('fundSumProfit', f2(fundCum, true), fundCum);
    setTxt('fundMYest', f2(fundYesterday, true), fundYesterday);
    setTxt('fundMCum', f2(fundCum, true), fundCum);
    setTxt('accFundVal', f2(fundAmount), 1);
    setTxt('accFundNote', f2(fundYesterday, true), fundYesterday);

    /* ---- 现金：pa_cash 各账户余额汇总（盈透证券余额已含在 IBKR 净值里，剔除防重复计算） ---- */
    const cashRows = (seed.pa_cash || [])
      .filter((c) => !/盈透|IBKR/i.test(c.note || ''))
      .map((c) => {
      const bal = (c.transactions || []).reduce((s, t) => s + t.amount * (t.type === 'in' ? 1 : -1), 0);
      return { note: c.note || c.currency, cur: (c.currency || '').toUpperCase(), bal };
    });
    const cashCny = cashRows.reduce((s, r) => s + (r.cur === 'USD' ? r.bal * FX : r.bal), 0);
    const cashTbody = $id('cashTbody');
    if (cashTbody) {
      cashTbody.innerHTML = cashRows.map((r) =>
        `<tr><td class="td-link up">交易</td><td>${r.note}</td><td class="num">--</td>` +
        `<td class="num">${f2(r.cur === 'USD' ? r.bal * FX : r.bal)}</td><td class="num">${f2(r.bal)}</td>` +
        `<td class="num">--</td><td class="num">--</td><td class="num">--</td><td class="num">--</td>` +
        `<td class="num">--</td><td class="num">--</td><td>${r.cur}</td></tr>`
      ).join('');
    }
    setTxt('cashSumVal', f2(cashCny), 1);
    setTxt('accCashVal', f2(cashCny), 1);

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
      stockTbody.innerHTML = rows.map((r) => {
        // 价格列用 USD 原值（期权 3 位小数，便于和市值对账），金额列（市值/盈亏）折 CNY
        const c = (v) => v == null ? '--' : v * FX;
        const pf = (v) => v == null ? '--' : (r.mult === 100 ? v.toFixed(3) : f2(v));
        const cls = (v) => v > 0 ? 'up' : v < 0 ? 'down' : '';
        return `<tr><td class="td-link up">交易</td><td>${r.h.code}</td><td>${r.h.name}</td>` +
          `<td class="num">${r.qty}</td><td class="num">${r.qty}</td>` +
          `<td class="num">${pf(r.price)}</td><td class="num">${pf(r.cost)}</td>` +
          `<td class="num">${f2(c(r.value))}</td>` +
          `<td class="num ${cls(r.pnlRatio)}">${pctS(r.pnlRatio)}</td>` +
          `<td class="num ${cls(r.pnl)}">${f2(c(r.pnl), true)}</td>` +
          `<td class="num ${cls(r.todayPnl)}">${f2(c(r.todayPnl), true)}</td></tr>`;
      }).join('');
      const empty = $id('stockEmpty');
      if (empty) empty.hidden = true;
    }
    const stockEquityCny = (ibkrCash + rtPosVal) * FX;
    const stockTodayCny = todayPnlUsd * FX;
    const stockPnlCny = rows.reduce((s, r) => s + (r.pnl || 0), 0) * FX;
    // 证券累计盈亏（USD）= IBKR 净值(实时=现金+持仓，不含TQQQ) + TQQQ市值 − IBKR充入 − TQQQ买入
    // IBKR充入 = EFT 五笔 21,841.22 + 手动CNH入金 2,725.80 = 24,567.02（与汇丰美国流出 24,567.02 对账一致）
    const TQQQ_BUY = (tqqq && tqqq.trades && tqqq.trades[0]) ? tqqq.trades[0].shares * tqqq.trades[0].price : 0;
    const stockCumUsd = ibkrCash + rtPosVal - 24567.02 - TQQQ_BUY;
    const stockCumCny = stockCumUsd * FX;
    setTxt('stockSumVal', f2(rtPosVal * FX), 1);
    setTxt('stockSumToday', f2(stockTodayCny, true), stockTodayCny);
    setTxt('stockSumPnl', f2(stockPnlCny, true), stockPnlCny);
    setTxt('mStockVal', f2(rtPosVal * FX), 1);
    setTxt('mStockLong', f2(rows.filter((r) => r.value != null && r.qty > 0).reduce((s, r) => s + r.value, 0) * FX), 1);
    setTxt('mStockShort', f2(rows.filter((r) => r.value != null && r.qty < 0).reduce((s, r) => s + r.value, 0) * FX));
    // 累计收益（资产列）= 证券累计盈亏（净值口径，含已实现盈亏/汇兑/利息）
    setTxt('mPnlTotal', f2(stockCumCny, true), stockCumCny);
    setTxt('mCashCny', f2(ibkrCash * FX));
    setTxt('mCashUsd', f2(ibkrCash));
    setTxt('accStockVal', f2(stockEquityCny), 1);
    setTxt('accStockNote', f2(stockTodayCny, true), stockTodayCny);
    setTxt('accStockPct', stockEquityCny - stockTodayCny ? pctS(stockTodayCny / (stockEquityCny - stockTodayCny)) : '--', stockTodayCny);

    /* ---- 侧栏总资产 + 走势 ---- */
    const totalCny = stockEquityCny + fundAmount + cashCny;
    setTxt('accTotalVal', f2(totalCny), 1);
    setTxt('accTotalVal2', f2(totalCny), 1);
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
  }
  initAccountData();
})();
