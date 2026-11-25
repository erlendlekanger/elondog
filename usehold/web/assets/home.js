/* Hold home: the pinned ring, the lighting paragraph, time-vs-size bars, the bento, and the live coins and payouts. */
(() => {
  const {$, $$, esc, api, nf, sol, usd, ago, avatar, ringFor, mult, countTo, reduced, solscan, held} = HL;
  const GS = window.gsap && window.ScrollTrigger && !reduced;

  /* ------------------------------------------------------------ the ring: 30 days of holding, scrubbed by scroll */
  (() => {
    const sc = $('[data-ringscene]');
    const C = 2 * Math.PI * 84;
    const ticks = $('[data-ticks]');
    ticks.innerHTML = Array.from({length: 60}, (_, i) => { const a = i / 60 * 2 * Math.PI, r1 = 96, r2 = i % 5 ? 99 : 102;
      return `<line class="tick" x1="${100 + Math.cos(a) * r1}" y1="${100 + Math.sin(a) * r1}" x2="${100 + Math.cos(a) * r2}" y2="${100 + Math.sin(a) * r2}" stroke-width="${i % 5 ? .8 : 1.6}"/>`; }).join('');
    const caps = $$('.cap', sc);
    const set = k => {
      const days = 30 * k, m = mult(days);
      $('[data-arc]').setAttribute('stroke-dashoffset', (C * (1 - (m - 1) / 9)).toFixed(2));
      $('[data-mult]').textContent = m.toFixed(2);
      $('[data-days]').textContent = days < 1 ? Math.round(days * 24) + ' hours' : Math.round(days) + ' days';
      $('[data-share]').textContent = `${nf(m, 1)}x a fresh buy`;
      $('[data-bag]').textContent = 'same coins';
      const i = days < .7 ? 0 : days < 5 ? 1 : days < 20 ? 2 : 3;
      caps.forEach((c, j) => c.classList.toggle('on', j === i));
    };
    if (GS) ScrollTrigger.create({trigger: sc, start: 'top top', end: '+=220%', pin: $('.stage', sc), scrub: .5, onUpdate: s => set(s.progress)});
    else { let k = 0; setInterval(() => { k = (k + .01) % 1; set(k); }, 60); }
    set(0);
  })();

  /* ------------------------------------------------------------ the paragraph lights up word by word */
  (() => {
    const p = $('[data-readout]');
    let html = '', inG = false;
    p.innerHTML.split(/(<g>|<\/g>)/).forEach(part => {
      if (part === '<g>') { inG = true; return; }
      if (part === '</g>') { inG = false; return; }
      html += part.split(/(\s+)/).map(w => w.trim() ? `<span class="wd${inG ? ' g' : ''}">${w}</span>` : w).join('');
    });
    p.innerHTML = html;
    const ws = $$('.wd', p);
    const light = k => { const n = Math.round(k * ws.length); ws.forEach((w, i) => w.classList.toggle('lit', i < n)); };
    if (GS) ScrollTrigger.create({trigger: p, start: 'top 80%', end: 'bottom 45%', scrub: true, onUpdate: s => light(s.progress)});
    else light(1);
  })();

  /* ------------------------------------------------------------ time vs size */
  $('[data-versus]').addEventListener('reveal', () => {}, {once: true});
  const vio = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; vio.disconnect();
    $$('[data-w]').forEach(i => { i.style.width = i.dataset.w + '%'; });
    $$('[data-pc]').forEach(s => countTo(s, +s.dataset.pc, {d: 1, dur: 1600}));
  }), {threshold: .4});
  vio.observe($('[data-versus]'));

  /* ------------------------------------------------------------ bento */
  (() => {
    const r = $('[data-reset]');
    r.innerHTML = Array.from({length: 18}, () => '<i></i>').join('');
    const bars = $$('i', r);
    let t = 0;
    setInterval(() => {
      t = (t + 1) % 26;
      bars.forEach((b, i) => { const h = t < 18 ? (i <= t ? 18 + i * 4.4 : 6) : 6; b.style.height = h + 'px'; b.style.transition = t < 18 ? 'height .5s' : 'height .25s'; b.style.opacity = t >= 18 ? .25 : .9; });
    }, 160);
    HL.api('/api/pairs').then(d => {
      if (!d.ok || !d.pairs) return;
      $('[data-tiles]').innerHTML = d.pairs.slice(0, 12).map(p => `<span>${p.logo ? `<img src="${esc(p.logo)}" alt="" loading="lazy" onerror="this.remove()">` : '<i style="font-style:normal;width:22px;height:22px;display:grid;place-items:center">◎</i>'}${esc(p.symbol)}</span>`).join('') + (d.pairs.length > 12 ? `<span>+${d.pairs.length - 12} more</span>` : '');
    });
  })();

  /* ------------------------------------------------------------ live */
  const L = {last: null, iv: 360};
  setInterval(() => {
    const el = $('[data-clock]');
    if (!L.last) { el.textContent = Math.floor(L.iv / 60) + ':00'; return; }
    const left = Math.max(0, L.last + L.iv - Date.now() / 1000);
    el.textContent = left > 1 ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : 'now';
  }, 1000);
  const coinCard = (c, su) => `<a class="card coinc glow rv" href="/c?mint=${esc(c.mint)}">
      <div class="hd">${avatar(c.mint, 'av lg')}<div><b style="font-size:17px">$${esc(c.symbol)}</b><div class="dim" style="font-size:13px">${esc(c.name)}</div></div><span class="badge blue" style="margin-left:auto">${c.pair && c.pair.symbol !== 'SOL' ? 'pays ' + esc(c.pair.symbol) : 'pays SOL'}</span></div>
      <div><div class="label">Market cap</div><div class="mc">${usd(c.mcap_lamports, su)}</div></div>
      <div style="display:flex;align-items:center;gap:12px">${ringFor(c.avg_mult || 1, 34, 4)}<div><b>${nf(c.avg_mult || 1, 2)}x</b><div class="dim" style="font-size:12.5px">average multiplier · ${c.holders} holders</div></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="badge good">${sol(c.sent, 2)} paid</span><span class="badge">avg hold ${held(c.avg_hold_s)}</span></div></a>`;
  const load = async () => {
    const d = await api('/api/coins');
    if (!d.ok) {
      $('[data-coins]').innerHTML = `<div class="empty card" style="grid-column:1/-1">${d.offline ? 'Live coins show up here when the payout desk is reachable.' : esc(d.error)}</div>`;
      $('[data-feed]').innerHTML = '<div class="empty">–</div>';
      return;
    }
    L.last = d.last_tick; L.iv = d.interval_s || 360;
    const su = d.sol_usd, t = d.totals;
    const coins = d.coins.sort((a, b) => b.mcap_lamports - a.mcap_lamports).slice(0, 6);
    $('[data-coins]').innerHTML = coins.length ? coins.map(c => coinCard(c, su)).join('') : `<div class="empty card" style="grid-column:1/-1">No coin yet. <a href="/launch" class="grad" style="font-weight:700">Launch the first →</a></div>`;
    HL.reveal($('[data-coins]'));
    const ev = d.events.filter(e => e.kind === 'pay' || e.kind === 'launch').slice(0, 7);
    $('[data-feed]').innerHTML = ev.length ? ev.map(e => e.kind === 'pay'
      ? `<a href="${solscan('tx', e.sig)}" target="_blank" rel="noopener"><span class="ic">↗</span><div class="tx"><b>${sol(e.lamports, 3)}</b><span>paid to ${e.holders} holders of $${esc(e.coin_symbol || '')}</span></div><span class="t">${ago(e.t)}</span></a>`
      : `<a href="/c?mint=${esc(e.coin)}"><span class="ic b">★</span><div class="tx"><b>$${esc(e.coin_symbol || '')} launched</b><span>fee split locked to its holders</span></div><span class="t">${ago(e.t)}</span></a>`).join('') : '<div class="empty">Payouts show up here every six minutes.</div>';
    $('[data-totals]').innerHTML = [['Coins', nf(t.coins)], ['Fees collected', sol(t.collected, 3)], ['Paid to holders', sol(t.sent, 3)], ['Holders paid', nf(t.holders_paid)], ['Payouts', nf(t.payouts)]].map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('');
  };
  load(); setInterval(load, 30000);
})();
