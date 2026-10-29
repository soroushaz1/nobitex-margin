// Hard risk rules. The AI proposes; this file decides whether a proposal is allowed
// and how big it may be. Nothing the AI returns can change these limits.

import { floorToStep, roundToStep } from './util.js';

export const LIMITS = {
  MAX_LEVERAGE: 3, // absolute cap, regardless of settings or exchange
  DEFAULT_LEVERAGE: 2,
  MAX_RISK_PCT: 3, // max % of margin balance lost if the stop is hit
  DEFAULT_RISK_PCT: 2,
  MIN_STOP_PCT: 0.6,
  MAX_STOP_PCT: 5,
  MIN_REWARD_RISK: 1.5,
  MAX_COLLATERAL_SHARE: 0.9, // never lock more than 90% of the wallet
  FEE_BUFFER_PCT: 0.35, // round-trip fees + slippage counted as extra loss
  MAX_TRADES_PER_DAY: 3,
  MAX_OPEN_POSITIONS: 1,
  MIN_CONFIDENCE: 55,
  STOP_LIMIT_SLIPPAGE_PCT: 0.5,
  MAX_SPREAD_PCT: 0.4,
};

export const DEFAULT_MIN_ORDER_RIALS = 3_000_000;

/** Clamp user settings into the allowed range. */
export function effectiveSettings(s = {}) {
  let lev = Number(s.leverage) || LIMITS.DEFAULT_LEVERAGE;
  lev = Math.min(Math.max(lev, 1), LIMITS.MAX_LEVERAGE);
  lev = Math.round(lev * 2) / 2;
  let risk = Number(s.riskPct) || LIMITS.DEFAULT_RISK_PCT;
  risk = Math.min(Math.max(risk, 0.5), LIMITS.MAX_RISK_PCT);
  let perDay = Number(s.maxTradesPerDay) || LIMITS.MAX_TRADES_PER_DAY;
  perDay = Math.min(Math.max(Math.round(perDay), 1), LIMITS.MAX_TRADES_PER_DAY);
  return { leverage: lev, riskPct: risk, maxTradesPerDay: perDay };
}

/**
 * Build an executable plan from an AI idea.
 * idea: { symbol, side: 'long'|'short', stop_loss_pct, take_profit_pct, confidence }
 * ctx:  { price, balanceRials, market: {maxLeverage, buyEnabled, sellEnabled, src, dst},
 *         amountStep, priceStep, minOrderRials, settings, tradesToday, openPositions }
 * Returns { ok: true, plan } or { ok: false, reasons: [...] }.
 */
