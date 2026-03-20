const API = 'http://localhost:5000/api';
let stocks = {};
let done = false;
let totalTickers = 0;
let coloring = 0;
let max_coloring = 5;
let selectedSymbol = null;
let sidebarOpen = false;
const Portfolios = {
  cache: {},

  async loadAll() {
    const r = await fetch(`${API}/portfolios`);
    this.cache = await r.json();
    return this.cache;
  },

  async create(name) {
    const portfolio = {
      name,
      created_at: new Date().toISOString(),
      holdings: {},
      log: []
    };
    await fetch(`${API}/portfolios/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(portfolio)
    });
    this.cache[name] = portfolio;
    return portfolio;
  },

  async addHolding(portfolioName, symbol, shares, priceAtBuy) {
    const r = await fetch(`${API}/portfolios/${encodeURIComponent(portfolioName)}/holding`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        symbol,
        shares,
        price_at_buy: priceAtBuy,
        added_at: new Date().toISOString()
      })
    });
    const updated = await r.json();
    this.cache[portfolioName] = updated;
    return updated;
  },

  async delete(name) {
    await fetch(`${API}/portfolios/${encodeURIComponent(name)}`, {method: 'DELETE'});
    delete this.cache[name];
  },

  stats(portfolioName) {
    const p = this.cache[portfolioName];
    if (!p) return null;
    let totalCost = 0, totalValue = 0;
    for (const [sym, h] of Object.entries(p.holdings)) {
      const current = stocks[sym]?.price ?? h.price_at_buy;
      totalCost  += h.shares * h.price_at_buy;
      totalValue += h.shares * current;
    }
    return {
      totalCost,
      totalValue,
      gain: totalValue - totalCost,
      gainPct: totalCost ? ((totalValue - totalCost) / totalCost) * 100 : 0
    };
  }
};

let camX = 0, camY = 0, zoom = 1;
let isDragging = false, dragStartX = 0, dragStartY = 0, camStartX = 0, camStartY = 0;
let mouseDownX = 0, mouseDownY = 0;
const DRAG_THRESHOLD = 5;

let layoutCache = null;
let layoutDirty = true;

const canvas = document.getElementById('heatmap');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvas-wrap');

function resize() {
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  layoutDirty = true;
  render();
}
window.addEventListener('resize', resize);

function getColor(change) {
  if (change == null) return [50, 50, 50];
  const t = Math.max(-1, Math.min(1, change / 5));
  const gray = [50, 50, 50];
  if (t >= 0) {
    return [
      Math.round(gray[0] * (1-t)),
      Math.round(gray[1] + (180-gray[1]) * t),
      Math.round(gray[2] * (1-t))
    ];
  } else {
    const u = -t;
    return [
      Math.round(gray[0] + (180-gray[0]) * u),
      Math.round(gray[1] * (1-u)),
      Math.round(gray[2] * (1-u))
    ];
  }
}

function colorVal(s) {
  if (coloring === 0) return s.change;
  if (coloring === 1) return s.moving_avs[0];
  if (coloring === 2) return s.moving_avs[1];
  if (coloring === 3) return s.fpeg != null ? Math.max(-5, 5 - s.fpeg*5) : null;
  if (coloring === 4) return (s.recomm_data[0] - 70) / 6;
  if (coloring === 5) return (s.pe/s.fpe-1);
  return s.change;
}

function rgbStr(rgb) { return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; }
function dimRgb(rgb) { return [Math.round(rgb[0]*0.3), Math.round(rgb[1]*0.3), Math.round(rgb[2]*0.3)]; }

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

function squarify(items, x, y, w, h) {
  if (!items.length) return [];
  let tot = items.reduce((s,i) => s + i.market_cap, 0) || 1;
  const results = [];

  function layoutRow(row, rx, ry, rw, rh) {
    const rowTotal = row.reduce((s,i) => s + i.market_cap, 0);
    if (rw >= rh) {
      const colW = (rowTotal/tot)*rw;
      let cy = ry;
      for (const s of row) {
        const ch = (s.market_cap/rowTotal)*rh;
        results.push({s, x:rx, y:cy, w:colW, h:ch});
        cy += ch;
      }
    } else {
      const rowH = (rowTotal/tot)*rh;
      let cx = rx;
      for (const s of row) {
        const cw = (s.market_cap/rowTotal)*rw;
        results.push({s, x:cx, y:ry, w:cw, h:rowH});
        cx += cw;
      }
    }
  }

  function worstRatio(row, rw, rh) {
    const rowTotal = row.reduce((s,i) => s + i.market_cap, 0) || 1;
    const ratios = [];
    for (const s of row) {
      if (rw >= rh) {
        const colW = (rowTotal/tot)*rw;
        const tileH = (s.market_cap/rowTotal)*rh;
        if (tileH === 0) continue;
        ratios.push(colW/tileH);
      } else {
        const rowH = (rowTotal/tot)*rh;
        const tileW = (s.market_cap/rowTotal)*rw;
        if (tileW === 0) continue;
        ratios.push(rowH/tileW);
      }
    }
    if (!ratios.length) return Infinity;
    return Math.max(...ratios.map(r => Math.max(r, 1/r)));
  }

  const remaining = [...items].sort((a,b) => b.market_cap - a.market_cap);
  let currentRow = [];
  let cx = x, cy = y, cw = w, ch = h;

  while (remaining.length) {
    const s = remaining[0];
    const candidate = [...currentRow, s];
    if (!currentRow.length || worstRatio(candidate, cw, ch) <= worstRatio(currentRow, cw, ch)) {
      currentRow.push(s);
      remaining.shift();
    } else {
      layoutRow(currentRow, cx, cy, cw, ch);
      const rowTotal = currentRow.reduce((s,i) => s + i.market_cap, 0);
      if (cw >= ch) { const dx = (rowTotal/tot)*cw; cx += dx; cw -= dx; }
      else          { const dy = (rowTotal/tot)*ch; cy += dy; ch -= dy; }
      tot -= rowTotal;
      currentRow = [];
    }
  }
  if (currentRow.length) layoutRow(currentRow, cx, cy, cw, ch);
  return results;
}

const SECTOR_H = 20;

function buildLayout() {
  const list = Object.values(stocks).sort((a,b) => b.market_cap - a.market_cap);
  if (!list.length) return null;

  const bySector = {};
  for (const s of list) {
    (bySector[s.sector] = bySector[s.sector]||[]).push(s);
  }
  const totalCap = list.reduce((s,i) => s + i.market_cap, 0) || 1;

  const sectorsSorted = Object.entries(bySector)
    .map(([name, arr]) => ({name, arr, cap: arr.reduce((s,i)=>s+i.market_cap,0)}))
    .sort((a,b) => b.cap - a.cap);

  const rows = [];
  let cur = [], curCap = 0;
  const target = totalCap / 3;
  for (const sec of sectorsSorted) {
    cur.push(sec);
    curCap += sec.cap;
    if (curCap >= target) { rows.push({row:cur, cap:curCap}); cur=[]; curCap=0; }
  }
  if (cur.length) rows.push({row:cur, cap:curCap});

  const W = canvas.width, H = canvas.height;
  const rowH = H / rows.length;
  const tiles = [];
  const sectorRects = [];

  for (let ri = 0; ri < rows.length; ri++) {
    const {row, cap: rowCap} = rows[ri];
    const wy = ri * rowH;
    let wx = 0;
    for (const sec of row) {
      const sw = (sec.cap / rowCap) * W;
      sectorRects.push({name: sec.name, x:wx, y:wy, w:sw, h:SECTOR_H});
      const tilesY = wy + SECTOR_H;
      const tilesH = rowH - SECTOR_H;
      const t = squarify(sec.arr, wx, tilesY, sw, tilesH);
      tiles.push(...t);
      wx += sw;
    }
  }
  return {tiles, sectorRects};
}

let hitTiles = [];

function worldToScreen(wx, wy) {
  return [(wx + camX)*zoom, (wy + camY)*zoom];
}

function render() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, W, H);

  if (layoutDirty) { layoutCache = buildLayout(); layoutDirty = false; }
  if (!layoutCache) return;

  hitTiles = [];
  const PAD = Math.max(1, zoom);
  const halfPad = PAD/2;

  for (const {s, x:wx, y:wy, w:ww, h:wh} of layoutCache.tiles) {
    const [sx, sy] = worldToScreen(wx, wy);
    const sw = ww*zoom - PAD;
    const sh = wh*zoom - PAD;

    if (sx > W || sy > H || sx+sw < 0 || sy+sh < 0) continue;

    const rx = sx+halfPad, ry = sy+halfPad;

    const color = getColor(colorVal(s));
    const dim = dimRgb(color);
    const isSelected = s.symbol === selectedSymbol;
    const borderW = Math.max(1, sh/40);

    ctx.fillStyle = rgbStr(color);
    ctx.fillRect(rx, ry, sw, sh);

    ctx.strokeStyle = isSelected ? '#ffff64' : rgbStr(dim);
    ctx.lineWidth = isSelected ? 2 : borderW;
    ctx.strokeRect(rx+borderW/2, ry+borderW/2, sw-borderW, sh-borderW);

    hitTiles.push({sx:rx, sy:ry, sw, sh, s});

    if (sh < 14) continue;

    ctx.save();
    ctx.beginPath();
    ctx.rect(rx+2, ry+2, sw-4, sh-4);
    ctx.clip();

    let textY = ry + 4 + borderW;
    const bigH = Math.max(4, Math.min(Math.sqrt(sw)*1.5, Math.sqrt(sh)*1.5, 180));
    const smallH = Math.max(3, Math.min(Math.sqrt(sw), Math.sqrt(sh), 180));

    if (sh > textY - ry + bigH) {
      ctx.font = `700 ${bigH}px "IBM Plex Mono"`;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      const symW = ctx.measureText(s.symbol).width;
      const symSubW = ctx.measureText(`${s.symbol} : ${s.subsector}`).width;
      if (symSubW < sw - 4 - borderW*2) {
        ctx.fillStyle = 'rgba(210,210,210,0.85)';
        ctx.fillText(`${s.symbol} : ${s.subsector}`, rx+3+borderW, textY+bigH-2);
      } else if (symW < sw - 4 - borderW*2) {
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillText(s.symbol, rx+3+borderW, textY+bigH-2);
      }
      if (s.favorite && bigH < sw-3) {
        ctx.fillStyle = '#f0c040';
        ctx.font = `${bigH}px serif`;
        ctx.fillText('★', rx+sw-bigH-3, textY+bigH-2);
      }
      textY += bigH + 3;
    }

    ctx.font = `500 ${smallH}px "IBM Plex Mono"`;

    if (s.price != null && sh > textY-ry+smallH) {
      const full  = `${s.price.toFixed(2)} • ${s.change>=0?'+':''}${s.change.toFixed(2)}% • ${fmtNum(s.market_cap)}`;
      const mid   = `${s.price.toFixed(2)} • ${s.change>=0?'+':''}${s.change.toFixed(2)}%`;
      const mini  = `${s.price.toFixed(2)}`;
      ctx.fillStyle = 'rgba(200,200,200,0.9)';
      for (const t of [full, mid, mini]) {
        if (ctx.measureText(t).width < sw-4) { ctx.fillText(t, rx+3+borderW, textY+smallH-2); break; }
      }
      textY += smallH + 2;
    }

    ctx.fillStyle = 'rgba(180,180,180,0.85)';
    for (const [label, val] of [['P/E', s.pe],['fP/E', s.fpe],['fPEG', s.fpeg]]) {
      if (sh > textY-ry+smallH) {
        const t = val != null ? `${label}:${val.toFixed(2)}` : `${label}:—`;
        if (ctx.measureText(t).width < sw-4) {
          ctx.fillText(t, rx+3+borderW, textY+smallH-2);
          textY += smallH+2;
        }
      }
    }

    if (sh > textY-ry+smallH && s.recomm_data) {
      const rd = s.recomm_data;
      const t = `${rd[1].toUpperCase()} (${rd[0].toFixed(0)}% · ${rd[2]})`;
      if (ctx.measureText(t).width < sw-4) {
        ctx.fillText(t, rx+3+borderW, textY+smallH-2);
        textY += smallH+2;
      }
    }

    if (sh > textY-ry+smallH && s.moving_avs) {
      const both = `MA50:${s.moving_avs[0].toFixed(2)}%  MA200:${s.moving_avs[1].toFixed(2)}%`;
      const ma50 = `MA50:${s.moving_avs[0].toFixed(2)}%`;
      for (const t of [both, ma50]) {
        if (ctx.measureText(t).width < sw-4) { ctx.fillText(t, rx+3+borderW, textY+smallH-2); break; }
      }
    }

    ctx.restore();
  }

  for (const {name, x:wx, y:wy, w:ww, h:wh} of layoutCache.sectorRects) {
    const [sx, sy] = worldToScreen(wx, wy);
    const sw = ww*zoom, sh = wh*zoom;
    if (sx > W || sy > H || sx+sw < 0 || sy+sh < 0) continue;

    ctx.fillStyle = 'rgba(40,40,60,0.9)';
    ctx.fillRect(sx, sy, sw, sh);

    const fsize = Math.max(8, Math.min(180, Math.round(Math.sqrt(121*zoom))));
    ctx.font = `600 ${fsize}px "IBM Plex Sans"`;
    ctx.fillStyle = 'rgba(200,200,220,0.9)';
    const lw = ctx.measureText(name).width;
    if (lw < sw-4) ctx.fillText(name, sx+4, sy+sh*0.75);
  }
}

function startSSE() {
  pollStocks().then(() => {
    const es = new EventSource(`${API}/stream`);
    es.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'stock') {
        stocks[msg.stock.symbol] = msg.stock;
        layoutDirty = true;
        totalTickers = msg.total;
        updateStatus();
        updateSidebar();
        document.getElementById('loading').classList.add('hidden');
      } else if (msg.type === 'done') {
        done = true;
        totalTickers = msg.total;
        updateStatus();
      }
    };
    es.onerror = () => {
      es.close();
      pollStocks();
    };
  });
}

async function updateIndex() {
  const held = Object.values(stocks).filter(s => s.market_cap && s.change != null);
  if (!held.length) return;

  const totalCap = held.reduce((s, x) => s + x.market_cap, 0);
  const weightedChange = held.reduce((s, x) => s + (x.change * x.market_cap / totalCap), 0);

  const r = await fetch(`${API}/index`);
  const { price: spPrice } = await r.json();

  const sign = weightedChange >= 0 ? '+' : '';
  const el = document.getElementById('header-performance');
  el.textContent = `${spPrice.toLocaleString(undefined, {maximumFractionDigits: 2})} | ${weightedChange >= 0 ? '+' : ''}${weightedChange.toFixed(2)}%`;
  el.classList.toggle('pos', weightedChange >= 0);
  el.classList.toggle('neg', weightedChange < 0);
}

function pollStocks() {
  return fetch(`${API}/stocks`)
    .then(r => r.json())
    .then(data => {
      for (const s of data.stocks) stocks[s.symbol] = s;
      totalTickers = data.total;
      done = data.done;
      layoutDirty = true;
      updateStatus();
      updateSidebar();
      if (!done) document.getElementById('loading').classList.remove('hidden');
      else document.getElementById('loading').classList.add('hidden');
    })
    .catch(() => {});
}

function updateStatus() {
  updateIndex();
  const loaded = Object.keys(stocks).length;
  document.getElementById('status').textContent =
    `${loaded}/${totalTickers} ${done?'✓':'…'}`;
  if (totalTickers) {
    document.getElementById('loading-bar').style.width = (loaded/totalTickers*100)+'%';
    document.getElementById('loading-text').textContent = `LOADING… ${loaded}/${totalTickers}`;
  }
}

let sidebarFilter = '';

function updateSidebar() {
  if (!sidebarOpen) return;
  const list = document.getElementById('sidebar-list');
  const sorted = Object.values(stocks)
    .filter(s => !sidebarFilter || s.symbol.startsWith(sidebarFilter.toUpperCase()))
    .sort((a,b) => b.market_cap - a.market_cap);

  const existing = new Set([...list.querySelectorAll('.sidebar-item')].map(el=>el.dataset.sym));
  const needed = new Set(sorted.map(s=>s.symbol));

  for (const sym of existing) {
    if (!needed.has(sym)) list.querySelector(`[data-sym="${sym}"]`)?.remove();
  }

  for (const s of sorted) {
    let el = list.querySelector(`[data-sym="${s.symbol}"]`);
    const color = getColor(colorVal(s));
    const isSelected = s.symbol === selectedSymbol;
    if (!el) {
      el = document.createElement('div');
      el.className = 'sidebar-item';
      el.dataset.sym = s.symbol;
      el.innerHTML = `
        <div class="sidebar-color-dot"></div>
        <div class="sidebar-symbol"></div>
        <div class="sidebar-change"></div>
        <div class="sidebar-star">☆</div>`;
      el.addEventListener('click', e => {
        if (e.target.classList.contains('sidebar-star')) return;
        selectSymbol(s.symbol);
      });
      el.querySelector('.sidebar-star').addEventListener('click', () => toggleFav(s.symbol));
      list.appendChild(el);
    }
    el.querySelector('.sidebar-color-dot').style.background = rgbStr(color);
    el.querySelector('.sidebar-symbol').textContent = s.symbol;
    el.querySelector('.sidebar-change').textContent =
      s.change != null ? (s.change>=0?'+':'')+s.change.toFixed(2)+'%' : '—';
    el.querySelector('.sidebar-star').textContent = s.favorite ? '★' : '☆';
    el.querySelector('.sidebar-star').classList.toggle('active', s.favorite);
    el.classList.toggle('selected', isSelected);
  }
}

function selectSymbol(sym, forceSelection=false, moveTo=false) {
  if (selectedSymbol === sym && !forceSelection) {
    selectedSymbol = null;
    document.getElementById('detail').classList.remove('visible');
  } else {
    selectedSymbol = sym;
    showDetail(sym);
    if (moveTo) { moveToSymbol(sym) };
  }
  layoutDirty = true;
  render();
  updateSidebar();
}

function scoreToRG(pct) {
  if (pct <= 50) {
    return [pct * 2, 0];
  } else {
    return [100, (pct - 50) * 2];
  }
}

function showDetail(sym) {
  const s = stocks[sym];
  if (!s) return;
  const panel = document.getElementById('detail');
  panel.classList.add('visible');

  document.getElementById('detail-symbol').textContent = s.symbol;
  document.getElementById('detail-sector').textContent = `${s.sector} › ${s.subsector}`;
  document.getElementById('dp-price').textContent = s.price != null ? `$${s.price.toFixed(2)}` : '—';

  const chEl = document.getElementById('dp-change');
  chEl.textContent = s.change != null ? (s.change>=0?'+':'')+s.change.toFixed(2)+'%' : '—';
  chEl.className = 'detail-cell-val ' + (s.change>0?'pos':s.change<0?'neg':'neutral');

  document.getElementById('dp-mcap').textContent = fmtNum(s.market_cap);
  document.getElementById('dp-pe').textContent = fmt2(s.pe);
  document.getElementById('dp-fpe').textContent = fmt2(s.fpe);
  document.getElementById('dp-fpeg').textContent = fmt2(s.fpeg);

  const ma50El = document.getElementById('dp-ma50');
  const ma200El = document.getElementById('dp-ma200');
  if (s.moving_avs) {
    ma50El.textContent = (s.moving_avs[0]>=0?'+':'')+s.moving_avs[0].toFixed(2)+'%';
    ma50El.className = 'detail-cell-val '+(s.moving_avs[0]>0?'pos':'neg');
    ma200El.textContent = (s.moving_avs[1]>=0?'+':'')+s.moving_avs[1].toFixed(2)+'%';
    ma200El.className = 'detail-cell-val '+(s.moving_avs[1]>0?'pos':'neg');
  }

  if (s.recomm_data) {
    const [score, key, n] = s.recomm_data;
    document.getElementById('dp-recomm').textContent = `${key.toUpperCase()} (${score.toFixed(2)}%) · ${n} analysts`;

    const [r, g] = scoreToRG(score);
    document.getElementById('dp-recomm-fill').style.background = `linear-gradient(to right, #4caf50 ${g}%, #f44336 ${r}%)`;

  }

  const starEl = document.getElementById('detail-star');
  starEl.textContent = s.favorite ? '★' : '☆';
  starEl.className = s.favorite ? 'active' : '';
}

function moveToSymbol(sym) {
  if (!layoutCache) return;
  const tile = layoutCache.tiles.find(t => t.s.symbol === sym);
  if (!tile) return;
  const W = canvas.width, H = canvas.height;
  const tCenterX = tile.x + tile.w;
  const tCenterY = tile.y + tile.h;
  camX = W/2/zoom - tCenterX;
  camY = H/2/zoom - tCenterY;
}

function toggleFav(sym) {
  fetch(`${API}/favorite/${sym}`, {method:'POST'})
    .then(r=>r.json())
    .then(data => {
      if (stocks[sym]) {
        stocks[sym].favorite = data.favorite;
        layoutDirty = true;
        render();
        updateSidebar();
        if (selectedSymbol === sym) showDetail(sym);
      }
    });
}

const tooltip = document.getElementById('tooltip');

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  isDragging = false;
  dragStartX = e.clientX; dragStartY = e.clientY;
  mouseDownX = e.clientX; mouseDownY = e.clientY;
  camStartX = camX; camStartY = camY;
});

