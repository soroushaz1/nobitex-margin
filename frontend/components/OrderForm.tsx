import React, { useState, useEffect } from 'react';
import { 
  OrderSide, 
  OrderType, 
  MarginMode, 
  QuoteCurrency, 
  CryptoAsset, 
  WalletBalances 
} from '../types';
import { LEVERAGE_OPTIONS, formatCurrency, formatPrice } from '../constants';
import { getInstantCopilotSetup } from '../services/geminiService';
import { Calculator, Shield, AlertTriangle, Info, Zap, Sparkles, Wand2 } from 'lucide-react';

interface OrderFormProps {
  quoteCurrency: QuoteCurrency;
  baseAsset: CryptoAsset;
  currentPrice: number;
  balances: WalletBalances;
  onPlaceOrder: (order: {
    side: OrderSide;
    type: OrderType;
    marginMode: MarginMode;
    leverage: number;
    price: number;
    amount: number; // in base crypto (e.g. BTC)
    takeProfit?: number;
    stopLoss?: number;
    aiSuggested?: boolean;
  }) => void;
  presetPrice?: number;
}

export const OrderForm: React.FC<OrderFormProps> = ({
  quoteCurrency,
  baseAsset,
  currentPrice,
  balances,
  onPlaceOrder,
  presetPrice,
}) => {
  const [side, setSide] = useState<OrderSide>('BUY'); // BUY = Long, SELL = Short
  const [orderType, setOrderType] = useState<OrderType>('LIMIT');
  const [marginMode, setMarginMode] = useState<MarginMode>('ISOLATED');
  const [leverage, setLeverage] = useState<number>(3);
  const [priceInput, setPriceInput] = useState<string>(currentPrice.toString());
  const [amountInput, setAmountInput] = useState<string>(''); // in base crypto
  const [percentSlider, setPercentSlider] = useState<number>(25);

  const [enableTpSl, setEnableTpSl] = useState(false);
  const [tpInput, setTpInput] = useState<string>('');
  const [slInput, setSlInput] = useState<string>('');
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotReason, setCopilotReason] = useState<string | null>(null);

  // Update price when preset clicked from order book
  useEffect(() => {
    if (presetPrice && presetPrice > 0) {
      setPriceInput(presetPrice.toString());
    }
  }, [presetPrice]);

  // Adjust max leverage if asset limit is lower
  useEffect(() => {
    if (leverage > baseAsset.maxLeverage) {
      setLeverage(baseAsset.maxLeverage);
    }
  }, [baseAsset.maxLeverage, leverage]);

  const priceNum = orderType === 'MARKET' ? currentPrice : parseFloat(priceInput) || currentPrice;
  const amountNum = parseFloat(amountInput) || 0;
  const notionalValue = amountNum * priceNum; // total position size in quote currency
  const requiredMargin = leverage > 0 ? notionalValue / leverage : notionalValue;
  const borrowedAmount = Math.max(0, notionalValue - requiredMargin);

  // Available free collateral in chosen quote currency
  const availableQuoteCollateral = balances[quoteCurrency].free;
  const maxBuyableBase = priceNum > 0 ? (availableQuoteCollateral * leverage) / priceNum : 0;

  // Approximate liquidation price calculation
  const maintenanceRate = 0.05; // 5% maintenance margin
  const liquidationPrice =
    leverage > 1 && priceNum > 0
      ? side === 'BUY'
        ? priceNum * (1 - 1 / leverage + maintenanceRate)
        : priceNum * (1 + 1 / leverage - maintenanceRate)
      : 0;

  // Percentage slider helper
  const handleSliderChange = (pct: number) => {
    setPercentSlider(pct);
    const targetAmount = (maxBuyableBase * (pct / 100));
    setAmountInput(targetAmount > 0 ? targetAmount.toFixed(baseAsset.decimals) : '');
  };

  // 1-Click AI Copilot Auto-Fill
  const handleAutoCopilot = async () => {
    setCopilotLoading(true);
    try {
      const res = await getInstantCopilotSetup(
        baseAsset.symbol,
        currentPrice,
        quoteCurrency,
        baseAsset.maxLeverage
      );

      setSide(res.side);
      setLeverage(res.leverage);
      setPriceInput(res.entryPrice.toString());
      setEnableTpSl(true);
      setTpInput(res.takeProfit.toString());
      setSlInput(res.stopLoss.toString());
      setCopilotReason(res.reason);

      // Default to 25% of user's free balance for safe execution
      const suggestedSize = ((availableQuoteCollateral * 0.25 * res.leverage) / res.entryPrice);
      if (suggestedSize > 0) {
        setAmountInput(suggestedSize.toFixed(baseAsset.decimals));
      }
    } finally {
      setCopilotLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amountNum <= 0) return;

    if (requiredMargin > availableQuoteCollateral) {
      alert(`موجودی آزاد ناکافی است. مارجین مورد نیاز: ${formatCurrency(requiredMargin, quoteCurrency)}`);
      return;
    }

    onPlaceOrder({
      side,
      type: orderType,
      marginMode,
      leverage,
      price: priceNum,
      amount: amountNum,
      takeProfit: enableTpSl && tpInput ? parseFloat(tpInput) : undefined,
      stopLoss: enableTpSl && slInput ? parseFloat(slInput) : undefined,
      aiSuggested: Boolean(copilotReason),
    });

    setAmountInput('');
    setCopilotReason(null);
  };

  return (
    <div className="bg-nobi-card border border-nobi-border rounded-xl p-4 flex flex-col h-full text-xs">
      {/* AI Copilot Quick Assistant Banner */}
      <div className="mb-3 p-2.5 rounded-xl bg-gradient-to-r from-amber-500/15 via-purple-500/10 to-emerald-500/15 border border-amber-500/30 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-amber-400 shrink-0" />
          <div>
            <span className="font-bold text-white text-[11px] block">دستیار هوشمند معامله (AI Copilot)</span>
            <span className="text-[10px] text-slate-400">تکمیل خودکار جهت، اهرم، حد سود و ضرر</span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleAutoCopilot}
          disabled={copilotLoading}
          className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] flex items-center gap-1 transition-colors shadow-sm disabled:opacity-50"
        >
          {copilotLoading ? <Sparkles className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          <span>تنظیم هوشمند</span>
        </button>
      </div>

      {copilotReason && (
        <div className="mb-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300">
          <strong className="block text-[10px] text-emerald-400 mb-0.5">تحلیل هوش مصنوعی:</strong>
          {copilotReason}
        </div>
      )}

      {/* Long / Short Selector */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-slate-900/80 rounded-xl border border-nobi-border mb-3">
        <button
          type="button"
          onClick={() => setSide('BUY')}
          className={`py-2 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
            side === 'BUY'
              ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-600/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>خرید (موقعیت Long)</span>
          <span className="text-[10px] opacity-75">▲</span>
        </button>
        <button
          type="button"
          onClick={() => setSide('SELL')}
          className={`py-2 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
            side === 'SELL'
              ? 'bg-gradient-to-r from-rose-600 to-rose-500 text-white shadow-md shadow-rose-600/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>فروش (موقعیت Short)</span>
          <span className="text-[10px] opacity-75">▼</span>
        </button>
      </div>

      {/* Mode & Leverage Badges */}
      <div className="flex items-center justify-between gap-2 mb-3">
        {/* Margin Mode Selector */}
        <div className="flex items-center gap-1 bg-[#111724] p-0.5 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setMarginMode('ISOLATED')}
            className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
              marginMode === 'ISOLATED'
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ایزوله (Isolated)
          </button>
          <button
            type="button"
            onClick={() => setMarginMode('CROSS')}
            className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
              marginMode === 'CROSS'
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            کراس (Cross)
          </button>
        </div>

        {/* Order Type Toggle */}
        <div className="flex items-center gap-1 bg-[#111724] p-0.5 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setOrderType('LIMIT')}
            className={`px-2 py-1 rounded text-[10px] font-bold ${
              orderType === 'LIMIT' ? 'bg-slate-700 text-emerald-400' : 'text-slate-400'
            }`}
          >
            محدود (Limit)
          </button>
          <button
            type="button"
            onClick={() => setOrderType('MARKET')}
            className={`px-2 py-1 rounded text-[10px] font-bold ${
              orderType === 'MARKET' ? 'bg-slate-700 text-emerald-400' : 'text-slate-400'
            }`}
          >
            سریع (Market)
          </button>
        </div>
      </div>

      {/* Leverage Selector */}
      <div className="mb-3 bg-slate-900/50 p-2.5 rounded-xl border border-nobi-border">
        <div className="flex items-center justify-between text-[11px] mb-1.5">
          <span className="text-slate-400 flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-400" />
            ضریب تعهد (Leverage):
          </span>
          <span className="font-mono font-bold text-amber-400 text-xs">{leverage}x</span>
        </div>
        <div className="grid grid-cols-6 gap-1">
          {LEVERAGE_OPTIONS.filter((lev) => lev <= baseAsset.maxLeverage).map((lev) => (
            <button
              key={lev}
              type="button"
              onClick={() => setLeverage(lev)}
              className={`py-1 rounded text-[10px] font-bold font-mono transition-colors ${
                leverage === lev
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              {lev}x
            </button>
          ))}
        </div>
      </div>

      {/* Form Fields */}
      <form onSubmit={handleSubmit} className="space-y-3 flex-1 flex flex-col justify-between">
        <div className="space-y-3">
          {/* Order Price */}
          {orderType === 'LIMIT' && (
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>قیمت سفارش:</span>
                <span className="font-mono">واحد: {quoteCurrency}</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  className="w-full bg-[#111724] border border-nobi-border focus:border-emerald-500 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 outline-none"
                  placeholder="قیمت مورد نظر..."
                  required
                />
                <span className="absolute left-3 top-2 text-[10px] font-bold text-slate-400 pointer-events-none">
                  {quoteCurrency}
                </span>
              </div>
            </div>
          )}

          {/* Order Amount */}
          <div>
            <div className="flex justify-between text-[11px] text-slate-400 mb-1">
              <span>مقدار سفارش:</span>
              <span className="font-mono text-emerald-400 cursor-pointer" onClick={() => handleSliderChange(100)}>
                Max: {maxBuyableBase.toFixed(baseAsset.decimals)} {baseAsset.symbol}
              </span>
            </div>
            <div className="relative">
              <input
                type="number"
                step="any"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="w-full bg-[#111724] border border-nobi-border focus:border-emerald-500 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 outline-none"
                placeholder={`0.00 ${baseAsset.symbol}`}
                required
              />
              <span className="absolute left-3 top-2 text-[10px] font-bold text-slate-400 pointer-events-none">
                {baseAsset.symbol}
              </span>
            </div>

            {/* Percentage Quick Select */}
            <div className="grid grid-cols-4 gap-1 mt-1.5">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => handleSliderChange(pct)}
                  className={`py-1 text-[10px] font-medium rounded transition-colors ${
                    percentSlider === pct
                      ? 'bg-slate-700 text-slate-100'
                      : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* TP / SL Accordion Toggle */}
          <div className="pt-1 border-t border-nobi-border">
            <button
              type="button"
              onClick={() => setEnableTpSl(!enableTpSl)}
              className="text-[11px] text-slate-300 flex items-center justify-between w-full py-1 hover:text-emerald-400 transition-colors"
            >
              <span>حد سود و حد ضرر (TP / SL)</span>
              <span className="text-[10px] text-slate-400">{enableTpSl ? '− پنهان' : '+ تنظیم'}</span>
            </button>

            {enableTpSl && (
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">حد سود (TP):</label>
                  <input
                    type="number"
                    step="any"
                    value={tpInput}
                    onChange={(e) => setTpInput(e.target.value)}
                    placeholder="قیمت هدف"
                    className="w-full bg-[#111724] border border-nobi-border rounded p-1.5 text-[11px] font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">حد ضرر (SL):</label>
                  <input
                    type="number"
                    step="any"
                    value={slInput}
                    onChange={(e) => setSlInput(e.target.value)}
                    placeholder="قیمت توقف"
                    className="w-full bg-[#111724] border border-nobi-border rounded p-1.5 text-[11px] font-mono outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Real-time Margin & Liquidation Preview Box */}
          <div className="bg-[#111724] rounded-xl p-2.5 border border-nobi-border space-y-1.5 text-[11px]">
            <div className="flex justify-between text-slate-400">
              <span>ارزش کل موقعیت (Notional):</span>
              <span className="font-mono text-slate-200">
                {formatCurrency(notionalValue, quoteCurrency)}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>وجه تضمین اولیه (Margin):</span>
              <span className="font-mono font-semibold text-emerald-400">
                {formatCurrency(requiredMargin, quoteCurrency)}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>وام دریافتی از استخر تعهدی:</span>
              <span className="font-mono text-amber-300">
                {formatCurrency(borrowedAmount, quoteCurrency)}
              </span>
            </div>
            {leverage > 1 && liquidationPrice > 0 && (
              <div className="pt-1 border-t border-slate-800 flex justify-between items-center text-rose-400 font-semibold">
                <span className="flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-rose-400" />
                  قیمت لیکوئید تقریبی:
                </span>
                <span className="font-mono">
                  {formatCurrency(liquidationPrice, quoteCurrency)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Action Button */}
        <button
          type="submit"
          disabled={amountNum <= 0}
          className={`w-full py-3 rounded-xl font-bold text-xs transition-all shadow-lg mt-3 flex items-center justify-center gap-2 ${
            amountNum <= 0
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
              : side === 'BUY'
              ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-emerald-500/20 active:scale-[0.99]'
              : 'bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white shadow-rose-500/20 active:scale-[0.99]'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>
            {side === 'BUY'
              ? `ثبت موقعیت خرید تعهدی (Long ${leverage}x)`
              : `ثبت موقعیت فروش تعهدی (Short ${leverage}x)`}
          </span>
        </button>
      </form>
    </div>
  );
};
