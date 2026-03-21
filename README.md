### Setup

1. Install dependencies: `pip install -r requirements.txt`
2. Copy `secrets.template.json` to `secrets.json` and fill in your keys

### API Keys

- **Finnhub** (optional) — used for stock news. Get a free key at https://finnhub.io/. Without it, the news section will be empty.

### Data Sources

- **yfinance** — fundamental indicators, prices, and price history
- **Finnhub** — news articles per stock
- **StockTwits** — real-time comments and sentiment on stocks

### Notes

Theoretically just running app.py and going to http://127.0.0.1:5000/viz should lead you to the main visualization no problem, from which you can then visit all the various parts of the suite.

I highly recommend not stopping the program and restarting it again quickly, this will send lots of requests to yfinance and get you rate limited.

#### !! This is only supposed for personal use, as it uses scraping to gather data !!