// Market data for the token. With a contract address it polls DexScreener's public
// API; without one it runs a clearly labelled demo random walk so the site works
// before launch.

const HISTORY = 96;

export function createMarket({ chain, contractAddress, pollSeconds = 20 }) {
  const listeners = new Set();
  const state = {
    demo: !contractAddress,
    ready: false,
    price: 0,
    change: { m5: 0, h1: 0, h6: 0, h24: 0 },
    marketCap: 0,
    volume24h: 0,
    liquidity: 0,
    url: null,
    history: [],
  };

  const emit = () => listeners.forEach((fn) => fn(state));

  // Rough 24h curve from DexScreener's change anchors (24h, 6h, 1h, 5m ago),
  // smoothed and lightly textured. Live polls are appended on top of it.
  function seedHistory(price, c) {
    const at = (pct) => price / (1 + pct / 100);
    const anchors = [
      [0, at(c.h24)],
      [0.75, at(c.h6)],
      [23 / 24, at(c.h1)],
      [1 - 5 / 1440, at(c.m5)],
      [1, price],
    ];
    const out = [];
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    for (let i = 0; i < HISTORY; i++) {
      const x = i / (HISTORY - 1);
      let k = 0;
      while (k < anchors.length - 2 && x > anchors[k + 1][0]) k++;
      const [x0, y0] = anchors[k];
      const [x1, y1] = anchors[k + 1];
      const f = x1 === x0 ? 1 : (x - x0) / (x1 - x0);
      const s = f * f * (3 - 2 * f);
      const y = y0 + (y1 - y0) * s;
      out.push(i === HISTORY - 1 ? y : y * (1 + rand() * 0.012));
    }
    return out;
  }

  async function poll() {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`);
      const json = await res.json();
      const pairs = (json.pairs || []).filter((p) => !chain || p.chainId === chain);
      if (!pairs.length) throw new Error('no pairs yet');
      const p = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      const price = parseFloat(p.priceUsd);
      state.change = { m5: 0, h1: 0, h6: 0, h24: 0, ...p.priceChange };
      state.marketCap = p.marketCap || p.fdv || 0;
      state.volume24h = p.volume?.h24 || 0;
      state.liquidity = p.liquidity?.usd || 0;
      state.url = p.url;
      if (!state.ready) state.history = seedHistory(price, state.change);
      else { state.history.push(price); state.history.shift(); }
      state.price = price;
      state.ready = true;
      emit();
    } catch (err) {
      console.warn('[market]', err.message);
    }
  }

  function demoTick() {
    const last = state.history[state.history.length - 1] ?? 0.000042;
    // Random walk with occasional pumps and dumps, for demo only.
    const shock = Math.random() < 0.06 ? (Math.random() - 0.35) * 0.18 : 0;
    const next = Math.max(1e-7, last * (1 + (Math.random() - 0.48) * 0.025 + shock));
    if (!state.history.length) {
      let v = 0.000031;
      for (let i = 0; i < HISTORY; i++) { v *= 1 + (Math.random() - 0.45) * 0.04; state.history.push(v); }
    } else {
      state.history.push(next);
      state.history.shift();
    }
    const h = state.history;
    const pct = (i) => (h[h.length - 1] / h[Math.max(0, h.length - 1 - i)] - 1) * 100;
    state.price = h[h.length - 1];
    state.change = { m5: pct(1), h1: pct(4), h6: pct(24), h24: pct(h.length - 1) };
    state.marketCap = state.price * 1e9;
    state.volume24h = state.marketCap * 0.31;
    state.liquidity = state.marketCap * 0.08;
    state.ready = true;
    emit();
  }

  function start() {
    if (state.demo) { demoTick(); setInterval(demoTick, 4000); }
    else { poll(); setInterval(poll, pollSeconds * 1000); }
  }

  return { state, start, onUpdate: (fn) => listeners.add(fn) };
}

export function formatPrice(p) {
  if (!p) return '$0';
  if (p >= 1) return `$${p.toFixed(2)}`;
  const zeros = Math.max(0, -Math.floor(Math.log10(p)) - 1);
  if (zeros >= 4) {
    // $0.0₅4231 style, like DexScreener.
    const sub = String(zeros).split('').map((d) => '₀₁₂₃₄₅₆₇₈₉'[d]).join('');
    return `$0.0${sub}${Math.round(p * 10 ** (zeros + 4))}`;
  }
  return `$${p.toFixed(zeros + 4)}`;
}

export function formatUsd(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function formatPct(n) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}