window.addEventListener('mousemove', e => {
  if (e.buttons === 1) {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (!isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      isDragging = true;
      wrap.classList.add('dragging');
    }
    if (isDragging) {
      camX = camStartX + dx/zoom;
      camY = camStartY + dy/zoom;
      render();
    }
  }

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  let hit = null;
  for (let i = hitTiles.length-1; i >= 0; i--) {
    const t = hitTiles[i];
    if (mx>=t.sx && mx<=t.sx+t.sw && my>=t.sy && my<=t.sy+t.sh) { hit=t.s; break; }
  }
  if (hit) {
    tooltip.style.display = 'block';
    tooltip.style.left = Math.min(e.clientX+14, window.innerWidth-280)+'px';
    tooltip.style.top  = Math.min(e.clientY+14, window.innerHeight-200)+'px';
    const chSign = hit.change>=0?'+':'';
    tooltip.innerHTML = `
      <div class="tt-symbol">${hit.symbol}</div>
      <div class="tt-sub">${hit.sector} › ${hit.subsector}</div>
      <div class="tt-row"><span class="tt-label">Price</span><span class="tt-val">$${hit.price!=null?hit.price.toFixed(2):'—'}</span></div>
      <div class="tt-row"><span class="tt-label">Change</span><span class="tt-val ${hit.change>0?'pos':'neg'}">${chSign}${hit.change!=null?hit.change.toFixed(2)+'%':'—'}</span></div>
      <div class="tt-row"><span class="tt-label">Mkt Cap</span><span class="tt-val">${fmtNum(hit.market_cap)}</span></div>
      <div class="tt-divider"></div>
      <div class="tt-row"><span class="tt-label">P/E</span><span class="tt-val">${fmt2(hit.pe)}</span></div>
      <div class="tt-row"><span class="tt-label">fP/E</span><span class="tt-val">${fmt2(hit.fpe)}</span></div>
      <div class="tt-row"><span class="tt-label">fPEG</span><span class="tt-val">${fmt2(hit.fpeg)}</span></div>
    `;
  } else {
    tooltip.style.display = 'none';
  }
});

