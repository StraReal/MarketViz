const API = 'http://localhost:5000/api';
const COLORS = ['#4caf50','#2196f3','#ff9800','#e91e63','#9c27b0','#00bcd4'];

let symbols   = [];
let rawData   = {}; // symbol > [{date, price}]
let stockInfo = {}; // symbol > stock object

let activeDays  = 90;
let panOffset   = 0;
let isPanning   = false;
let panStartX   = 0;
let panStartOffset = 0;

const gWrap   = document.getElementById('graph-wrap');
const gCanvas = document.getElementById('graph-canvas');
const gCtx    = gCanvas.getContext('2d');
const tip     = document.getElementById('crosshair-tip');

function parseURL() {
  const p = new URLSearchParams(window.location.search);
  const s = p.get('symbols');
  if (s) symbols = s.split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) symbols = ['AAPL'];
}

function pushURL() {
  const url = new URL(window.location);
  url.searchParams.set('symbols', symbols.join(','));
  history.replaceState({}, '', url);
}


async function loadSymbol(sym) {
  try {
    const r = await fetch(`${API}/stock_history/${encodeURIComponent(sym)}`);
    console.log(r)
    if (!r.ok) return;
    rawData[sym] = await r.json();
  } catch(e) { console.warn('Failed to load', sym, e); }
}

async function loadStockInfo() {
  try {
    const r = await fetch(`${API}/stocks`);
    if (!r.ok) return;
    const data = await r.json();
    for (const s of (data.stocks || [])) stockInfo[s.symbol] = s;
  } catch(e) {}
}

function getData(sym) {
  return rawData[sym] || [];
}

function tradingDaysForPeriod(data) {
  if (activeDays === 0) return data.length;
  return Math.round(activeDays * 5 / 7);
}


