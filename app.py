import math
from datetime import datetime

from flask import Flask, jsonify, Response, send_file, redirect, url_for, request
from flask_cors import CORS
from curl_cffi import requests as cffi_requests
import requests as req
import yfinance as yf
import pandas as pd
import threading
import json
import time
import os
import csv
from concurrent.futures import ThreadPoolExecutor, as_completed

app = Flask(__name__,static_folder='frontend/static', static_url_path='/static')
CORS(app)

url = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"

stocks = {}
tickers = []
done = False
lock = threading.Lock()
stop_event = threading.Event()
fetch_thread = None

required = ('sector', 'subsector', 'symbol', 'price', 'market_cap', 'change', 'moving_avs')

_tickers_cache = None
_tickers_loaded_at = None
TICKERS_TTL = 3600


with open('secrets.json') as f:
    _secrets = json.load(f)

FINNHUB_KEY    = _secrets['finnhub_api_key']

def load_tickers():
    global _tickers_cache, _tickers_loaded_at
    now = time.time()
    if _tickers_cache is None or _tickers_loaded_at is None or (now - _tickers_loaded_at) > TICKERS_TTL:
        _tickers_cache = pd.read_csv(url)['Symbol'].tolist()
        _tickers_loaded_at = now
        print(f"Tickers reloaded ({len(_tickers_cache)} tickers)")
    return _tickers_cache

rate_limited_event = threading.Event()

def fetch_one(ticker_name):
    if rate_limited_event.is_set():
        return None
    ticker_name = ticker_name.replace('.', '-')
    try:
        tick = yf.Ticker(ticker_name)
        info = tick.info

        sector = info.get('sector')
        subsector = info.get('industry')
        price = info.get('currentPrice')
        pe = info.get('trailingPE')
        forward_pe = info.get('forwardPE')
        eps_current = info.get('epsCurrentYear')
        eps_forward = info.get('forwardEps')
        ps = info.get('priceToSalesTrailing12Months')
        pb = info.get('priceToBook')
        market_cap = info.get('marketCap', 0)
        change = info.get('regularMarketChangePercent', 0)
        moving_avs = [
            info.get('fiftyDayAverageChangePercent', 0) * 100,
            info.get('twoHundredDayAverageChangePercent', 0) * 100
        ]
        recomm_mean = info.get('recommendationMean', 9)
        recomm_score = (5 - recomm_mean) * 25
        recomm_data = [
            recomm_score,
            info.get('recommendationKey', 'none'),
            info.get('numberOfAnalystOpinions', -1)
        ]
        eps = info.get('trailingEps')
        fwd_eps = info.get('forwardEps')
        beta = info.get('beta')
        week52_high = info.get('fiftyTwoWeekHigh')
        week52_low = info.get('fiftyTwoWeekLow')
        div_yield = info.get('dividendYield')
        five_year_avg_div_yield = info.get('fiveYearAvgDividendYield')
        profit_margin = info.get('profitMargins')
        gross_margin = info.get('grossMargins')
        op_margin = info.get('operatingMargins')
        roa = info.get('returnOnAssets')
        roe = info.get('returnOnEquity')
        debt_to_equity = info.get('debtToEquity')
        free_cashflow = info.get('freeCashflow')
        short_float = info.get('shortPercentOfFloat')
        inst_held = info.get('heldPercentInstitutions')
        insider_held = info.get('heldPercentInsiders')
        rev_growth = info.get('revenueGrowth')
        eps_growth = info.get('earningsGrowth')
        ev_to_ebitda = info.get('enterpriseToEbitda')
        volume = info.get('volume')
        operating_cashflow = info.get('operatingCashflow')
        shares_outstanding = info.get('sharesOutstanding')

        t_high = info.get('targetHighPrice')
        t_low = info.get('targetLowPrice')
        t_mean = info.get('targetMeanPrice')
        t_median = info.get('targetMedianPrice')

        l_name = info.get('longName')
        l_summary = info.get('longBusinessSummary')

        if not operating_cashflow or not shares_outstanding:
            p_to_cf = None
        else:
            cf_per_share = operating_cashflow / shares_outstanding
            p_to_cf = price / cf_per_share if cf_per_share else None

        fpeg = None
        if forward_pe and eps_current and eps_forward and pe:
            try:
                growth_rate = ((eps_forward - eps_current) / eps_current) * 100
                fpeg = forward_pe / growth_rate
                if fpeg < 0:
                    fpeg = None
            except ZeroDivisionError:
                pass

        stock = {
            'sector': sector,
            'subsector': subsector,
            'symbol': ticker_name,
            'price': price,
            'pe': pe,
            'fpe': forward_pe,
            'fpeg': fpeg,
            'ps': ps,
            'pb': pb,
            'pc': p_to_cf,
            'market_cap': market_cap,
            'change': change,
            'moving_avs': moving_avs,
            'recomm_data': recomm_data,
            'favorite': False,
            'eps': eps,
            'fwd_eps': fwd_eps,
            'beta': beta,
            'week52_high': week52_high,
            'week52_low': week52_low,
            'div_yield': div_yield,
            'profit_margin': profit_margin,
            'roa': roa,
            'roe': roe,
            'rev_growth': rev_growth,
            'eps_growth': eps_growth,
            'gross_margin': gross_margin,
            'inst_held': inst_held,
            'insider_held': insider_held,
            'op_margin': op_margin,
            'debt_to_equity': debt_to_equity,
            'free_cashflow': free_cashflow,
            'short_float': short_float,
            'ev_to_ebitda': ev_to_ebitda,
            'five_year_avg_div_yield': five_year_avg_div_yield,
            'volume': volume,
            'shares_outstanding': shares_outstanding,
            'l_name': l_name,
            'l_summary': l_summary,
            't_high': t_high,
            't_low': t_low,
            't_mean': t_mean,
            't_median': t_median,
        }

        if any(stock[k] is None for k in required):
            print(f"SKIP {ticker_name}: missing required fields")
            return None

        try:
            hist = tick.history(period='1y')
            existing = load_history(ticker_name)
            for row in hist.itertuples():
                date = str(row.Index.date())
                existing[date] = {
                    'open': round(row.Open, 4),
                    'high': round(row.High, 4),
                    'low': round(row.Low, 4),
                    'close': round(row.Close, 4),
                    'volume': int(row.Volume)
                }
            save_history(ticker_name, dict(sorted(existing.items())))
        except Exception as e:
            print(f"HISTORY ERROR {ticker_name}: {e}")

        rate_limited_event.clear()

        with lock:
            if ticker_name in stocks:
                stock['favorite'] = stocks[ticker_name].get('favorite', False)

        print(f"OK {ticker_name}")
        return stock

    except Exception as e:
        if 'Too Many Requests' in str(e) or '429' in str(e):
            print(f"Rate limited on {ticker_name}, pausing fetch.")
            rate_limited_event.set()
            return None
        print(f"ERROR {ticker_name}: {e}")
        return None