window.addEventListener('mouseup', e => {
  if (e.button !== 0) return;
  wrap.classList.remove('dragging');
  if (!isDragging) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;

    const topEl = document.elementFromPoint(e.clientX, e.clientY);
    if (topEl !== canvas) return;

    let clicked = null;
    for (let i = hitTiles.length-1; i >= 0; i--) {
      const t = hitTiles[i];
      if (mx>=t.sx && mx<=t.sx+t.sw && my>=t.sy && my<=t.sy+t.sh) { clicked=t.s; break; }
    }
    if (clicked) {
      if (e.ctrlKey) window.open(`https://finviz.com/quote.ashx?t=${clicked.symbol}&p=d`,'_blank');
      else selectSymbol(clicked.symbol);
    }
  }
});

window.addEventListener('dblclick', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;

  const topEl = document.elementFromPoint(e.clientX, e.clientY);
  if (topEl !== canvas) return;

  let clicked = null;
  for (let i = hitTiles.length-1; i >= 0; i--) {
    const t = hitTiles[i];
    if (mx>=t.sx && mx<=t.sx+t.sw && my>=t.sy && my<=t.sy+t.sh) { clicked=t.s; break; }
  }
if (clicked) window.open(`/stock?symbols=${clicked.symbol}`, '_blank');
isDragging = false;
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const wbx = mx/zoom - camX, wby = my/zoom - camY;
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  zoom = Math.max(0.05, Math.min(50, zoom * factor));
  camX = mx/zoom - wbx;
  camY = my/zoom - wby;
  render();
}, {passive:false});