function drawGraph() {
  gCanvas.width  = gWrap.clientWidth;
  gCanvas.height = gWrap.clientHeight;

  const W = gCanvas.width, H = gCanvas.height;
  const PAD = { top: 24, right: 20, bottom: 36, left: 68 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top  - PAD.bottom;

    gCtx.fillStyle = '#0a0a0c';
    gCtx.fillRect(0, 0, W, H);
    gCtx.fillStyle = '#040405';
    gCtx.fillRect(PAD.left, PAD.top, chartW, chartH);

  const allSeries = symbols
    .map(s => ({ sym: s, data: getData(s) }))
    .filter(s => s.data.length > 1);

  if (!allSeries.length) return;

  const longest = allSeries.reduce((a, b) => a.data.length >= b.data.length ? a : b);
  const N = longest.data.length;

  const visiblePoints = Math.min(N, tradingDaysForPeriod(longest.data));
  const pointSpacing = chartW / Math.max(visiblePoints - 1, 1);

  const xOfIndex = (i, dataLen) => {
    const rightEdge = PAD.left + chartW - panOffset;
    return rightEdge - (dataLen - 1 - i) * pointSpacing;
  };

const normalized = allSeries.map(({ sym, data }) => {
  let anchorIdx = 0;
  if (activeDays > 0) {
    const idx = data.length - visiblePoints;
    anchorIdx = idx >= 0 ? idx : 0;
  }
  const anchorPrice = data[anchorIdx].price;
  return {
    sym,
    data: data.map(d => ({ date: d.date, pct: ((d.price - anchorPrice) / anchorPrice) * 100 }))
  };
});  const visibleNorm = normalized.map(({ sym, data }) => {
    return data.filter((_, i) => {
      const x = xOfIndex(i, data.length);
      return x >= PAD.left && x <= PAD.left + chartW;
    });
  }).flat();

  const allVals = visibleNorm.length ? visibleNorm.map(d => d.pct) : normalized.flatMap(s => s.data.map(d => d.pct));
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;
  const pad = range * 0.08;
  const lo = minV - pad, hi = maxV + pad;

  const yScale = v => PAD.top + chartH - ((v - lo) / (hi - lo)) * chartH;

  // y grid
  gCtx.font = '10px "IBM Plex Mono"';
  gCtx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const v = lo + ((hi - lo) / 5) * i;
    const y = yScale(v);
    const sign = v >= 0 ? '+' : '';
    gCtx.fillStyle = v >= 0 ? 'rgba(76,175,80,0.5)' : 'rgba(244,67,54,0.5)';
    gCtx.fillText(sign + v.toFixed(1) + '%', PAD.left - 6, y + 3);
    gCtx.beginPath();
    gCtx.strokeStyle = Math.abs(v) < 0.01 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)';
    gCtx.lineWidth = 1;
    gCtx.moveTo(PAD.left, y);
    gCtx.lineTo(PAD.left + chartW, y);
    gCtx.stroke();
  }

  gCtx.save();
  gCtx.beginPath();
  gCtx.rect(PAD.left, PAD.top, chartW, chartH);
  gCtx.clip();

  normalized.forEach(({ sym, data }, idx) => {
    if (data.length < 2) return;
    const color = COLORS[idx % COLORS.length];
    const xs = i => xOfIndex(i, data.length);

    gCtx.beginPath();
    data.forEach((d, i) => {
      i === 0 ? gCtx.moveTo(xs(i), yScale(d.pct)) : gCtx.lineTo(xs(i), yScale(d.pct));
    });
    gCtx.lineTo(xs(data.length - 1), PAD.top + chartH);
    gCtx.lineTo(xs(0), PAD.top + chartH);
    gCtx.closePath();
    const grad = gCtx.createLinearGradient(0, PAD.top, 0, PAD.top + chartH);
    grad.addColorStop(0, hexAlpha(color, 0.18));
    grad.addColorStop(1, hexAlpha(color, 0));
    gCtx.fillStyle = grad;
    gCtx.fill();

    gCtx.beginPath();
    gCtx.strokeStyle = color;
    gCtx.lineWidth = 1.5;
    gCtx.lineJoin = 'round';
    data.forEach((d, i) => {
      i === 0 ? gCtx.moveTo(xs(i), yScale(d.pct)) : gCtx.lineTo(xs(i), yScale(d.pct));
    });
    gCtx.stroke();
  });

  gCtx.restore();

  // x axis labels
  gCtx.fillStyle = 'rgba(180,180,180,0.35)';
  gCtx.font = '10px "IBM Plex Mono"';
  gCtx.textAlign = 'center';
  const labelStep = Math.max(1, Math.floor(visiblePoints / 6));
  for (let i = 0; i < longest.data.length; i += labelStep) {
    const x = xOfIndex(i, longest.data.length);
    if (x < PAD.left || x > PAD.left + chartW) continue;
    gCtx.fillText(longest.data[i].date.slice(5), x, H - PAD.bottom + 14);
  }

  if (symbols.length > 1) {
    let lx = PAD.left + 8;
    normalized.forEach(({ sym }, idx) => {
      const color = COLORS[idx % COLORS.length];
      gCtx.fillStyle = color;
      gCtx.font = '700 11px "IBM Plex Mono"';
      gCtx.textAlign = 'left';
      gCtx.fillText(sym, lx, PAD.top + 14);
      lx += gCtx.measureText(sym).width + 18;
    });
  }
}

let mouseX = -1, mouseY = -1;

gCanvas.addEventListener('mousemove', e => {
  if (isPanning) return;
  const rect = gCanvas.getBoundingClientRect();
  mouseX = (e.clientX - rect.left) * (gCanvas.width  / rect.width);
  mouseY = (e.clientY - rect.top)  * (gCanvas.height / rect.height);
  updateCrosshair(e.clientX, e.clientY);
});

gCanvas.addEventListener('mouseleave', () => {
  mouseX = mouseY = -1;
  tip.style.display = 'none';
});

