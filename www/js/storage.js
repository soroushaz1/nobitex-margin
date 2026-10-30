// Local storage. Secrets (Nobitex API key/private key, AI key) are encrypted with a key
// derived from the user's PIN (PBKDF2-SHA256 → AES-GCM) and never stored in plain text.

import { bytesToB64, b64AnyToBytes } from './util.js';

const PBKDF2_ITERATIONS = 210000;

export function createStore(backend) {
  const ls = backend || globalThis.localStorage;
  return {
    get(key, fallback = null) {
      try {
        const v = ls.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      ls.setItem(key, JSON.stringify(value));
    },
    remove(key) {
      ls.removeItem(key);
    },
  };
}

async function deriveKey(pin, salt) {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSecrets(pin, secrets) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(secrets)),
  );
  return { v: 1, salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
}

/** Returns the secrets object, or throws if the PIN is wrong. */
export async function decryptSecrets(pin, blob) {
  const key = await deriveKey(pin, b64AnyToBytes(blob.salt));
  try {
    const pt = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64AnyToBytes(blob.iv) },
      key,
      b64AnyToBytes(blob.ct),
    );
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    throw new Error('رمز اشتباه است');
  }
}

export const DEFAULT_SETTINGS = {
  mode: 'paper', // 'paper' | 'live'
  leverage: 2,
  riskPct: 2,
  maxOpenPositions: 3,
  maxTradesPerDay: 0,
  minConfidence: 50,
  minRewardRisk: 1.2,
  maxSpreadPct: 0.6,
  minVolumeBillionToman: 0.5,
  lockMinutes: 30,
  paperBalanceToman: 996000,
  aiBaseUrl: '',
  aiModel: '',
  candidates: 10,
  bgEnabled: false,
  bgSeenAt: 0,
};
