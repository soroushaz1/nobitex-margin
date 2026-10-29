// Nobitex API v2 client (https://apiv2.nobitex.ir).
// Auth: API Key with Ed25519 signature over  timestamp + METHOD + path(+query) + rawBody,
// sent as URL-safe Base64 in the Nobitex-Signature header.
// Environment-agnostic: `fetchFn` and `nacl` are injected so the same code runs in the
// Android WebView (native HTTP via CapacitorHttp) and in Node tests.

import { b64AnyToBytes, hexToBytes, bytesToB64 } from './util.js';

export const BASE_URL = 'https://apiv2.nobitex.ir';
export const USER_AGENT = 'TraderBot/DastyarTaahodi';
const CLOCK_RESYNC_MS = 10 * 60 * 1000;

function isTimestampError(e) {
  return /timestamp/i.test(String((e && e.message) || '')) || /timestamp/i.test(String((e && e.code) || ''));
}

export class NobitexError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/**
 * Turn whatever the user pasted as a private key into the 32-byte Ed25519 seed.
 * Accepts: raw 32-byte seed or 64-byte seed+public (base64, base64url or hex),
 * or a PKCS#8 PEM / DER (base64) private key.
 */
export function parsePrivateKey(input) {
  let text = String(input || '').trim();
  if (!text) throw new Error('کلید خصوصی خالی است');
  text = text.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '');
  let bytes;
  if (/^[0-9a-fA-F]+$/.test(text) && (text.length === 64 || text.length === 128)) {
    bytes = hexToBytes(text);
  } else {
    try {
      bytes = b64AnyToBytes(text);
    } catch {
      throw new Error('فرمت کلید خصوصی شناخته نشد');
    }
  }
  if (bytes.length === 32) return bytes;
  if (bytes.length === 64) return bytes.slice(0, 32);
  // PKCS#8 DER for Ed25519 is 48 bytes; the seed is the last 32 bytes
  // (prefix 302e020100300506032b657004220420).
  if (bytes.length === 48 && bytes[0] === 0x30) return bytes.slice(16);
  throw new Error(`طول کلید خصوصی نامعتبر است (${bytes.length} بایت)`);
}

