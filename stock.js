export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'symbol is required' });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'upstream error', status: response.status });
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];

    if (!result) {
      return res.status(404).json({ error: 'no data for symbol' });
    }

    const meta = result.meta;
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const volumes = result.indicators?.quote?.[0]?.volume || [];

    // 计算 MA20（用近20个收盘价均值）
    const validCloses = closes.filter(v => v !== null);
    const ma20closes = validCloses.slice(-20);
    const ma20 = ma20closes.length > 0
      ? ma20closes.reduce((a, b) => a + b, 0) / ma20closes.length
      : null;

    // 计算 RSI(14)
    const rsi = calcRSI(validCloses, 14);

    // 成交量（最新）
    const latestVolume = volumes.filter(v => v !== null).slice(-1)[0] || 0;

    // 看涨/看跌（简单判断：当日涨跌幅）
    const changePercent = meta.regularMarketChangePercent || 0;
    const sentiment = changePercent >= 0 ? 'bullish' : 'bearish';

    // 分时图数据（最多120个点，确保 timestamps 与 closes 索引对齐）
    const len = Math.min(timestamps.length, closes.length);
    const sliceStart = Math.max(0, len - 120);
    const chartData = timestamps.slice(sliceStart).map((t, i) => ({
      t: t * 1000,
      v: closes[sliceStart + i] ?? null
    })).filter(d => d.v !== null);

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');
    return res.status(200).json({
      symbol,
      name: meta.longName || meta.shortName || symbol,
      currency: meta.currency,
      price: meta.regularMarketPrice,
      change: meta.regularMarketChange,
      changePercent: meta.regularMarketChangePercent,
      ma20: ma20 ? parseFloat(ma20.toFixed(4)) : null,
      rsi: rsi ? parseFloat(rsi.toFixed(2)) : null,
      volume: latestVolume,
      sentiment,
      chartData,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}
