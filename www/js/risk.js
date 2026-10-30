// Risk rules. The AI proposes; this file decides whether a proposal is allowed and how
// big it may be. Most rules are user-adjustable (RULES); a few sanity checks are fixed
// because without them a trade cannot be executed or protected correctly.

import { floorToStep, roundToStep } from './util.js';

// [min, max, default] for every user-adjustable rule.
export const RULES = {
  leverage: [1, 10, 2], // also capped by the market's own max leverage
  riskPct: [0.5, 20, 2], // % of balance lost if the stop is hit
  maxOpenPositions: [1, 10, 3],
  maxTradesPerDay: [0, 50, 0], // 0 = unlimited
  minConfidence: [0, 90, 50],
  minRewardRisk: [1, 3, 1.2],
  maxSpreadPct: [0.1, 3, 0.6],
  minVolumeBillionToman: [0, 100, 0.5], // markets below this daily volume are skipped
};

// Fixed sanity limits (not preferences).
export const FIXED = {
  MIN_STOP_PCT: 0.3, // tighter than this is eaten by fees + noise
  MAX_STOP_PCT: 15,
  LIQ_BUFFER: 0.7, // stop must sit inside 70% of the distance to liquidation
  MAX_COLLATERAL_SHARE: 0.95,
  FEE_BUFFER_PCT: 0.35, // round-trip fees + slippage counted as extra loss
  STOP_LIMIT_SLIPPAGE_PCT: 0.5,
};

export const DEFAULT_MIN_ORDER_RIALS = 3_000_000;

function clamp(v, [min, max, def], { int = false, step = 0 } = {}) {
  let n = Number(v);
  if (!isFinite(n) || (v === '' || v === null || v === undefined)) n = def;
  n = Math.min(Math.max(n, min), max);
  if (int) n = Math.round(n);
  if (step) n = Math.round(n / step) * step;
  return n;
}

/** Clamp user settings into the allowed ranges. */
export function effectiveSettings(s = {}) {
  return {
    leverage: clamp(s.leverage, RULES.leverage, { step: 0.5 }),
    riskPct: clamp(s.riskPct, RULES.riskPct, { step: 0.1 }),
    maxOpenPositions: clamp(s.maxOpenPositions, RULES.maxOpenPositions, { int: true }),
    maxTradesPerDay: clamp(s.maxTradesPerDay, RULES.maxTradesPerDay, { int: true }),
    minConfidence: clamp(s.minConfidence, RULES.minConfidence, { int: true }),
    minRewardRisk: clamp(s.minRewardRisk, RULES.minRewardRisk, { step: 0.1 }),
    maxSpreadPct: clamp(s.maxSpreadPct, RULES.maxSpreadPct, { step: 0.05 }),
    minVolumeBillionToman: clamp(s.minVolumeBillionToman, RULES.minVolumeBillionToman, { step: 0.1 }),
  };
}

/** Rules the AI and the scanner need (no account data). */
export function scanRules(s = {}, exclude = []) {
  const e = effectiveSettings(s);
  return {
    minConfidence: e.minConfidence,
    minRewardRisk: e.minRewardRisk,
    maxSpreadPct: e.maxSpreadPct,
    minVolumeRials: e.minVolumeBillionToman * 1e10,
    exclude: exclude.map((x) => String(x).toUpperCase()),
  };
}

