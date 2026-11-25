/* The launch page: a PAIR (a coin quoted in a root) or a ROOT (a SOL coin whose creator fees pay its pair builders).
   Single-root sites (cfg.single_root) launch pairs on their one root; the root itself is the owner's one genesis launch. */
(() => {
  const {$, $$, esc, post, short, solscan, ringFor, mult, nf, sol, usd, pct, avatar, readImage, steps} = HL;
  const S = window.SITE;
  const qs = new URLSearchParams(location.search);
  const L = {type: qs.get('type') === 'root' ? 'root' : 'pair', root: qs.get('root') || '', roots: [], image: null, busy: false, cfg: null, su: null};
  const v = k => ($(`[data-v="${k}"]`).value || '').trim();
  const msg = t => { $('[data-msg]').textContent = t || ''; };
  const T = S.t || {};

  /* ------------------------------------------------------------ the side panel */
  const rootRow = () => L.roots.find(r => r.mint === L.root);
  function paintSide() {
    const cfg = L.cfg || {}, r = rootRow(), sym = r ? '$' + r.symbol : 'the root';
    if (L.type === 'pair') {
      const fee = +$('[data-fee]').value / 100;
      $('[data-sumlabel]').textContent = T.pairSum || 'What your pair earns';
      $('[data-kv]').innerHTML = [
        ['Trades against', r ? `${esc(sym)} · ${esc(r.name)}` : 'pick a root'],
        ['Your creator fee', `${nf(fee, 2)}% of every trade, in ${esc(sym)}`],
        ['Root fees to pairs', r ? `${r.pairs_bps / 100}% of ${esc(sym)}'s fees` : '–'],
        ['Your part of them', `by ${esc(sym)} locked × time`],
        ['Lock multiplier', `1x to ${nf(HL.CURVE.max, 0)}x over ${Math.round(HL.CURVE.tau * 3)} days`],
        ['Counts from', `${sol(cfg.min_lock_lamports || 1e8, 2)} of ${esc(sym)} locked`],
        ['Paid', `in SOL every ${Math.round((cfg.interval_s || 600) / 60)} min`],
      ].map(([k, x]) => `<div><span>${k}</span><span>${x}</span></div>`).join('');
    } else {
      const share = +$('[data-share]').value;
      $('[data-sumlabel]').textContent = T.rootSum || 'What your root does';
      $('[data-kv]').innerHTML = [
        ['Paired with', 'SOL'],
        ['Creator fees to pair builders', share + '%'],
        ['Creator fees to you', (100 - share) + '%'],
        ['Builders are paid by', 'your coin locked × time'],
        ['Fee split', 'locked at launch, admin revoked'],
        ['Payout wallet', cfg.treasury ? `<a class="mono" href="${solscan('account', cfg.treasury)}" target="_blank" rel="noopener">${short(cfg.treasury, 5)}</a>` : '–'],
      ].map(([k, x]) => `<div><span>${k}</span><span>${x}</span></div>`).join('');
    }
  }
  (() => {
    const t0 = performance.now();
    const tick = t => {
      requestAnimationFrame(tick);
      const k = ((t - t0) % 7000) / 7000, d = 3 * HL.CURVE.tau * Math.min(1, k / .85), m = mult(d);
      $('[data-pr]').innerHTML = ringFor(m, 64, 6);
      $('[data-pm]').textContent = m.toFixed(2);
      $('[data-pd]').textContent = L.type === 'root' ? 'the multiplier your pair builders climb' : d < .05 ? 'a pair that just started locking' : `a pair locking for ${d < 1 ? Math.round(d * 24) + ' hours' : Math.round(d) + ' days'}`;
    };
    requestAnimationFrame(tick);
  })();

  /* ------------------------------------------------------------ type */
  function setType(t) {
    L.type = t;
    $$('[data-tabs] button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    const single = L.cfg && L.cfg.single_root;
    $('[data-title]').textContent = t === 'pair' ? (T.pairTitle || 'Build a pair') : (single ? (T.genesisTitle || 'Genesis launch') : 'Launch a root');
    $('[data-lede]').textContent = t === 'pair' ? (T.pairLede || $('[data-lede]').textContent)
      : (single ? (T.genesisLede || 'The one root of this site, from the owner wallet.') : `Launch a coin paired with SOL. Up to 100% of its creator fees pay the people who build pairs on it, by how much of it their pair keeps locked. The split is locked on chain at launch.`);
    $('[data-rootfield]').classList.toggle('hidden', t !== 'pair' || !!single);
    $('[data-feefield]').classList.toggle('hidden', t !== 'pair');
    $('[data-sharefield]').classList.toggle('hidden', t !== 'root');
    $('[data-buyhint]').textContent = t === 'pair' ? 'optional, paid in SOL and swapped into PVE first' : 'optional, paid in SOL from your wallet';
    $('[data-v="name"]').placeholder = t === 'pair' ? (T.pairName || 'Shiba Pair') : (T.rootName || 'Dog Coin');
    $('[data-v="tick"]').placeholder = t === 'pair' ? (T.pairTick || 'SHIB') : (T.rootTick || 'DOG');
    const u = new URL(location.href); u.searchParams.set('type', t); history.replaceState(null, '', u);
    paintSide(); paintBtn();
  }
  $('[data-tabs]').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) setType(b.dataset.t); });

  /* ------------------------------------------------------------ roots */
  function paintPicker() {
    const t = ($('[data-rootq]').value || '').trim().toLowerCase();
    const list = L.roots.filter(r => !t || r.name.toLowerCase().includes(t) || r.symbol.toLowerCase().includes(t) || r.mint.toLowerCase().startsWith(t));
    $('[data-picker]').innerHTML = list.length ? list.map(r => `<button type="button" data-m="${esc(r.mint)}" class="${r.mint === L.root ? 'on' : ''}">${avatar(r.mint)}<div><b>$${esc(r.symbol)}</b> <span>${esc(r.name)}</span></div>
        <div class="m"><b style="font-size:14px">${usd(r.mcap_lamports, L.su)}</b><br><span>${r.pairs} pairs · ${pct(r.locked_pct)} locked</span></div></button>`).join('')
      : `<div class="dim" style="padding:12px;font-size:14px">${L.roots.length ? 'No root matches that.' : `No root has launched yet. <a href="#" data-toroot style="color:var(--accent);font-weight:600">Launch the first one →</a>`}</div>`;
    const a = $('[data-toroot]'); if (a) a.onclick = e => { e.preventDefault(); setType('root'); };
  }
  $('[data-picker]').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; L.root = b.dataset.m; paintPicker(); paintSide(); });
  $('[data-rootq]').addEventListener('input', paintPicker);
  HL.api('/api/roots').then(d => {
    if (!d.ok) { $('[data-picker]').innerHTML = `<div class="dim" style="padding:12px;font-size:14px">${esc(d.error || 'Roots could not be loaded.')}</div>`; return; }
    L.su = d.sol_usd;
    L.roots = d.roots.sort((a, b) => b.mcap_lamports - a.mcap_lamports);
    if (!L.root && L.roots.length) L.root = L.roots[0].mint;
    paintPicker(); paintSide();
  });

  /* ------------------------------------------------------------ inputs */
  const paintRange = el => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
  $('[data-fee]').addEventListener('input', e => { paintRange(e.target); $('[data-feev]').textContent = nf(e.target.value / 100, 2).replace(/\.?0+$/, '') + '%'; paintSide(); });
  $('[data-share]').addEventListener('input', e => { paintRange(e.target); $('[data-sharev]').textContent = e.target.value + '%'; paintSide(); });
  $$('input[type=range]').forEach(paintRange);
  $('[data-file]').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { L.image = await readImage(f); msg(''); $('[data-pv]').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`; } catch (x) { msg(x.message); }
  });
  $('[data-buyrow]').addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (!b) return; $('[data-v="buy"]').value = b.dataset.b === '0' ? '' : b.dataset.b; $$('.chip', $('[data-buyrow]')).forEach(c => c.classList.toggle('on', c === b)); });

  function validate() {
    if (L.type === 'pair' && !L.root && !(L.cfg && L.cfg.single_root)) return 'Pick the root your pair trades against.';
    if (!L.image) return 'Add an image for the coin.';
    if (!v('name')) return 'Give the coin a name.';
    if (!/^[A-Za-z0-9]{1,10}$/.test(v('tick').replace(/\$/g, ''))) return 'The ticker must be 1 to 10 letters or digits.';
    const b = v('buy'), max = (L.cfg && L.cfg.max_first_buy_sol) || 50;
    if (b && !(parseFloat(b) >= 0 && parseFloat(b) <= max)) return `The first buy must be between 0 and ${max} SOL.`;
    return '';
  }
  function paintBtn() {
    if (L.busy) return;
    const b = $('[data-launch]'), cfg = L.cfg;
    let why = '';
    if (!cfg) why = 'Launching opens soon';
    else if (!cfg.launch_open) why = 'Launching opens soon';
    else if (L.type === 'root' && !cfg.root_open) why = cfg.single_root ? 'Genesis is closed' : 'Launching roots opens soon';
    else if (L.type === 'pair' && cfg.single_root && !cfg.root) why = `${S.brand} has not launched yet`;
    b.disabled = !!why;
    b.textContent = why || (HL.W.account ? (L.type === 'pair' ? (T.pairBtn || 'Launch the pair') : (cfg.single_root ? 'Launch genesis' : 'Launch the root')) : 'Connect wallet to launch');
  }
  HL.cfgReady.then(cfg => {
    L.cfg = cfg;
    if (cfg) {
      $('[data-fee]').max = cfg.pair_fee_bps_max; $('[data-fee]').value = cfg.pair_fee_bps_default; $('[data-fee]').dispatchEvent(new Event('input'));
      $('[data-share]').min = cfg.root_pairs_bps_min / 100; $('[data-share]').value = cfg.root_pairs_bps_default / 100; $('[data-share]').dispatchEvent(new Event('input'));
      if (cfg.single_root) {
        // one root: pairs only, and the genesis tab only for the owner while the root is not out
        const owner = cfg.owner, showGenesis = !cfg.root && owner && HL.W.account && HL.W.account.address === owner;
        $('[data-tabs]').classList.toggle('hidden', !showGenesis);
        if (cfg.root) L.root = cfg.root;
        if (!showGenesis && L.type === 'root') L.type = 'pair';
        HL.onWallet(W => { const g = !cfg.root && owner && W.account && W.account.address === owner; $('[data-tabs]').classList.toggle('hidden', !g); if (!g && L.type === 'root') setType('pair'); });
      }
    }
    setType(L.type);
  });
  HL.onWallet(paintBtn);

  /* ------------------------------------------------------------ launch */
  $('[data-launch]').addEventListener('click', async e => {
    e.preventDefault();
    if (L.busy) return;
    msg('');
    const bad = validate(); if (bad) { msg(bad); return; }
    let acc;
    try { acc = await HL.ensureWallet(); } catch (x) { if (x.message !== 'cancelled') msg(x.message); return; }
    const btn = $('[data-launch]'); L.busy = true; btn.disabled = true; btn.textContent = 'Launching…';
    const isPair = L.type === 'pair';
    const SS = [isPair ? 'Preparing the pair and its first buy' : 'Preparing the coin and its locked fee split', 'Approve it in your wallet', 'Sending it to Solana', 'Confirming'];
    const el = $('[data-steps]');
    let at = 0;
    try {
      steps(el, SS, 0);
      const body = {user: acc.address, name: v('name'), symbol: v('tick').replace(/\$/g, ''), description: v('desc'), image: L.image, twitter: v('twitter'), first_buy_sol: parseFloat(v('buy')) || 0};
      if (isPair) { body.root = L.root; body.fee_bps = +$('[data-fee]').value; } else body.pairs_bps = +$('[data-share]').value * 100;
      const p = await post(isPair ? '/api/launch/pair/prepare' : '/api/launch/root/prepare', body);
      if (!p.ok) throw new Error(p.error || 'The coin could not be prepared. Nothing was launched.');
      at = 1; steps(el, SS, 1);
      const sigs = await HL.signAndSend(p.txs_b64, acc, n => { at = n; steps(el, SS, n); });
      steps(el, SS, 4);
      let c = {ok: false};
      for (let i = 0; i < 6 && !c.ok; i++) { c = await post(isPair ? '/api/launch/pair/confirm' : '/api/launch/root/confirm', {mint: p.mint, signature: sigs[0]}); if (!c.ok) await HL.sleep(2000); }
      const page = isPair ? `/p?mint=${esc(p.mint)}` : `/r?mint=${esc(p.mint)}`;
      $('[data-done]').innerHTML = `<div class="done"><b>${isPair ? (T.pairDone || 'Your pair is live') : 'Your root is live'}</b><span class="dim" style="font-size:14px">${isPair ? 'It counts from the first minute it keeps the root locked above the line, and its multiplier climbs from there.' : 'Share it: every pair built on it buys it and locks it.'}</span>
        <div class="links"><a class="pill solid" href="${page}">Open it</a><a class="pill" href="https://pump.fun/coin/${esc(p.mint)}" target="_blank" rel="noopener">pump.fun</a>
        <a class="pill" href="${solscan('tx', sigs[0])}" target="_blank" rel="noopener">Transaction</a></div></div>`;
    } catch (x) {
      steps(el, SS, at, true);
      msg(/reject|cancel|denied/i.test(x.message || '') ? 'You cancelled it in your wallet. Nothing was launched.' : (x.message || 'Something went wrong. Nothing was launched.'));
    } finally { L.busy = false; paintBtn(); }
  });
})();
