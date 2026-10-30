// Live execution. Called ONLY after the user taps confirm.
// Entry: market order with a price bound → find the new position → OCO close order
// (take-profit + stop-loss). Orders are never retried blindly.

import { boundedMarketPrice } from './risk.js';
import { floorToStep, sleep } from './util.js';
import { bestOf } from './market.js';

export async function currentBest(api, symbol) {
  const book = await api.orderbook(symbol);
  const { ask, bid } = bestOf(book);
  if (!(ask > 0 && bid > 0)) throw new Error('دفتر سفارش این بازار خالی است');
  return { ask, bid, last: Number(book.lastTradePrice) || (ask + bid) / 2 };
}

export function positionSide(p) {
  const s = String(p.side || p.type || '').toLowerCase();
  if (s.includes('sell') || s.includes('short')) return 'short';
  if (s.includes('buy') || s.includes('long')) return 'long';
  return null;
}

export function positionSymbol(p) {
  const dst = String(p.dstCurrency || 'rls').toLowerCase();
  return `${String(p.srcCurrency || '').toUpperCase()}${dst === 'usdt' ? 'USDT' : 'IRT'}`;
}

export async function activePositions(api) {
  const d = await api.positions('active');
  return d.positions || [];
}

/**
 * Possible close amounts (in the coin) for a position, most likely first.
 * Nobitex reports a short's size as `liability` (coin borrowed) and a long's as
 * `totalAsset` (coin held); the planned amount is the fallback. Values that don't
 * match the position's size (collateral × leverage) are dropped.
 */
export function positionAmounts(p, fallbackAmount, step, refPrice) {
  const side = positionSide(p);
  const raw =
    side === 'long'
      ? [p.totalAsset, fallbackAmount, Number(fallbackAmount) * 0.995]
      : [p.liability, p.delegatedAmount, fallbackAmount];
  const expected = Number(p.collateral) * Number(p.leverage);
  const price = Number(refPrice) || Number(p.entryPrice);
  const out = [];
  for (const v of raw) {
    const n = Number(v);
    if (!(n > 0)) continue;
    if (expected > 0 && price > 0) {
      const ratio = (n * price) / expected;
      if (ratio < 0.3 || ratio > 3) continue;
    }
    const a = floorToStep(n, step);
    if (Number(a) > 0 && !out.includes(a)) out.push(a);
  }
  return out;
}

/** Unrealized profit in rials (exchange value if given, else computed from the book). */
export function positionPnl(p, best, fallbackAmount, step) {
  const side = positionSide(p);
  const collateral = Number(p.collateral);
  const given = p.unrealizedPNL ?? p.unrealizedPnl;
  let pnl = given === undefined || given === null || given === '' ? NaN : Number(given);
  if (!isFinite(pnl)) {
    const entry = Number(p.entryPrice);
    const amount = Number(positionAmounts(p, fallbackAmount, step || 1e-8, best && (best.ask + best.bid) / 2)[0]);
    if (!(entry > 0 && amount > 0 && best)) return null;
    pnl = side === 'long' ? (best.bid - entry) * amount : (entry - best.ask) * amount;
  }
  return { pnl, pct: collateral > 0 ? (pnl / collateral) * 100 : null };
}

async function refetch(api, p) {
  try {
    const d = await api.position(p.id);
    return (d && d.position) || p;
  } catch {
    return p;
  }
}

/** Cancel the market's open margin orders (frees amounts locked in a TP/SL). */
export async function freePosition(api, p) {
  try {
    await api.cancelMarketOrders(String(p.srcCurrency).toLowerCase(), String(p.dstCurrency || 'rls').toLowerCase());
    await sleep(1200);
  } catch {
    /* nothing to cancel, or not supported — the close attempt will tell */
  }
  return refetch(api, p);
}

/**
 * Execute a confirmed plan. `log(text)` reports progress to the UI.
 * Returns { orderId, positionId, protectedOk, warnings }.
 */
