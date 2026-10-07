// Little pump.fun-flavoured "broadcasts" the agent's CRT cycles through between lines:
// an ASCII pill, a pumping candle chart, and a bonding-curve run to King of the Hill.

const GREEN = '#7CFFA0';
const WHITE = '#F4F4F2';
const RED = '#FF5C7A';
const MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
const RAMP = ' .:-=+*#%@';
const GLYPHS = '$%#@*+=01';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);

function capsuleSdf(px, py, ax, ay, bx, by, r) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay));
  const dx = pax - bax * h, dy = pay - bay * h;
  return [Math.hypot(dx, dy) - r, h];
}

export const SHOWS = {
  /** ASCII pill: diagonal capsule, green bottom-left half, white top-right half. */
  pill: {
    duration: 6.5,
    draw(c, S, p, t) {
      const cols = 44;
      const cell = S / cols;
      c.font = `600 ${Math.round(cell * 1.05)}px ${MONO}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const wob = Math.sin(t * 1.3) * 0.12;
      const ang = -Math.PI / 4 + wob;
      const L = 0.56 * ease(p * 2.2); // grows in
      const ax = -Math.cos(ang) * L, ay = -Math.sin(ang) * L;
      const bob = Math.sin(t * 2.1) * 0.03;
      const r = 0.31 * ease(p * 2.2);
      const sweep = ((t * 0.6) % 1.6) - 0.3; // highlight band travelling along the pill
      for (let j = 0; j < cols; j++) {
        for (let i = 0; i < cols; i++) {
          const x = (i + 0.5) / cols * 2 - 1;
          const y = (j + 0.5) / cols * 2 - 1 - 0.08 + bob;
          const [d, h] = capsuleSdf(x, y, ax, ay, -ax, -ay, r);
          if (d > 0.025) continue;
          // fake lighting: thicker in the middle, lit from top-left, glossy sweep
          const depth = clamp(-d / r);
          let b = 0.35 + 0.55 * Math.sqrt(depth) + 0.25 * clamp(-(x + y) * 0.6);
          b += 0.35 * Math.exp(-Math.pow((h - sweep) / 0.08, 2)) * depth;
          if (d > -0.03) b = 1; // crisp outline
          const seam = Math.abs(h - 0.5) < 0.025;
          let ch = RAMP[Math.round(clamp(b) * (RAMP.length - 1))];
          if (Math.random() < 0.015) ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
          if (seam) ch = '/';
          c.fillStyle = h < 0.5 ? GREEN : WHITE;
          c.globalAlpha = seam ? 0.55 : 1;
          c.fillText(ch, (i + 0.5) * cell, (j + 0.5) * cell);
        }
      }
      c.globalAlpha = clamp((p - 0.25) * 4) * (0.65 + 0.35 * Math.sin(t * 6));
      c.fillStyle = GREEN;
      c.font = `600 30px ${MONO}`;
      c.fillText('pump.fun', S / 2, S * 0.9);
      c.globalAlpha = 1;
    },
  },

  /** Candle chart that pumps up and to the right. */
  chart: {
    duration: 7,
    init() {
      const n = 26;
      let v = 1;
      const candles = [];
      for (let i = 0; i < n; i++) {
        const drift = 0.03 + (i / n) * 0.14;
        const move = (Math.random() - 0.38) * 0.22 + drift;
        const o = v;
        v = Math.max(0.6, v * (1 + move));
        const hi = Math.max(o, v) * (1 + Math.random() * 0.08);
        const lo = Math.min(o, v) * (1 - Math.random() * 0.08);
        candles.push({ o, c: v, hi, lo });
      }
      return { candles, max: Math.max(...candles.map((k) => k.hi)), min: Math.min(...candles.map((k) => k.lo)) };
    },
    draw(c, S, p, t, st) {
      const { candles, max, min } = st;
      const x0 = 60, x1 = S - 40, y0 = 120, y1 = S - 80;
      // grid
      c.strokeStyle = 'rgba(124,255,160,0.18)';
      c.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = y0 + ((y1 - y0) * i) / 4;
        c.beginPath();
        c.moveTo(x0, y);
        c.lineTo(x1, y);
        c.stroke();
      }
      const shown = Math.min(candles.length, Math.floor(ease(p * 1.25) * candles.length) + 1);
      const w = (x1 - x0) / candles.length;
      const Y = (v) => y1 - ((Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min))) * (y1 - y0);
      for (let i = 0; i < shown; i++) {
        const k = candles[i];
        const up = k.c >= k.o;
        c.fillStyle = c.strokeStyle = up ? GREEN : RED;
        const x = x0 + i * w + w / 2;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(x, Y(k.hi));
        c.lineTo(x, Y(k.lo));
        c.stroke();
        const top = Y(Math.max(k.o, k.c));
        c.fillRect(x - w * 0.32, top, w * 0.64, Math.max(3, Y(Math.min(k.o, k.c)) - top));
      }
      const last = candles[shown - 1];
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.fillStyle = WHITE;
      c.font = `600 34px ${MONO}`;
      c.fillText('$BUTTHOLE', x0, 78);
      c.fillStyle = GREEN;
      c.textAlign = 'right';
      c.font = `600 22px ${MONO}`;
      c.globalAlpha = 0.6 + 0.4 * Math.sin(t * 5);
      c.fillText('● SCANNING', x1, 70);
      c.globalAlpha = 0.55;
      c.fillStyle = WHITE;
      c.font = `500 16px ${MONO}`;
      c.fillText('ILLUSTRATION', x1, 94);
      c.globalAlpha = 1;
      // pulse dot on the latest price
      const lx = x0 + (shown - 0.5) * w;
      const ly = Y(last.c);
      c.globalAlpha = 0.5 + 0.5 * Math.sin(t * 10);
      c.beginPath();
      c.arc(lx, ly, 9, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
      if (p > 0.82) {
        c.textAlign = 'center';
        c.fillStyle = GREEN;
        c.font = `700 40px ${MONO}`;
        c.globalAlpha = clamp((p - 0.82) * 8) * (Math.sin(t * 14) > -0.3 ? 1 : 0.35);
        c.fillText('SIGNAL FOUND', S / 2, S - 28);
        c.globalAlpha = 1;
      }
    },
  },

  /** Bonding curve fills up -> King of the Hill -> graduated. */
  bonding: {
    duration: 6.5,
    draw(c, S, p, t) {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const fill = ease(clamp(p / 0.6));
      const pct = Math.round(fill * 100);
      c.fillStyle = WHITE;
      c.font = `600 30px ${MONO}`;
      c.fillText('BONDING CURVE', S / 2, S * 0.28);
      const blocks = 16;
      const on = Math.round(fill * blocks);
      c.font = `700 34px ${MONO}`;
      let bar = '';
      for (let i = 0; i < blocks; i++) bar += i < on ? '█' : '░';
      c.fillStyle = GREEN;
      c.fillText(`[${bar}]`, S / 2, S * 0.42);
      c.font = `700 64px ${MONO}`;
      c.fillText(`${pct}%`, S / 2, S * 0.57);
      if (p > 0.62) {
        const blink = Math.sin(t * 12) > -0.2 ? 1 : 0.4;
        c.globalAlpha = clamp((p - 0.62) * 6) * blink;
        c.fillStyle = WHITE;
        c.font = `700 30px ${MONO}`;
        c.fillText('♛ KING OF THE HILL ♛', S / 2, S * 0.72);
        c.globalAlpha = clamp((p - 0.78) * 6);
        c.fillStyle = GREEN;
        c.font = `600 26px ${MONO}`;
        c.fillText('GRADUATED  ✓  LFG', S / 2, S * 0.8);
        c.globalAlpha = 1;
      }
    },
  },

  /** ChatGPT, Claude and Grok passing signals around the pucker until they agree. */
  council: {
    duration: 8,
    init() {
      const feed = [
        ['GROK', 'frog meme trending on X'],
        ['GPT', 'volume +3x in 10 min'],
        ['CLAUDE', 'contract: checking...'],
        ['GROK', 'replies: very bullish'],
        ['GPT', 'holders spreading out'],
        ['CLAUDE', 'liquidity: ok'],
        ['GPT', 'plan: small size'],
        ['CLAUDE', 'risk: acceptable'],
        ['GROK', 'LFG'],
      ];
      return { feed, packets: [] };
    },
    draw(c, S, p, t, st) {
      const cx = S / 2, cy = S * 0.38, R = 128;
      const nodes = [
        { id: 'GPT', a: -Math.PI / 2 },
        { id: 'CLAUDE', a: -Math.PI / 2 + (2 * Math.PI) / 3 },
        { id: 'GROK', a: -Math.PI / 2 + (4 * Math.PI) / 3 },
      ].map((n) => ({ ...n, x: cx + Math.cos(n.a) * R, y: cy + Math.sin(n.a) * R }));
      // links
      c.strokeStyle = 'rgba(124,255,160,0.25)';
      c.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = nodes[i], b = nodes[(i + 1) % 3];
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(cx, cy);
        c.stroke();
      }
      // packets travelling between the three
      for (let k = 0; k < 9; k++) {
        const from = nodes[k % 3], to = nodes[(k + 1 + (k % 2)) % 3];
        const q = (t * 0.9 + k / 9) % 1;
        const x = from.x + (to.x - from.x) * q, y = from.y + (to.y - from.y) * q;
        c.fillStyle = k % 2 ? GREEN : WHITE;
        c.globalAlpha = Math.sin(q * Math.PI);
        c.fillRect(x - 4, y - 4, 8, 8);
      }
      c.globalAlpha = 1;
      // centre: the shared hole
      c.beginPath();
      c.arc(cx, cy, 20 + Math.sin(t * 4) * 3, 0, Math.PI * 2);
      c.strokeStyle = GREEN;
      c.lineWidth = 3;
      c.stroke();
      // nodes
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      nodes.forEach((n, i) => {
        const active = Math.floor(t * 1.5) % 3 === i;
        c.fillStyle = '#000';
        c.strokeStyle = active ? GREEN : WHITE;
        c.lineWidth = 3;
        c.beginPath();
        c.arc(n.x, n.y, 34, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.fillStyle = active ? GREEN : WHITE;
        c.font = `700 ${n.id.length > 4 ? 15 : 20}px ${MONO}`;
        c.fillText(n.id, n.x, n.y);
      });
      // feed
      const shown = Math.min(st.feed.length, Math.floor(p * 1.2 * st.feed.length) + 1);
      const start = Math.max(0, shown - 4);
      c.textAlign = 'left';
      c.font = `500 19px ${MONO}`;
      for (let i = start; i < shown; i++) {
        const [who, msg] = st.feed[i];
        const y = S * 0.73 + (i - start) * 26;
        c.globalAlpha = i === shown - 1 ? 1 : 0.55;
        c.fillStyle = GREEN;
        c.fillText(`${who.padEnd(6)}>`, 40, y);
        c.fillStyle = WHITE;
        c.fillText(msg, 130, y);
      }
      c.globalAlpha = 0.5;
      c.fillStyle = WHITE;
      c.font = `500 14px ${MONO}`;
      c.textAlign = 'right';
      c.fillText('ILLUSTRATION', S - 32, 34);
      c.globalAlpha = 1;
    },
  },

  /** Three votes, one decision. */
  vote: {
    duration: 6.5,
    draw(c, S, p, t) {
      c.textBaseline = 'middle';
      c.textAlign = 'center';
      c.fillStyle = WHITE;
      c.font = `600 30px ${MONO}`;
      c.fillText('VOTE', S / 2, S * 0.22);
      const rows = [['CHATGPT', 'BUY'], ['CLAUDE', 'OK, SMALL'], ['GROK', 'APE']];
      c.font = `600 28px ${MONO}`;
      rows.forEach(([who, v], i) => {
        const y = S * (0.36 + i * 0.11);
        const done = p > 0.15 + i * 0.18;
        c.textAlign = 'left';
        c.fillStyle = WHITE;
        c.fillText(who, 70, y);
        c.textAlign = 'right';
        c.fillStyle = GREEN;
        const dots = '.'.repeat(1 + (Math.floor(t * 4) % 3));
        c.fillText(done ? `${v} ✓` : dots, S - 70, y);
      });
      if (p > 0.72) {
        c.textAlign = 'center';
        c.globalAlpha = clamp((p - 0.72) * 6) * (Math.sin(t * 12) > -0.2 ? 1 : 0.4);
        c.fillStyle = GREEN;
        c.font = `700 40px ${MONO}`;
        c.fillText('CONSENSUS', S / 2, S * 0.78);
        c.globalAlpha = 1;
      }
    },
  },

  /** Scrolling scan feed. */
  ticker: {
    duration: 5,
    draw(c, S, p, t) {
      c.textBaseline = 'middle';
      const rows = ['SCANNING X', 'READING CHARTS', 'CHECKING CONTRACTS', '3 MINDS · 1 HOLE', 'NFA · DYOR', 'LEARNING IN PUBLIC'];
      for (let r = 0; r < 7; r++) {
        const y = S * (0.14 + r * 0.12);
        const speed = (r % 2 ? -1 : 1) * (90 + r * 18);
        const text = `${rows[r % rows.length]}   ·   `.repeat(4);
        c.font = `${r === 3 ? 700 : 500} ${r === 3 ? 44 : 30}px ${MONO}`;
        const w = c.measureText(text).width / 4;
        const x = (((t * speed) % w) + w) % w;
        c.fillStyle = r === 3 ? GREEN : r % 2 ? WHITE : GREEN;
        c.globalAlpha = r === 3 ? 1 : 0.55;
        c.textAlign = 'left';
        c.fillText(text, x - w, y);
      }
      c.globalAlpha = 1;
    },
  },
};

export const SHOW_ORDER = ['council', 'pill', 'chart', 'ticker', 'vote', 'bonding'];
