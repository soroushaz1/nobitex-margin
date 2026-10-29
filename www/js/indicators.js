// Technical indicators computed on-device. The AI receives these numbers instead of raw
// candles, which keeps prompts small and makes its reasoning checkable.

export function candlesFromUdf(d) {
  if (!d || d.s !== 'ok' || !Array.isArray(d.t)) return [];
  const out = [];
  for (let i = 0; i < d.t.length; i++) {
    out.push({ t: d.t[i], o: +d.o[i], h: +d.h[i], l: +d.l[i], c: +d.c[i], v: +(d.v ? d.v[i] : 0) });
  }
  return out;
}

export function ema(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(ch, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-ch, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(NaN);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) =>
    i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c)),
  );
  let a = 0;
  for (let i = 1; i <= period; i++) a += tr[i];
  a /= period;
  out[period] = a;
  for (let i = period + 1; i < candles.length; i++) {
    a = (a * (period - 1) + tr[i]) / period;
    out[i] = a;
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => ef[i] - es[i]);
  const valid = line.map((x) => (isNaN(x) ? 0 : x));
  const start = line.findIndex((x) => !isNaN(x));
  const sig = new Array(closes.length).fill(NaN);
  if (start >= 0) {
    const s = ema(valid.slice(start), signal);
    for (let i = 0; i < s.length; i++) sig[start + i] = s[i];
  }
  return { line, signal: sig, hist: line.map((x, i) => x - sig[i]) };
}

function last(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (!isNaN(arr[i])) return arr[i];
  return NaN;
}

const r = (x, d = 2) => (isFinite(x) ? Number(x.toFixed(d)) : null);

/** Compact, relative (percent-based) summary of one timeframe. */
export function summarize(candles) {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.c);
  const price = closes[closes.length - 1];
  const e20 = last(ema(closes, 20));
  const e50 = last(ema(closes, 50));
  const e200 = candles.length >= 200 ? last(ema(closes, 200)) : NaN;
  const rsiArr = rsi(closes, 14);
  const a = last(atr(candles, 14));
  const m = macd(closes);
  const hist = m.hist.filter((x) => !isNaN(x));
  const lookback = candles.slice(-50);
  const swingHigh = Math.max(...lookback.map((c) => c.h));
  const swingLow = Math.min(...lookback.map((c) => c.l));
  const vols = candles.slice(-20).map((c) => c.v);
  const volAvg = vols.reduce((s, x) => s + x, 0) / (vols.length || 1);
  const pctFrom = (x) => ((price - x) / x) * 100;
  return {
    price,
    change_last_10_candles_pct: r(pctFrom(closes[closes.length - 11])),
    change_last_50_candles_pct: r(pctFrom(closes[closes.length - 51])),
    price_vs_ema20_pct: r(pctFrom(e20)),
    price_vs_ema50_pct: r(pctFrom(e50)),
    price_vs_ema200_pct: r(pctFrom(e200)),
    ema20_above_ema50: e20 > e50,
    rsi14: r(last(rsiArr), 1),
    rsi14_3_candles_ago: r(rsiArr[rsiArr.length - 4], 1),
    atr14_pct: r((a / price) * 100, 3),
    macd_hist_last3_pct_of_price: hist.slice(-3).map((x) => r((x / price) * 100, 4)),
    dist_to_50c_high_pct: r(((swingHigh - price) / price) * 100),
    dist_to_50c_low_pct: r(((price - swingLow) / price) * 100),
    last_volume_vs_20c_avg: r(volAvg ? candles[candles.length - 1].v / volAvg : NaN),
    last_5_candles_close_pct: closes.slice(-6).map((c, i, arr) => (i ? r(((c - arr[i - 1]) / arr[i - 1]) * 100) : null)).slice(1),
    _atr: a,
  };
}