def worker_loop(ticker_slice, worker_id):
    i = 0
    while not stop_event.is_set():
        ticker = ticker_slice[i]
        result = fetch_one(ticker)
        if rate_limited_event.is_set():
            print(f"Worker {worker_id} rate limited, backing off...")
            time.sleep(60)
            rate_limited_event.clear()
            continue

        if result:
            with lock:
                stocks[result['symbol']] = result

        i += 1
        if i >= len(ticker_slice):
            i = 0
            print(f"Worker {worker_id} completed pass, restarting...")

def fetch_all():
    all_tickers = load_tickers()
    mid = len(all_tickers) // 2
    slices = [all_tickers[:mid], all_tickers[mid:]]

    threads = []
    for i, slice in enumerate(slices):
        t = threading.Thread(target=worker_loop, args=(slice, i), daemon=True)
        t.start()
        threads.append(t)

    for t in threads:
        t.join()

HISTORY_DIR = 'history'
os.makedirs(HISTORY_DIR, exist_ok=True)

_history_cache = {}

def load_history(symbol):
    if symbol in _history_cache:
        return _history_cache[symbol]
    path = os.path.join(HISTORY_DIR, f'{symbol}.csv')
    if not os.path.exists(path):
        return {}
    with open(path, newline='') as f:
        reader = csv.DictReader(f)
        data = {row['date']: {
            'open':   float(row['open']),
            'high':   float(row['high']),
            'low':    float(row['low']),
            'close':  float(row['close']),
            'volume': int(row['volume'])
        } for row in reader}
    _history_cache[symbol] = data
    return data

def save_history(symbol, data):
    path = os.path.join(HISTORY_DIR, f'{symbol}.csv')
    with open(path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'open', 'high', 'low', 'close', 'volume'])
        writer.writeheader()
        for date, row in data.items():
            if any(str(v).lower() == 'nan' for v in [row['open'], row['high'], row['low'], row['close']]):
                continue
            writer.writerow({'date': date, **row})

