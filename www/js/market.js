// Market discovery: quote-currency margin markets, limits and precisions.

import { DEFAULT_MIN_ORDER_RIALS, DEFAULT_MIN_ORDER_USDT } from './risk.js';

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

export const MAX_CANDIDATES = 20;
// Default: markets with less than ~0.5 billion toman daily volume are skipped (adjustable in settings).
export const MIN_VOLUME_RIALS = 5_000_000_000;
const DEFAULT_USDT_TO_RIAL_RATE = 684_500; // Used only when the public USDT/RLS ticker is unavailable.

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

export function symbolOf(src, dst = 'rls') {
  return `${src.toUpperCase()}${dst === 'usdt' ? 'USDT' : 'IRT'}`;
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
        if (!['rls', 'usdt'].includes(dst) || !src) continue;
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

  statFor(src, dst = 'rls') {
    return this.stats[`${src}-${dst}`] || null;
  }

  /** Most liquid tradable markets in the requested quote currency (skips thin markets). */
  candidates(n = 10, minVolumeRials = MIN_VOLUME_RIALS, quoteCurrency = 'IRT') {
    const minVol = Number.isFinite(Number(minVolumeRials)) ? Number(minVolumeRials) : MIN_VOLUME_RIALS;
    const dst = String(quoteCurrency).toUpperCase() === 'USDT' ? 'usdt' : 'rls';
    const usdtToRial = Number(this.stats['usdt-rls']?.latest) || DEFAULT_USDT_TO_RIAL_RATE;
    const rows = Object.entries(this.markets)
      .map(([symbol, m]) => {
        const s = this.statFor(m.src, m.dst);
        const quoteVolume = s ? Number(s.volumeDst) || 0 : 0;
        const volume = m.dst === 'usdt' ? quoteVolume * usdtToRial : quoteVolume;
        return { symbol, ...m, volume, quoteVolume, closed: s ? !!s.isClosed : false };
      })
      .filter((x) => x.dst === dst && !x.closed && (x.buyEnabled || x.sellEnabled) && x.volume > 0 && x.volume >= minVol);
    rows.sort((a, b) => b.volume - a.volume);
    return rows.slice(0, Math.min(Math.max(Math.round(n) || 10, 1), MAX_CANDIDATES + 10));
  }

  precision(symbol) {
    const nb = (this.options && this.options.nobitex) || {};
    const ap = nb.amountPrecisions || {};
    const pp = nb.pricePrecisions || {};
    const mo = nb.minOrders || {};
    const dst = this.markets && this.markets[symbol] ? this.markets[symbol].dst : /USDT$/i.test(symbol) ? 'usdt' : 'rls';
    const baseSymbol = String(symbol).replace(/USDT$/i, 'IRT').toUpperCase();
    const amountStep = Number(ap[symbol]) || FALLBACK_AMOUNT_STEP[symbol] || FALLBACK_AMOUNT_STEP[baseSymbol] || 0.000001;
    const priceStep = Number(pp[symbol]) || (dst === 'usdt' ? 0.01 : 10);
    const minOrderValue =
      Number(mo[dst] ?? mo[dst.toUpperCase()]) || (dst === 'usdt' ? DEFAULT_MIN_ORDER_USDT : DEFAULT_MIN_ORDER_RIALS);
    return { amountStep, priceStep, minOrderValue, minOrderRials: minOrderValue };
  }
}