export function signatureToHeader(sig) {
  // URL-safe Base64 (with padding, same as Python's urlsafe_b64encode)
  return bytesToB64(sig).replace(/\+/g, '-').replace(/\//g, '_');
}

function buildQuery(params) {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

export class Nobitex {
  constructor({ apiKey, privateKey, fetchFn, nacl, baseUrl = BASE_URL, now = () => Date.now() } = {}) {
    this.apiKey = apiKey ? String(apiKey).trim() : '';
    this.nacl = nacl;
    this.fetch = fetchFn || ((...a) => fetch(...a));
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.now = now;
    this.clockOffsetMs = 0; // server time - local time, learned from Date headers
    this.clockSyncedAt = 0;
    this.secretKey = null;
    if (privateKey) {
      const seed = privateKey instanceof Uint8Array ? privateKey : parsePrivateKey(privateKey);
      this.secretKey = nacl.sign.keyPair.fromSeed(seed).secretKey;
    }
  }

  get hasAuth() {
    return !!(this.apiKey && this.secretKey);
  }

  timestamp() {
    return String(Math.floor((this.now() + this.clockOffsetMs) / 1000));
  }

  signHeaders(method, fullPath, rawBody = '') {
    const ts = this.timestamp();
    const msg = new TextEncoder().encode(`${ts}${method.toUpperCase()}${fullPath}${rawBody}`);
    const sig = this.nacl.sign.detached(msg, this.secretKey);
    return {
      'Nobitex-Key': this.apiKey,
      'Nobitex-Signature': signatureToHeader(sig),
      'Nobitex-Timestamp': ts,
    };
  }

  async request(method, path, { params, body, auth = false } = {}) {
    if (auth) {
      if (!this.hasAuth) throw new NobitexError('کلید API تنظیم نشده است');
      // Nobitex rejects signatures whose timestamp is >30s off, so use the server's clock.
      if (!this.clockSyncedAt || this.now() - this.clockSyncedAt > CLOCK_RESYNC_MS) await this.syncClock();
    }
    try {
      return await this.send(method, path, { params, body, auth });
    } catch (e) {
      // A rejected timestamp means the request was not executed, so one retry is safe.
      if (auth && isTimestampError(e)) {
        await this.syncClock(true);
        return this.send(method, path, { params, body, auth });
      }
      throw e;
    }
  }

  async send(method, path, { params, body, auth }) {
    const fullPath = path + buildQuery(params);
    const rawBody = body !== undefined ? JSON.stringify(body) : '';
    const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
    if (rawBody) headers['Content-Type'] = 'application/json';
    if (auth) Object.assign(headers, this.signHeaders(method, fullPath, rawBody));
    let res;
    try {
      res = await this.fetch(this.baseUrl + fullPath, {
        method,
        headers,
        body: rawBody || undefined,
      });
    } catch (e) {
      throw new NobitexError('اتصال به نوبیتکس برقرار نشد: ' + (e && e.message ? e.message : e));
    }
    this.learnClock(res);
    let data;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    const failed = !res.ok || (data && data.status === 'failed') || (data && data.s === 'error');
    if (failed) {
      const msg = (data && (data.message || data.detail || data.errmsg || data.code)) || `HTTP ${res.status}`;
      throw new NobitexError(String(msg), { status: res.status, code: data && data.code, body: data });
    }
    return data;
  }

  /** Read the server time from the HTTP Date header. Returns true if learned. */
  learnClock(res) {
    try {
      const h = res.headers;
      const d = h && (h.get ? h.get('date') || h.get('Date') : h.date || h.Date);
      if (!d) return false;
      const server = Date.parse(d);
      if (isNaN(server)) return false;
      // Date has 1s resolution; +500ms centers the rounding error.
      this.clockOffsetMs = server + 500 - this.now();
      this.clockSyncedAt = this.now();
      this.lastDateLearned = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Learn the server clock with a cheap public call. Falls back to the orderbook's
   * lastUpdate (server-side ms timestamp) if the Date header is not exposed.
   */
  async syncClock(force = false) {
    if (!force && this.clockSyncedAt && this.now() - this.clockSyncedAt < CLOCK_RESYNC_MS) return;
    this.lastDateLearned = false;
    let book = null;
    try {
      book = await this.send('GET', '/v3/orderbook/BTCIRT', {});
    } catch {
      /* fall through */
    }
    if (this.lastDateLearned) return; // Date header worked
    const last = book && Number(book.lastUpdate);
    if (last > 1e12) {
      this.clockOffsetMs = last - this.now();
      this.clockSyncedAt = this.now();
    }
  }

  // ---------------- public market data ----------------
  marketStats() {
    return this.request('GET', '/market/stats');
  }
  options() {
    return this.request('GET', '/v2/options');
  }
  orderbook(symbol) {
    return this.request('GET', `/v3/orderbook/${symbol}`);
  }
  /** Candles in TradingView UDF format {s,t,o,h,l,c,v}. resolution: '15','60','240','D' */
  ohlc(symbol, resolution, countback = 200) {
    const to = Math.floor((this.now() + this.clockOffsetMs) / 1000);
    return this.request('GET', '/market/udf/history', { params: { symbol, resolution, to, countback } });
  }
  async ohlcRange(symbol, resolution, from, to) {
    return this.request('GET', '/market/udf/history', { params: { symbol, resolution, from, to } });
  }
  marginMarkets() {
    // Works with or without auth; signed when keys exist (some accounts need it).
    return this.request('GET', '/margin/markets/list', { auth: this.hasAuth });
  }

  // ---------------- authenticated ----------------
  async marginBalanceRials() {
    // Prefer v2 wallets filtered to the margin wallet; fall back to the legacy list.
    try {
      const d = await this.request('GET', '/v2/wallets', { params: { type: 'margin' }, auth: true });
      const w = d.wallets || {};
      const rls = w.RLS || w.rls;
      if (rls) return { balance: Number(rls.balance), blocked: Number(rls.blocked || 0) };
    } catch (e) {
      if (e.status && e.status !== 404 && e.status !== 400) throw e;
    }
    const d = await this.request('GET', '/users/wallets/list', { params: { type: 'margin' }, auth: true });
    const list = d.wallets || [];
    const rls = list.find((x) => String(x.currency).toLowerCase() === 'rls');
    if (!rls) throw new NobitexError('کیف پول تعهدی ریالی پیدا نشد');
    return {
      balance: Number(rls.activeBalance ?? rls.balance),
      blocked: Number(rls.blockedBalance ?? rls.blocked ?? 0),
    };
  }

  delegationLimit(market) {
    return this.request('GET', '/margin/v2/delegation-limit', { params: { market }, auth: true });
  }

  positions(status = 'active') {
    return this.request('GET', '/positions/list', { params: { status }, auth: true });
  }

  position(id) {
    return this.request('GET', `/positions/${id}/status`, { auth: true });
  }

  /**
   * Open a margin position.
   * side 'buy' = long, 'sell' = short. Prices in the market's quote currency (rial for IRT).
   */
  addMarginOrder({ src, dst, side, amount, price, leverage, execution = 'limit', stopPrice, stopLimitPrice, mode }) {
    const body = {
      srcCurrency: src,
      dstCurrency: dst,
      type: side,
      amount: String(amount),
      price: String(price),
      leverage: String(leverage),
    };
    if (execution !== 'limit') body.execution = execution;
    if (stopPrice !== undefined) body.stopPrice = String(stopPrice);
    if (stopLimitPrice !== undefined) body.stopLimitPrice = String(stopLimitPrice);
    if (mode) body.mode = mode;
    return this.request('POST', '/margin/orders/add', { body, auth: true });
  }

  /** Close (part of) a position. With mode 'oco': take-profit limit `price` + stop `stopPrice`. */
  closePosition(id, { amount, price, execution = 'limit', stopPrice, stopLimitPrice, mode }) {
    const body = { amount: String(amount), price: String(price) };
    if (execution !== 'limit') body.execution = execution;
    if (stopPrice !== undefined) body.stopPrice = String(stopPrice);
    if (stopLimitPrice !== undefined) body.stopLimitPrice = String(stopLimitPrice);
    if (mode) body.mode = mode;
    return this.request('POST', `/positions/${id}/close`, { body, auth: true });
  }

  /** Cancel an open order (used to cancel an unfilled entry). */
  cancelOrder(id) {
    return this.request('POST', '/market/orders/update-status', { body: { order: id, status: 'canceled' }, auth: true });
  }
}
