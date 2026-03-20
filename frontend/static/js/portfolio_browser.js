const API = 'http://localhost:5000/api';

async function loadPortfolios() {
  const [portfoliosRes, stocksRes] = await Promise.all([
    fetch(`${API}/portfolios`),
    fetch(`${API}/stocks`)
  ]);

  const portfolios = await portfoliosRes.json();
  const stocksData = await stocksRes.json();
  const stocks = {};
  for (const s of (stocksData.stocks || [])) stocks[s.symbol] = s;

  const grid = document.getElementById('info-grid');
  grid.innerHTML = '';

  for (const [name, p] of Object.entries(portfolios)) {
    const holdings = p.holdings || {};
    const log = p.log || [];

    const numStocks = Object.keys(holdings).length;

    let totalValue = 0, totalCost = 0, totalDayGain = 0;
    for (const [sym, h] of Object.entries(holdings)) {
      const s = stocks[sym];
      const price = s?.price ?? h.price_at_buy;
      const value = price * h.shares;
      const cost  = h.price_at_buy * h.shares;
      totalValue   += value;
      totalCost    += cost;
      totalDayGain += s?.change != null ? (s.change / 100) * value : 0;
    }

    const totalPL    = totalCost ? ((totalValue - totalCost) / totalCost) * 100 : 0;
    const dayPL      = totalValue ? (totalDayGain / totalValue) * 100 : 0;

    const createdAt  = new Date(p.created_at);
    const daysSince  = Math.max(1, (Date.now() - createdAt) / 86400000);
    const avgTxPerDay = log.length / daysSince;

    const years = daysSince / 365;
    const avgYearlyYield = totalCost ? (Math.pow(totalValue / totalCost, 1 / Math.max(years, 0.01)) - 1) * 100 : 0;

    let yield2y = null;
    try {
      const histRes = await fetch(`${API}/portfolio_history/${encodeURIComponent(name)}`);
      const hist = await histRes.json();
      if (hist.length) {
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 2);
        const cutStr = cutoff.toISOString().slice(0, 10);
        const startPoint = hist.find(d => d.date >= cutStr) || hist[0];
        const endPoint   = hist[hist.length - 1];
        yield2y = startPoint.cost ? ((endPoint.value - startPoint.cost) / startPoint.cost) * 100 : null;
      }
    } catch(e) {}

    const totalSign   = totalPL >= 0 ? '+' : '';
    const daySign     = dayPL >= 0 ? '+' : '';
    const yieldSign   = avgYearlyYield >= 0 ? '+' : '';
    const yield2ySign = yield2y != null ? (yield2y >= 0 ? '+' : '') : '';

    const card = document.createElement('div');
    card.className = 'stock-card';
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => window.location = `/portfolio/${encodeURIComponent(name)}`);

    card.innerHTML = `
      <div class="card-header">
        <span class="card-sym">${name}</span>
        <span class="card-price">€${fmtNum(totalValue)}</span>
        <span class="card-change ${dayPL >= 0 ? 'pos' : 'neg'}">${daySign}${dayPL.toFixed(2)}%</span>
      </div>
      <div class="card-body">
        <div class="card-row">
          <span class="card-label">CREATED</span>
          <span class="card-val">${createdAt.toISOString().slice(0,10)}</span>
        </div>
        <div class="card-row">
          <span class="card-label">STOCKS</span>
          <span class="card-val">${numStocks}</span>
        </div>
        <div class="card-row">
          <span class="card-label">TOTAL P/L</span>
          <span class="card-val ${totalPL >= 0 ? 'pos' : 'neg'}">${totalSign}${totalPL.toFixed(2)}%</span>
        </div>
        <div class="card-row">
          <span class="card-label">AVG TX/DAY</span>
          <span class="card-val">${avgTxPerDay.toFixed(2)}</span>
        </div>
        <div class="card-row">
          <span class="card-label">AVG YEARLY</span>
          <span class="card-val ${avgYearlyYield >= 0 ? 'pos' : 'neg'}">${yieldSign}${avgYearlyYield.toFixed(2)}%</span>
        </div>
        <div class="card-row">
          <span class="card-label">2Y YIELD</span>
          <span class="card-val ${yield2y >= 0 ? 'pos' : 'neg'}">${yield2y != null ? yield2ySign+yield2y.toFixed(2)+'%' : '—'}</span>
        </div>
      </div>`;

    grid.appendChild(card);
  }
}

function fmtNum(n) {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return (n/1e12).toFixed(2)+'T';
  if (a >= 1e9)  return (n/1e9).toFixed(2)+'B';
  if (a >= 1e6)  return (n/1e6).toFixed(2)+'M';
  if (a >= 1e3)  return (n/1e3).toFixed(2)+'K';
  return n.toFixed(2);
}

loadPortfolios();