// Journal of every AI suggestion and what happened to it.
// Paper trades are settled against real Nobitex candles, so the AI builds a measurable
// track record before (and while) real money is used.

export const MAX_PAPER_HOURS = 72;

/**
 * Settle a paper trade with 15m candles after its entry.
 * Conservative: if a candle touches both stop and target, the stop counts first.
 */
export function settlePaper(entry, candles, nowSec) {
  const { side, price, stopPrice, tpPrice, openedAt } = entry;
  const startSec = Math.floor(openedAt / 1000);
  for (const c of candles) {
    if (c.t + 15 * 60 <= startSec) continue; // candle closed before entry
    if (side === 'long') {
      if (c.l <= stopPrice) return { status: 'lost', exitPrice: stopPrice, closedAt: c.t * 1000 };
      if (c.h >= tpPrice) return { status: 'won', exitPrice: tpPrice, closedAt: c.t * 1000 };
    } else {
      if (c.h >= stopPrice) return { status: 'lost', exitPrice: stopPrice, closedAt: c.t * 1000 };
      if (c.l <= tpPrice) return { status: 'won', exitPrice: tpPrice, closedAt: c.t * 1000 };
    }
  }
  const hours = (nowSec - startSec) / 3600;
  if (hours >= MAX_PAPER_HOURS && candles.length) {
    const lastC = candles[candles.length - 1];
    return { status: 'expired', exitPrice: lastC.c, closedAt: lastC.t * 1000 };
  }
  return null;
}

const FEE_PCT = 0.35;

/** Profit in rials and in R (multiples of the planned risk) for a closed trade. */
export function resultOf(entry) {
  if (typeof entry.realizedPnl === 'number' && isFinite(entry.realizedPnl)) {
    return { pnl: entry.realizedPnl, r: entry.lossAtStop ? entry.realizedPnl / entry.lossAtStop : 0 };
  }
  if (!entry.exitPrice) return { pnl: 0, r: 0 };
  const dir = entry.side === 'long' ? 1 : -1;
  const movePct = ((entry.exitPrice - entry.price) / entry.price) * 100 * dir - FEE_PCT;
  const pnl = (entry.notional * movePct) / 100;
  const r = entry.lossAtStop ? pnl / entry.lossAtStop : 0;
  return { pnl, r };
}

export function stats(entries) {
  const closed = entries.filter((e) => ['won', 'lost', 'expired', 'closed'].includes(e.status));
  let pnl = 0;
  let r = 0;
  let wins = 0;
  for (const e of closed) {
    const res = resultOf(e);
    pnl += res.pnl;
    r += res.r;
    if (res.pnl > 0) wins++;
  }
  return {
    count: closed.length,
    wins,
    winRate: closed.length ? (wins / closed.length) * 100 : 0,
    pnl,
    totalR: r,
    open: entries.filter((e) => e.status === 'open').length,
    suggestions: entries.length,
  };
}

export function tradesToday(entries, mode, now = Date.now()) {
  const d = new Date(now);
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return entries.filter((e) => e.mode === mode && e.openedAt && e.openedAt >= startOfDay).length;
}