@app.route('/api/portfolio_history/<name>')
def get_portfolio_history(name):
    path = os.path.join(PORTFOLIOS_DIR, f'{name}.json')
    if not os.path.exists(path):
        return jsonify({'error': 'not found'}), 404

    with open(path) as f:
        portfolio = json.load(f)

    holdings = portfolio['holdings']

    all_dates = set()
    histories = {}
    for symbol in holdings:
        hist = load_history(symbol)
        histories[symbol] = hist
        all_dates.update(hist.keys())

    all_dates = sorted(all_dates)

    result = []
    for date in all_dates:
        total_value = 0
        total_cost = 0
        for symbol, h in holdings.items():
            if h['added_at'][:10] > date:
                continue
            hist = histories.get(symbol, {})
            price = hist.get(date, {}).get('close')
            if price is None:
                continue
            total_value += h['shares'] * price
            total_cost += h['shares'] * h['price_at_buy']

        if total_value > 0:
            result.append({
                'date': date,
                'value': round(total_value, 2),
                'cost': round(total_cost, 2),
                'gain': round(total_value - total_cost, 2),
                'gain_pct': round((total_value - total_cost) / total_cost * 100, 4) if total_cost else 0
            })

    return jsonify(result)

@app.route('/api/stock_history/<symbol>')
def get_stock_history(symbol):
    hist = load_history(symbol)
    if not hist:
        return jsonify({'error': 'not found'}), 404

    result = [
        {'date': date, 'price': data['close']}
        for date, data in sorted(hist.items())
        if not math.isnan(data['close'])
    ]
    return jsonify(result)