const searchBox = document.getElementById('search-box');

document.addEventListener('keydown', e => {
  if (document.activeElement !== document.body) return;
if (e.key === 'l' || e.key === 'L') { e.preventDefault(); searchBox.focus(); }
  if (e.key >= '1' && e.key <= max_coloring+1) {
    coloring = parseInt(e.key)-1;
    setColorBtn(coloring);
    layoutDirty = true;
    render();
  }
  if (e.key === 'Escape') {
    selectedSymbol = null;
    document.getElementById('detail').classList.remove('visible');
    layoutDirty = true;
    render();
  }
});

searchBox.addEventListener('input', () => {
  const v = searchBox.value.toUpperCase();
  sidebarFilter = v;
  const matches = Object.keys(stocks).filter(k => k.startsWith(v)).sort();
  if (matches.length === 1) { selectSymbol(matches[0], true, true); searchBox.blur(); searchBox.value=''; sidebarFilter='';}
  updateSidebar();
});

searchBox.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const v = searchBox.value.toUpperCase();
    const matches = Object.keys(stocks).filter(k=>k.startsWith(v)).sort();
    if (matches.length) selectSymbol(matches[0], true, true);
    searchBox.blur(); searchBox.value=''; sidebarFilter='';
    updateSidebar();
  }
  if (e.key === 'Escape') { searchBox.blur(); searchBox.value=''; sidebarFilter=''; updateSidebar(); }
});

