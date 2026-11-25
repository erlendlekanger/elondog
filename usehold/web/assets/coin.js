(() => {
  const {$, esc, api, nf, sol, usd, pct, ago, avatar, ringFor, solscan, short, copy, held} = HL;
  const mint = new URLSearchParams(location.search).get('mint') || '';
  const C = {first: true, last: null, iv: 360};
  const load = async () => {
    const [d, all] = await Promise.all([api('/api/coin?mint=' + encodeURIComponent(mint)), api('/api/coins')]);
    if (all.ok) { C.last = all.last_tick; C.iv = all.interval_s; }
    if (!d.ok) { $('[data-name]').textContent = d.offline ? 'Not reachable' : 'Not found'; $('[data-sub]').innerHTML = `<span class="dim">${esc(d.error)}</span>`; $('[data-holders]').innerHTML = '<tr><td colspan="7" class="empty">–</td></tr>'; $('[data-feed]').innerHTML = '<div class="empty">–</div>'; return; }
    const c = d.coin, su = d.sol_usd, paysIn = c.paid_in && c.paid_in.symbol || 'SOL';
    document.title = `$${c.symbol} · Hold`;
    if (C.first) {
      $('[data-head] .av').outerHTML = avatar(c.mint, 'av xl');
      $('[data-name]').textContent = c.name || '$' + c.symbol;
      $('[data-sub]').innerHTML = `<span class="badge blue">$${esc(c.symbol)}</span><span class="badge">pays ${esc(paysIn)}</span><button class="badge mono" data-cp style="border:0;cursor:pointer">${short(c.mint, 5)} · copy</button>`;
      $('[data-cp]').onclick = () => copy(c.mint, 'Address copied');
      $('[data-acts]').innerHTML = `<a class="pill blue" href="https://pump.fun/coin/${esc(c.mint)}" target="_blank" rel="noopener">Buy on pump.fun <span class="arr">→</span></a><a class="pill" href="${solscan('token', c.mint)}" target="_blank" rel="noopener">Solscan</a>`;
      C.first = false;
    }
    $('[data-s="mcap"]').textContent = usd(c.mcap_lamports, su);
    $('[data-s="holders"]').textContent = nf(c.holders);
    $('[data-s="mult"]').innerHTML = `<span style="display:inline-flex;align-items:center;gap:10px">${ringFor(c.avg_mult || 1, 30, 4)}${nf(c.avg_mult || 1, 2)}x</span>`;
    $('[data-s="multk"]').textContent = `average multiplier · held ${held(c.avg_hold_s)} on average`;
    $('[data-s="sent"]').textContent = sol(c.sent, 2);
    $('[data-paysk]').textContent = `of its creator fees to its holders, paid in ${paysIn}`;
    $('[data-kv]').innerHTML = [['Collected', sol(c.collected, 3)], ['Waiting to be paid', sol(c.waiting, 3)], ['Holders paid so far', nf(c.holders_paid)], ['Last payout', c.last_payout_at ? ago(c.last_payout_at) + ' ago' : '–'],
      ['Payout wallet', `<a class="mono" href="${solscan('account', d.treasury)}" target="_blank" rel="noopener">${short(d.treasury, 4)}</a>`]].map(([k, x]) => `<div><span>${k}</span><span>${x}</span></div>`).join('');
    const sup = c.supply || 1;
    $('[data-holders]').innerHTML = d.holders.length ? d.holders.map((h, i) => `<tr><td class="rank">${i + 1}</td>
        <td><a class="mono" style="font-size:13.5px" href="/me?address=${esc(h.owner)}">${short(h.owner, 5)}</a></td><td class="r hide-sm">${pct(h.amount / sup * 100, 2)}</td><td class="r">${held(h.age_s)}</td>
        <td class="r"><span style="display:inline-flex;align-items:center;gap:8px">${ringFor(h.mult, 20, 3)}${nf(h.mult, 2)}x</span></td>
        <td class="r"><div class="sharebar"><span>${pct(h.share * 100, 2)}</span><div class="meter hide-sm"><i style="width:${Math.min(100, h.share * 100 * 2)}%"></i></div></div></td><td class="r hide-sm" style="color:var(--good)">${sol(h.paid, 3)}</td></tr>`).join('')
      : '<tr><td colspan="7" class="empty">No wallet holds 0.1% of the supply yet.</td></tr>';
    const ev = d.events.filter(e => ['pay', 'collect', 'launch', 'split'].includes(e.kind)).slice(0, 10);
    $('[data-feed]').innerHTML = ev.length ? ev.map(e => e.kind === 'pay' ? `<a href="${solscan('tx', e.sig)}" target="_blank" rel="noopener"><span class="ic">↗</span><div class="tx"><b>${sol(e.lamports, 3)}</b><span>paid to ${e.holders} holders</span></div><span class="t">${ago(e.t)}</span></a>`
      : e.kind === 'collect' ? `<a href="${solscan('tx', e.sig)}" target="_blank" rel="noopener"><span class="ic b">↘</span><div class="tx"><b>${sol(e.lamports, 3)}</b><span>creator fees collected</span></div><span class="t">${ago(e.t)}</span></a>`
      : e.kind === 'split' ? `<a href="#"><span class="ic b">÷</span><div class="tx"><b>${sol(e.lamports, 3)} split</b><span>over ${e.holders} holders</span></div><span class="t">${ago(e.t)}</span></a>`
      : `<a href="${e.sig ? solscan('tx', e.sig) : '#'}" target="_blank" rel="noopener"><span class="ic b">★</span><div class="tx"><b>Launched</b><span>fee split locked to the holders</span></div><span class="t">${ago(e.t)}</span></a>`).join('') : '<div class="empty">Collections and payouts show up here.</div>';
  };
  setInterval(() => {
    if (!C.last) return;
    const left = Math.max(0, C.last + C.iv - Date.now() / 1000);
    $('[data-next]').textContent = left > 1 ? `next payout in ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : 'payout round running';
  }, 1000);
  load(); setInterval(load, 20000);
})();
