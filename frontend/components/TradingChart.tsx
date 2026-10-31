import React, { useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { CandleData, QuoteCurrency } from '../types';
import { formatCurrency } from '../constants';
import { BarChart3, TrendingUp, Maximize2, Activity } from 'lucide-react';

interface TradingChartProps {
  candles: CandleData[];
  quoteCurrency: QuoteCurrency;
  pairSymbol: string;
}

export const TradingChart: React.FC<TradingChartProps> = ({
  candles,
  quoteCurrency,
  pairSymbol,
}) => {
  const [timeframe, setTimeframe] = useState<'15m' | '1h' | '4h' | '1D'>('1h');
  const [showMa, setShowMa] = useState(true);

  const minPrice = Math.min(...candles.map((c) => c.low));
  const maxPrice = Math.max(...candles.map((c) => c.high));
  const yDomainPadding = (maxPrice - minPrice) * 0.05;

  return (
    <div className="bg-nobi-card border border-nobi-border rounded-xl flex flex-col h-[440px] overflow-hidden">
      {/* Chart Toolbar */}
      <div className="px-4 py-2 border-b border-nobi-border flex items-center justify-between text-xs bg-[#131a26]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-900/60 p-0.5 rounded-lg border border-slate-800">
            {(['15m', '1h', '4h', '1D'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                  timeframe === tf
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowMa(!showMa)}
            className={`px-2 py-1 rounded text-[11px] font-semibold border transition-colors flex items-center gap-1 ${
              showMa
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                : 'text-slate-400 border-transparent hover:bg-slate-800'
            }`}
          >
            <Activity className="w-3 h-3" />
            <span>EMA 20</span>
          </button>
        </div>

        <div className="flex items-center gap-3 text-slate-400 text-[11px]">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            قیمت تعهد (Mark Price)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            میانگین متحرک
          </span>
        </div>
      </div>

      {/* Chart Area */}
      <div className="flex-1 w-full p-2 relative">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={candles} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" vertical={false} />

            <XAxis
              dataKey="time"
              stroke="#64748b"
              fontSize={10}
              tickLine={false}
              axisLine={{ stroke: '#232e42' }}
            />

            <YAxis
              yAxisId="price"
              orientation="right"
              stroke="#64748b"
              fontSize={10}
              domain={[minPrice - yDomainPadding, maxPrice + yDomainPadding]}
              tickFormatter={(v) =>
                quoteCurrency === 'IRT'
                  ? `${Math.round(v / 1000000)}M`
                  : v > 1000
                  ? `$${(v / 1000).toFixed(1)}k`
                  : `$${v.toFixed(1)}`
              }
              tickLine={false}
              axisLine={{ stroke: '#232e42' }}
            />

            <YAxis
              yAxisId="volume"
              orientation="left"
              domain={[0, 'auto']}
              hide={true}
            />

            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload as CandleData;
                  const isUp = data.close >= data.open;
                  return (
                    <div className="bg-[#121927]/95 border border-nobi-border rounded-lg p-2.5 shadow-xl text-xs backdrop-blur-md">
                      <div className="flex items-center justify-between gap-4 mb-1.5 text-slate-300 font-medium">
                        <span>{data.time}</span>
                        <span className={`font-bold ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isUp ? '▲ صعودی' : '▼ نزولی'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px]">
                        <span className="text-slate-400">Open:</span>
                        <span className="text-right">{formatCurrency(data.open, quoteCurrency)}</span>
                        <span className="text-slate-400">High:</span>
                        <span className="text-right text-emerald-400">{formatCurrency(data.high, quoteCurrency)}</span>
                        <span className="text-slate-400">Low:</span>
                        <span className="text-right text-rose-400">{formatCurrency(data.low, quoteCurrency)}</span>
                        <span className="text-slate-400">Close:</span>
                        <span className="text-right font-bold">{formatCurrency(data.close, quoteCurrency)}</span>
                        <span className="text-slate-400">Volume:</span>
                        <span className="text-right text-slate-300">{data.volume.toLocaleString()}</span>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />

            <Bar
              yAxisId="volume"
              dataKey="volume"
              fill="#334155"
              opacity={0.35}
              barSize={6}
            />

            <Area
              yAxisId="price"
              type="monotone"
              dataKey="close"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#priceGradient)"
            />

            {showMa && (
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="ma20"
                stroke="#f59e0b"
                strokeWidth={1.5}
                dot={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
