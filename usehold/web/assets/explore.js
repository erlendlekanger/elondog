(() => {
  const {$, $$, esc, api, nf, sol, usd, avatar, ringFor, countTo, held} = HL;
  const E = {sort: 'mcap', d: null};
  const card = (c, su) => `<a class="card coinc glow" href="/c?mint=${esc(c.mint)}">
      <div class="hd">${avatar(c.mint, 'av lg')}<div><b style="font-size:17px">$${esc(c.symbol)}</b><div class="dim" style="font-size:13px">${esc(c.name)}</div></div><span class="badge blue" style="margin-left:auto">${c.pair && c.pair.symbol !== 'SOL' ? 'pays ' + esc(c.pair.symbol) : 'pays SOL'}</span></div>
      <div><div class="label">Market cap</div><div class="mc">${usd(c.mcap_lamports, su)}</div></div>
      <div style="display:flex;align-items:center;gap:12px">${ringFor(c.avg_mult || 1, 34, 4)}<div><b>${nf(c.avg_mult || 1, 2)}x</b><div class="dim" style="font-size:12.5px">average multiplier · ${c.holders} holders</div></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="badge good">${sol(c.sent, 2)} paid</span><span class="badge">avg hold ${held(c.avg_hold_s)}</span></div></a>`;
  const paint = () => {
    $$('[data-sort] button').forEach(b => b.classList.toggle('on', b.dataset.k === E.sort));
    const d = E.d; if (!d) return;
    if (!d.ok) { $('[data-list]').innerHTML = `<div class="empty card" style="grid-column:1/-1">${esc(d.offline ? 'Live coins show up here when the payout desk is reachable.' : d.error)}</div>`; return; }
    const f = {mcap: c => -c.mcap_lamports, paid: c => -c.sent, holders: c => -c.holders, hold: c => -c.avg_hold_s, new: c => -(c.created_at || 0)}[E.sort];
    const rows = [...d.coins].sort((a, b) => f(a) - f(b));
    $('[data-list]').innerHTML = rows.length ? rows.map(c => card(c, d.sol_usd)).join('') : `<div class="empty card" style="grid-column:1/-1">No coin yet. <a href="/launch" class="grad" style="font-weight:700">Launch the first →</a></div>`;
  };
  $('[data-sort]').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; E.sort = b.dataset.k; paint(); });
  const load = async () => {
    E.d = await api('/api/coins');
    if (E.d.ok) { const t = E.d.totals; countTo($('[data-s="coins"]'), t.coins); countTo($('[data-s="collected"]'), t.collected / 1e9, {d: 2, post: ' SOL'}); countTo($('[data-s="sent"]'), t.sent / 1e9, {d: 2, post: ' SOL'}); countTo($('[data-s="holders"]'), t.holders_paid); }
    paint();
  };
  load(); setInterval(load, 30000);
})();
