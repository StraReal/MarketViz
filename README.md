### Setup
1. Clone the repo: ```git clone https://github.com/StraReal/MarketViz.git```
2. You can run the script by just double-clicking `mviz.bat`

### API Keys

- **Finnhub** (optional) - used for stock news. Get a free key at https://finnhub.io/. Without it, the news section will be empty.

### Data Sources

- **yfinance** - fundamental indicators, prices, and price history
- **Finnhub** - news articles per stock
- **StockTwits** - real-time comments and sentiment on stocks

### Notes

Once you run `mviz.bat` (or `app.py`) it will expose the visualization on `0.0.0.0:5000`. This can be changed in the code however you like.

I highly recommend not stopping the program and restarting it again quickly, this will send lots of requests to yfinance and get you rate limited.

It comes with an auto-updater. You have no reason to trust me: turn it off, I made it for less technical people who use this (friends etc.) to get the updates without having to do a git clone or anything more than once.

#### !! This is only supposed for personal use, as it uses scraping to gather data !!