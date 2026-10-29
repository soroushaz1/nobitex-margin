// Live execution. Called ONLY after the user taps confirm on a specific plan.
// Steps: market entry with a price bound → find the new position → place an OCO
// close order (take-profit + stop-loss). Orders are never retried blindly.

import { boundedMarketPrice } from './risk.js';
import { floorToStep, sleep } from './util.js';
import { bestOf } from './market.js';

export async function currentBest(api, symbol) {
  const book = await api.orderbook(symbol);
  const { ask, bid } = bestOf(book);
  if (!(ask > 0 && bid > 0)) throw new Error('دفتر سفارش خالی است');
  return { ask, bid, last: Number(book.lastTradePrice) || (ask + bid) / 2 };
}

function positionSide(p) {
  const s = String(p.side || p.type || '').toLowerCase();
  if (s.includes('sell') || s.includes('short')) return 'short';
  if (s.includes('buy') || s.includes('long')) return 'long';
  return null;
}

export async function activePositions(api) {
  const d = await api.positions('active');
  return d.positions || [];
}

/**
 * Execute a confirmed plan. `log(text)` reports progress to the UI.
 * Returns { orderId, positionId, protectedOk, warnings }.
 */
export async function executePlan(api, plan, precision, log = () => {}) {
  const warnings = [];
  const before = await activePositions(api);
  if (before.length) throw new Error('یک پوزیشن باز وجود دارد؛ ابتدا آن را ببندید');
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
  for (let i = 0; i < 12 && !position; i++) {
    await sleep(2000);
    try {
      const list = await activePositions(api);
      position =
        list.find((p) => !knownIds.has(p.id) && String(p.srcCurrency).toLowerCase() === plan.src) ||
        list.find((p) => !knownIds.has(p.id)) ||
        null;
    } catch {
      /* keep polling */
    }
  }
  if (!position) {
    warnings.push('سفارش ثبت شد اما پوزیشن هنوز دیده نشد. حتماً در اپ نوبیتکس بررسی کنید و حد ضرر بگذارید.');
    return { orderId, positionId: null, protectedOk: false, warnings };
  }
  if (positionSide(position) && positionSide(position) !== plan.side) {
    warnings.push('جهت پوزیشن باز شده با پیشنهاد یکی نیست؛ در اپ نوبیتکس بررسی کنید.');
  }

  log('ثبت حد سود و حد ضرر…');
  const protectedOk = await protectPosition(api, position, plan, precision, log, warnings);
  return { orderId, positionId: position.id, protectedOk, warnings };
}

/** Place the OCO close order. Tries a few amount interpretations, never more than 3 calls. */
export async function protectPosition(api, position, plan, precision, log = () => {}, warnings = []) {
  const amounts = [];
  const liability = Number(position.liability);
  if (plan.side === 'short' && liability > 0) amounts.push(floorToStep(liability, precision.amountStep));
  amounts.push(String(plan.amount));
  amounts.push(floorToStep(Number(plan.amount) * 0.995, precision.amountStep));
  const tried = new Set();
  let lastErr = null;
  for (const amount of amounts) {
    if (tried.has(amount) || !(Number(amount) > 0)) continue;
    tried.add(amount);
    try {
      await api.closePosition(position.id, {
        amount,
        price: plan.tpPrice,
        stopPrice: plan.stopPrice,
        stopLimitPrice: plan.stopLimitPrice,
        mode: 'oco',
      });
      log('حد سود و ضرر ثبت شد ✓');
      return true;
    } catch (e) {
      lastErr = e;
    }
  }
  warnings.push('ثبت حد ضرر ناموفق بود: ' + (lastErr ? lastErr.message : '') + ' — فوراً از بخش پوزیشن‌ها دوباره تلاش کنید یا پوزیشن را ببندید.');
  return false;
}

/** Close a whole position now (market order with a price bound). */
export async function closeNow(api, position, precision) {
  const side = positionSide(position) || 'long';
  const symbol = `${String(position.srcCurrency).toUpperCase()}IRT`;
  const best = await currentBest(api, symbol);
  // closing a long = selling, closing a short = buying
  const bound = boundedMarketPrice(side === 'long' ? 'short' : 'long', best.ask, best.bid, precision.priceStep, 0.5);
  const amount = Number(position.liability) > 0 ? floorToStep(Number(position.liability), precision.amountStep) : null;
  if (!amount) throw new Error('مقدار پوزیشن مشخص نیست؛ از اپ نوبیتکس ببندید');
  return api.closePosition(position.id, { amount, price: bound, execution: 'market' });
}

export { positionSide };
