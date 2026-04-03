"""Price fetcher — yfinance integration with caching and fallback."""

import sqlite3
import logging
import threading
from datetime import datetime

import yfinance as yf

logger = logging.getLogger('signage')

METAL_TICKERS = {
    'Gold':      'GC=F',
    'Silver':    'SI=F',
    'Platinum':  'PL=F',
    'Palladium': 'PA=F',
}
FX_TICKERS = ['CADUSD=X', 'EURUSD=X']

# Track consecutive failures for admin warning
_lock = threading.Lock()
_consecutive_failures = 0
_last_error = None


def get_failure_status():
    """Return (consecutive_failures, last_error_message)."""
    with _lock:
        return _consecutive_failures, _last_error


def fetch_and_store(db_path):
    """Fetch all 4 metals + USD/CAD, convert to CAD, store in DB.

    Returns list of price dicts on success, None on failure.
    """
    global _consecutive_failures, _last_error

    all_tickers = list(METAL_TICKERS.values()) + FX_TICKERS

    try:
        data = yf.download(
            all_tickers,
            period='2d',
            interval='1m',
            group_by='ticker',
            progress=False,
            threads=True,
        )

        if data.empty:
            raise ValueError('yfinance returned empty data')

        # --- Extract FX rates -----------------------------------------------
        fx_close = data['CADUSD=X']['Close'].dropna()
        if fx_close.empty:
            raise ValueError('No FX data for CADUSD=X')
        usd_cad = 1.0 / float(fx_close.iloc[-1])

        # EUR rate (non-fatal if unavailable)
        usd_eur = 0.0
        try:
            eur_close = data['EURUSD=X']['Close'].dropna()
            if not eur_close.empty:
                usd_eur = 1.0 / float(eur_close.iloc[-1])
        except Exception:
            logger.warning('EUR FX data unavailable, EUR prices will be 0')

        # --- Extract metal prices -------------------------------------------
        results = []
        for name, symbol in METAL_TICKERS.items():
            col = data[symbol]['Close'].dropna()
            if col.empty:
                logger.warning(f'No data for {symbol}, skipping')
                continue

            price_usd = float(col.iloc[-1])

            # Daily change: compare to first data point of the 2-day window
            prev_price = float(col.iloc[0])
            change_usd = price_usd - prev_price
            change_pct = (change_usd / prev_price * 100) if prev_price != 0 else 0.0

            price_cad = price_usd * usd_cad
            change_cad = change_usd * usd_cad
            price_eur = price_usd * usd_eur
            change_eur = change_usd * usd_eur

            results.append({
                'metal': symbol,
                'name': name,
                'price_usd': round(price_usd, 2),
                'price_cad': round(price_cad, 2),
                'price_eur': round(price_eur, 2),
                'change_usd': round(change_usd, 2),
                'change_dollar': round(change_cad, 2),
                'change_eur': round(change_eur, 2),
                'change_percent': round(change_pct, 2),
            })

        if not results:
            raise ValueError('No metal prices could be extracted')

        # --- Store in DB ----------------------------------------------------
        now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        conn = sqlite3.connect(db_path)
        for r in results:
            conn.execute(
                '''INSERT INTO prices
                   (metal, price_usd, price_cad, price_eur,
                    change_usd, change_dollar, change_eur, change_percent, fetched_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (r['metal'], r['price_usd'], r['price_cad'], r['price_eur'],
                 r['change_usd'], r['change_dollar'], r['change_eur'],
                 r['change_percent'], now),
            )
        conn.commit()

        # Prune old rows — keep last 24 hours only
        conn.execute(
            "DELETE FROM prices WHERE fetched_at < datetime('now', '-1 day')"
        )
        conn.commit()
        conn.close()

        with _lock:
            _consecutive_failures = 0
            _last_error = None

        logger.info(
            f'Prices updated: '
            + ', '.join(f"{r['name']}=${r['price_cad']:.2f}CAD" for r in results)
            + f' (USD/CAD={usd_cad:.4f}, USD/EUR={usd_eur:.4f})'
        )
        return results

    except Exception as e:
        with _lock:
            _consecutive_failures += 1
            _last_error = str(e)
            fails = _consecutive_failures

        logger.error(f'Price fetch failed ({fails} consecutive): {e}')
        return None
