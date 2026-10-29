// Market discovery: which rial margin markets exist, their limits and precisions.

import { DEFAULT_MIN_ORDER_RIALS } from './risk.js';

const FALLBACK_MARKETS = ['btc', 'eth', 'xrp', 'doge', 'sol', 'ton', 'trx', 'ada'];

const FALLBACK_AMOUNT_STEP = {
  BTCIRT: 0.000001,
  ETHIRT: 0.00001,
  SOLIRT: 0.0001,
  TONIRT: 0.001,
  XRPIRT: 1,
  DOGEIRT: 1,
  TRXIRT: 1,
  ADAIRT: 1,
};

export const MAX_CANDIDATES = 15;
// Markets with less than ~1 billion toman daily volume are skipped (wide spreads, easy to move).
export const MIN_VOLUME_RIALS = 10_000_000_000;

/** Best ask/bid from an orderbook regardless of sort order. */
export function bestOf(book) {
  const asks = (book && book.asks) || [];
  const bids = (book && book.bids) || [];
  const ask = asks.length ? Math.min(...asks.slice(0, 5).map((x) => Number(x[0]))) : NaN;
  const bid = bids.length ? Math.max(...bids.slice(0, 5).map((x) => Number(x[0]))) : NaN;
  return { ask, bid };
}

/** Spread in percent for every symbol in one request (/v3/orderbook/all). */
export async function spreads(api) {
  const out = {};
  try {
    const all = await api.orderbook('all');
    for (const [sym, book] of Object.entries(all)) {
      if (!book || typeof book !== 'object' || !book.asks) continue;
      const { ask, bid } = bestOf(book);
      if (ask > 0 && bid > 0) out[sym.toUpperCase()] = ((ask - bid) / ((ask + bid) / 2)) * 100;
    }
  } catch {
    /* spreads are optional */
  }
  return out;
}

export function symbolOf(src) {
  return `${src.toUpperCase()}IRT`;
}

export class MarketInfo {
  constructor(api) {
    this.api = api;
    this.options = null;
    this.markets = null; // { BTCIRT: {src, dst, maxLeverage, buyEnabled, sellEnabled} }
    this.stats = null;
    this.warnings = [];
  }

  async load() {
    this.warnings = [];
    const [opt, mk, st] = await Promise.allSettled([this.api.options(), this.api.marginMarkets(), this.api.marketStats()]);
    this.options = opt.status === 'fulfilled' ? opt.value : null;
    if (!this.options) this.warnings.push('تنظیمات دقت قیمت از نوبیتکس دریافت نشد؛ مقادیر پیش‌فرض استفاده می‌شود');

    if (st.status !== 'fulfilled') throw st.reason;
    this.stats = st.value.stats || {};

    this.markets = {};
    if (mk.status === 'fulfilled' && mk.value && mk.value.markets) {
      for (const [sym, m] of Object.entries(mk.value.markets)) {
        const src = String(m.srcCurrency || '').toLowerCase();
        const dst = String(m.dstCurrency || '').toLowerCase();
        if (dst !== 'rls' || !src) continue;
        this.markets[sym.toUpperCase()] = {
          src,
          dst,
          maxLeverage: Number(m.maxLeverage) || 3,
          buyEnabled: m.buyEnabled !== false,
          sellEnabled: m.sellEnabled !== false,
        };
      }
    }
    if (!Object.keys(this.markets).length) {
      this.warnings.push('فهرست بازارهای تعهدی دریافت نشد؛ از فهرست پیش‌فرض استفاده می‌شود');
      for (const src of FALLBACK_MARKETS) {
        this.markets[symbolOf(src)] = { src, dst: 'rls', maxLeverage: 3, buyEnabled: true, sellEnabled: true };
      }
    }
    return this;
  }

  statFor(src) {
    return this.stats[`${src}-rls`] || null;
  }

  /** Most liquid tradable rial margin markets (skips thin markets). */
  candidates(n = 10) {
    const rows = Object.entries(this.markets)
      .map(([symbol, m]) => {
        const s = this.statFor(m.src);
        return { symbol, ...m, volume: s ? Number(s.volumeDst) || 0 : 0, closed: s ? !!s.isClosed : false };
      })
      .filter((x) => !x.closed && (x.buyEnabled || x.sellEnabled) && x.volume >= MIN_VOLUME_RIALS);
    rows.sort((a, b) => b.volume - a.volume);
    return rows.slice(0, Math.min(Math.max(Math.round(n) || 10, 3), MAX_CANDIDATES));
  }

  precision(symbol) {
    const nb = (this.options && this.options.nobitex) || {};
    const ap = nb.amountPrecisions || {};
    const pp = nb.pricePrecisions || {};
    const mo = nb.minOrders || {};
    const amountStep = Number(ap[symbol]) || FALLBACK_AMOUNT_STEP[symbol] || 0.000001;
    const priceStep = Number(pp[symbol]) || 10;
    const minOrderRials = Number(mo.rls) || DEFAULT_MIN_ORDER_RIALS;
    return { amountStep, priceStep, minOrderRials };
  }
}