@app.route('/api/history/<symbol>')
def get_history(symbol):
    try:
        existing = load_history(symbol)
        if existing:
            return jsonify(existing)

        hist = yf.Ticker(symbol).history(period='1y')
        for row in hist.itertuples():
            date = str(row.Index.date())
            existing[date] = {
                'open': round(row.Open, 4),
                'high': round(row.High, 4),
                'low': round(row.Low, 4),
                'close': round(row.Close, 4),
                'volume': int(row.Volume)
            }
        sorted_data = dict(sorted(existing.items()))
        save_history(symbol, sorted_data)
        return jsonify(sorted_data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/')
def index():
    return redirect(url_for('heatmap_viz'))

@app.route('/viz')
def heatmap_viz():
    return send_file('frontend/html/viz.html')

@app.route('/stock')
def stock_viz():
    return send_file('frontend/html/stock.html')

@app.route('/api/stocks')
def get_stocks():
    with lock:
        return jsonify({
            'stocks': list(stocks.values()),
            'done': done,
            'total': len(tickers),
            'loaded': len(stocks)
        })

@app.route('/api/stream')
def stream():
    """SSE endpoint — pushes each stock as it arrives."""
    def generate():
        seen = set()
        prev_done = False
        while True:
            with lock:
                current_stocks = dict(stocks)
                current_done = done

            for sym, s in current_stocks.items():
                if sym not in seen:
                    seen.add(sym)
                    yield f"data: {json.dumps({'type': 'stock', 'stock': s, 'total': len(tickers)})}\n\n"

            if current_done and not prev_done:
                yield f"data: {json.dumps({'type': 'done', 'total': len(current_stocks)})}\n\n"
                prev_done = True

            if current_done:
                break

            time.sleep(0.2)

    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

@app.route('/api/favorite/<symbol>', methods=['POST'])
def toggle_favorite(symbol):
    with lock:
        if symbol in stocks:
            stocks[symbol]['favorite'] = not stocks[symbol]['favorite']
            return jsonify({'favorite': stocks[symbol]['favorite']})
    return jsonify({'error': 'not found'}), 404

PORTFOLIOS_DIR = 'portfolios'
os.makedirs(PORTFOLIOS_DIR, exist_ok=True)

@app.route('/portfolio_browser')
def portfolio_browser():
    return send_file('frontend/html/portfolio_browser.html')

@app.route('/portfolio/<name>')
def portfolio_view(name):
    return send_file('frontend/html/portfolio.html')

@app.route('/api/portfolios', methods=['GET'])
def get_portfolios():
    portfolios = {}
    for fname in os.listdir(PORTFOLIOS_DIR):
        if fname.endswith('.json'):
            name = fname[:-5]
            with open(os.path.join(PORTFOLIOS_DIR, fname)) as f:
                portfolios[name] = json.load(f)
    return jsonify(portfolios)

@app.route('/api/portfolios/<name>', methods=['GET'])
def get_portfolio(name):
    path = os.path.join(PORTFOLIOS_DIR, f'{name}.json')
    if not os.path.exists(path):
        return jsonify({'error': 'not found'}), 404
    with open(path) as f:
        return jsonify(json.load(f))

@app.route('/api/portfolios/<name>', methods=['POST'])
def save_portfolio(name):
    data = request.get_json()
    path = os.path.join(PORTFOLIOS_DIR, f'{name}.json')
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    return jsonify({'status': 'saved'})

@app.route('/api/portfolios/<name>', methods=['DELETE'])
def delete_portfolio(name):
    path = os.path.join(PORTFOLIOS_DIR, f'{name}.json')
    if os.path.exists(path):
        os.remove(path)
    return jsonify({'status': 'deleted'})

@app.route('/api/portfolios/<name>/buy', methods=['POST'])
def buy_holding(name):
    path = os.path.join(PORTFOLIOS_DIR, f'{name}.json')
    if not os.path.exists(path):
        return jsonify({'error': 'not found'}), 404
    data = request.get_json()  # {symbol, shares, price}
    with open(path) as f:
        portfolio = json.load(f)

    symbol = data['symbol']
    shares = data['shares']
    price = data['price']
    timestamp = data.get('timestamp', datetime.now().isoformat() + 'Z')

    if symbol in portfolio['holdings']:
        existing = portfolio['holdings'][symbol]
        total_shares = existing['shares'] + shares
        existing['price_at_buy'] = (
            (existing['shares'] * existing['price_at_buy']) + (shares * price)
        ) / total_shares
        existing['shares'] = total_shares
    else:
        portfolio['holdings'][symbol] = {
            'shares': shares,
            'price_at_buy': price,
            'added_at': timestamp
        }

    portfolio['log'].append({
        'type': 'buy',
        'symbol': symbol,
        'shares': shares,
        'price': price,
        'timestamp': timestamp
    })

    with open(path, 'w') as f:
        json.dump(portfolio, f, indent=2)
    return jsonify(portfolio)

@app.route('/api/portfolios/<name>/sell', methods=['POST'])
def sell_holding(name):
    path = os.path.join(PORTFOLIOS_DIR, f'{name}.json')
    if not os.path.exists(path):
        return jsonify({'error': 'not found'}), 404
    data = request.get_json()  # {symbol, percent, price}
    with open(path) as f:
        portfolio = json.load(f)

    symbol = data['symbol']
    percent = data['percent']
    price = data['price']
    timestamp = data.get('timestamp', datetime.utcnow().isoformat() + 'Z')

    if symbol not in portfolio['holdings']:
        return jsonify({'error': f'{symbol} not in portfolio'}), 400
    if not (0 < percent <= 100):
        return jsonify({'error': 'percent must be between 0 and 100'}), 400

    existing = portfolio['holdings'][symbol]

    if percent == 100:
        shares_to_sell = existing['shares']
        del portfolio['holdings'][symbol]
    else:
        shares_to_sell = existing['shares'] * (percent / 100)
        existing['shares'] -= shares_to_sell

    portfolio['log'].append({
        'type': 'sell',
        'symbol': symbol,
        'shares': shares_to_sell,
        'percent': percent,
        'price': price,
        'timestamp': timestamp
    })

    with open(path, 'w') as f:
        json.dump(portfolio, f, indent=2)
    return jsonify(portfolio)

@app.route('/api/index')
def get_index():
    r = req.get('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=2d',
                     headers={'User-Agent': 'Mozilla/5.0'})
    meta = r.json()['chart']['result'][0]['meta']
    price = meta['regularMarketPrice']
    return jsonify({
        'price': round(price, 2),
    })

@app.route('/api/stocktwits/<symbol>')
def stocktwits(symbol):
    r = cffi_requests.get(
        f'https://api.stocktwits.com/api/2/streams/symbol/{symbol}.json',
        impersonate="chrome"
    )
    if r.status_code != 200:
        return jsonify({'error': f'status {r.status_code}'}), 502
    return jsonify(r.json())

@app.route('/api/news/<symbol>')
def get_news(symbol):
    try:
        try:
            from datetime import timedelta
            today = datetime.now().strftime('%Y-%m-%d')
            week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')

            n = req.get('https://finnhub.io/api/v1/company-news', params={
                'symbol': symbol,
                'from': week_ago,
                'to': today,
                'token': FINNHUB_KEY
            })

            if n.status_code == 200:
                news = n.json()[:10]
                with lock:
                    if symbol in stocks:
                        stocks[symbol]['news'] = news
                return jsonify({'news': news})
            else:
                print(f"NEWS {symbol}: Finnhub returned {n.status_code}, falling back to cache")

        except Exception as e:
            print(f"NEWS FETCH ERROR {symbol}: {e}")

        # Fall back to cached news
        with lock:
            cached = stocks.get(symbol, {}).get('news', [])
        return jsonify({'news': cached})

    except Exception as e:
        print(f"NEWS ERROR {symbol}: {e}")
        return jsonify({'news': []}), 500

def schedule_fetch():
    while True:
        time.sleep(300)
        print("Scheduled refetch starting...")
        global fetch_thread
        stop_event.set()
        if fetch_thread and fetch_thread.is_alive():
            fetch_thread.join(timeout=3)
        stop_event.clear()
        fetch_thread = threading.Thread(target=fetch_all, daemon=True)
        fetch_thread.start()

if __name__ == '__main__':
    fetch_thread = threading.Thread(target=fetch_all, daemon=True)
    fetch_thread.start()
    threading.Thread(target=schedule_fetch, daemon=True).start()
    app.run(debug=False, port=5000, threaded=True)