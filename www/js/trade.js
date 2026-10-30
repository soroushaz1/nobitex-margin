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

/** A positive decimal string with at most 10 decimals (no float noise), or null. */
export function exactAmount(v) {
  const n = Number(v);
  if (!(n > 0) || !isFinite(n)) return null;
  let str = String(v).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) str = n.toFixed(10);
  const [i, f = ''] = str.split('.');
  const frac = f.slice(0, 10).replace(/0+$/, '');
  const out = frac ? `${i}.${frac}` : i;
  return Number(out) > 0 ? out : null;
}

/**
 * Close amounts (in the coin) for a position, most likely first.
 * Verified against real Nobitex data: a short's size is `liability` (coin owed, which
 * grows with interest, e.g. 0.0021954888) and its `totalAsset` is in rials; for a long
 * it is the other way round (`totalAsset` = coin held). The exact value comes first —
 * rounding it down to the market step leaves an unclosable remainder. The planned
 * amount is used only when the exchange field is missing.
 */
export function positionAmounts(p, fallbackAmount, step) {
  const side = positionSide(p);
  const field = side === 'long' ? p.totalAsset : p.liability ?? p.delegatedAmount;
  const out = [];
  const add = (v) => {
    if (v && Number(v) > 0 && !out.some((x) => Number(x) === Number(v))) out.push(v);
  };
  if (Number(field) > 0) {
    add(exactAmount(field));
    add(floorToStep(Number(field), step));
  } else if (Number(fallbackAmount) > 0) {
    add(floorToStep(Number(fallbackAmount), step));
    if (side === 'long') add(floorToStep(Number(fallbackAmount) * 0.995, step));
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
    const amount = Number(positionAmounts(p, fallbackAmount, step || 1e-8)[0]);
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

function isOpenOrder(o) {
  return !/done|cancel|close|filled|reject|expire/i.test(String(o.status || ''));
}

function sameMarket(o, src, dst) {
  const os = String(o.srcCurrency || src).toLowerCase();
  const od = String(o.dstCurrency || dst).toLowerCase();
  const margin = !o.tradeType || /margin/i.test(String(o.tradeType));
  return os === src && od === dst && margin;
}

/** Open margin orders of one market (never touches spot orders). */
export async function openMarginOrders(api, src, dst) {
  const d = await api.ordersList({ status: 'open', tradeType: 'margin', srcCurrency: src, dstCurrency: dst });
  return (d.orders || []).filter((o) => sameMarket(o, src, dst) && isOpenOrder(o));
}

/**
 * Cancel every open margin order of the position's market (TP/SL legs lock the amount).
 * The bulk endpoint skips stop orders that have not triggered yet, so each remaining
 * order is also cancelled one by one. Returns the refreshed position.
 */
export async function freePosition(api, p, log = () => {}) {
  const src = String(p.srcCurrency).toLowerCase();
  const dst = String(p.dstCurrency || 'rls').toLowerCase();
  try {
    await api.cancelMarketOrders(src, dst);
    log('لغو گروهی سفارش‌های این بازار: انجام شد');
  } catch (e) {
    log('لغو گروهی سفارش‌ها: ' + e.message);
  }
  for (let round = 0; round < 3; round++) {
    let orders;
    try {
      orders = await openMarginOrders(api, src, dst);
    } catch (e) {
      log('دریافت فهرست سفارش‌های باز ناموفق: ' + e.message);
      break;
    }
    if (!orders.length) {
      log('سفارش باز دیگری در این بازار نمانده');
      break;
    }
    for (const o of orders) {
      try {
        await api.cancelOrder(o.id);
        log(`لغو سفارش ${o.id} (${o.execution || ''} ${o.type || ''}): انجام شد`);
      } catch (e) {
        log(`لغو سفارش ${o.id}: ${e.message}`);
      }
    }
    await sleep(1200);
  }
  return refetch(api, p);
}

async function isStillOpen(api, id) {
  try {
    const list = await activePositions(api);
    return list.some((x) => String(x.id) === String(id));
  } catch {
    return null;
  }
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
    p = await freePosition(api, p, log);
  }
  const amounts = positionAmounts(p, fallbackAmount, precision.amountStep).slice(0, 3);
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

/**
 * Close a whole position now: cancel its TP/SL, then a market order with a price bound
 * (falling back to an aggressive limit order), then verify that the position is gone.
 * Returns { closed: true|false|null, log: [...] }. Throws (with .log) if no close order
 * could be placed.
 */
export async function closeNow(api, position, precision, fallbackAmount, onLog = () => {}) {
  const steps = [];
  const log = (t) => {
    steps.push(t);
    onLog(t);
  };
  const p = await freePosition(api, position, log);
  const side = positionSide(p) || 'long';
  const best = await currentBest(api, positionSymbol(p));
  const mid = (best.ask + best.bid) / 2;
  // closing a long = selling (price below bid), closing a short = buying (price above ask)
  const closeAs = side === 'long' ? 'short' : 'long';
  const marketBound = boundedMarketPrice(closeAs, best.ask, best.bid, precision.priceStep, 0.5);
  const limitPrice = boundedMarketPrice(closeAs, best.ask, best.bid, precision.priceStep, 1);
  const amounts = positionAmounts(p, fallbackAmount, precision.amountStep).slice(0, 3);
  log(`جهت: ${side === 'long' ? 'لانگ' : 'شورت'} · مقدارهای قابل امتحان: ${amounts.join('، ') || '—'}`);
  if (!amounts.length) {
    const err = new Error('مقدار پوزیشن مشخص نیست؛ از اپ نوبیتکس ببندید');
    err.log = steps;
    throw err;
  }
  const attempts = [];
  for (const amount of amounts) attempts.push({ amount, execution: 'market', price: marketBound });
  attempts.push({ amount: amounts[0], execution: 'limit', price: limitPrice });
  let placed = false;
  let lastErr = null;
  for (const a of attempts.slice(0, 5)) {
    try {
      await api.closePosition(p.id, a.execution === 'market' ? a : { amount: a.amount, price: a.price });
      log(`سفارش بستن (${a.execution === 'market' ? 'بازار' : 'محدود'}، مقدار ${a.amount}) ثبت شد`);
      placed = true;
      break;
    } catch (e) {
      lastErr = e;
      log(`بستن (${a.execution === 'market' ? 'بازار' : 'محدود'}، مقدار ${a.amount}) رد شد: ${e.message}`);
    }
  }
  const valueRials = Number(amounts[0]) * mid;
  const minOrder = Number(precision.minOrderRials) || 0;
  if (!placed) {
    let msg = lastErr ? lastErr.message : 'سفارش بستن ثبت نشد';
    if (minOrder && valueRials < minOrder) {
      msg = `فقط مقدار خیلی کمی (${amounts[0]} ${String(p.srcCurrency).toUpperCase()}، حدود ${Math.round(valueRials / 10).toLocaleString('en-US')} تومان) از این پوزیشن مانده که نوبیتکس سفارشش را قبول نکرد. آن را از اپ نوبیتکس («بستن کامل») ببندید تا وثیقه آزاد شود. (${msg})`;
    }
    const err = new Error(msg);
    err.log = steps;
    throw err;
  }
  for (let i = 0; i < 6; i++) {
    await sleep(1500);
    const open = await isStillOpen(api, p.id);
    if (open === false) {
      log('پوزیشن بسته شد ✓');
      return { closed: true, log: steps };
    }
  }
  // Still listed: if only a remainder is left (e.g. interest), close that too, once.
  const after = await refetch(api, p);
  const rest = positionAmounts(after, null, precision.amountStep)[0];
  if (rest && Number(rest) < Number(amounts[0])) {
    log(`باقی‌مانده پوزیشن: ${rest} — تلاش برای بستن آن`);
    try {
      await api.closePosition(p.id, { amount: rest, price: marketBound, execution: 'market' });
      for (let i = 0; i < 4; i++) {
        await sleep(1500);
        if ((await isStillOpen(api, p.id)) === false) {
          log('پوزیشن بسته شد ✓');
          return { closed: true, log: steps };
        }
      }
    } catch (e) {
      log(`بستن باقی‌مانده رد شد: ${e.message}`);
    }
  }
  log('سفارش بستن ثبت شده ولی پوزیشن هنوز در فهرست پوزیشن‌های باز است');
  return { closed: false, log: steps };
}
