(() => {
  const {$, esc, api, nf, sol, usd, pct, avatar, ringFor} = HL;
  const S = window.SITE, T = S.t || {};
  let addr = new URLSearchParams(location.search).get('address') || '';
  const look = async a => {
    addr = (a || '').trim();
    if (!addr) return;
    $('[data-addr]').value = addr;
    $('[data-list]').innerHTML = '<div class="empty card">Loading…</div>';
    const d = await api('/api/wallet?address=' + encodeURIComponent(addr));
    if (!d.ok) { $('[data-list]').innerHTML = `<div class="empty card">${esc(d.error)}</div>`; return; }
    const rows = d.roots, prs = rows.flatMap(r => r.pairs);
    $('[data-s="pairs"]').textContent = nf(prs.length);
    $('[data-s="share"]').textContent = rows.length ? pct(rows.reduce((s, r) => s + r.share, 0) * 100 / Math.max(1, rows.length)) : '–';
    $('[data-s="owed"]').textContent = sol(rows.reduce((s, r) => s + r.owed, 0), 3);
    $('[data-s="paid"]').textContent = sol(rows.reduce((s, r) => s + r.paid, 0), 3);
    $('[data-list]').innerHTML = rows.length ? rows.map(r => `<div class="card pad rv" style="margin-bottom:14px">
        <div class="toolbar"><a class="who" href="/r?mint=${esc(r.root)}" style="display:flex;align-items:center;gap:12px">${avatar(r.root, 'av lg')}<div><b style="font-size:20px">$${esc(r.symbol)}</b><div class="dim" style="font-size:13px">${esc(r.name)}</div></div></a>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="badge blue">${pct(r.share * 100)} of the next payout</span><span class="badge">${sol(r.owed, 3)} waiting</span><span class="badge good">${sol(r.paid, 3)} paid</span></div></div>
        ${r.pairs.length ? `<div class="tscroll"><table class="tbl"><thead><tr><th>Pair</th><th class="r">Locked</th><th class="r hide-sm">Multiplier</th><th class="r">Share</th><th class="r">Earned</th></tr></thead><tbody>${r.pairs.map(p => `<tr onclick="location.href='/p?mint=${esc(p.mint)}'" style="cursor:pointer">
          <td><div class="who">${avatar(p.mint)}<div><b>$${esc(p.symbol)}</b><span>${p.counted ? 'counted' : 'below the line'}</span></div></div></td><td class="r"><b>${usd(p.locked_lamports, null)}</b></td>
          <td class="r hide-sm"><span style="display:inline-flex;align-items:center;gap:8px">${ringFor(p.mult, 20, 3)}${nf(p.mult, 2)}x</span></td><td class="r">${pct(p.share * 100)}</td><td class="r" style="color:var(--good);font-weight:600">${sol(p.earned, 3)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="dim" style="font-size:14px">Paid earlier for pairs that no longer lock this root.</div>'}
      </div>`).join('') : `<div class="empty card">This wallet has not built a pair yet. <a href="/launch?type=pair" style="color:var(--accent);font-weight:600">${T.buildFirst || 'Build your first pair'} →</a></div>`;
    HL.reveal();
    const u = new URL(location.href); u.searchParams.set('address', addr); history.replaceState(null, '', u);
  };
  $('[data-go]').addEventListener('click', () => look($('[data-addr]').value));
  $('[data-addr]').addEventListener('keydown', e => { if (e.key === 'Enter') look(e.target.value); });
  HL.onWallet(W => { if (W.account && !addr) look(W.account.address); });
  if (addr) look(addr);
})();