function updateCrosshair(cx, cy) {
  const PAD = { top: 24, right: 20, bottom: 36, left: 68 };
  const chartW = gCanvas.width - PAD.left - PAD.right;

  if (mouseX < PAD.left || mouseX > PAD.left + chartW) { tip.style.display = 'none'; return; }

  const allSeries = symbols.map(s => ({ sym: s, data: getData(s) })).filter(s => s.data.length > 1);
  if (!allSeries.length) return;

  const longest = allSeries.reduce((a, b) => a.data.length >= b.data.length ? a : b);
  const N = longest.data.length;
  const visiblePoints = Math.min(N, tradingDaysForPeriod(longest.data));
  const pointSpacing = chartW / Math.max(visiblePoints - 1, 1);
  const rightEdge = PAD.left + chartW - panOffset;
  const rawIdx = (mouseX - rightEdge) / pointSpacing + (N - 1);
  const idx = Math.max(0, Math.min(N - 1, Math.round(rawIdx)));
  const date = longest.data[idx]?.date;
  if (!date) return;

  let html = `<div class="ct-date">${date}</div>`;
  allSeries.forEach(({ sym, data }, i) => {
    const pt = data.find(d => d.date === date) || data[Math.min(idx, data.length - 1)];
    if (!pt) return;
    const chg = ((pt.price - data[0].price) / data[0].price) * 100;
    const color = COLORS[i % COLORS.length];
    const sign = chg >= 0 ? '+' : '';
    html += `<div class="ct-row">
      <span class="ct-sym" style="color:${color}">${sym}</span>
      <span class="ct-val">$${pt.price.toFixed(2)}</span>
      <span class="${chg >= 0 ? 'ct-pos' : 'ct-neg'}">${sign}${chg.toFixed(2)}%</span>
    </div>`;
  });

  tip.innerHTML = html;
  tip.style.display = 'block';

  const tipW = 200;
  const tipH = 28 + allSeries.length * 22;
  const rect = gWrap.getBoundingClientRect();
  let tx = cx - rect.left + 14;
  let ty = cy - rect.top  - tipH / 2;
  if (tx + tipW > rect.width)  tx = cx - rect.left - tipW - 14;
  if (ty < 0) ty = 4;
  if (ty + tipH > rect.height) ty = rect.height - tipH - 4;
  tip.style.left = tx + 'px';
  tip.style.top  = ty + 'px';
}

gCanvas.addEventListener('mousedown', e => {
if (e.button !== 0) return;
  isPanning = true;
  panStartX = e.clientX;
  panStartOffset = panOffset;
  gCanvas.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', e => {
  if (!isPanning) return;
  const dx = e.clientX - panStartX;
  const _allData = getData(symbols[0]);
  const _N = _allData.length;
  const _chartW = gCanvas.width - 68 - 20;
  const _visiblePoints = Math.min(_N, tradingDaysForPeriod(_allData));
  const _pointSpacing = _chartW / Math.max(_visiblePoints - 1, 1);
  const maxPan = Math.max(0, (_N - _visiblePoints) * _pointSpacing);
  panOffset = Math.min(maxPan, panStartOffset - dx);
  drawGraph();
});

window.addEventListener('mouseup', () => {
  isPanning = false;
  gCanvas.style.cursor = 'crosshair';
});

function renderPills() {
  const list = document.getElementById('symbol-list');
  list.innerHTML = '';
  symbols.forEach((sym, idx) => {
    const color = COLORS[idx % COLORS.length];
    const pill = document.createElement('div');
    pill.className = 'sym-pill';
    pill.style.borderColor = hexAlpha(color, 0.4);
    pill.style.color = color;
    pill.style.background = hexAlpha(color, 0.08);
    pill.innerHTML = `<span class="dot" style="background:${color}"></span>${sym}<span class="remove">✕</span>`;
    pill.querySelector('.remove').addEventListener('click', () => removeSymbol(sym));
    list.appendChild(pill);
  });
}

async function addSymbol(sym) {
  sym = sym.trim().toUpperCase();
  const prev_first_sym = symbols[0]
  if (!sym || symbols.includes(sym)) return;
  symbols.push(sym);
  const curr_first_sym = symbols[0]
  pushURL();
  renderPills();
  await loadSymbol(sym);
  await loadStockInfo();
  panOffset = 0;
  drawGraph();
  renderInfoCards();
  if (prev_first_sym !== curr_first_sym) {
  if (curr_first_sym) {
    renderInfoSheet();
    renderNewsSheet();
    loadTwits(curr_first_sym);
  } else {
    clearInterval(twitsInterval);
    document.getElementById('comments-body').innerHTML = '';
  }
}
}

function removeSymbol(sym) {
  const prev_first_sym = symbols[0]
  symbols = symbols.filter(s => s !== sym);
  const curr_first_sym = symbols[0]
  pushURL();
  renderPills();
  panOffset = 0;
  drawGraph();
  renderInfoCards();
  if (prev_first_sym !== curr_first_sym) {
  if (curr_first_sym) {
    renderInfoSheet();
    renderNewsSheet();
    loadTwits(curr_first_sym);
  } else {
    clearInterval(twitsInterval);
    document.getElementById('comments-body').innerHTML = '';
  }
}
}