/**
 * Build an executable plan from an AI idea.
 * idea: { symbol, side: 'long'|'short', stop_loss_pct, take_profit_pct, confidence }
 * ctx:  { price, balanceRials, market: {maxLeverage, buyEnabled, sellEnabled, src, dst},
 *         amountStep, priceStep, minOrderRials, settings, tradesToday, openPositions,
 *         openSymbols: [...], spreadPct }
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
  const symbol = String(ctx.symbol || idea.symbol || '').toUpperCase();

  if (!side) reasons.push('جهت معامله نامعتبر است');
  if (!(price > 0)) reasons.push('قیمت فعلی بازار در دسترس نیست');
  if (!(balance > 0)) reasons.push('موجودی آزاد کیف پول تعهدی صفر یا نامشخص است');
  if (!(stopPct >= FIXED.MIN_STOP_PCT && stopPct <= FIXED.MAX_STOP_PCT))
    reasons.push(`فاصله حد ضرر باید بین ${FIXED.MIN_STOP_PCT} و ${FIXED.MAX_STOP_PCT} درصد باشد (پیشنهاد: ${stopPct})`);
  if (!(tpPct > 0) || tpPct / stopPct < s.minRewardRisk - 1e-9)
    reasons.push(`نسبت سود به ضرر (${(tpPct / stopPct).toFixed(2)}) کمتر از حداقل تنظیم‌شده (${s.minRewardRisk}) است`);
  if (!(conf >= s.minConfidence)) reasons.push(`اطمینان تحلیل (${Math.round(conf)}) کمتر از حداقل تنظیم‌شده (${s.minConfidence}) است`);
  if (side === 'long' && market.buyEnabled === false) reasons.push('معامله خرید (لانگ) در این بازار فعال نیست');
  if (side === 'short' && market.sellEnabled === false) reasons.push('معامله فروش (شورت) در این بازار فعال نیست');
  if (Number(ctx.spreadPct) > s.maxSpreadPct)
    reasons.push(`اختلاف قیمت خرید و فروش این بازار (${Number(ctx.spreadPct).toFixed(2)}٪) از حد تنظیم‌شده (${s.maxSpreadPct}٪) بیشتر است`);
  if ((ctx.openSymbols || []).map((x) => String(x).toUpperCase()).includes(symbol))
    reasons.push('در همین بازار پوزیشن باز دارید؛ ابتدا آن را ببندید');
  if ((ctx.openPositions || 0) >= s.maxOpenPositions)
    reasons.push(`${ctx.openPositions} پوزیشن باز دارید؛ سقف تنظیم‌شده ${s.maxOpenPositions} است (در تنظیمات قابل تغییر)`);
  if (s.maxTradesPerDay > 0 && (ctx.tradesToday || 0) >= s.maxTradesPerDay)
    reasons.push(`سقف ${s.maxTradesPerDay} معامله در روز پر شده است (در تنظیمات قابل تغییر)`);

  let leverage = s.leverage;
  if (Number(market.maxLeverage) > 0) leverage = Math.min(leverage, Number(market.maxLeverage));
  leverage = Math.max(1, Math.floor(leverage * 2) / 2);

  // The stop must trigger before liquidation (liquidation is roughly 100/leverage % away).
  const liqPct = 100 / leverage;
  if (stopPct > liqPct * FIXED.LIQ_BUFFER)
    reasons.push(`با اهرم ${leverage}، حد ضرر ${stopPct}٪ بعد از لیکوئید شدن (حدود ${liqPct.toFixed(1)}٪) فعال می‌شود؛ اهرم را کم کنید`);

  if (reasons.length) return { ok: false, reasons };

  const amountStep = Number(ctx.amountStep) || 1e-6;
  const priceStep = Number(ctx.priceStep) || 10;
  const minOrder = Number(ctx.minOrderRials) || DEFAULT_MIN_ORDER_RIALS;

  const riskRials = (balance * s.riskPct) / 100;
  let notional = riskRials / ((stopPct + FIXED.FEE_BUFFER_PCT) / 100);
  const maxNotional = balance * FIXED.MAX_COLLATERAL_SHARE * leverage;
  const cappedByBalance = notional > maxNotional;
  notional = Math.min(notional, maxNotional);

  const amount = floorToStep(notional / price, amountStep);
  const realNotional = Number(amount) * price;
  if (!(Number(amount) > 0) || realNotional < minOrder) {
    return {
      ok: false,
      reasons: [
        `حجم مجاز معامله (${Math.round(realNotional / 10).toLocaleString('en-US')} تومان) از حداقل سفارش نوبیتکس (${Math.round(
          minOrder / 10,
        ).toLocaleString('en-US')} تومان) کمتر است؛ ریسک هر معامله یا اهرم را بیشتر کنید`,
      ],
    };
  }

  const dir = side === 'long' ? 1 : -1;
  const stopPrice = Number(roundToStep(price * (1 - (dir * stopPct) / 100), priceStep));
  const tpPrice = Number(roundToStep(price * (1 + (dir * tpPct) / 100), priceStep));
  const stopLimitPrice = Number(roundToStep(stopPrice * (1 - (dir * FIXED.STOP_LIMIT_SLIPPAGE_PCT) / 100), priceStep));
  const collateral = realNotional / leverage;
  const lossAtStop = realNotional * ((stopPct + FIXED.FEE_BUFFER_PCT) / 100);
  const gainAtTp = realNotional * ((tpPct - FIXED.FEE_BUFFER_PCT) / 100);

  return {
    ok: true,
    plan: {
      symbol,
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

/** SL/TP prices for an existing position from percentages around a reference price. */
export function protectionPrices(side, refPrice, stopPct, tpPct, priceStep) {
  const dir = side === 'long' ? 1 : -1;
  const stopPrice = Number(roundToStep(refPrice * (1 - (dir * stopPct) / 100), priceStep));
  const tpPrice = Number(roundToStep(refPrice * (1 + (dir * tpPct) / 100), priceStep));
  const stopLimitPrice = Number(roundToStep(stopPrice * (1 - (dir * FIXED.STOP_LIMIT_SLIPPAGE_PCT) / 100), priceStep));
  return { stopPrice, tpPrice, stopLimitPrice };
}

/**
 * Quick validity check of an AI idea without account data (used by the background
 * scanner to decide whether a notification is worth sending).
 */
export function ideaLooksValid(idea, spreadPct, rules = {}) {
  const minConf = rules.minConfidence ?? RULES.minConfidence[2];
  const minRR = rules.minRewardRisk ?? RULES.minRewardRisk[2];
  const maxSpread = rules.maxSpreadPct ?? RULES.maxSpreadPct[2];
  if (!idea || idea.decision !== 'trade' || !idea.side) return false;
  if ((rules.exclude || []).includes(String(idea.symbol).toUpperCase())) return false;
  const sl = Number(idea.stop_loss_pct);
  const tp = Number(idea.take_profit_pct);
  if (!(sl >= FIXED.MIN_STOP_PCT && sl <= FIXED.MAX_STOP_PCT)) return false;
  if (!(tp / sl >= minRR - 1e-9)) return false;
  if (!(Number(idea.confidence) >= minConf)) return false;
  if (Number(spreadPct) > maxSpread) return false;
  return true;
}

/** Market order with a protective price bound (max slippage). */
export function boundedMarketPrice(side, bestAsk, bestBid, priceStep, slippagePct = 0.3) {
  if (side === 'long') return roundToStep(bestAsk * (1 + slippagePct / 100), priceStep);
  return roundToStep(bestBid * (1 - slippagePct / 100), priceStep);
}

// Backwards-compatible alias used by older modules/tests.
export const LIMITS = {
  MIN_STOP_PCT: FIXED.MIN_STOP_PCT,
  MAX_STOP_PCT: FIXED.MAX_STOP_PCT,
  MAX_COLLATERAL_SHARE: FIXED.MAX_COLLATERAL_SHARE,
};
