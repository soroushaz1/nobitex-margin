import { QuoteCurrency, LiveSyncStatus } from '../types';
import { USDT_TO_IRT_RATE } from '../constants';

export interface NobitexTickerResult {
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  usdtRate: number;
  source: 'NOBITEX_PUBLIC_API' | 'SIMULATED_ENGINE';
  latencyMs: number;
}

// Nobitex public API market stats URL
const NOBITEX_STATS_ENDPOINT = 'https://api.nobitex.ir/market/stats';

/**
 * Attempts to fetch live prices from Nobitex public market endpoints.
 * Nobitex prices in the API are denominated in Iranian Rials for -rls pairs (divide by 10 to get Toman/IRT)
 * and USDT for -usdt pairs.
 */
export const fetchNobitexMarketStats = async (
  baseSymbol: string,
  quoteCurrency: QuoteCurrency,
  fallbackBasePriceUSDT: number
): Promise<NobitexTickerResult> => {
  const startTime = performance.now();
  const lowerBase = baseSymbol.toLowerCase();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(NOBITEX_STATS_ENDPOINT, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      const stats = data.stats || {};
      const latencyMs = Math.round(performance.now() - startTime);

      // Nobitex USDT to Rial pair key is 'usdt-rls'
      let liveUsdtIrtRate = USDT_TO_IRT_RATE;
      if (stats['usdt-rls']?.latest) {
        // Rials to Toman: divide by 10
        liveUsdtIrtRate = Math.round(parseFloat(stats['usdt-rls'].latest) / 10);
      }

      // Check for base asset in IRT or USDT
      const rlsPairKey = `${lowerBase}-rls`;
      const usdtPairKey = `${lowerBase}-usdt`;

      if (quoteCurrency === 'IRT' && stats[rlsPairKey]) {
        const item = stats[rlsPairKey];
        const latestPriceRial = parseFloat(item.latest);
        const dayChange = parseFloat(item.dayChange || '0');
        const dayHighRial = parseFloat(item.dayHigh || item.latest);
        const dayLowRial = parseFloat(item.dayLow || item.latest);
        const volume = parseFloat(item.volume || '0');

        return {
          price: Math.round(latestPriceRial / 10), // Convert to Toman (IRT)
          change24h: Number(dayChange.toFixed(2)),
          high24h: Math.round(dayHighRial / 10),
          low24h: Math.round(dayLowRial / 10),
          volume24h: volume,
          usdtRate: liveUsdtIrtRate,
          source: 'NOBITEX_PUBLIC_API',
          latencyMs,
        };
      } else if (quoteCurrency === 'USDT' && stats[usdtPairKey]) {
        const item = stats[usdtPairKey];
        return {
          price: parseFloat(item.latest),
          change24h: Number(parseFloat(item.dayChange || '0').toFixed(2)),
          high24h: parseFloat(item.dayHigh || item.latest),
          low24h: parseFloat(item.dayLow || item.latest),
          volume24h: parseFloat(item.volume || '0'),
          usdtRate: liveUsdtIrtRate,
          source: 'NOBITEX_PUBLIC_API',
          latencyMs,
        };
      }
    }
  } catch (err) {
    // Expected in environments where CORS or internet egress to Iranian endpoints is filtered
    console.debug('Nobitex direct API fetch returned fallback:', err);
  }

  // Graceful deterministic simulation fallback calibrated to real market levels
  const latencyMs = Math.round(performance.now() - startTime);
  const price =
    quoteCurrency === 'IRT'
      ? Math.round(fallbackBasePriceUSDT * USDT_TO_IRT_RATE)
      : fallbackBasePriceUSDT;

  return {
    price,
    change24h: 2.34,
    high24h: quoteCurrency === 'IRT' ? Math.round(price * 1.028) : Number((price * 1.028).toFixed(2)),
    low24h: quoteCurrency === 'IRT' ? Math.round(price * 0.978) : Number((price * 0.978).toFixed(2)),
    volume24h: 89.45,
    usdtRate: USDT_TO_IRT_RATE,
    source: 'SIMULATED_ENGINE',
    latencyMs,
  };
};
