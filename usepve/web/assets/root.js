(() => {
  const {$, esc, api, nf, sol, usd, pct, ago, avatar, ringFor, solscan, short, copy, countTo} = HL;
  const S = window.SITE, T = S.t || {};
  const mint = new URLSearchParams(location.search).get('mint') || '';
  const R = {d: null, first: true};
  const feedRow = e => {
    if (e.kind === 'pay') return `<a href="${solscan('tx', e.sig)}" target="_blank" rel="noopener"><span class="ic">↗</span><div class="tx"><b>${sol(e.lamports, 3)}</b><span>paid to ${e.holders} ${T.builderWord || 'pair builder'}${e.holders === 1 ? '' : 's'}</span></div><span class="t">${ago(e.t)}</span></a>`;
    if (e.kind === 'pair') return `<a href="/p?mint=${esc(e.pair)}"><span class="ic b">+</span><div class="tx"><b>$${esc(e.pair_symbol || '')} paired</b><span>launched on ${esc(S.brand)}</span></div><span class="t">${ago(e.t)}</span></a>`;
    if (e.kind === 'split') return `<a href="#"><span class="ic b">÷</span><div class="tx"><b>${sol(e.lamports, 3)} split</b><span>over ${e.pairs || e.holders} pairs by root locked × time</span></div><span class="t">${ago(e.t)}</span></a>`;
    if (e.kind === 'launch') return `<a href="${e.sig ? solscan('tx', e.sig) : '#'}" target="_blank" rel="noopener"><span class="ic b">★</span><div class="tx"><b>Launched</b><span>fee split locked on chain</span></div><span class="t">${ago(e.t)}</span></a>`;
    if (e.kind === 'collect') return `<a href="${solscan('tx', e.sig)}" target="_blank" rel="noopener"><span class="ic b">↘</span><div class="tx"><b>${sol(e.lamports, 3)}</b><span>creator fees collected</span></div><span class="t">${ago(e.t)}</span></a>`;
    return '';
  };
  const load = async () => {
    const d = R.d = await api('/api/root' + (mint ? '?mint=' + encodeURIComponent(mint) : ''));
    if (!d.ok) { $('[data-name]').textContent = d.offline ? 'Not reachable' : 'Not found'; $('[data-sub]').innerHTML = `<span class="dim">${esc(d.error)}</span>`; $('[data-pairs]').innerHTML = '<tr><td colspan="6" class="empty">–</td></tr>'; $('[data-feed]').innerHTML = '<div class="empty">–</div>'; return; }
    const r = d.root, su = d.sol_usd;
    document.title = `$${r.symbol} · ${S.brand}`;
    if (R.first) {
      $('[data-head] .av').outerHTML = avatar(r.mint, 'av xl');
      $('[data-name]').textContent = r.name || '$' + r.symbol;
      $('[data-sub]').innerHTML = `<span class="badge blue">$${esc(r.symbol)}</span><span class="badge">${T.rootBadge || 'Root'}</span><button class="badge mono" data-cp style="border:0;cursor:pointer">${short(r.mint, 5)} · copy</button>`;
      $('[data-cp]').onclick = () => copy(r.mint, 'Address copied');
      $('[data-acts]').innerHTML = `<a class="pill blue" href="/launch?type=pair&root=${esc(r.mint)}">${T.pairItBtn || 'Pair this coin'} <span class="arr">→</span></a><a class="pill" href="https://pump.fun/coin/${esc(r.mint)}" target="_blank" rel="noopener">pump.fun</a><a class="pill" href="${solscan('token', r.mint)}" target="_blank" rel="noopener">Solscan</a>`;
      $('[data-pairit]').href = `/launch?type=pair&root=${encodeURIComponent(r.mint)}`;
      R.first = false;
    }
    $('[data-s="mcap"]').textContent = usd(r.mcap_lamports, su);
    countTo($('[data-s="locked"]'), r.locked_pct, {d: 1, post: '%'});
    $('[data-s="pairs"]').textContent = nf(r.pairs);
    $('[data-s="pairsk"]').textContent = `pairs · ${r.pairs_counted} counted`;
    $('[data-s="sent"]').textContent = sol(r.sent, 2);
    $('[data-bps]').textContent = (r.pairs_bps / 100) + '%';
    $('[data-bpsk]').textContent = r.pairs_bps >= 10000 ? 'of every creator fee goes to the pair builders' : `to the pair builders, ${100 - r.pairs_bps / 100}% to its launcher`;
    setTimeout(() => { $('[data-bpsb]').style.width = (r.pairs_bps / 100) + '%'; $('[data-bpsb]').style.background = 'var(--accent2)'; }, 200);
    $('[data-kv]').innerHTML = [['Collected', sol(r.collected, 3)], ['Waiting to be paid', sol(r.waiting, 3)], ['Builders paid', nf(r.builders_paid)],
      ['A pair counts from', sol(r.floor_lamports, 2) + ' locked'], ['Payout wallet', `<a class="mono" href="${solscan('account', d.treasury)}" target="_blank" rel="noopener">${short(d.treasury, 4)}</a>`]].map(([k, x]) => `<div><span>${k}</span><span>${x}</span></div>`).join('');
    const prs = d.pairs;
    $('[data-pairstitle]').textContent = `${T.pairsWord || 'Pairs'} (${prs.length})`;
    $('[data-pairs]').innerHTML = prs.length ? prs.map((p, i) => `<tr onclick="location.href='/p?mint=${esc(p.mint)}'" style="cursor:pointer"><td class="rank">${i + 1}</td>
        <td><div class="who">${avatar(p.mint)}<div><b>$${esc(p.symbol)}</b><span>${p.launched_here ? 'launched here' : 'launched elsewhere'}${p.complete ? ' · graduated' : ''}</span></div></div></td>
        <td class="r"><b>${usd(p.locked_lamports, su)}</b>${p.counted ? '' : '<div class="dim" style="font-size:12px">below the line</div>'}</td>
        <td class="r hide-sm"><span style="display:inline-flex;align-items:center;gap:8px">${ringFor(p.mult, 20, 3)}${nf(p.mult, 2)}x</span></td>
        <td class="r"><div class="sharebar"><span>${pct(p.share * 100)}</span><div class="meter hide-sm"><i style="width:${Math.min(100, p.share * 100)}%"></i></div></div></td>
        <td class="r" style="color:var(--good);font-weight:600">${sol(p.earned, 2)}</td></tr>`).join('')
      : `<tr><td colspan="6" class="empty">No pair yet. The first pair gets the whole pot. <a href="/launch?type=pair&root=${esc(r.mint)}" style="color:var(--accent);font-weight:600">Build it →</a></td></tr>`;
    const ev = d.events.map(feedRow).filter(Boolean).slice(0, 12);
    $('[data-feed]').innerHTML = ev.length ? ev.join('') : '<div class="empty">Nothing yet. Collections and payouts show up here.</div>';
  };
  const tick = () => {
    const d = R.d; if (!d || !d.ok || !d.last_tick) return;
    const left = Math.max(0, d.last_tick + d.interval_s - Date.now() / 1000);
    $('[data-next]').textContent = left > 1 ? `next payout in ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : 'payout round running';
  };
  load(); setInterval(load, 20000); setInterval(tick, 1000);
})();