export async function executePlan(api, plan, precision, log = () => {}) {
  const warnings = [];
  const before = await activePositions(api);
  if (before.some((p) => positionSymbol(p) === plan.symbol)) {
    throw new Error('در همین بازار پوزیشن باز دارید؛ ابتدا آن را ببندید');
  }
  const knownIds = new Set(before.map((p) => p.id));

  log('دریافت قیمت لحظه‌ای…');
  const best = await currentBest(api, plan.symbol);
  const bound = boundedMarketPrice(plan.side, best.ask, best.bid, precision.priceStep);

  log('ثبت سفارش ورود…');
  const res = await api.addMarginOrder({
    src: plan.src,
    dst: plan.dst,
    side: plan.orderSide,
    amount: plan.amount,
    price: bound,
    leverage: plan.leverage,
    execution: 'market',
  });
  const orderId = res.order && res.order.id;

  log('در انتظار باز شدن پوزیشن…');
  let position = null;
  for (let i = 0; i < 15 && !position; i++) {
    await sleep(2000);
    try {
      const list = await activePositions(api);
      position = list.find((p) => !knownIds.has(p.id) && positionSymbol(p) === plan.symbol) || null;
    } catch {
      /* keep polling */
    }
  }
  if (!position) {
    warnings.push('سفارش ثبت شد اما پوزیشن هنوز دیده نشد. از بخش «پوزیشن‌ها» وضعیت را ببینید و حد سود/ضرر بگذارید.');
    return { orderId, positionId: null, protectedOk: false, warnings };
  }
  if (positionSide(position) && positionSide(position) !== plan.side) {
    warnings.push('جهت پوزیشن باز شده با پیشنهاد یکی نیست؛ در اپ نوبیتکس بررسی کنید.');
  }

  log('ثبت حد سود و حد ضرر…');
  const protectedOk = await protectPosition(api, position, plan, plan.amount, precision, log, warnings, false);
  return { orderId, positionId: position.id, protectedOk, warnings };
}

/**
 * Place the OCO close order (take-profit limit + stop-loss).
 * prices: { tpPrice, stopPrice, stopLimitPrice }. With cancelFirst, existing orders of the
 * market are cancelled first (needed when changing an existing TP/SL).
 */
export async function protectPosition(api, position, prices, fallbackAmount, precision, log = () => {}, warnings = [], cancelFirst = true) {
  let p = position;
  if (cancelFirst) {
    log('لغو سفارش‌های قبلی این بازار…');
    p = await freePosition(api, p);
  }
  const amounts = positionAmounts(p, fallbackAmount, precision.amountStep, prices.tpPrice).slice(0, 3);
  if (!amounts.length) {
    warnings.push('مقدار پوزیشن مشخص نشد؛ حد ضرر را از اپ نوبیتکس بگذارید.');
    return false;
  }
  let lastErr = null;
  for (const amount of amounts) {
    try {
      await api.closePosition(p.id, {
        amount,
        price: prices.tpPrice,
        stopPrice: prices.stopPrice,
        stopLimitPrice: prices.stopLimitPrice,
        mode: 'oco',
      });
      log('حد سود و ضرر ثبت شد ✓');
      return true;
    } catch (e) {
      lastErr = e;
    }
  }
  warnings.push('ثبت حد سود/ضرر ناموفق بود: ' + (lastErr ? lastErr.message : '') + ' — از بخش پوزیشن‌ها دوباره تلاش کنید یا پوزیشن را ببندید.');
  return false;
}

/** Close a whole position now: cancel its TP/SL, then a market order with a price bound. */
export async function closeNow(api, position, precision, fallbackAmount) {
  const p = await freePosition(api, position);
  const side = positionSide(p) || 'long';
  const best = await currentBest(api, positionSymbol(p));
  // closing a long = selling (bound below bid), closing a short = buying (bound above ask)
  const bound = boundedMarketPrice(side === 'long' ? 'short' : 'long', best.ask, best.bid, precision.priceStep, 0.5);
  const amounts = positionAmounts(p, fallbackAmount, precision.amountStep, (best.ask + best.bid) / 2).slice(0, 3);
  if (!amounts.length) throw new Error('مقدار پوزیشن مشخص نیست؛ از اپ نوبیتکس ببندید');
  let lastErr = null;
  for (const amount of amounts) {
    try {
      return await api.closePosition(p.id, { amount, price: bound, execution: 'market' });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
