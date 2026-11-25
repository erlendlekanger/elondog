(() => {
  const {$, esc, api, nf, sol, pct, avatar, ringFor, held} = HL;
  let addr = new URLSearchParams(location.search).get('address') || '';
  const look = async a => {
    addr = (a || '').trim(); if (!addr) return;
    $('[data-addr]').value = addr;
    $('[data-list]').innerHTML = '<div class="empty card">Loading…</div>';
    const d = await api('/api/wallet?address=' + encodeURIComponent(addr));
    if (!d.ok) { $('[data-list]').innerHTML = `<div class="empty card">${esc(d.error)}</div>`; return; }
    const rows = d.coins;
    $('[data-s="coins"]').textContent = nf(rows.filter(r => r.amount > 0).length);
    $('[data-s="mult"]').textContent = rows.length ? nf(Math.max(...rows.map(r => r.mult)), 2) + 'x' : '–';
    $('[data-s="owed"]').textContent = sol(rows.reduce((s, r) => s + r.owed, 0), 3);
    $('[data-s="paid"]').textContent = sol(rows.reduce((s, r) => s + r.paid, 0), 3);
    $('[data-list]').innerHTML = rows.length ? `<div class="card pad tscroll" style="padding:10px 16px"><table class="tbl"><thead><tr><th>Coin</th><th class="r hide-sm">Holding</th><th class="r">Held for</th><th class="r">Multiplier</th><th class="r">Share</th><th class="r hide-sm">Waiting</th><th class="r">Paid</th></tr></thead><tbody>${rows.map(r => `<tr onclick="location.href='/c?mint=${esc(r.coin)}'" style="cursor:pointer">
        <td><div class="who">${avatar(r.coin)}<div><b>$${esc(r.symbol)}</b><span>${r.counted ? 'counted' : 'below 0.1% of the supply'}</span></div></div></td><td class="r hide-sm">${pct(r.amount / (r.supply || 1) * 100, 2)}</td><td class="r">${held(r.age_s)}</td>
        <td class="r"><span style="display:inline-flex;align-items:center;gap:8px">${ringFor(r.mult, 20, 3)}${nf(r.mult, 2)}x</span></td><td class="r">${pct(r.share * 100, 2)}</td><td class="r hide-sm">${sol(r.owed, 3)}</td><td class="r" style="color:var(--good);font-weight:600">${sol(r.paid, 3)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty card">This wallet holds no coin launched on Hold yet. <a href="/explore" class="grad" style="font-weight:700">Explore coins →</a></div>';
    const u = new URL(location.href); u.searchParams.set('address', addr); history.replaceState(null, '', u);
  };
  $('[data-go]').addEventListener('click', () => look($('[data-addr]').value));
  $('[data-addr]').addEventListener('keydown', e => { if (e.key === 'Enter') look(e.target.value); });
  HL.onWallet(W => { if (W.account && !addr) look(W.account.address); });
  if (addr) look(addr);
})();
