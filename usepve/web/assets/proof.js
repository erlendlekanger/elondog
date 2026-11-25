(() => {
  const {$, $$, esc, api, sol, ago, solscan, short} = HL;
  const T = (window.SITE.t || {});
  let kind = '';
  const WHAT = {pay: ['Paid', 'good'], collect: ['Collected', 'blue'], split: ['Split', ''], pair: ['New pair', 'blue'], launch: ['Launch', 'blue'], claim: ['Claimed', ''], swap: ['Swapped', ''], setup: ['Setup', ''], pay_failed: ['Payout retry', ''], skip: ['Skipped', '']};
  const load = async () => {
    const d = await api('/api/proof?limit=200' + (kind ? '&kind=' + kind : ''));
    if (!d.ok) { $('[data-rows]').innerHTML = `<tr><td colspan="5" class="empty">${esc(d.error)}</td></tr>`; return; }
    const t = d.totals;
    $('[data-s="collected"]').textContent = sol(t.collected, 3); $('[data-s="sent"]').textContent = sol(t.sent, 3);
    $('[data-s="fees"]').textContent = sol(t.fees, 4); $('[data-s="waiting"]').textContent = sol(t.waiting, 3);
    if (d.treasury) { const a = $('[data-treasury]'); a.href = solscan('account', d.treasury); a.textContent = `Payout wallet · ${sol(d.treasury_lamports, 2)}`; }
    $('[data-rows]').innerHTML = d.events.length ? d.events.map(e => {
      const [w, c] = WHAT[e.kind] || [e.kind, ''];
      const coin = e.pair_symbol ? `$${esc(e.pair_symbol)} / $${esc(e.coin_symbol || '')}` : e.coin_symbol ? '$' + esc(e.coin_symbol) : '–';
      const amt = e.lamports != null ? sol(e.lamports, 4) : e.raw != null ? e.raw + ' raw' : '–';
      const extra = e.kind === 'pay' ? ` <span class="dim" style="font-size:12.5px">to ${e.holders} ${T.builderWord || 'builder'}${e.holders === 1 ? '' : 's'}</span>` : e.kind === 'split' ? ` <span class="dim" style="font-size:12.5px">over ${e.pairs || e.holders} pairs</span>` : '';
      return `<tr><td class="mono dim" style="font-size:13px">${ago(e.t)} ago</td><td><span class="badge ${c}">${w}</span>${extra}</td><td>${coin}</td><td class="r"><b>${amt}</b></td>
        <td class="r">${e.sig ? `<a class="mono" style="font-size:13px;color:var(--accent)" href="${solscan('tx', e.sig)}" target="_blank" rel="noopener">${short(e.sig, 6)}</a>` : '–'}</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty">Nothing yet. The first collection shows up here.</td></tr>';
  };
  $('[data-kind]').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; $$('[data-kind] button').forEach(x => x.classList.toggle('on', x === b)); load(); });
  load(); setInterval(load, 30000);
})();