document.getElementById('btn-add').addEventListener('click', () => {
  const inp = document.getElementById('sym-input');
  if (inp.value) { addSymbol(inp.value); inp.value = ''; }
});

document.getElementById('sym-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.value) {
    addSymbol(e.target.value);
    e.target.value = '';
  }
});


document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeDays = parseInt(btn.dataset.days);
    panOffset = 0;
    drawGraph();
  });
});

function renderInfoSheet() {
  const sheet = document.getElementById('info-sheet');
  sheet.innerHTML = '';

  const sym = symbols[0];
  if (!sym) return;
  document.title = `${sym} - Stock Analysis`;

  const s          = stockInfo[sym];
  const hist       = rawData[sym];
  const lastPrice  = hist?.length ? hist[hist.length - 1].price : null;
  const firstPrice = hist?.length ? hist[0].price : null;
  const totalChg   = (lastPrice && firstPrice) ? ((lastPrice - firstPrice) / firstPrice) * 100 : null;
  const fcfPerShare = s.free_cashflow / s.shares_outstanding;
  const pToFcf = s.price / fcfPerShare;

  const dayChg  = s?.change;
  const daySign = dayChg  != null ? (dayChg  >= 0 ? '+' : '') : '';
  const dayClass= dayChg  != null ? (dayChg  >= 0 ? 'pos' : 'neg') : '';
  const chgSign = totalChg != null ? (totalChg >= 0 ? '+' : '') : '';
  const chgClass= totalChg != null ? (totalChg >= 0 ? 'pos' : 'neg') : '';
  const peClass = s?.pe != null ? (s.pe < 8 ? 'pos' : s.pe > 50 ? 'neg' : '') : '';
  const pegClass = s?.fpeg != null ? (s.fpeg < 1 ? 'pos' : s.fpeg > 3 ? 'neg' : '') : '';
  const fpeClass = s?.fpe != null ? (s.fpe < 8 ? 'pos' : s.fpe > 50 ? 'neg' : '') : '';
  const t_meanClass = s?.t_mean != null ? (s.t_mean >= s.price ? 'pos' : 'neg') : '';
  const t_medClass = s?.t_median != null ? (s.t_median >= s.price ? 'pos' : 'neg') : '';
  const t_highClass = s?.t_high != null ? (s.t_high >= s.price ? 'pos' : 'neg') : '';
  const t_lowClass = s?.t_low != null ? (s.t_low >= s.price ? 'pos' : 'neg') : '';
  const [score, key, n] = s?.recomm_data ?? [null, null, null];

  const cell = (label, value, cls = '') =>
    `<div class="sheet-cell">
      <span class="sheet-label">${label}</span>
      <span class="sheet-val${cls ? ' ' + cls : ''}">${value ?? '—'}</span>
    </div>`;

  const fmtPct = v => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—';
  const pctClass = v => v != null ? (v >= 0 ? 'pos' : 'neg') : '';

  sheet.innerHTML = `
    <div id="sheet-header">
      <span class="card-sym">${sym}</span>
      ${s?.sector ? `<span class="card-sector">/ ${s.l_name}   ${s.sector}</span>` : ''}
      ${s?.subsector ? `<span class="card-sector" style="opacity:0.6">${s.subsector}</span>` : ''}
      <span style="flex:1"></span>
      <span class="card-price">${s.price != null ? '$' + s.price.toFixed(2) : '—'}</span>
      ${dayChg != null ? `<span class="card-change ${dayClass}">${daySign}${dayChg.toFixed(2)}%</span>` : ''}
    </div>
    <div id="sheet-body">
      ${cell('PERIOD RETURN', fmtPct(totalChg), chgClass)}
      ${cell('DAY CHANGE',    fmtPct(dayChg),   dayClass)}
      ${cell('MKT CAP',       s ? fmtNum(s.market_cap) : '—')}
      ${cell('P/E',           s ? fmt2(s.pe)   : '—', peClass)}
      ${cell('FWD P/E',       s ? fmt2(s.fpe)  : '—', fpeClass)}
      ${cell('FWD PEG',       s ? fmt2(s.fpeg) : '—', pegClass)}
      ${cell('EPS (TTM)',      s ? fmt2(s.eps)     : '—')}
      ${cell('FWD EPS',        s ? fmt2(s.fwd_eps) : '—')}
      ${cell('MA50',  s?.moving_avs ? fmtPct(s.moving_avs[0]) : '—', pctClass(s?.moving_avs?.[0]))}
      ${cell('MA200', s?.moving_avs ? fmtPct(s.moving_avs[1]) : '—', pctClass(s?.moving_avs?.[1]))}
      ${cell('52W HIGH',       s ? '$' + fmt2(s.week52_high) : '—')}
      ${cell('52W LOW',        s ? '$' + fmt2(s.week52_low)  : '—')}
      ${cell('DIV YIELD',      s?.div_yield   != null ? s.div_yield.toFixed(2) + '%'               : '—')}
      ${cell('5YAV DIV YIELD',      s?.five_year_avg_div_yield   != null ? s.five_year_avg_div_yield.toFixed(2) + '%'               : '—')}
      ${cell('PROFIT MGN',     s?.profit_margin != null ? (s.profit_margin * 100).toFixed(2) + '%' : '—')}
      ${cell('GROSS MGN',      s?.gross_margin  != null ? (s.gross_margin  * 100).toFixed(2) + '%' : '—')}
      ${cell('OP MGN',         s?.op_margin     != null ? (s.op_margin     * 100).toFixed(2) + '%' : '—')}
      ${cell('ROE',            s?.roe != null ? (s.roe * 100).toFixed(2) + '%' : '—')}
      ${cell('ROA',            s?.roa != null ? (s.roa * 100).toFixed(2) + '%' : '—')}
      ${cell('DEBT/EQ',        s ? fmt2(s.debt_to_equity) : '—')}
      ${cell('P/C',        s ? fmtNum(s.pc) : '—')}
      ${cell('P/S',        s ? fmtNum(s.ps) : '—')}
      ${cell('P/B',        s ? fmtNum(s.pb) : '—')}
      ${cell('P/FCF',        s ? fmtNum(pToFcf) : '—')}
      ${cell('FCF',        s ? fmtNum(s.free_cashflow) : '—')}
      ${cell('EV/EBITDA',        s ? fmtNum(s.ev_to_ebitda) : '—')}
      ${cell('BETA',           s ? fmt2(s.beta) : '—')}
      ${cell('VOLUME',           s ? fmtNum(s.volume) : '—')}
      ${cell('SHORT %',        s?.short_float != null ? (s.short_float * 100).toFixed(2) + '%' : '—')}
      ${cell('INSIDER HELD',      s?.insider_held   != null ? (s.insider_held   * 100).toFixed(2) + '%' : '—')}
      ${cell('INST HELD',      s?.inst_held   != null ? (s.inst_held   * 100).toFixed(2) + '%' : '—')}
      ${cell('REV GROWTH',     s?.rev_growth  != null ? fmtPct(s.rev_growth  * 100) : '—', pctClass(s?.rev_growth))}
      ${cell('EPS GROWTH',     s?.eps_growth  != null ? fmtPct(s.eps_growth  * 100) : '—', pctClass(s?.eps_growth))}
      ${cell('SHARES OUTS.NG',     s?.shares_outstanding  != null ? fmtNum(s.shares_outstanding) : '—')}
      ${cell('TARGET HIGH',        s ? fmt2(s.t_high) : '—', t_highClass)}
      ${cell('TARGET LOW',        s ? fmt2(s.t_low) : '—', t_lowClass)}
      ${cell('TARGET MEAN',        s ? fmt2(s.t_mean) : '—', t_meanClass)}
      ${cell('TARGET MEDIAN',        s ? fmt2(s.t_median) : '—', t_medClass)}
      ${score != null ? `
        <div class="sheet-cell-wide">
          <span class="sheet-label">${key?.toUpperCase() ?? '—'} · ${score.toFixed(2)}% · ${n ?? '?'} ANALYSTS</span>
          <div class="recomm-bar-bg">
            <div class="recomm-bar-fill" style="background:linear-gradient(to right,#4caf50 ${score}%,#f44336 ${100 - score}%)"></div>
            <div class="recomm-bar-marker" style="left:${score}%">
              <div class="recomm-bar-line"></div>
              <div class="recomm-bar-triangle"></div>
            </div>
          </div>
        </div>` : ''}
    </div>
  `;
}

