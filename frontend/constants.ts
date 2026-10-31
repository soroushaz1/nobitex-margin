import { CryptoAsset, QuoteCurrency } from './types';

// Approximate baseline exchange rate for 1 USDT to Iranian Toman (IRT)
export const USDT_TO_IRT_RATE = 68450;

export const SUPPORTED_ASSETS: CryptoAsset[] = [
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    nameFa: 'بیت‌کوین',
    icon: '₿',
    basePriceUSDT: 64800,
    decimals: 5,
    maxLeverage: 10,
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    nameFa: 'اتریوم',
    icon: 'Ξ',
    basePriceUSDT: 3450,
    decimals: 4,
    maxLeverage: 10,
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    nameFa: 'سولانا',
    icon: '◎',
    basePriceUSDT: 148,
    decimals: 3,
    maxLeverage: 8,
  },
  {
    symbol: 'TON',
    name: 'Toncoin',
    nameFa: 'تون‌کوین',
    icon: '💎',
    basePriceUSDT: 5.65,
    decimals: 2,
    maxLeverage: 5,
  },
  {
    symbol: 'DOGE',
    name: 'Dogecoin',
    nameFa: 'دوج‌کوین',
    icon: 'Ð',
    basePriceUSDT: 0.125,
    decimals: 1,
    maxLeverage: 5,
  },
  {
    symbol: 'XRP',
    name: 'Ripple',
    nameFa: 'ریپل',
    icon: '✕',
    basePriceUSDT: 0.582,
    decimals: 2,
    maxLeverage: 5,
  },
];

export const INITIAL_BALANCES = {
  IRT: {
    free: 250000000, // 250,000,000 Tomans
    locked: 0,
    borrowed: 0,
  },
  USDT: {
    free: 4000, // 4,000 USDT
    locked: 0,
    borrowed: 0,
  },
  crypto: {
    BTC: { free: 0.15, locked: 0 },
    ETH: { free: 1.5, locked: 0 },
    SOL: { free: 12, locked: 0 },
    TON: { free: 200, locked: 0 },
    DOGE: { free: 4000, locked: 0 },
    XRP: { free: 1200, locked: 0 },
  },
};

export const LEVERAGE_OPTIONS = [1, 2, 3, 5, 8, 10];

export const formatCurrency = (val: number, currency: QuoteCurrency): string => {
  if (currency === 'IRT') {
    // Tomans formatted as integers with Persian/Toman separators
    return `${Math.round(val).toLocaleString('en-US')} تومان`;
  }
  // USDT formatted with 2 to 4 decimals depending on size
  if (Math.abs(val) < 1 && val !== 0) {
    return `$${val.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 })}`;
  }
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const formatPrice = (price: number, currency: QuoteCurrency): string => {
  if (currency === 'IRT') {
    return Math.round(price).toLocaleString('en-US');
  }
  if (price < 1) return price.toFixed(4);
  if (price < 10) return price.toFixed(3);
  return price.toFixed(2);
};
