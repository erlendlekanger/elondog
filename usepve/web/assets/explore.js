(() => {
  const {$, $$, esc, api, nf, sol, usd, pct, avatar, countTo, ringFor} = HL;
  const S = window.SITE, T = S.t || {};
  const qs = new URLSearchParams(location.search);
  const E = {view: qs.get('view') === 'pairs' ? 'pairs' : 'roots', sort: '', d: null};
  const SORTS = {roots: [['mcap', 'Market cap'], ['locked', 'Most locked'], ['pairs', 'Most pairs'], ['new', 'Newest']],
                 pairs: [['locked', 'Most locked'], ['share', 'Biggest share'], ['earned', 'Most earned'], ['new', 'Newest']]};
  const rootCard = (r, su) => `<a class="card rootc glow" href="/r?mint=${esc(r.mint)}">
      <div class="hd">${avatar(r.mint, 'av lg')}<div><b>$${esc(r.symbol)}</b><div class="dim" style="font-size:13px">${esc(r.name)}</div></div><span class="badge blue" style="margin-left:auto">${r.pairs} pairs</span></div>
      <div><div class="label">Market cap</div><div class="mc">${usd(r.mcap_lamports, su)}</div></div>
      <div class="lk"><div class="t"><span>Locked in pairs</span><b style="color:var(--ink)">${pct(r.locked_pct)}</b></div><div class="meter"><i style="width:${Math.min(100, r.locked_pct * 1.6)}%"></i></div></div>
      <div class="ft"><span class="badge good">${sol(r.sent, 2)} to builders</span><span class="badge">${r.pairs_bps / 100}% of fees to pairs</span></div></a>`;
  const pairRow = (p, i, su) => `<tr onclick="location.href='/p?mint=${esc(p.mint)}'" style="cursor:pointer"><td class="rank">${i + 1}</td>
      <td><div class="who">${avatar(p.mint)}<div><b>$${esc(p.symbol)}</b><span>${esc(p.name)}</span></div></div></td>
      <td class="hide-sm"><a href="/r?mint=${esc(p.root)}" onclick="event.stopPropagation()" class="badge blue">$${esc(p.root_symbol)}</a></td>
      <td class="r"><b>${usd(p.locked_lamports, su)}</b>${p.counted ? '' : '<div class="dim" style="font-size:12px">below the line</div>'}</td>
      <td class="r hide-sm"><span style="display:inline-flex;align-items:center;gap:8px">${ringFor(p.mult, 20, 3)}${nf(p.mult, 2)}x</span></td>
      <td class="r"><div class="sharebar"><span>${pct(p.share * 100)}</span><div class="meter hide-sm"><i style="width:${Math.min(100, p.share * 100)}%"></i></div></div></td>
      <td class="r" style="color:var(--good);font-weight:600">${sol(p.earned, 2)}</td></tr>`;
  function paint() {
    const d = E.d;
    $('[data-sort]').innerHTML = SORTS[E.view].map(([k, t]) => `<button data-k="${k}" class="${k === E.sort ? 'on' : ''}">${t}</button>`).join('');
    $$('[data-view] button').forEach(b => b.classList.toggle('on', b.dataset.t === E.view));
    if (!d) return;
    if (!d.ok) { $('[data-list]').innerHTML = `<div class="empty card">${esc(d.offline ? 'Live roots and pairs show up here when the payout desk is reachable.' : d.error)}</div>`; return; }
    const su = d.sol_usd;
    if (E.view === 'roots') {
      const f = {mcap: r => -r.mcap_lamports, locked: r => -r.locked_pct, pairs: r => -r.pairs, new: r => -(r.created_at || 0)}[E.sort];
      const rows = [...d.roots].sort((a, b) => f(a) - f(b));
      $('[data-list]').innerHTML = rows.length ? `<div class="grid3">${rows.map(r => rootCard(r, su)).join('')}</div>` : `<div class="empty card">${T.noRoots || 'No root has launched yet.'} <a href="/launch?type=root" style="color:var(--accent);font-weight:600">Launch the first →</a></div>`;
    } else {
      const f = {locked: p => -p.locked_lamports, share: p => -p.share, earned: p => -p.earned, new: p => -(p.created_at || 0)}[E.sort];
      const rows = [...d.pairs].sort((a, b) => f(a) - f(b));
      $('[data-list]').innerHTML = rows.length ? `<div class="card pad tscroll" style="padding:10px 16px"><table class="tbl"><thead><tr><th>#</th><th>Pair</th><th class="hide-sm">Root</th><th class="r">Locked</th><th class="r hide-sm">Multiplier</th><th class="r">Share now</th><th class="r">Earned</th></tr></thead><tbody>${rows.map((p, i) => pairRow(p, i, su)).join('')}</tbody></table></div>`
        : `<div class="empty card">No pair yet. <a href="/launch?type=pair" style="color:var(--accent);font-weight:600">Build the first →</a></div>`;
    }
  }
  $('[data-view]').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; E.view = b.dataset.t; E.sort = SORTS[E.view][0][0]; paint(); });
  $('[data-sort]').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; E.sort = b.dataset.k; paint(); });
  E.sort = SORTS[E.view][0][0];
  paint();
  HL.cfgReady.then(cfg => {
    if (!cfg || !cfg.single_root) return;
    E.single = true; E.view = 'pairs'; E.sort = 'locked';
    $('[data-view]').classList.add('hidden');
    $('[data-s="roots"]').nextElementSibling.textContent = T.lockedLabel || 'of the root locked in pairs';
    paint();
  });
  const load = async () => {
    E.d = await api('/api/roots');
    if (E.d.ok) {
      const t = E.d.totals;
      if (E.single && E.d.roots[0]) countTo($('[data-s="roots"]'), E.d.roots[0].locked_pct, {d: 1, post: '%'}); else countTo($('[data-s="roots"]'), E.d.roots.length);
      countTo($('[data-s="pairs"]'), t.pairs || 0);
      countTo($('[data-s="collected"]'), (t.collected || 0) / 1e9, {d: 2, post: ' SOL'}); countTo($('[data-s="sent"]'), (t.sent || 0) / 1e9, {d: 2, post: ' SOL'});
    }
    paint();
  };
  load(); setInterval(load, 30000);
})();
