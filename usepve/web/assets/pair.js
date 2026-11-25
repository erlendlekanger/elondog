(() => {
  const {$, esc, api, nf, sol, usd, pct, ago, avatar, ringFor, solscan, short, copy, dur} = HL;
  const S = window.SITE, T = S.t || {};
  const mint = new URLSearchParams(location.search).get('mint') || '';
  let first = true;
  const load = async () => {
    const d = await api('/api/pair?mint=' + encodeURIComponent(mint));
    if (!d.ok) { $('[data-name]').textContent = d.offline ? 'Not reachable' : 'Not found yet'; $('[data-sub]').innerHTML = `<span class="dim">${esc(d.error)}</span>`; $('[data-feed]').innerHTML = '<div class="empty">–</div>'; return; }
    const p = d.pair, r = d.root, su = d.sol_usd;
    document.title = `$${p.symbol} · ${S.brand}`;
    if (first) {
      $('[data-head] .av').outerHTML = avatar(p.mint, 'av xl');
      $('[data-name]').textContent = p.name || '$' + p.symbol;
      $('[data-sub]').innerHTML = `<span class="badge blue">$${esc(p.symbol)}</span><span class="badge">${T.pairBadge || 'Pair'} on $${esc(r.symbol)}</span>${p.complete ? '<span class="badge good">graduated</span>' : ''}<button class="badge mono" data-cp style="border:0;cursor:pointer">${short(p.mint, 5)} · copy</button>`;
      $('[data-cp]').onclick = () => copy(p.mint, 'Address copied');
      $('[data-acts]').innerHTML = `<a class="pill blue" href="https://pump.fun/coin/${esc(p.mint)}" target="_blank" rel="noopener">Trade on pump.fun <span class="arr">→</span></a><a class="pill" href="${solscan('token', p.mint)}" target="_blank" rel="noopener">Solscan</a>`;
      $('[data-rootcard]').href = '/r?mint=' + encodeURIComponent(r.mint);
      $('[data-root]').innerHTML = `${avatar(r.mint, 'av lg')}<div><div style="font-size:24px;font-weight:600;letter-spacing:-.03em">$${esc(r.symbol)}</div><div class="dim" style="font-size:14px">${esc(r.name)} · ${usd(r.mcap_lamports, su)} · ${pct(r.locked_pct)} locked in pairs</div></div><span style="margin-left:auto;font-size:22px">→</span>`;
      first = false;
    }
    $('[data-s="locked"]').textContent = usd(p.locked_lamports, su);
    $('[data-s="lockedk"]').textContent = `of $${r.symbol} locked${p.counted ? '' : ' · below the line'}`;
    $('[data-s="share"]').textContent = pct(p.share * 100);
    $('[data-s="mult"]').innerHTML = `<span style="display:inline-flex;align-items:center;gap:10px">${ringFor(p.mult, 30, 4)}${nf(p.mult, 2)}x</span>`;
    $('[data-s="earned"]').textContent = sol(p.earned, 3);
    $('[data-desc]').textContent = p.description || `$${p.symbol} trades against $${r.symbol}: every buy of it buys $${r.symbol} first, and every $${r.symbol} in its ${p.complete ? 'pool' : 'curve'} is locked.`;
    $('[data-kv]').innerHTML = [
      ['Builder', p.creator ? `<a class="mono" href="${solscan('account', p.creator)}" target="_blank" rel="noopener">${short(p.creator, 5)}</a>` : '–'],
      ['Its own creator fee', p.fee_bps != null ? nf(p.fee_bps / 100, 2) + '% in $' + esc(r.symbol) : '–'],
      ['Root locked', `${usd(p.locked_lamports, su)} ${p.complete ? 'in its PumpSwap pool' : 'in its bonding curve'}`],
      ['Locking for', dur(p.age_s)],
      ['Counts from', sol(r.floor_lamports, 2) + ' locked'],
      ['Launched', p.launched_here ? `on ${esc(S.brand)}` : 'elsewhere on pump.fun'],
    ].map(([k, x]) => `<div><span>${k}</span><span>${x}</span></div>`).join('');
    const ev = d.events.filter(e => e.kind === 'pair' || e.kind === 'split').slice(0, 8);
    $('[data-feed]').innerHTML = ev.length ? ev.map(e => e.kind === 'pair'
      ? `<a href="${e.sig ? solscan('tx', e.sig) : '#'}" target="_blank" rel="noopener"><span class="ic b">+</span><div class="tx"><b>Launched</b><span>paired against $${esc(r.symbol)}</span></div><span class="t">${ago(e.t)}</span></a>`
      : `<a href="#"><span class="ic">÷</span><div class="tx"><b>${sol(e.lamports, 3)} split</b><span>$${esc(r.symbol)}'s fees over ${e.pairs || e.holders} pairs</span></div><span class="t">${ago(e.t)}</span></a>`).join('') : '<div class="empty">Splits of the root\'s fees show up here.</div>';
  };
  load(); setInterval(load, 20000);
})();
