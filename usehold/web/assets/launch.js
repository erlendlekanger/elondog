/* Launch a coin whose creator fees are paid to its holders (the Hold desk's /api/launch routes). */
(() => {
  const {$, $$, esc, post, short, solscan, ringFor, mult, readImage, steps} = HL;
  const SOL = 'So11111111111111111111111111111111111111112';
  const L = {image: null, busy: false, pair: {mint: SOL, symbol: 'SOL', name: 'Solana', logo: ''}, iv: 360, pairs: null};
  const v = k => ($(`[data-v="${k}"]`).value || '').trim();
  const msg = t => { $('[data-msg]').textContent = t || ''; };
  const paintPair = () => {
    const p = L.pair, stock = p.mint !== SOL;
    $('[data-pairnote]').textContent = stock ? `Paired with ${p.symbol} (${p.name}). It trades in ${p.symbol}, and holders are paid in ${p.symbol}.` : 'Paired with SOL. Holders are paid in SOL.';
    $('[data-pv2]').textContent = stock ? `${p.symbol}, ${p.name}` : 'SOL';
    $('[data-iv]').textContent = `in ${p.symbol} every ${Math.round(L.iv / 60)} min`;
    $$('.pr', $('[data-pairs]')).forEach(b => b.classList.toggle('on', b.dataset.m === p.mint));
  };
  HL.api('/api/pairs').then(d => {
    if (!d.ok || !d.pairs || d.pairs.length < 2) return;
    L.pairs = d.pairs;
    $('[data-pairs]').innerHTML = d.pairs.map(p => `<button type="button" class="pr" data-m="${esc(p.mint)}" title="${esc(p.name)}">${p.mint === SOL ? '<i>◎</i>' : `<img src="${esc(p.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`}<b>${esc(p.symbol)}</b></button>`).join('');
    paintPair();
  });
  $('[data-pairs]').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; L.pair = (L.pairs || []).find(p => p.mint === b.dataset.m) || L.pair; paintPair(); });
  (() => {
    const t0 = performance.now();
    const tick = t => {
      requestAnimationFrame(tick);
      const k = ((t - t0) % 7000) / 7000, d = 30 * Math.min(1, k / .85), m = mult(d);
      $('[data-pr]').innerHTML = ringFor(m, 64, 6);
      $('[data-pm]').textContent = m.toFixed(2);
      $('[data-pd]').textContent = d < .05 ? 'a wallet that just bought' : `a wallet holding for ${d < 1 ? Math.round(d * 24) + ' hours' : Math.round(d) + ' days'}`;
    };
    requestAnimationFrame(tick);
  })();
  $('[data-file]').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { L.image = await readImage(f); msg(''); $('[data-pv]').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`; } catch (x) { msg(x.message); }
  });
  $('[data-buyrow]').addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (!b) return; $('[data-v="buy"]').value = b.dataset.b === '0' ? '' : b.dataset.b; $$('.chip', $('[data-buyrow]')).forEach(c => c.classList.toggle('on', c === b)); });
  function validate() {
    if (!L.image) return 'Add an image for the coin.';
    if (!v('name')) return 'Give the coin a name.';
    if (!/^[A-Za-z0-9]{1,10}$/.test(v('tick').replace(/\$/g, ''))) return 'The ticker must be 1 to 10 letters or digits.';
    const b = v('buy'), max = (HL.D.cfg && HL.D.cfg.max_first_buy_sol) || 50;
    if (b && !(parseFloat(b) >= 0 && parseFloat(b) <= max)) return `The first buy must be between 0 and ${max} SOL.`;
    return '';
  }
  function paintBtn() {
    if (L.busy) return;
    const b = $('[data-launch]'), cfg = HL.D.cfg, open = cfg && cfg.launch_open;
    b.disabled = !open;
    b.textContent = !open ? 'Launching opens soon' : HL.W.account ? 'Launch the coin' : 'Connect wallet to launch';
  }
  HL.cfgReady.then(cfg => {
    if (cfg) {
      const a = $('[data-treasury]'); a.textContent = short(cfg.treasury, 5) || '–'; if (cfg.treasury) a.href = solscan('account', cfg.treasury);
      L.iv = cfg.interval_s; paintPair();
      $('[data-mh]').textContent = `${cfg.min_hold_pct}% of the supply or more`;
    }
    paintBtn();
  });
  HL.onWallet(paintBtn);
  $('[data-launch]').addEventListener('click', async e => {
    e.preventDefault();
    if (L.busy) return;
    msg('');
    const bad = validate(); if (bad) { msg(bad); return; }
    let acc;
    try { acc = await HL.ensureWallet(); } catch (x) { if (x.message !== 'cancelled') msg(x.message); return; }
    const btn = $('[data-launch]'); L.busy = true; btn.disabled = true; btn.textContent = 'Launching…';
    const S = ['Preparing the coin and its locked fee split', 'Approve it in your wallet', 'Sending it to Solana', 'Confirming'];
    const el = $('[data-steps]');
    let at = 0;
    try {
      steps(el, S, 0);
      const p = await post('/api/launch/prepare', {user: acc.address, name: v('name'), symbol: v('tick').replace(/\$/g, ''), description: v('desc'), image: L.image,
        twitter: v('twitter'), first_buy_sol: parseFloat(v('buy')) || 0, pair: L.pair.mint});
      if (!p.ok) throw new Error(p.error || 'The coin could not be prepared. Nothing was launched.');
      at = 1; steps(el, S, 1);
      const sigs = await HL.signAndSend(p.txs_b64, acc, n => { at = n; steps(el, S, n); });
      steps(el, S, 4);
      let c = {ok: false};
      for (let i = 0; i < 6 && !c.ok; i++) { c = await post('/api/launch/confirm', {mint: p.mint, signature: sigs[0]}); if (!c.ok) await HL.sleep(2000); }
      $('[data-done]').innerHTML = `<div class="done"><b>Your coin is live</b><span class="dim" style="font-size:14px">Its holders are paid in ${esc(L.pair.symbol)} from the next split, and every hour they hold raises their share.</span>
        <div class="links"><a class="pill solid" href="/c?mint=${esc(p.mint)}">Open it</a><a class="pill" href="https://pump.fun/coin/${esc(p.mint)}" target="_blank" rel="noopener">pump.fun</a>
        <a class="pill" href="${solscan('tx', sigs[0])}" target="_blank" rel="noopener">Transaction</a></div></div>`;
    } catch (x) {
      steps(el, S, at, true);
      msg(/reject|cancel|denied/i.test(x.message || '') ? 'You cancelled it in your wallet. Nothing was launched.' : (x.message || 'Something went wrong. Nothing was launched.'));
    } finally { L.busy = false; paintBtn(); }
  });
})();
