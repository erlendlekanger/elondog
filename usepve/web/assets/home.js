/* PVE home: the boss panel, PvP vs PvE, the horizontal levels and the live raid board. */
(() => {
  const {$, $$, esc, api, nf, sol, usd, pct, ago, avatar, ringFor, mult, reduced, solscan} = HL;
  const B = {locked: 0, party: [], live: false};

  /* ------------------------------------------------------------ the boss */
  const paintBoss = () => {
    const hp = Math.max(4, 100 - B.locked);                         // the market's HP: the PVE not locked by players
    $('[data-hp]').style.width = hp + '%';
    $('[data-hpg]').style.width = Math.min(100, hp + 1.5) + '%';
    $('[data-hpt]').textContent = `HP ${nf(hp, 1)}%`;
    $('[data-locked]').textContent = pct(B.locked);
    $('[data-party]').innerHTML = B.party.length ? B.party.slice(0, 4).map(p => `<a class="pl" href="/p?mint=${esc(p.mint)}">${avatar(p.mint)}<div><b>$${esc(p.symbol)}</b><div class="bar"><i style="width:${Math.min(100, p.share * 100)}%"></i></div></div><span class="dmg">${pct(p.share * 100)}</span></a>`).join('')
      : `<div class="pl" style="grid-template-columns:1fr"><span class="dim">${B.live ? 'No player yet. The first pair takes the whole drop.' : 'Players show up here when the payout desk is reachable.'}</span></div>`;
  };
  const hit = () => {
    if (reduced || document.hidden) return;
    const box = $('[data-boss]');
    const p = B.party.length ? B.party[Math.floor(Math.random() * Math.min(4, B.party.length))] : null;
    const el = document.createElement('div');
    el.className = 'dmgfx';
    el.textContent = p ? `-${(Math.random() * .4 + .05).toFixed(2)}% · $${p.symbol}` : `-${(Math.random() * .4 + .05).toFixed(2)}%`;
    el.style.left = (20 + Math.random() * 55) + '%'; el.style.top = (24 + Math.random() * 14) + '%';
    box.appendChild(el); setTimeout(() => el.remove(), 1700);
  };
  setInterval(hit, 1500);

  /* ------------------------------------------------------------ scroll scenes */
  if (window.gsap && window.ScrollTrigger && !reduced) {
    gsap.fromTo('[data-pvp]', {opacity: 1, filter: 'saturate(1)'}, {opacity: .35, filter: 'saturate(0)', scrollTrigger: {trigger: '[data-vs]', start: 'top 70%', end: 'center 40%', scrub: true}});
    gsap.fromTo('[data-pvecard]', {scale: .96}, {scale: 1.02, scrollTrigger: {trigger: '[data-vs]', start: 'top 70%', end: 'center 40%', scrub: true}});
    const track = $('[data-track]');
    const dist = () => Math.max(0, track.scrollWidth - innerWidth + 40);
    gsap.to(track, {x: () => -dist(), ease: 'none', scrollTrigger: {trigger: '[data-levels]', start: 'top top', end: () => '+=' + dist(), pin: true, scrub: .6, invalidateOnRefresh: true,
      onUpdate: s => paintLevels(s.progress)}});
  } else {
    $('[data-track]').style.cssText += ';overflow-x:auto;width:auto';
    paintLevels(1);
  }
  function paintLevels(k) {
    const xp = Math.min(1, Math.max(0, (k - .15) / .45));
    $('[data-xp]').style.width = (xp * 100) + '%';
    $('[data-xpt]').textContent = (xp * 4.2).toFixed(2) + '%';
    $('[data-loot]').textContent = '+' + (Math.max(0, (k - .45) / .4) * 1.37).toFixed(2) + ' SOL';
    $('[data-mx]').textContent = mult(9 * Math.min(1, Math.max(0, (k - .6) / .4))).toFixed(2);
  }
  paintLevels(0);

  /* ------------------------------------------------------------ live */
  const load = async () => {
    const d = await api('/api/root');
    if (!d.ok) {
      B.live = false;
      if (!d.offline) { $('[data-phase]').textContent = 'GENESIS SOON'; $('[data-bosslv]').textContent = 'The boss spawns at genesis'; }
      paintBoss();
      $('[data-board]').innerHTML = `<tr><td colspan="5" class="empty">${d.offline ? 'The raid board shows up here when the payout desk is reachable.' : 'PVE has not launched yet. The raid starts at genesis.'}</td></tr>`;
      $('[data-feed]').innerHTML = '<div class="empty">–</div>';
      return;
    }
    B.live = true;
    const r = d.root, su = d.sol_usd;
    B.locked = r.locked_pct; B.party = d.pairs;
    $('[data-phase]').textContent = 'LIVE';
    $('[data-bossname]').textContent = 'The Market';
    $('[data-bosslv]').textContent = `$${r.symbol} · ${usd(r.mcap_lamports, su)} market cap · ${r.pairs} players`;
    paintBoss();
    $('[data-board]').innerHTML = d.pairs.length ? d.pairs.slice(0, 8).map((p, i) => `<tr onclick="location.href='/p?mint=${esc(p.mint)}'" style="cursor:pointer"><td class="rank">${i + 1}</td>
        <td><div class="who">${avatar(p.mint)}<div><b>$${esc(p.symbol)}</b><span>${p.counted ? pct(p.share * 100) + ' of the drop' : 'below the line'}</span></div></div></td>
        <td class="r"><b>${usd(p.locked_lamports, su)}</b></td><td class="r hide-sm"><span style="display:inline-flex;align-items:center;gap:8px">${ringFor(p.mult, 20, 3)}${nf(p.mult, 2)}x</span></td>
        <td class="r" style="color:var(--good);font-weight:600">${sol(p.earned, 2)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">No player yet. The first pair takes the whole drop. <a href="/launch" style="color:var(--accent);font-weight:600">Spawn it →</a></td></tr>';
    const ev = d.events.filter(e => ['pay', 'pair', 'collect'].includes(e.kind)).slice(0, 7);
    $('[data-feed]').innerHTML = ev.length ? ev.map(e => e.kind === 'pay'
      ? `<a href="${solscan('tx', e.sig)}" target="_blank" rel="noopener"><span class="ic">◆</span><div class="tx"><b>${sol(e.lamports, 3)} looted</b><span>by ${e.holders} player${e.holders === 1 ? '' : 's'}</span></div><span class="t">${ago(e.t)}</span></a>`
      : e.kind === 'pair' ? `<a href="/p?mint=${esc(e.pair)}"><span class="ic b">+</span><div class="tx"><b>$${esc(e.pair_symbol || '')} spawned</b><span>a new player</span></div><span class="t">${ago(e.t)}</span></a>`
      : `<a href="${solscan('tx', e.sig)}" target="_blank" rel="noopener"><span class="ic b">↘</span><div class="tx"><b>${sol(e.lamports, 3)}</b><span>dropped by the boss (fees collected)</span></div><span class="t">${ago(e.t)}</span></a>`).join('') : '<div class="empty">Loot drops every ten minutes.</div>';
  };
  paintBoss();
  load(); setInterval(load, 30000);
})();
