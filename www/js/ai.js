// AI analysis through any OpenAI-compatible chat completions endpoint.
// The model sees on-device indicator summaries for a few liquid markets and must answer
// with strict JSON. Its answer is only an idea: risk.js decides if it is allowed.

import { candlesFromUdf, summarize } from './indicators.js';
import { LIMITS } from './risk.js';
import { spreads } from './market.js';
import { sleep } from './util.js';

const REQUEST_GAP_MS = 150; // be gentle with Nobitex rate limits

const TIMEFRAMES = [
  { key: '15m', res: '15' },
  { key: '1h', res: '60' },
  { key: '4h', res: '240' },
];

/** Fetch candles and compute indicator summaries for each candidate market. */
export async function buildSnapshot(api, candidates, spreadMap = {}, onProgress = () => {}) {
  const markets = [];
  for (let idx = 0; idx < candidates.length; idx++) {
    const c = candidates[idx];
    onProgress(idx + 1, candidates.length);
    const tfs = {};
    let atr15 = null;
    for (const tf of TIMEFRAMES) {
      try {
        const d = await api.ohlc(c.symbol, tf.res, 220);
        await sleep(REQUEST_GAP_MS);
        const sum = summarize(candlesFromUdf(d));
        if (sum) {
          if (tf.key === '15m') atr15 = sum._atr;
          const { _atr, price, ...rest } = sum;
          tfs[tf.key] = rest;
          if (!c.price) c.price = price;
        }
      } catch {
        /* skip timeframe */
      }
    }
    if (Object.keys(tfs).length < 2) continue;
    markets.push({
      symbol: c.symbol,
      long_allowed: c.buyEnabled,
      short_allowed: c.sellEnabled,
      volume_24h_billion_toman: Number((c.volume / 1e10).toFixed(1)),
      spread_pct: spreadMap[c.symbol] !== undefined ? Number(spreadMap[c.symbol].toFixed(3)) : null,
      timeframes: tfs,
      _price: c.price,
      _atr15: atr15,
    });
  }
  return markets;
}

export function systemPrompt() {
  return [
    'You are a cautious crypto margin-trading analyst for a small retail account on the Iranian exchange Nobitex (rial/toman markets).',
    'You receive indicator summaries (percent-based, computed from real candles) for a few liquid markets on 15m, 1h and 4h timeframes.',
    'Task: decide whether there is ONE clear, high-quality trade setup for the next few hours to ~2 days, or none.',
    'Rules:',
    '- "no_trade" is a valid and frequently correct answer. Choose it when signals conflict, the trend is unclear, or volatility is extreme.',
    '- Prefer trading WITH the higher-timeframe (4h/1h) trend; avoid shorting strong uptrends and longing strong downtrends.',
    '- Only use markets from the list, and only sides marked as allowed.',
    `- Avoid markets with spread_pct above ${LIMITS.MAX_SPREAD_PCT}; smaller, low-volume coins move erratically, so demand a cleaner setup there.`,
    `- stop_loss_pct must be between ${LIMITS.MIN_STOP_PCT} and ${LIMITS.MAX_STOP_PCT}, placed beyond normal noise (consider atr14_pct on 15m and 1h).`,
    `- take_profit_pct must be at least ${LIMITS.MIN_REWARD_RISK} x stop_loss_pct and realistic versus recent ranges (dist_to_50c_high/low).`,
    '- Percentages are distances from the current price.',
    '- confidence is 0-100; be honest and calibrated, most setups deserve 50-70.',
    'Answer ONLY with a JSON object, no markdown:',
    '{"decision":"trade"|"no_trade","symbol":"BTCIRT","side":"long"|"short","stop_loss_pct":1.5,"take_profit_pct":3.0,"confidence":62,"holding_hours":24,',
    '"reasoning_fa":"2-4 short sentences in Persian explaining the setup","risks_fa":"1-2 short sentences in Persian on what would invalidate it",',
    '"market_view_fa":"one Persian sentence about the overall market"}',
    'For no_trade, still fill reasoning_fa and market_view_fa.',
  ].join('\n');
}

export function userPrompt(markets) {
  const clean = markets.map(({ _price, _atr15, ...m }) => m);
  return `Current UTC time: ${new Date().toISOString()}\nMarkets:\n${JSON.stringify(clean)}`;
}

/** Pull the first JSON object out of a model reply. */
export function extractJson(text) {
  if (!text) throw new Error('پاسخ خالی از هوش مصنوعی');
  const cleaned = String(text).replace(/```json|```/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('پاسخ هوش مصنوعی JSON نبود');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export function normalizeIdea(raw, markets) {
  const decision = raw.decision === 'trade' ? 'trade' : 'no_trade';
  const idea = {
    decision,
    symbol: String(raw.symbol || '').toUpperCase(),
    side: raw.side === 'short' ? 'short' : raw.side === 'long' ? 'long' : null,
    stop_loss_pct: Number(raw.stop_loss_pct),
    take_profit_pct: Number(raw.take_profit_pct),
    confidence: Number(raw.confidence),
    holding_hours: Number(raw.holding_hours) || 24,
    reasoning_fa: String(raw.reasoning_fa || ''),
    risks_fa: String(raw.risks_fa || ''),
    market_view_fa: String(raw.market_view_fa || ''),
  };
  if (decision === 'trade' && !markets.some((m) => m.symbol === idea.symbol)) {
    idea.decision = 'no_trade';
    idea.invalid = 'نماد پیشنهادی در فهرست بازارهای بررسی‌شده نبود';
  }
  return idea;
}

/** Call an OpenAI-compatible endpoint. */
export async function askModel({ baseUrl, apiKey, model, fetchFn }, system, user) {
  const f = fetchFn || ((...a) => fetch(...a));
  const url = String(baseUrl || '').replace(/\/$/, '') + '/chat/completions';
  const base = {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  const send = async (body) => {
    let res;
    try {
      res = await f(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error('اتصال به سرویس هوش مصنوعی برقرار نشد: ' + (e && e.message ? e.message : e));
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { res, data, text };
  };
  let { res, data, text } = await send({ ...base, response_format: { type: 'json_object' } });
  if (!res.ok && res.status === 400) ({ res, data, text } = await send(base)); // provider without json mode
  if (!res.ok) {
    const msg = (data && data.error && (data.error.message || data.error)) || text.slice(0, 200);
    throw new Error(`خطای سرویس هوش مصنوعی (${res.status}): ${msg}`);
  }
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return extractJson(content);
}

/**
 * Full analysis pipeline shared by the app and the background runner.
 * ai: { baseUrl, apiKey, model, fetchFn? }
 */
export async function runAnalysis(api, market, ai, n, onProgress = () => {}) {
  onProgress('markets');
  await market.load();
  const cands = market.candidates(n);
  if (!cands.length) throw new Error('بازار تعهدی فعالی با حجم کافی پیدا نشد');
  const sp = await spreads(api);
  const snapshot = await buildSnapshot(api, cands, sp, (i, total) => onProgress('candles', i, total));
  if (!snapshot.length) throw new Error('داده کندل دریافت نشد');
  onProgress('ai');
  const raw = await askModel(ai, systemPrompt(), userPrompt(snapshot));
  const idea = normalizeIdea(raw, snapshot);
  const m = snapshot.find((x) => x.symbol === idea.symbol);
  return {
    idea,
    scanned: snapshot.length,
    price: m ? m._price : null,
    spreadPct: m ? m.spread_pct : null,
    warnings: market.warnings.slice(),
  };
}
