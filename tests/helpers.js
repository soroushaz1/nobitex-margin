import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

/** Load the vendored tweetnacl (UMD) exactly as shipped in the app. */
export function loadNacl() {
  const code = readFileSync(new URL('../www/vendor/nacl-fast.min.js', import.meta.url), 'utf8');
  const module = { exports: {} };
  // same realm as the tests, so `instanceof Uint8Array` checks inside nacl pass
  new Function('module', 'exports', 'require', 'self', code)(module, module.exports, () => webcrypto, { crypto: webcrypto });
  return module.exports;
}

/** Minimal fetch mock: routes is an array of [matcher(url, init), responder(url, init)]. */
export function mockFetch(routes, calls = []) {
  return async (url, init = {}) => {
    calls.push({ url, init });
    for (const [match, respond] of routes) {
      if (match(url, init)) {
        const { status = 200, body = {}, headers = {} } = await respond(url, init);
        return {
          ok: status >= 200 && status < 300,
          status,
          headers: { get: (k) => headers[k.toLowerCase()] ?? null },
          text: async () => JSON.stringify(body),
        };
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, text: async () => '{"status":"failed","message":"no route"}' };
  };
}

/** Synthetic candles following a path of closes. */
export function makeCandles(closes, startSec = 1_700_000_000, stepSec = 900) {
  return closes.map((c, i) => ({
    t: startSec + i * stepSec,
    o: i ? closes[i - 1] : c,
    h: Math.max(c, i ? closes[i - 1] : c) * 1.002,
    l: Math.min(c, i ? closes[i - 1] : c) * 0.998,
    c,
    v: 100 + (i % 7),
  }));
}

export function toUdf(candles) {
  return {
    s: 'ok',
    t: candles.map((c) => c.t),
    o: candles.map((c) => c.o),
    h: candles.map((c) => c.h),
    l: candles.map((c) => c.l),
    c: candles.map((c) => c.c),
    v: candles.map((c) => c.v),
  };
}