function renderInfoCards() {
  const grid = document.getElementById('info-grid');
  grid.innerHTML = '';

  symbols.forEach((sym, idx) => {
    const color = COLORS[idx % COLORS.length];
    const s     = stockInfo[sym];
    const hist  = rawData[sym];
    const lastPrice  = hist?.length ? hist[hist.length - 1].price : null;
    const firstPrice = hist?.length ? hist[0].price : null;
    const totalChg   = (lastPrice && firstPrice) ? ((lastPrice - firstPrice) / firstPrice) * 100 : null;

    const dayChg   = s?.change;
    const daySign  = dayChg != null ? (dayChg >= 0 ? '+' : '') : '';
    const dayClass = dayChg != null ? (dayChg >= 0 ? 'pos' : 'neg') : '';
    const chgSign  = totalChg != null ? (totalChg >= 0 ? '+' : '') : '';
    const chgClass = totalChg != null ? (totalChg >= 0 ? 'pos' : 'neg') : '';

    let recommHTML = '';
    if (s?.recomm_data) {
      const [score, key, n] = s.recomm_data;
      const g = score > 50 ? (score - 50) * 2 : 0;
      const r = score <= 50 ? score * 2 : 100;
      recommHTML = `
        <div class="card-row recomm-bar-wrap">
          <span class="card-label">${key?.toUpperCase() ?? '—'} · ${score.toFixed(2)}% · ${n ?? '?'} ANALYST/S</span>
          <div class="recomm-bar-bg">
            <div class="recomm-bar-fill" style="background:linear-gradient(to right,#4caf50 ${g}%,#f44336 ${r}%)"></div>
            <div class="recomm-bar-marker" style="left:${score}%">
              <div class="recomm-bar-line"></div>
              <div class="recomm-bar-triangle"></div>
            </div>
          </div>
        </div>`
    }

    const card = document.createElement('div');
    card.className = 'stock-card';
    card.innerHTML = `
      <div class="card-header">
    <div class="card-color-bar" style="background:${color}"></div>
    <a class="card-sym" href="https://finviz.com/quote.ashx?t=${sym}&p=d" target="_blank">${sym}</a>
        ${s?.sector ? `<span class="card-sector">${s.sector}</span>` : ''}
        <span class="card-price">${lastPrice != null ? '$'+lastPrice.toFixed(2) : '—'}</span>
        ${dayChg != null ? `<span class="card-change ${dayClass}">${daySign}${dayChg.toFixed(2)}%</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-row">
          <span class="card-label">PERIOD RETURN</span>
          <span class="card-val ${chgClass}">${totalChg != null ? chgSign+totalChg.toFixed(2)+'%' : '—'}</span>
        </div>
        <div class="card-row">
          <span class="card-label">MKT CAP</span>
          <span class="card-val">${s ? fmtNum(s.market_cap) : '—'}</span>
        </div>
        <div class="card-row">
          <span class="card-label">P/E</span>
          <span class="card-val">${s ? fmt2(s.pe) : '—'}</span>
        </div>
        <div class="card-row">
          <span class="card-label">FWD P/E</span>
          <span class="card-val">${s ? fmt2(s.fpe) : '—'}</span>
        </div>
        <div class="card-row">
          <span class="card-label">FWD PEG</span>
          <span class="card-val">${s ? fmt2(s.fpeg) : '—'}</span>
        </div>
        <div class="card-row">
          <span class="card-label">MA50</span>
          <span class="card-val ${s?.moving_avs?.[0] >= 0 ? 'pos' : 'neg'}">${s?.moving_avs ? (s.moving_avs[0]>=0?'+':'')+s.moving_avs[0].toFixed(2)+'%' : '—'}</span>
        </div>
        <div class="card-row">
          <span class="card-label">MA200</span>
          <span class="card-val ${s?.moving_avs?.[1] >= 0 ? 'pos' : 'neg'}">${s?.moving_avs ? (s.moving_avs[1]>=0?'+':'')+s.moving_avs[1].toFixed(2)+'%' : '—'}</span>
        </div>
        <div class="card-row">
          <span class="card-label">SUBSECTOR</span>
          <span class="card-val" style="font-size:11px">${s?.subsector ?? '—'}</span>
        </div>
        ${recommHTML}
      </div>`;

    grid.appendChild(card);
  });
}

async function renderNewsSheet() {
  const sym = symbols[0];
  if (!sym) return;
  const s = stockInfo[sym];
  if (!s) return;

  const section = document.getElementById('news-section');
  if (!section) return;

  const newsBody = document.getElementById('news-body');
  newsBody.innerHTML = '<div style="color: #555; padding: 12px; font-size: 12px;">Loading...</div>';

  try {
    const r = await fetch(`${API}/news/${encodeURIComponent(sym)}`);
    const data = await r.json();
    const news = data.news || [];
    newsBody.innerHTML = '';

    if (!news.length) {
      const el = document.createElement('div');
      el.style.cssText = `
        background: rgba(255,200,200,0.08);
        border-left: 3px solid #f44336;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 12px;
        color: #aaa;
      `;
      el.textContent = 'No recent news.';
      newsBody.appendChild(el);
      return;
    }

    let expanded = false;

    function renderArticles() {
      newsBody.querySelectorAll('a, .news-expand-btn').forEach(el => el.remove());

      const toShow = expanded ? news : news.slice(0, 1);

      for (const article of toShow) {
        const date = new Date(article.datetime * 1000).toLocaleTimeString();
        const sentiment = quickSentiment(article.headline);
        const color = sentiment === 'Bullish' ? '#4caf50' : sentiment === 'Bearish' ? '#f44336' : 'var(--border)';
        const el = document.createElement('a');
        el.href = article.url;
        el.target = '_blank';
        el.style.cssText = `
          display: block;
          background: rgba(255,255,255,0.02);
          border-left: 3px solid ${color};
          padding: 8px 12px;
          border-radius: 4px;
          font-size: 12px;
          line-height: 1.5;
          text-decoration: none;
          color: inherit;
        `;
        el.innerHTML = `
          <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
            <span style="color: #ccc; font-weight: 700">${article.source}</span>
            <span style="color: #555">${date}</span>
          </div>
          <div style="color: #aaa">${article.headline}</div>
        `;
        el.addEventListener('mouseover', () => el.style.background = 'rgba(255,255,255,0.05)');
        el.addEventListener('mouseout',  () => el.style.background = 'rgba(255,255,255,0.02)');
        newsBody.appendChild(el);
      }

      if (news.length > 1) {
        const btn = document.createElement('div');
        btn.className = 'news-expand-btn';
        btn.textContent = expanded ? '▲ Show less' : `▼ Show ${news.length - 1} more articles`;
        btn.addEventListener('click', () => { expanded = !expanded; renderArticles(); });
        newsBody.appendChild(btn);
      }
    }

    renderArticles();

  } catch (e) {
    newsBody.innerHTML = '<div style="color: #555; padding: 12px; font-size: 12px;">Failed to load news.</div>';
  }
}

let twitsInterval = null;

function quickSentiment(headline) {
  const h = headline.toLowerCase();
  const bullish = [
    'beat', 'raise', 'surge', 'rally', 'growth', 'record', 'upgrade',
    'buy', 'profit', 'gain', 'soar', 'jump', 'climb', 'rise', 'strong',
    'outperform', 'exceed', 'expand', 'boost', 'improve', 'recover',
    'optimistic', 'bullish', 'positive', 'opportunity', 'breakout',
    'rebound', 'win', 'award', 'launch', 'innovation', 'partnership',
    'deal', 'acquire', 'dividend', 'buyback', 'guidance', 'upbeat',
    'accelerate', 'dominate'
];
  const bearish = [
    'miss', 'cut', 'fall', 'decline', 'loss', 'downgrade', 'sell',
    'warn', 'risk', 'drop', 'dump', 'exit', 'offload', 'slump',
    'tumble', 'plunge', 'sink', 'crash', 'weak', 'disappoint', 'layoff',
    'downsize', 'bankruptcy', 'debt', 'lawsuit', 'probe', 'investigation',
    'fraud', 'recall', 'shortage', 'inflation', 'recession', 'bearish',
    'negative', 'concern', 'fear', 'uncertainty', 'volatile', 'penalty',
    'fine', 'hack', 'breach', 'suspend', 'halt', 'reduce', 'lower',
    'shrink', 'struggle', 'trouble'
];
  const b = bullish.filter(w => h.includes(w)).length;
  const br = bearish.filter(w => h.includes(w)).length;
  if (b > br) return 'Bullish';
  if (br > b) return 'Bearish';
  return 'Neutral';
}

async function loadTwits(symbol) {
  if (twitsInterval) {
    clearInterval(twitsInterval);
  }

  await fetchTwits(symbol);
  twitsInterval = setInterval(() => fetchTwits(symbol), 40_000);
}

async function fetchTwits(symbol) {
  const body = document.getElementById('comments-body');
  body.innerHTML = '<div style="color: #555; padding: 12px; font-size: 12px;">Loading...</div>';

  try {
    const r = await fetch(`${API}/stocktwits/${symbol}`);
    const data = await r.json();
    body.innerHTML = '';

  if (!data.messages?.length) {
    const el = document.createElement('div');
    el.style.cssText = `
      background: rgba(255,200,200,0.08);
      border-left: 3px solid #f44336;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      color: #aaa;
    `;
    el.textContent = 'No comments found.';
    body.appendChild(el);
    return;
  }

    let expanded = false;

    function renderMessages() {
      body.querySelectorAll('.twit-item, .news-expand-btn').forEach(el => el.remove());

      const toShow = expanded ? data.messages : data.messages.slice(0, 1);

      toShow.forEach(msg => {
        const sentiment = msg.entities?.sentiment?.basic;
        const color = sentiment === 'Bullish' ? '#4caf50' : sentiment === 'Bearish' ? '#f44336' : 'var(--border)';

        const el = document.createElement('div');
        el.className = 'twit-item';
        el.style.cssText = `
          background: rgba(255,255,255,0.02);
          border-left: 3px solid ${color};
          padding: 8px 12px;
          border-radius: 4px;
          font-size: 12px;
          line-height: 1.5;
          user-select: text;
          color: #aaa;
          cursor: text;
        `;
        el.innerHTML = `
          <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
            <span style="color: #ccc; font-weight: 700">${msg.user.username}</span>
            <span style="color: #555">${new Date(msg.created_at).toLocaleTimeString()}</span>
          </div>
          ${sentiment ? `<div style="color:${color}; font-size:11px; margin-bottom: 4px;">${sentiment}</div>` : ''}
          <div>${linkify(msg.body)}</div>
        `;
        body.appendChild(el);
      });

      if (data.messages.length > 1) {
        const btn = document.createElement('div');
        btn.className = 'news-expand-btn';
        btn.textContent = expanded ? '▲ Show less' : `▼ Show ${data.messages.length - 1} more messages`;
        btn.addEventListener('click', () => { expanded = !expanded; renderMessages(); });
        body.appendChild(btn);
      }
    }

    renderMessages();

  } catch (e) {
    body.innerHTML = '<div style="color: #555; padding: 12px; font-size: 12px;">Failed to load messages.</div>';
  }
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawGraph, 100);
});

function fmtNum(n) {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return (n/1e12).toFixed(2)+'T';
  if (a >= 1e9)  return (n/1e9).toFixed(2)+'B';
  if (a >= 1e6)  return (n/1e6).toFixed(2)+'M';
  if (a >= 1e3)  return (n/1e3).toFixed(2)+'K';
  return n.toFixed(2);
}

function fmt2(n) { return n != null ? n.toFixed(2) : '—'; }

function hexAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function linkify(text) {
  return text
    .replace(/https?:\/\/[^\s]+/g, url => `<a href="${url}" target="_blank" style="color:#4caf50;text-decoration:underline;cursor:pointer">${url}</a>`);
}

async function init() {
  parseURL();
  renderPills();
  await Promise.all(symbols.map(loadSymbol));
  await loadStockInfo();
  panOffset = 0;
  drawGraph();
  renderInfoCards();
  renderInfoSheet();
  renderNewsSheet();
  loadTwits(symbols[0]);
}

init();