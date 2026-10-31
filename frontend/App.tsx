import React, { useState, useEffect, useMemo } from 'react';
import { 
  QuoteCurrency, 
  CryptoAsset, 
  MarketPair, 
  CandleData, 
  OrderBookEntry, 
  TradeEntry, 
  Position, 
  Order, 
  WalletBalances 
} from './types';
import { 
  SUPPORTED_ASSETS, 
  USDT_TO_IRT_RATE, 
  INITIAL_BALANCES 
} from './constants';
import { Navbar } from './components/Navbar';
import { MarketHeader } from './components/MarketHeader';
import { TradingChart } from './components/TradingChart';
import { OrderBook } from './components/OrderBook';
import { OrderForm } from './components/OrderForm';
import { PositionsTable } from './components/PositionsTable';
import { AiRiskModal } from './components/AiRiskModal';

export const App: React.FC = () => {
  // 1. Core State: Quote Currency (IRT vs USDT)
  const [quoteCurrency, setQuoteCurrency] = useState<QuoteCurrency>('IRT');
  const [selectedAsset, setSelectedAsset] = useState<CryptoAsset>(SUPPORTED_ASSETS[0]);
  const [balances, setBalances] = useState<WalletBalances>(INITIAL_BALANCES);

  // 2. Positions & Orders
  const [positions, setPositions] = useState<Position[]>([
    {
      id: 'pos-init-1',
      pairId: 'BTC-IRT',
      baseAsset: 'BTC',
      quoteCurrency: 'IRT',
      side: 'BUY',
      marginMode: 'ISOLATED',
      leverage: 5,
      size: 0.05,
      entryPrice: 4320000000,
      markPrice: 4435560000,
      liquidationPrice: 3672000000,
      margin: 43200000, // 43.2M Tomans collateral
      borrowed: 172800000,
      unrealizedPnl: 5778000,
      roePercentage: 13.37,
      maintenanceMarginRate: 0.05,
      openedAt: '14:20',
    },
  ]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isAiRiskOpen, setIsAiRiskOpen] = useState(false);
  const [presetOrderPrice, setPresetOrderPrice] = useState<number | undefined>();

  // Helper to compute active market price based on quote currency
  const basePriceInCurrency = useMemo(() => {
    return quoteCurrency === 'IRT'
      ? selectedAsset.basePriceUSDT * USDT_TO_IRT_RATE
      : selectedAsset.basePriceUSDT;
  }, [selectedAsset, quoteCurrency]);

  const [currentMarketPrice, setCurrentMarketPrice] = useState<number>(basePriceInCurrency);

  // Sync market price when currency or asset changes
  useEffect(() => {
    setCurrentMarketPrice(basePriceInCurrency);
  }, [basePriceInCurrency]);

  // Construct active market pair metrics
  const activePair: MarketPair = useMemo(() => {
    const change = 2.45;
    return {
      id: `${selectedAsset.symbol}-${quoteCurrency}`,
      baseAsset: selectedAsset.symbol,
      quoteCurrency,
      lastPrice: currentMarketPrice,
      change24h: change,
      high24h: currentMarketPrice * 1.034,
      low24h: currentMarketPrice * 0.972,
      volume24h: 124.6,
      fundingRate: 0.0001,
      borrowRatePerHour: 0.000015,
    };
  }, [selectedAsset, quoteCurrency, currentMarketPrice]);

  // Generate dynamic candles
  const candles: CandleData[] = useMemo(() => {
    const list: CandleData[] = [];
    const count = 30;
    const base = currentMarketPrice;
    let lastClose = base * 0.96;

    for (let i = count; i >= 0; i--) {
      const delta = (Math.sin(i * 0.4) + (Math.random() - 0.48)) * (base * 0.012);
      const open = lastClose;
      const close = open + delta;
      const high = Math.max(open, close) + Math.random() * (base * 0.004);
      const low = Math.min(open, close) - Math.random() * (base * 0.004);
      lastClose = close;

      list.push({
        time: `${12 - Math.floor(i / 2)}:${(i * 15) % 60 === 0 ? '00' : '30'}`,
        timestamp: Date.now() - i * 900000,
        open,
        high,
        low,
        close,
        volume: Math.floor(10 + Math.random() * 45),
        ma20: close * (1 + (Math.sin(i) * 0.005)),
      });
    }
    return list;
  }, [currentMarketPrice]);

  // Generate dynamic order book bids & asks
  const { bids, asks } = useMemo(() => {
    const bList: OrderBookEntry[] = [];
    const aList: OrderBookEntry[] = [];
    let bTotal = 0;
    let aTotal = 0;

    const step = quoteCurrency === 'IRT' ? 2500000 : currentMarketPrice * 0.0008;

    for (let i = 1; i <= 8; i++) {
      const askAmount = 0.08 + Math.random() * 0.45;
      const bidAmount = 0.08 + Math.random() * 0.45;
      aTotal += askAmount;
      bTotal += bidAmount;

      aList.push({
        price: currentMarketPrice + i * step,
        amount: askAmount,
        total: aTotal,
      });

      bList.push({
        price: currentMarketPrice - i * step,
        amount: bidAmount,
        total: bTotal,
      });
    }

    return { bids: bList, asks: aList };
  }, [currentMarketPrice, quoteCurrency]);

  // Recent simulated trades
  const [recentTrades, setRecentTrades] = useState<TradeEntry[]>([
    { id: 't1', price: currentMarketPrice, amount: 0.045, time: '14:32:05', side: 'BUY' },
    { id: 't2', price: currentMarketPrice * 0.999, amount: 0.12, time: '14:31:58', side: 'SELL' },
    { id: 't3', price: currentMarketPrice * 1.001, amount: 0.08, time: '14:31:40', side: 'BUY' },
  ]);

  // Simulate tick updates to keep terminal feeling active
  useEffect(() => {
    const interval = setInterval(() => {
      const jitter = (Math.random() - 0.49) * 0.0015;
      setCurrentMarketPrice((prev) => {
        const nextPrice = prev * (1 + jitter);
        return quoteCurrency === 'IRT' ? Math.round(nextPrice) : Number(nextPrice.toFixed(2));
      });

      // Update positions mark price and unrealized PnL
      setPositions((prev) =>
        prev.map((pos) => {
          if (pos.baseAsset !== selectedAsset.symbol || pos.quoteCurrency !== quoteCurrency) {
            return pos;
          }
          const priceDiff = pos.side === 'BUY'
            ? currentMarketPrice - pos.entryPrice
            : pos.entryPrice - currentMarketPrice;
          const pnl = priceDiff * pos.size;
          const roe = pos.margin > 0 ? (pnl / pos.margin) * 100 : 0;
          return {
            ...pos,
            markPrice: currentMarketPrice,
            unrealizedPnl: Math.round(pnl),
            roePercentage: roe,
          };
        })
      );
    }, 3200);

    return () => clearInterval(interval);
  }, [selectedAsset, quoteCurrency, currentMarketPrice]);

  // Handlers for Trading
  const handlePlaceOrder = (newOrderData: {
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET';
    marginMode: 'ISOLATED' | 'CROSS';
    leverage: number;
    price: number;
    amount: number;
    takeProfit?: number;
    stopLoss?: number;
  }) => {
    const notional = newOrderData.amount * newOrderData.price;
    const requiredMargin = notional / newOrderData.leverage;

    // Deduct free balance, add to locked margin
    setBalances((prev) => ({
      ...prev,
      [quoteCurrency]: {
        ...prev[quoteCurrency],
        free: Math.max(0, prev[quoteCurrency].free - requiredMargin),
        locked: prev[quoteCurrency].locked + requiredMargin,
      },
    }));

    if (newOrderData.type === 'MARKET') {
      // Execute immediately as Position
      const maintenanceMarginRate = 0.05;
      const liqPrice =
        newOrderData.side === 'BUY'
          ? newOrderData.price * (1 - 1 / newOrderData.leverage + maintenanceMarginRate)
          : newOrderData.price * (1 + 1 / newOrderData.leverage - maintenanceMarginRate);

      const newPosition: Position = {
        id: `pos-${Date.now()}`,
        pairId: `${selectedAsset.symbol}-${quoteCurrency}`,
        baseAsset: selectedAsset.symbol,
        quoteCurrency,
        side: newOrderData.side,
        marginMode: newOrderData.marginMode,
        leverage: newOrderData.leverage,
        size: newOrderData.amount,
        entryPrice: newOrderData.price,
        markPrice: newOrderData.price,
        liquidationPrice: Math.round(liqPrice),
        margin: Math.round(requiredMargin),
        borrowed: Math.round(notional - requiredMargin),
        unrealizedPnl: 0,
        roePercentage: 0,
        maintenanceMarginRate,
        takeProfit: newOrderData.takeProfit,
        stopLoss: newOrderData.stopLoss,
        openedAt: new Date().toLocaleTimeString(),
      };

      setPositions((prev) => [newPosition, ...prev]);

      // Add to recent trades
      setRecentTrades((prev) => [
        {
          id: `trade-${Date.now()}`,
          price: newOrderData.price,
          amount: newOrderData.amount,
          time: new Date().toLocaleTimeString(),
          side: newOrderData.side,
        },
        ...prev.slice(0, 15),
      ]);
    } else {
      // Create Limit Order
      const newOrder: Order = {
        id: `ord-${Date.now()}`,
        pairId: `${selectedAsset.symbol}-${quoteCurrency}`,
        baseAsset: selectedAsset.symbol,
        quoteCurrency,
        side: newOrderData.side,
        type: newOrderData.type,
        leverage: newOrderData.leverage,
        price: newOrderData.price,
        amount: newOrderData.amount,
        filled: 0,
        status: 'OPEN',
        createdAt: new Date().toLocaleTimeString(),
      };
      setOrders((prev) => [newOrder, ...prev]);
    }
  };

  const handleClosePosition = (positionId: string) => {
    const pos = positions.find((p) => p.id === positionId);
    if (!pos) return;

    // Return collateral plus realized PnL to free balance
    const returnedEquity = Math.max(0, pos.margin + pos.unrealizedPnl);

    setBalances((prev) => ({
      ...prev,
      [pos.quoteCurrency]: {
        ...prev[pos.quoteCurrency],
        free: prev[pos.quoteCurrency].free + returnedEquity,
        locked: Math.max(0, prev[pos.quoteCurrency].locked - pos.margin),
      },
    }));

    setPositions((prev) => prev.filter((p) => p.id !== positionId));
  };

  const handleCancelOrder = (orderId: string) => {
    const ord = orders.find((o) => o.id === orderId);
    if (!ord) return;

    const notional = ord.amount * ord.price;
    const lockedMargin = notional / ord.leverage;

    setBalances((prev) => ({
      ...prev,
      [ord.quoteCurrency]: {
        ...prev[ord.quoteCurrency],
        free: prev[ord.quoteCurrency].free + lockedMargin,
        locked: Math.max(0, prev[ord.quoteCurrency].locked - lockedMargin),
      },
    }));

    setOrders((prev) => prev.filter((o) => o.id !== orderId));
  };

  const handleAddMargin = (positionId: string, addedAmount: number) => {
    const pos = positions.find((p) => p.id === positionId);
    if (!pos || balances[pos.quoteCurrency].free < addedAmount) {
      alert('موجودی آزاد کافی نیست.');
      return;
    }

    setBalances((prev) => ({
      ...prev,
      [pos.quoteCurrency]: {
        ...prev[pos.quoteCurrency],
        free: prev[pos.quoteCurrency].free - addedAmount,
        locked: prev[pos.quoteCurrency].locked + addedAmount,
      },
    }));

    // Recalculate safer liquidation price with extra collateral
    setPositions((prev) =>
      prev.map((p) => {
        if (p.id !== positionId) return p;
        const newMargin = p.margin + addedAmount;
        const adjustment = (addedAmount / (p.size || 1)) * 0.85;
        const newLiq =
          p.side === 'BUY'
            ? Math.max(0, p.liquidationPrice - adjustment)
            : p.liquidationPrice + adjustment;

        return {
          ...p,
          margin: newMargin,
          liquidationPrice: Math.round(newLiq),
        };
      })
    );
  };

  const handleQuickDeposit = (curr: QuoteCurrency, amount: number) => {
    setBalances((prev) => ({
      ...prev,
      [curr]: {
        ...prev[curr],
        free: prev[curr].free + amount,
      },
    }));
  };

  const handleResetBalances = () => {
    setBalances(INITIAL_BALANCES);
    setPositions([]);
    setOrders([]);
  };

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col font-sans">
      {/* 1. Navbar with prominent IRT / USDT toggle */}
      <Navbar
        quoteCurrency={quoteCurrency}
        onSelectQuoteCurrency={(curr) => setQuoteCurrency(curr)}
        balances={balances}
        onResetBalances={handleResetBalances}
        onOpenAiRisk={() => setIsAiRiskOpen(true)}
        onQuickDeposit={handleQuickDeposit}
      />

      {/* 2. Market Header with stats & coin tabs */}
      <MarketHeader
        selectedAsset={selectedAsset}
        onSelectAsset={(asset) => setSelectedAsset(asset)}
        activePair={activePair}
        quoteCurrency={quoteCurrency}
        onToggleCurrency={(curr) => setQuoteCurrency(curr)}
      />

      {/* 3. Main Trading Layout Grid */}
      <main className="flex-1 max-w-[1920px] w-full mx-auto p-2 sm:p-3 grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Left Column (Desktop 8 / 12): Chart + Positions */}
        <div className="lg:col-span-6 xl:col-span-7 flex flex-col gap-3">
          <TradingChart
            candles={candles}
            quoteCurrency={quoteCurrency}
            pairSymbol={selectedAsset.symbol}
          />
          <PositionsTable
            positions={positions}
            orders={orders}
            quoteCurrency={quoteCurrency}
            onClosePosition={handleClosePosition}
            onCancelOrder={handleCancelOrder}
            onAddMargin={handleAddMargin}
          />
        </div>

        {/* Middle Column (Order Book: 3 / 12) */}
        <div className="lg:col-span-3 xl:col-span-2">
          <OrderBook
            bids={bids}
            asks={asks}
            recentTrades={recentTrades}
            quoteCurrency={quoteCurrency}
            baseAssetSymbol={selectedAsset.symbol}
            onSelectPrice={(price) => setPresetOrderPrice(price)}
          />
        </div>

        {/* Right Column (Order Form: 3 / 12) */}
        <div className="lg:col-span-3 xl:col-span-3">
          <OrderForm
            quoteCurrency={quoteCurrency}
            baseAsset={selectedAsset}
            currentPrice={currentMarketPrice}
            balances={balances}
            onPlaceOrder={handlePlaceOrder}
            presetPrice={presetOrderPrice}
          />
        </div>
      </main>

      {/* 4. Gemini AI Risk Auditor Modal */}
      <AiRiskModal
        isOpen={isAiRiskOpen}
        onClose={() => setIsAiRiskOpen(false)}
        positions={positions}
        activeQuote={quoteCurrency}
        currentAsset={selectedAsset}
        currentPrice={currentMarketPrice}
      />
    </div>
  );
};

export default App;
