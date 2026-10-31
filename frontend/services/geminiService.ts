import { GoogleGenAI, Type } from '@google/genai';
import { Position, GeminiAnalysisResult, QuoteCurrency } from '../types';

export const analyzeMarginRiskWithGemini = async (
  positions: Position[],
  activeQuote: QuoteCurrency,
  currentMarketInfo: { symbol: string; currentPrice: number; leverage: number; side: string }
): Promise<GeminiAnalysisResult> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY, vertexai: true });

    const prompt = `
You are Nobitex's Senior Risk & Margin Intelligence Engine.
Analyze the user's current margin positions and impending trade setup.

Trading Zone: ${activeQuote}
Target Symbol: ${currentMarketInfo.symbol}/${activeQuote}
Target Price: ${currentMarketInfo.currentPrice}
Planned Leverage: ${currentMarketInfo.leverage}x
Planned Side: ${currentMarketInfo.side}

Existing Open Positions:
${JSON.stringify(
  positions.map((p) => ({
    symbol: p.baseAsset,
    side: p.side,
    leverage: `${p.leverage}x`,
    entryPrice: p.entryPrice,
    markPrice: p.markPrice,
    liquidationPrice: p.liquidationPrice,
    marginMode: p.marginMode,
    unrealizedPnl: p.unrealizedPnl,
    roePercentage: `${p.roePercentage.toFixed(2)}%`,
  })),
  null,
  2
)}

Provide a strict, professional margin risk breakdown in JSON adhering to the schema.
Calculate sensible stop-loss and take-profit recommendations based on volatility and liquidation distance.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a seasoned crypto risk manager analyzing isolated and cross margin leverage for Iranian and international traders on Nobitex.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            riskScore: {
              type: Type.NUMBER,
              description: 'Risk level from 0 (very safe) to 100 (extreme liquidation risk)',
            },
            riskLevel: {
              type: Type.STRING,
              description: 'One of LOW, MEDIUM, HIGH, CRITICAL',
            },
            summary: {
              type: Type.STRING,
              description: 'A 2-3 sentence overview of portfolio exposure and liquidation hazard.',
            },
            recommendations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 practical tips for margin preservation, hedging, or leverage adjustment.',
            },
            suggestedStopLoss: {
              type: Type.NUMBER,
              description: 'Recommended Stop Loss price level to avoid liquidation.',
            },
            suggestedTakeProfit: {
              type: Type.NUMBER,
              description: 'Recommended Take Profit target based on risk-to-reward ratio 1:2.5.',
            },
            liquidationProximityWarning: {
              type: Type.STRING,
              description: 'Specific warning note about how close the liquidation price is.',
            },
          },
          required: [
            'riskScore',
            'riskLevel',
            'summary',
            'recommendations',
            'suggestedStopLoss',
            'suggestedTakeProfit',
            'liquidationProximityWarning',
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text.trim()) as GeminiAnalysisResult;
    return parsed;
  } catch (error) {
    console.error('Gemini Margin Risk evaluation error:', error);
    // Graceful fallback if API limit or network occurs
    const isHighLeverage = currentMarketInfo.leverage >= 5;
    const estStopLoss =
      currentMarketInfo.side === 'BUY'
        ? currentMarketInfo.currentPrice * 0.95
        : currentMarketInfo.currentPrice * 1.05;
    const estTakeProfit =
      currentMarketInfo.side === 'BUY'
        ? currentMarketInfo.currentPrice * 1.12
        : currentMarketInfo.currentPrice * 0.88;

    return {
      riskScore: isHighLeverage ? 68 : 34,
      riskLevel: isHighLeverage ? 'HIGH' : 'LOW',
      summary: `Trading on ${currentMarketInfo.leverage}x leverage in ${activeQuote} zone requires disciplined liquidation threshold monitoring and stop-loss placement.`,
      recommendations: [
        'Always maintain at least 30% buffer between mark price and liquidation price.',
        `Consider isolated margin mode to protect your remaining ${activeQuote} balance from cascade liquidation.`,
        'Set Stop-Limit orders ahead of major volatility spikes.',
      ],
      suggestedStopLoss: Math.round(estStopLoss),
      suggestedTakeProfit: Math.round(estTakeProfit),
      liquidationProximityWarning:
        'Keep margin ratio below 70% to prevent automated margin calls by the Nobitex risk engine.',
    };
  }
};
