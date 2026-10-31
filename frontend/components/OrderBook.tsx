import React, { useState } from 'react';
import { OrderBookEntry, TradeEntry, QuoteCurrency } from '../types';
import { formatPrice } from '../constants';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

interface OrderBookProps {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  recentTrades: TradeEntry[];
  quoteCurrency: QuoteCurrency;
  baseAssetSymbol: string;
  onSelectPrice: (price: number) => void;
}

export const OrderBook: React.FC<OrderBookProps> = ({
  bids,
  asks,
  recentTrades,
  quoteCurrency,
  baseAssetSymbol,
  onSelectPrice,
}) => {
  const [viewTab, setViewTab] = useState<'BOOK' | 'TRADES'>('BOOK');

  const maxTotalAsk = Math.max(...asks.map((a) => a.total), 1);
  const maxTotalBid = Math.max(...bids.map((b) => b.total), 1);

  const highestBid = bids[0]?.price || 0;
  const lowestAsk = asks[0]?.price || 0;
  const spread = Math.max(0, lowestAsk - highestBid);
  const spreadPercent = lowestAsk > 0 ? (spread / lowestAsk) * 100 : 0;

  return (
    <div className="bg-nobi-card border border-nobi-border rounded-xl flex flex-col h-[560px] overflow-hidden text-xs">
      {/* Header Tabs */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-nobi-border bg-[#131a26]">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewTab('BOOK')}
            className={`px-3 py-1 rounded-md font-semibold text-xs transition-colors ${
              viewTab === 'BOOK'
                ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            دفتر سفارشات (Order Book)
          </button>
          <button
            onClick={() => setViewTab('TRADES')}
            className={`px-3 py-1 rounded-md font-semibold text-xs transition-colors ${
              viewTab === 'TRADES'
                ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            معاملات اخیر
          </button>
        </div>

        <span className="text-[10px] text-slate-400 font-mono">
          واحد: {quoteCurrency}
        </span>
      </div>

      {viewTab === 'BOOK' ? (
        <div className="flex-1 flex flex-col justify-between p-2 select-none">
          {/* Table Headers */}
          <div className="grid grid-cols-3 text-slate-400 text-[10px] font-medium px-1 pb-1">
            <span>قیمت ({quoteCurrency})</span>
            <span className="text-center">مقدار ({baseAssetSymbol})</span>
            <span className="text-left">مجموع</span>
          </div>

          {/* Asks (Sell Orders) - Red */}
          <div className="flex flex-col-reverse justify-end gap-0.5 overflow-hidden">
            {asks.slice(0, 8).map((ask, i) => {
              const depthPercent = Math.min(100, (ask.total / maxTotalAsk) * 100);
              return (
                <div
                  key={`ask-${i}`}
                  onClick={() => onSelectPrice(ask.price)}
                  className="relative grid grid-cols-3 py-0.5 px-1 font-mono text-[11px] hover:bg-slate-800/60 cursor-pointer rounded transition-colors group"
                >
                  <div
                    className="absolute right-0 top-0 bottom-0 bg-rose-500/10 -z-0 pointer-events-none transition-all"
                    style={{ width: `${depthPercent}%` }}
                  />
                  <span className="text-rose-400 font-semibold group-hover:underline z-10">
                    {formatPrice(ask.price, quoteCurrency)}
                  </span>
                  <span className="text-center text-slate-300 z-10">{ask.amount.toFixed(4)}</span>
                  <span className="text-left text-slate-400 z-10">{ask.total.toFixed(3)}</span>
                </div>
              );
            })}
          </div>

          {/* Spread Bar */}
          <div className="my-1.5 py-1 px-2 bg-slate-900/80 border-y border-nobi-border flex items-center justify-between text-[11px] font-mono">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Spread:</span>
              <span className="font-semibold text-slate-200">
                {formatPrice(spread, quoteCurrency)}
              </span>
            </div>
            <span className="text-[10px] text-slate-400">({spreadPercent.toFixed(3)}%)</span>
          </div>

          {/* Bids (Buy Orders) - Green */}
          <div className="flex flex-col gap-0.5 overflow-hidden">
            {bids.slice(0, 8).map((bid, i) => {
              const depthPercent = Math.min(100, (bid.total / maxTotalBid) * 100);
              return (
                <div
                  key={`bid-${i}`}
                  onClick={() => onSelectPrice(bid.price)}
                  className="relative grid grid-cols-3 py-0.5 px-1 font-mono text-[11px] hover:bg-slate-800/60 cursor-pointer rounded transition-colors group"
                >
                  <div
                    className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 -z-0 pointer-events-none transition-all"
                    style={{ width: `${depthPercent}%` }}
                  />
                  <span className="text-emerald-400 font-semibold group-hover:underline z-10">
                    {formatPrice(bid.price, quoteCurrency)}
                  </span>
                  <span className="text-center text-slate-300 z-10">{bid.amount.toFixed(4)}</span>
                  <span className="text-left text-slate-400 z-10">{bid.total.toFixed(3)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Recent Trades Stream */
        <div className="flex-1 p-2 overflow-y-auto space-y-1">
          <div className="grid grid-cols-3 text-slate-400 text-[10px] font-medium px-1 pb-1">
            <span>قیمت ({quoteCurrency})</span>
            <span className="text-center">حجم</span>
            <span className="text-left">زمان</span>
          </div>
          {recentTrades.map((trade) => (
            <div
              key={trade.id}
              className="grid grid-cols-3 py-0.5 px-1 font-mono text-[11px] hover:bg-slate-800/40 rounded"
            >
              <span
                className={`flex items-center gap-0.5 font-semibold ${
                  trade.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {trade.side === 'BUY' ? (
                  <ArrowUpRight className="w-3 h-3 inline" />
                ) : (
                  <ArrowDownRight className="w-3 h-3 inline" />
                )}
                {formatPrice(trade.price, quoteCurrency)}
              </span>
              <span className="text-center text-slate-300">{trade.amount.toFixed(4)}</span>
              <span className="text-left text-slate-400 text-[10px]">{trade.time}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
