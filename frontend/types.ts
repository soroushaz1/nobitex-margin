export type QuoteCurrency = 'IRT' | 'USDT';

export type OrderSide = 'BUY' | 'SELL'; // Buy = Long (تعهد خرید), Sell = Short (تعهد فروش)
export type OrderType = 'LIMIT' | 'MARKET' | 'STOP_LIMIT';
export type MarginMode = 'ISOLATED' | 'CROSS';

export interface CryptoAsset {
  symbol: string;
  name: string;
  nameFa: string;
  icon: string;
  basePriceUSDT: number;
  decimals: number;
  maxLeverage: number;
}

export interface MarketPair {
  id: string;
  baseAsset: string;
  quoteCurrency: QuoteCurrency;
  lastPrice: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  fundingRate: number;
  borrowRatePerHour: number;
}

export interface CandleData {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma20?: number;
}

export interface OrderBookEntry {
  price: number;
  amount: number;
  total: number;
}

export interface TradeEntry {
  id: string;
  price: number;
  amount: number;
  time: string;
  side: OrderSide;
}

export interface Position {
  id: string;
  pairId: string;
  baseAsset: string;
  quoteCurrency: QuoteCurrency;
  side: OrderSide; // BUY = Long, SELL = Short
  marginMode: MarginMode;
  leverage: number;
  size: number; // in base asset (e.g. BTC)
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  margin: number; // initial collateral in quote currency
  borrowed: number; // borrowed amount in quote or base asset
  unrealizedPnl: number;
  roePercentage: number;
  maintenanceMarginRate: number;
  takeProfit?: number;
  stopLoss?: number;
  openedAt: string;
  aiSuggested?: boolean;
}

export interface Order {
  id: string;
  pairId: string;
  baseAsset: string;
  quoteCurrency: QuoteCurrency;
  side: OrderSide;
  type: OrderType;
  leverage: number;
  price: number;
  stopPrice?: number;
  amount: number;
  filled: number;
  status: 'OPEN' | 'FILLED' | 'CANCELLED';
  createdAt: string;
}

export interface WalletBalances {
  IRT: {
    free: number;
    locked: number;
    borrowed: number;
  };
  USDT: {
    free: number;
    locked: number;
    borrowed: number;
  };
  crypto: Record<string, { free: number; locked: number }>;
}

export interface GeminiAnalysisResult {
  riskScore: number; // 0 to 100
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  summary: string;
  recommendations: string[];
  suggestedStopLoss: number;
  suggestedTakeProfit: number;
  liquidationProximityWarning: string;
}

export interface AITradeSignal {
  id: string;
  symbol: string;
  nameFa: string;
  side: OrderSide; // BUY = Long, SELL = Short
  quoteCurrency: QuoteCurrency;
  recommendedLeverage: number;
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  expectedProfitPct: number;
  maxRiskPct: number;
  riskRewardRatio: string;
  confidenceScore: number; // 0-100
  timeframe: 'اسکالپ (15m)' | 'کوتاه‌مدت (1h)' | 'روندی (4h)';
  rationale: string;
  triggerEvent: string;
  timestamp: string;
}

export interface LiveSyncStatus {
  source: 'NOBITEX_PUBLIC_API' | 'SIMULATED_ENGINE';
  lastUpdated: string;
  usdtIrtRate: number;
  latencyMs: number;
  isConnected: boolean;
}