function setColorBtn(n) {
  document.querySelectorAll('.color-btn').forEach((b,i) => b.classList.toggle('active', i===n));
  document.querySelectorAll('.dropdown-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.col) === n);
  });
}

document.getElementById('btn-sidebar').addEventListener('click', () => {
  sidebarOpen = !sidebarOpen;
  document.getElementById('sidebar').classList.toggle('open', sidebarOpen);
  document.getElementById('btn-sidebar').classList.toggle('active', sidebarOpen);
  if (sidebarOpen) updateSidebar();
  setTimeout(()=>{ resize(); }, 210);
});

for (let i=0;i<4;i++) {
  document.getElementById(`col-${i}`).addEventListener('click', ()=>{
    coloring=i; setColorBtn(i); layoutDirty=true; render();
  });
}

document.getElementById('cols-menu').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('cols-dropdown').classList.toggle('open');
});

document.getElementById('cols-dropdown').addEventListener('click', e => {
  const col = e.target.dataset.col;
  if (col == null) return;
  coloring = parseInt(col);
  setColorBtn(coloring);
  layoutDirty = true;
  render();
  document.getElementById('cols-dropdown').classList.remove('open');
});

document.addEventListener('click', () => {
  document.getElementById('cols-dropdown').classList.remove('open');
});

