/* TryPair home: the orbit in the hero, the pinned story, and the live roots, pairs and payouts. */
(() => {
  const {$, $$, esc, api, nf, compact, sol, usd, ago, pct, avatar, ringFor, mult, countTo, reduced, solscan} = HL;

  /* ------------------------------------------------------------ the orbit: pairs circling a root */
  (() => {
    const box = $('[data-orbit]');
    if (!box) return;
    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs, parent) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); parent && parent.appendChild(el); return el; };
    const pairs = [['SHIB', 150, 0], ['BONE', 150, 2.1], ['PUP', 150, 4.2], ['LEASH', 235, .7], ['BARK', 235, 2.3], ['FETCH', 235, 3.9], ['PAW', 235, 5.4]];
    const spokes = $('[data-spokes]', box), nodes = $('[data-nodes]', box), pkts = $('[data-pkts]', box);
    const N = pairs.map(([s, r, a]) => {
      const line = mk('line', {class: 'spoke'}, spokes);
      const g = mk('g', {class: 'node'}, nodes);
      mk('circle', {class: 'b', r: r > 200 ? 30 : 36}, g);
      const t = mk('text', {y: 4}, g); t.textContent = '$' + s;
      return {s, r, a, line, g};
    });
    const P = Array.from({length: 14}, (_, i) => ({el: mk('circle', {class: i % 3 === 2 ? 'fee' : 'pkt', r: i % 3 === 2 ? 4 : 3.2}, pkts), n: i % N.length, t: Math.random(), fee: i % 3 === 2, v: .25 + Math.random() * .25}));
    let last = performance.now(), rot = 0;
    const frame = now => {
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      if (!reduced) rot += dt * .07;
      N.forEach(n => {
        const a = n.a + rot * (n.r > 200 ? .62 : 1);
        n.x = Math.cos(a) * n.r; n.y = Math.sin(a) * n.r;
        n.g.setAttribute('transform', `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`);
        n.line.setAttribute('x1', 0); n.line.setAttribute('y1', 0); n.line.setAttribute('x2', n.x.toFixed(1)); n.line.setAttribute('y2', n.y.toFixed(1));
      });
      P.forEach(p => {
        p.t += dt * p.v;
        if (p.t > 1) { p.t = 0; p.n = (p.n + 3) % N.length; }
        const n = N[p.n], k = p.fee ? p.t : 1 - p.t;               // buys flow in to the root, fees flow out to the pair
        const r0 = 74, rr = n.r - (n.r > 200 ? 30 : 36);
        const d = r0 + (rr - r0) * k, len = Math.hypot(n.x, n.y) || 1;
        p.el.setAttribute('cx', (n.x / len * d).toFixed(1)); p.el.setAttribute('cy', (n.y / len * d).toFixed(1));
        p.el.setAttribute('opacity', Math.sin(Math.PI * p.t).toFixed(2));
      });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    // the tags tick up slowly
    let lk = 38.4, fee = 1.84;
    setInterval(() => { lk = Math.min(61, lk + Math.random() * .3); fee += Math.random() * .03; $('[data-locked]').textContent = lk.toFixed(1) + '%'; $('[data-fee]').textContent = '+' + fee.toFixed(2) + ' SOL'; }, 1800);
  })();

  /* ------------------------------------------------------------ the pinned story */
  (() => {
    const story = $('[data-story]');
    if (!story) return;
    const sts = $$('.st', story), bars = $$('.prog i', story), chips = $$('[data-c]', story);
    const W = 600, H = 560;
    // a price path that steps up as pairs arrive: flat, then three climbs
    const pts = Array.from({length: 121}, (_, i) => {
      const x = i / 120;
      const lift = [.26, .52, .76].reduce((s, at, j) => s + (1 / (1 + Math.exp(-(x - at) * 38))) * [.18, .2, .24][j], 0);
      const wob = Math.sin(i * 1.7) * .012 + Math.sin(i * .53) * .018;
      return [x * W, H * (.8 - lift - wob)];
    });
    const path = k => {
      const n = Math.max(2, Math.round(k * (pts.length - 1)) + 1), seg = pts.slice(0, n);
      return 'M' + seg.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
    };
    const set = k => {
      const i = Math.min(3, Math.floor(k * 4 * .999));
      sts.forEach((s, j) => s.classList.toggle('on', j === i));
      bars.forEach((b, j) => b.classList.toggle('on', j <= i));
      const d = path(Math.max(.04, k));
      $('[data-px]', story).setAttribute('d', d);
      const endX = pts[Math.max(1, Math.round(Math.max(.04, k) * (pts.length - 1)))][0];
      $('[data-area]', story).setAttribute('d', d + ` L${endX.toFixed(1)} ${H} L0 ${H} Z`);
      const lift = 1 + [.26, .52, .76].reduce((s, at, j) => s + (1 / (1 + Math.exp(-(k - at) * 38))) * [.9, 1.1, 1.6][j], 0);
      $('[data-pr]', story).textContent = (0.0000041 * lift).toFixed(7);
      $('[data-chg]', story).textContent = '+' + Math.round((lift - 1) * 100) + '%';
      const lock = Math.max(0, Math.min(1, (k - .2) / .7)) * 41.6;
      $('[data-lk]', story).textContent = lock.toFixed(1) + '%';
      $('[data-lkb]', story).style.width = (lock / 41.6 * 72) + '%';
      chips.forEach((c, j) => c.classList.toggle('on', k > .26 + j * .17));
      $('[data-flow]', story).classList.toggle('on', i === 3);
    };
    if (window.gsap && window.ScrollTrigger && !reduced) {
      ScrollTrigger.create({trigger: story, start: 'top top', end: '+=260%', pin: $('.stage', story), scrub: .6, onUpdate: s => set(s.progress)});
      set(0);
    } else {
      let k = 0; set(0);
      setInterval(() => { k = (k + .25) % 1.0001; set(Math.min(1, k + .01)); }, 3200);
    }
  })();

  /* the multiplier card climbs while it is on screen */
  (() => {
    const el = $('[data-mx]');
    if (!el) return;
    let t0 = performance.now();
    const tick = t => { requestAnimationFrame(tick); const k = ((t - t0) % 6000) / 6000; el.textContent = mult(9 * Math.min(1, k / .8)).toFixed(2); };
    requestAnimationFrame(tick);
  })();

  /* ------------------------------------------------------------ live data */
  const rootCard = (r, su) => `<a class="card rootc glow rv" href="/r?mint=${esc(r.mint)}">
      <div class="hd">${avatar(r.mint, 'av lg')}<div><b>$${esc(r.symbol)}</b><div class="dim" style="font-size:13px">${esc(r.name)}</div></div><span class="badge blue" style="margin-left:auto">${r.pairs} pairs</span></div>
      <div><div class="label">Market cap</div><div class="mc">${usd(r.mcap_lamports, su)}</div></div>
      <div class="lk"><div class="t"><span>Locked in pairs</span><b style="color:var(--ink)">${pct(r.locked_pct)}</b></div><div class="meter"><i style="width:${Math.min(100, r.locked_pct * 1.6)}%"></i></div></div>
      <div class="ft"><span class="badge good">${sol(r.sent, 2)} to builders</span><span class="badge">${r.pairs_bps / 100}% of fees to pairs</span></div></a>`;
  const pairRow = (p, i, su) => `<tr onclick="location.href='/p?mint=${esc(p.mint)}'" style="cursor:pointer"><td class="rank">${i + 1}</td>
      <td><div class="who">${avatar(p.mint)}<div><b>$${esc(p.symbol)}</b><span>on $${esc(p.root_symbol)}</span></div></div></td>
      <td class="r"><b>${usd(p.locked_lamports, su)}</b></td><td class="r hide-sm">${nf(p.mult, 2)}x</td><td class="r" style="color:var(--good);font-weight:600">${sol(p.earned, 2)}</td></tr>`;
  const feedRow = e => {
    if (e.kind === 'pay') return `<a href="${solscan('tx', e.sig)}" target="_blank" rel="noopener"><span class="ic">↗</span><div class="tx"><b>${sol(e.lamports, 3)}</b><span>paid to ${e.holders} pair builder${e.holders === 1 ? '' : 's'} of $${esc(e.coin_symbol || '')}</span></div><span class="t">${ago(e.t)}</span></a>`;
    if (e.kind === 'pair') return `<a href="/p?mint=${esc(e.pair)}"><span class="ic b">+</span><div class="tx"><b>$${esc(e.pair_symbol || '')} paired</b><span>against $${esc(e.coin_symbol || '')}</span></div><span class="t">${ago(e.t)}</span></a>`;
    if (e.kind === 'launch') return `<a href="/r?mint=${esc(e.coin)}"><span class="ic b">★</span><div class="tx"><b>$${esc(e.coin_symbol || '')} launched</b><span>a new root</span></div><span class="t">${ago(e.t)}</span></a>`;
    return `<a href="${solscan('tx', e.sig)}" target="_blank" rel="noopener"><span class="ic b">↘</span><div class="tx"><b>${sol(e.lamports, 3)}</b><span>fees collected from $${esc(e.coin_symbol || '')}</span></div><span class="t">${ago(e.t)}</span></a>`;
  };
  const load = async () => {
    const d = await api('/api/roots');
    if (!d.ok) {
      $('[data-roots]').innerHTML = `<div class="empty card" style="grid-column:1/-1">${d.offline ? 'Live roots show up here when the payout desk is reachable.' : esc(d.error)}</div>`;
      $('[data-toppairs]').innerHTML = '<tr><td colspan="5" class="empty">–</td></tr>';
      $('[data-feed]').innerHTML = '<div class="empty">–</div>';
      return;
    }
    const su = d.sol_usd, t = d.totals;
    countTo($('[data-m="roots"]'), d.roots.length);
    countTo($('[data-m="pairs"]'), t.pairs || 0);
    countTo($('[data-m="paid"]'), (t.sent || 0) / 1e9, {d: 2, post: ' SOL'});
    const roots = d.roots.sort((a, b) => b.mcap_lamports - a.mcap_lamports).slice(0, 6);
    $('[data-roots]').innerHTML = roots.length ? roots.map(r => rootCard(r, su)).join('') : `<div class="empty card" style="grid-column:1/-1">No root yet. <a href="/launch?type=root" style="color:var(--accent);font-weight:600">Launch the first one →</a></div>`;
    HL.reveal($('[data-roots]'));
    const prs = d.pairs.slice(0, 8);
    $('[data-toppairs]').innerHTML = prs.length ? prs.map((p, i) => pairRow(p, i, su)).join('') : '<tr><td colspan="5" class="empty">No pair yet. The first one locks the most.</td></tr>';
    const ev = d.events.filter(e => ['pay', 'pair', 'launch', 'collect'].includes(e.kind)).slice(0, 7);
    $('[data-feed]').innerHTML = ev.length ? ev.map(feedRow).join('') : '<div class="empty">Payouts show up here every ten minutes.</div>';
  };
  load();
  setInterval(load, 30000);
})();
