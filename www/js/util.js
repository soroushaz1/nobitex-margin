// Small helpers shared by the app and the tests (no DOM access here).

export const RIAL_PER_TOMAN = 10;

/** Number of decimals implied by a step such as 0.0001 or "1e-6". */
export function stepDecimals(step) {
  const s = Number(step);
  if (!isFinite(s) || s <= 0) return 8;
  if (s >= 1) return 0;
  return Math.max(0, Math.round(-Math.log10(s)));
}

/** Round DOWN to a multiple of `step`, returned as a clean string. */
export function floorToStep(value, step) {
  const s = Number(step);
  const d = stepDecimals(s);
  const n = Math.floor(Number(value) / s + 1e-9) * s;
  return n.toFixed(d);
}

/** Round to the nearest multiple of `step`, returned as a clean string. */
export function roundToStep(value, step) {
  const s = Number(step);
  const d = stepDecimals(s);
  const n = Math.round(Number(value) / s) * s;
  return n.toFixed(d);
}

const faDigits = '۰۱۲۳۴۵۶۷۸۹';
export function toFaDigits(str) {
  return String(str).replace(/[0-9]/g, (d) => faDigits[d]);
}

/** Format a rial amount as toman with Persian digits and separators. */
export function fmtToman(rials, maxFrac = 0) {
  const t = Number(rials) / RIAL_PER_TOMAN;
  if (!isFinite(t)) return '—';
  return toFaDigits(t.toLocaleString('en-US', { maximumFractionDigits: maxFrac }));
}

export function fmtNum(n, maxFrac = 6) {
  if (n === null || n === undefined || !isFinite(Number(n))) return '—';
  return toFaDigits(Number(n).toLocaleString('en-US', { maximumFractionDigits: maxFrac }));
}

export function fmtPct(n, frac = 2) {
  if (!isFinite(Number(n))) return '—';
  return toFaDigits(Number(n).toFixed(frac)) + '٪';
}

/** Accept Persian/Arabic digits typed by the user. */
export function normalizeDigits(str) {
  return String(str)
    .replace(/[۰-۹]/g, (d) => String(faDigits.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[,٬،]/g, '')
    .trim();
}

// ---- base64 helpers (standard and URL-safe) ----
export function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
export function bytesToB64Url(bytes) {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64AnyToBytes(str) {
  let s = String(str).trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function hexToBytes(hex) {
  const h = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(h) || h.length % 2) throw new Error('hex نامعتبر');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