document.getElementById('detail-close').addEventListener('click', ()=>{
  selectedSymbol=null;
  document.getElementById('detail').classList.remove('visible');
  layoutDirty=true; render(); updateSidebar();
});

document.getElementById('detail-portfolio-add').addEventListener('click', () => {
  if (!selectedSymbol) return;
  document.getElementById('modal-symbol').textContent = selectedSymbol;
  document.getElementById('portfolio-modal').classList.add('open');
});

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('portfolio-modal').classList.remove('open');
});

document.getElementById('portfolio-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('portfolio-modal'))
    document.getElementById('portfolio-modal').classList.remove('open');
});

document.getElementById('modal-amount').addEventListener('input', () => {
  const amount = parseFloat(document.getElementById('modal-amount').value);
  const s = stocks[selectedSymbol];
  if (!amount || !s?.price) {
    document.getElementById('modal-shares-preview').textContent = `— shares @ $${s.price.toFixed(2)}`;
    return;
  }
  const shares = amount / s.price;
  document.getElementById('modal-shares-preview').textContent =
    `${shares.toFixed(4)} shares @ $${s.price.toFixed(2)}`;
});

document.getElementById('detail-portfolio-add').addEventListener('click', async () => {
  if (!selectedSymbol) return;
  document.getElementById('modal-symbol').textContent = selectedSymbol;

  const portfolios = await Portfolios.loadAll();
  const list = document.getElementById('modal-portfolio-list');
  list.innerHTML = '';

  for (const name of Object.keys(portfolios)) {
    const el = document.createElement('div');
    el.className = 'modal-portfolio-item';
    el.textContent = name;
    el.addEventListener('click', async () => {
  const amount = parseFloat(document.getElementById('modal-amount').value) || 0;
  const s = stocks[selectedSymbol];
  const shares = s?.price ? amount / s.price : 0;
  await Portfolios.addHolding(name, selectedSymbol, shares, s?.price ?? 0);
  document.getElementById('portfolio-modal').classList.remove('open');
});
    list.appendChild(el);
  }

  const createEl = document.createElement('div');
  createEl.className = 'modal-portfolio-item modal-portfolio-create';
  createEl.textContent = '+ Create new portfolio';
  createEl.addEventListener('click', async () => {
    const name = prompt('Portfolio name:');
    if (!name?.trim()) return;
    await Portfolios.create(name.trim());
    const s = stocks[selectedSymbol];
    await Portfolios.addHolding(name.trim(), selectedSymbol, 1, s?.price ?? 0);
    document.getElementById('portfolio-modal').classList.remove('open');
  });
  list.appendChild(createEl);

  document.getElementById('portfolio-modal').classList.add('open');
});

document.getElementById('detail-star').addEventListener('click', () => {
  if (selectedSymbol) toggleFav(selectedSymbol);
});

function loop() {
  if (layoutDirty) render();
  requestAnimationFrame(loop);
}

resize();
loop();
startSSE();