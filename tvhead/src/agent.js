// The "agent" persona: turns market data into a running terminal monologue and a mood.
// It comments on the market. It does not trade, and the UI says so.
import { formatPct, formatPrice, formatUsd } from './market.js';

export function moodFrom(change) {
  if (change.h1 > 3 || change.m5 > 1.5 || (change.h24 > 15 && change.h1 >= 0)) return 'pump';
  if (change.h1 < -3 || change.m5 < -1.5 || (change.h24 < -15 && change.h1 <= 0)) return 'dump';
  return 'neutral';
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function createAgent(market, ticker) {
  let i = 0;
  const lines = {
    pump: [
      (s) => `momentum 1h ${formatPct(s.change.h1)} :: antennas tingling`,
      () => `green candles detected. screen brightness +20%`,
      (s) => `price ${formatPrice(s.price)} :: mood = euphoric`,
      () => `scanning for jeets... none found. holding the line`,
      () => `${ticker} chart looks like my antennas. up only (not advice)`,
    ],
    dump: [
      (s) => `1h ${formatPct(s.change.h1)} :: static on the signal`,
      () => `red candles. adjusting vertical hold`,
      () => `paper hands detected nearby. staying calm`,
      (s) => `liquidity ${formatUsd(s.liquidity)} :: still broadcasting`,
      () => `a CRT has survived worse. diamond tubes`,
    ],
    neutral: [
      (s) => `price ${formatPrice(s.price)} :: 24h ${formatPct(s.change.h24)}`,
      (s) => `mcap ${formatUsd(s.marketCap)} :: vol 24h ${formatUsd(s.volume24h)}`,
      () => `scanning frequencies for alpha...`,
      () => `watching the mempool. it watches back`,
      (s) => `5m ${formatPct(s.change.m5)} :: sideways. tuning knobs`,
      () => `reminder: i am a tv. nothing i say is financial advice`,
    ],
  };

  return {
    next() {
      const s = market.state;
      if (!s.ready) return 'booting... waiting for signal';
      const mood = moodFrom(s.change);
      i++;
      // Every few lines, print the raw numbers so the feed stays grounded in real data.
      if (i % 4 === 0) return `px ${formatPrice(s.price)} | 1h ${formatPct(s.change.h1)} | 24h ${formatPct(s.change.h24)}`;
      return pick(lines[mood])(s);
    },
  };
}

// Draws the price chart that the TV can switch to. Rendered in white; the
// screen shader tints it and adds the CRT look.
export function createChartCanvas(ticker) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 400;
  const ctx = canvas.getContext('2d');

  function draw(state) {
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    const data = state.history;
    if (data.length < 2) return;
    const min = Math.min(...data), max = Math.max(...data);
    const pad = { l: 56, r: 56, t: 130, b: 70 };
    const x = (i) => pad.l + (i / (data.length - 1)) * (w - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - min) / (max - min || 1)) * (h - pad.t - pad.b);

    ctx.fillStyle = '#fff';
    ctx.font = '600 30px "JetBrains Mono", monospace';
    ctx.fillText(ticker, pad.l, 74);
    ctx.font = '500 26px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(formatPrice(state.price), w - pad.r, 74);
    ctx.font = '400 20px "JetBrains Mono", monospace';
    ctx.globalAlpha = 0.75;
    ctx.fillText(`24h ${formatPct(state.change.h24)}`, w - pad.r, 104);
    if (state.demo) { ctx.textAlign = 'left'; ctx.fillText('DEMO', pad.l, 104); }
    ctx.textAlign = 'left';

    // Area fill + line.
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.moveTo(x(0), h - pad.b);
    data.forEach((v, i) => ctx.lineTo(x(i), y(v)));
    ctx.lineTo(x(data.length - 1), h - pad.b);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.stroke();

    // Live dot.
    ctx.beginPath();
    ctx.arc(x(data.length - 1), y(data[data.length - 1]), 8, 0, Math.PI * 2);
    ctx.fill();

    // Baseline grid.
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    for (let g = 0; g <= 3; g++) {
      const gy = pad.t + (g / 3) * (h - pad.t - pad.b);
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(w - pad.r, gy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  return { canvas, draw };
}