export function buildPlan(idea, ctx) {
  const reasons = [];
  const s = effectiveSettings(ctx.settings);
  const side = idea.side === 'short' ? 'short' : idea.side === 'long' ? 'long' : null;
  const price = Number(ctx.price);
  const stopPct = Number(idea.stop_loss_pct);
  const tpPct = Number(idea.take_profit_pct);
  const conf = Number(idea.confidence);
  const balance = Number(ctx.balanceRials);
  const market = ctx.market || {};

  if (!side) reasons.push('جهت معامله نامعتبر است');
  if (!(price > 0)) reasons.push('قیمت فعلی بازار در دسترس نیست');
  if (!(balance > 0)) reasons.push('موجودی کیف پول تعهدی صفر یا نامشخص است');
  if (!(stopPct >= LIMITS.MIN_STOP_PCT && stopPct <= LIMITS.MAX_STOP_PCT))
    reasons.push(`فاصله حد ضرر باید بین ${LIMITS.MIN_STOP_PCT} و ${LIMITS.MAX_STOP_PCT} درصد باشد (پیشنهاد: ${stopPct})`);
  if (!(tpPct > 0) || tpPct / stopPct < LIMITS.MIN_REWARD_RISK)
    reasons.push(`نسبت سود به ضرر باید حداقل ${LIMITS.MIN_REWARD_RISK} باشد`);
  if (!(conf >= LIMITS.MIN_CONFIDENCE)) reasons.push(`اطمینان تحلیل کمتر از ${LIMITS.MIN_CONFIDENCE} است`);
  if (side === 'long' && market.buyEnabled === false) reasons.push('معامله خرید (لانگ) در این بازار فعال نیست');
  if (side === 'short' && market.sellEnabled === false) reasons.push('معامله فروش (شورت) در این بازار فعال نیست');
  if (Number(ctx.spreadPct) > LIMITS.MAX_SPREAD_PCT)
    reasons.push(`اختلاف قیمت خرید و فروش این بازار (${Number(ctx.spreadPct).toFixed(2)}٪) زیاد است`);
  if ((ctx.openPositions || 0) >= LIMITS.MAX_OPEN_POSITIONS) reasons.push('یک پوزیشن باز دارید؛ هم‌زمان فقط یکی مجاز است');
  if ((ctx.tradesToday || 0) >= s.maxTradesPerDay) reasons.push(`سقف ${s.maxTradesPerDay} معامله در روز پر شده است`);

  let leverage = s.leverage;
  if (Number(market.maxLeverage) > 0) leverage = Math.min(leverage, Number(market.maxLeverage));
  leverage = Math.max(1, Math.floor(leverage * 2) / 2);

  // The stop must sit far from liquidation (roughly 100/leverage % away).
  if (stopPct > (100 / leverage) * 0.5) reasons.push('حد ضرر بیش از حد به قیمت لیکوئید شدن نزدیک است');

  if (reasons.length) return { ok: false, reasons };

  const amountStep = Number(ctx.amountStep) || 1e-6;
  const priceStep = Number(ctx.priceStep) || 10;
  const minOrder = Number(ctx.minOrderRials) || DEFAULT_MIN_ORDER_RIALS;

  const riskRials = (balance * s.riskPct) / 100;
  let notional = riskRials / ((stopPct + LIMITS.FEE_BUFFER_PCT) / 100);
  const maxNotional = balance * LIMITS.MAX_COLLATERAL_SHARE * leverage;
  const cappedByBalance = notional > maxNotional;
  notional = Math.min(notional, maxNotional);

  const amount = floorToStep(notional / price, amountStep);
  const realNotional = Number(amount) * price;
  if (!(Number(amount) > 0) || realNotional < minOrder) {
    return {
      ok: false,
      reasons: [`حجم مجاز معامله (${Math.round(realNotional / 10).toLocaleString('en-US')} تومان) از حداقل سفارش نوبیتکس کمتر است`],
    };
  }

  const dir = side === 'long' ? 1 : -1;
  const stopPrice = Number(roundToStep(price * (1 - (dir * stopPct) / 100), priceStep));
  const tpPrice = Number(roundToStep(price * (1 + (dir * tpPct) / 100), priceStep));
  const stopLimitPrice = Number(
    roundToStep(stopPrice * (1 - (dir * LIMITS.STOP_LIMIT_SLIPPAGE_PCT) / 100), priceStep),
  );
  const collateral = realNotional / leverage;
  const lossAtStop = realNotional * ((stopPct + LIMITS.FEE_BUFFER_PCT) / 100);
  const gainAtTp = realNotional * ((tpPct - LIMITS.FEE_BUFFER_PCT) / 100);

  return {
    ok: true,
    plan: {
      symbol: ctx.symbol || idea.symbol,
      src: market.src,
      dst: market.dst,
      side,
      orderSide: side === 'long' ? 'buy' : 'sell',
      closeSide: side === 'long' ? 'sell' : 'buy',
      leverage,
      price,
      amount,
      notional: realNotional,
      collateral,
      stopPct,
      tpPct,
      stopPrice,
      stopLimitPrice,
      tpPrice,
      lossAtStop,
      gainAtTp,
      riskPct: s.riskPct,
      rewardRisk: tpPct / stopPct,
      cappedByBalance,
    },
  };
}

/**
 * Quick validity check of an AI idea without account data (used by the background
 * scanner to decide whether a notification is worth sending).
 */
export function ideaLooksValid(idea, spreadPct) {
  if (!idea || idea.decision !== 'trade' || !idea.side) return false;
  const sl = Number(idea.stop_loss_pct);
  const tp = Number(idea.take_profit_pct);
  if (!(sl >= LIMITS.MIN_STOP_PCT && sl <= LIMITS.MAX_STOP_PCT)) return false;
  if (!(tp / sl >= LIMITS.MIN_REWARD_RISK)) return false;
  if (!(Number(idea.confidence) >= LIMITS.MIN_CONFIDENCE)) return false;
  if (Number(spreadPct) > LIMITS.MAX_SPREAD_PCT) return false;
  return true;
}

/** Market order with a protective price bound (max slippage). */
export function boundedMarketPrice(side, bestAsk, bestBid, priceStep, slippagePct = 0.3) {
  if (side === 'long') return roundToStep(bestAsk * (1 + slippagePct / 100), priceStep);
  return roundToStep(bestBid * (1 - slippagePct / 100), priceStep);
}
