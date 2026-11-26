/* The shared core of the site: helpers, the API, the wallet (Wallet Standard), the top bar, search palette, mobile sheet,
   footer, Lenis smooth scrolling and reveal-on-scroll. The site's identity comes from window.SITE (assets/site.js),
   which every page loads first. */
(() => {
  const S = window.SITE || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const short = (a, n = 4) => a ? (a.length > n * 2 + 1 ? a.slice(0, n) + '…' + a.slice(-n) : a) : '';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const nf = (v, d = 0) => (v == null || isNaN(v)) ? '–' : Number(v).toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
  const compact = v => {
    if (v == null || isNaN(v)) return '–';
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 1 : 2) + 'K';
    return nf(v, Number.isInteger(v) ? 0 : a < 10 ? 2 : 0);
  };
  const sol = (lamports, d = 3) => lamports == null ? '–' : nf(lamports / 1e9, d) + ' SOL';
  const usd = (lamports, solUsd) => solUsd ? '$' + compact(lamports / 1e9 * solUsd) : compact(lamports / 1e9) + ' SOL';
  const pct = (v, d = 1) => v == null || isNaN(v) ? '–' : nf(v, d) + '%';
  const ago = t => {
    if (!t) return '–';
    const s = Math.max(0, Date.now() / 1000 - t);
    if (s < 60) return Math.floor(s) + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  };
  const dur = s => {
    if (!s || s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min';
    if (s < 86400) return (s / 3600).toFixed(s < 36000 ? 1 : 0) + ' h';
    return (s / 86400).toFixed(s < 864000 ? 1 : 0) + ' days';
  };
  const solscan = (kind, v) => `https://solscan.io/${kind}/${v}`;
  const OFFLINE = 'The payout desk is not reachable right now. Try again in a minute.';
  const api = async url => { try { const r = await fetch(url, {credentials: 'same-origin'}); if (r.status === 503) return {ok: false, offline: true, error: OFFLINE}; return await r.json(); } catch (e) { return {ok: false, offline: true, error: OFFLINE}; } };
  const post = async (url, body) => {
    let r;
    try { r = await fetch(url, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})}); }
    catch (e) { return {ok: false, error: OFFLINE}; }
    try { return await r.json(); } catch (e) { return {ok: false, error: OFFLINE}; }
  };

  /* the time multiplier, the same curve the desk uses (replaced by /api/config) */
  const CURVE = {max: S.curveMax || 3, tau: S.curveTau || 3};
  const mult = days => 1 + (CURVE.max - 1) * (1 - Math.exp(-Math.max(0, days) / CURVE.tau));
  const ring = (frac, size = 28, w = 3) => {
    const r = (size - w) / 2, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac));
    return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="transform:rotate(-90deg)"><circle class="bg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${w}"/>` +
      `<circle class="fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - f)).toFixed(2)}"/></svg>`;
  };
  const ringFor = (m, size, w) => ring((m - 1) / (CURVE.max - 1), size, w);

  let tt;
  const toast = t => { let el = $('.toast'); if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = t; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), 2200); };
  const copy = (t, msg) => { navigator.clipboard && navigator.clipboard.writeText(t).then(() => toast(msg || 'Copied')); };
  const avatar = (mint, cls = 'av') => `<span class="${cls}"><img src="/img/${encodeURIComponent(mint || '')}" alt="" loading="lazy" decoding="async" onerror="this.remove()"></span>`;

  /* ---------------------------------------------------------------- the shell */
  const here = location.pathname.replace(/\/$/, '') || '/';
  const I = {
    x: '<svg viewBox="0 0 24 24"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 9h16M4 15h16"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };
  const NAV = S.nav || [];
  const isOn = h => h === here || (S.navAlias && S.navAlias[here] === h);
  const D = {cfg: null};
  const top = document.createElement('header');
  top.className = 'top';
  top.innerHTML = `<a class="brand" href="/" aria-label="${esc(S.brand)} home">${S.logo || ''}<span>${esc(S.brand)}</span></a>
    <nav class="nav">${NAV.map(([h, t]) => `<a href="${h}" class="${isOn(h) ? 'on' : ''}">${t}</a>`).join('')}</nav>
    <div class="act">
      <button class="ib search" data-find aria-label="Search">${I.search}</button>
      <span class="ca" data-ca hidden><span class="k">CA</span><span class="v" data-cav></span><button class="cp" data-cacp>Copy</button></span>
      <a class="ib x" data-xlink href="#" target="_blank" rel="noopener" aria-label="${esc(S.brand)} on X" hidden>${I.x}</a>
      <button class="pill solid" data-connect>Connect wallet</button>
      <button class="ib burger" data-burger aria-label="Menu">${I.menu}</button>
    </div>
    <div class="walmenu" data-walmenu><a href="/me">${esc(S.rewardsLabel || 'Your rewards')}</a><button data-copyaddr>Copy address</button><button data-disconnect>Disconnect</button></div>`;
  document.body.prepend(top);
  const onScroll = () => top.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, {passive: true}); onScroll();

  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `${[['/', 'Home'], ...NAV].map(([h, t]) => `<a class="big ${h === here ? 'on' : ''}" href="${h}">${t}</a>`).join('')}
    <div class="row"><button class="pill" data-find>Search</button></div>`;
  document.body.appendChild(sheet);
  $('[data-burger]').addEventListener('click', () => { const on = sheet.classList.toggle('on'); document.documentElement.classList.toggle('sheet-on', on); $('[data-burger]').innerHTML = on ? I.close : I.menu; });

  /* search palette */
  const pal = document.createElement('div');
  pal.className = 'palette';
  pal.innerHTML = `<div class="in"><label>${I.search}<input data-q placeholder="${esc(S.searchPlaceholder || 'Search coins by name, ticker or address')}" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></label><div class="res" data-res></div></div>`;
  document.body.appendChild(pal);
  let found = null;
  const loadFound = () => found ? Promise.resolve(found) : (S.searchLoad ? S.searchLoad(api) : Promise.resolve([])).then(l => (found = l || []));
  const q = $('[data-q]', pal), res = $('[data-res]', pal);
  let sel = 0;
  const paintRes = () => {
    const t = q.value.trim().toLowerCase();
    loadFound().then(list => {
      const hits = (t ? list.filter(c => (c.name || '').toLowerCase().includes(t) || (c.symbol || '').toLowerCase().includes(t) || (c.mint || '').toLowerCase().startsWith(t)) : list).slice(0, 8);
      sel = Math.min(sel, Math.max(0, hits.length - 1));
      res.innerHTML = hits.length ? hits.map((c, i) => `<a href="${esc(c.href)}" class="${i === sel ? 'k' : ''}">${avatar(c.mint)}<span><b>${esc(c.name || c.symbol)}</b> <span class="dim mono">${esc(c.symbol)}</span></span><span class="dim" style="margin-left:auto">${esc(c.tag || '')}</span></a>`).join('')
        : `<div class="e">${list.length ? 'Nothing matches that.' : esc(S.searchEmpty || 'Nothing has launched yet.')}</div>`;
    });
  };
  const openFind = () => { sheet.classList.remove('on'); document.documentElement.classList.remove('sheet-on'); $('[data-burger]').innerHTML = I.menu; pal.classList.add('on'); q.value = ''; sel = 0; paintRes(); setTimeout(() => q.focus(), 30); };
  const closeFind = () => pal.classList.remove('on');
  $$('[data-find]').forEach(b => b.addEventListener('click', openFind));
  pal.addEventListener('click', e => { if (e.target === pal) closeFind(); });
  q.addEventListener('input', () => { sel = 0; paintRes(); });
  q.addEventListener('keydown', e => {
    const as = $$('a', res);
    if (e.key === 'ArrowDown') { sel = Math.min(as.length - 1, sel + 1); paintRes(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); paintRes(); e.preventDefault(); }
    else if (e.key === 'Enter' && as[sel]) location.href = as[sel].href;
  });
  addEventListener('keydown', e => {
    if (e.key === 'Escape') closeFind();
    else if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); openFind(); }
  });

  const cfgReady = api('/api/config').then(c => {
    if (c && c.ok) {
      D.cfg = c;
      const curve = c.hold || c.lock;
      if (curve) { CURVE.max = curve.max; CURVE.tau = curve.tau_days; }
      const ca = c.ca || S.ca;
      if (ca) { const el = $('[data-ca]'); el.hidden = false; $('[data-cav]').textContent = short(ca); $('[data-cacp]').onclick = e => { e.preventDefault(); copy(ca, 'CA copied'); }; }
      const xu = c.x_url || S.x;
      if (xu) { const a = $('[data-xlink]'); a.href = xu; a.hidden = false; }
    } else if (c && c.offline) document.documentElement.classList.add('desk-off');
    return D.cfg;
  });

  /* ---------------------------------------------------------------- wallet (Wallet Standard) */
  const W = {list: [], wallet: null, account: null};
  try {
    const reg = {register: (...ws) => { ws.forEach(w => { if (!W.list.includes(w)) W.list.push(w); }); return () => {}; }};
    addEventListener('wallet-standard:register-wallet', e => { try { e.detail(reg); } catch (x) {} });
    dispatchEvent(new CustomEvent('wallet-standard:app-ready', {detail: reg}));
  } catch (e) {}
  const usable = w => !/metamask/i.test(w.name || '') && w.features && w.features['standard:connect'] && w.features['solana:signTransaction'] && (w.chains || []).some(c => c.startsWith('solana:'));
  const b64bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const KEY = (S.key || 'site') + '-wallet';
  const wl = [];
  function paintWallet() {
    const b = $('[data-connect]');
    if (b) b.innerHTML = W.account ? `<span class="dot"></span><span class="mono">${short(W.account.address)}</span>` : 'Connect wallet';
    wl.forEach(fn => { try { fn(W); } catch (e) { console.error(e); } });
  }
  function setWallet(w, acc) {
    W.wallet = w; W.account = acc || null;
    try { if (acc) localStorage.setItem(KEY, JSON.stringify({name: w.name, address: acc.address})); else localStorage.removeItem(KEY); } catch (e) {}
    paintWallet();
  }
  async function connectWith(w) {
    const r = await w.features['standard:connect'].connect();
    const accs = (r && r.accounts) || w.accounts || [];
    const acc = accs.find(a => (a.chains || w.chains || []).some(c => c.startsWith('solana:'))) || accs[0];
    if (!acc) throw new Error('No Solana account in this wallet');
    setWallet(w, acc);
    if (w.features['standard:events']) w.features['standard:events'].on('change', () => { const a = (w.accounts || [])[0]; if (!a) setWallet(null, null); else if (W.account && a.address !== W.account.address) setWallet(w, a); });
    return acc;
  }
  const pickWallet = () => new Promise((resolve, reject) => {
    const ws = W.list.filter(usable);
    const el = document.createElement('div'); el.className = 'wpick';
    el.innerHTML = `<div class="wpick-in" role="dialog" aria-label="Connect a wallet"><h3>Connect a wallet</h3><p>Your wallet signs everything itself. ${esc(S.brand)} never sees your keys.</p><div class="list">${ws.length
      ? ws.map((w, i) => `<button data-i="${i}"><img src="${esc(w.icon)}" alt="">${esc(w.name)}</button>`).join('')
      : '<div class="nw">No Solana wallet was found in this browser. Install <a href="https://phantom.com" target="_blank" rel="noopener">Phantom</a> or <a href="https://solflare.com" target="_blank" rel="noopener">Solflare</a> and reload the page.</div>'}</div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('on'));
    const done = () => { el.remove(); removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') { done(); reject(new Error('cancelled')); } };
    addEventListener('keydown', onKey);
    const status = document.createElement('p'); status.className = 'wstatus'; el.querySelector('.wpick-in').appendChild(status);
    let busy = false;
    el.addEventListener('click', async e => {
      const b = e.target.closest('button[data-i]');
      if (!b) { if (e.target === el && !busy) { done(); reject(new Error('cancelled')); } return; }
      if (busy) return;
      const w = ws[+b.dataset.i];
      busy = true; b.classList.add('wait'); status.className = 'wstatus';
      status.textContent = `Approve the connection in the ${w.name} window.`;
      const hint = setTimeout(() => { if (busy) status.textContent = `No ${w.name} window? Click the ${w.name} icon in your browser's toolbar and approve it there.`; }, 6000);
      try { const acc = await connectWith(w); clearTimeout(hint); done(); resolve(acc); toast('Wallet connected'); }
      catch (x) {
        clearTimeout(hint); busy = false; b.classList.remove('wait');
        status.className = 'wstatus bad';
        status.textContent = /reject|cancel|denied/i.test(x.message || '') ? 'The connection was declined in the wallet. Click it again to retry.' : 'The wallet did not connect. Try again.';
      }
    });
  });
  const ensureWallet = async () => W.account || pickWallet();
  $('[data-connect]').addEventListener('click', e => { e.stopPropagation(); if (W.account) $('[data-walmenu]').classList.toggle('on'); else pickWallet().catch(() => {}); });
  document.addEventListener('click', () => $('[data-walmenu]').classList.remove('on'));
  $('[data-disconnect]').addEventListener('click', async () => { try { await W.wallet.features['standard:disconnect']?.disconnect(); } catch (e) {} setWallet(null, null); });
  $('[data-copyaddr]').addEventListener('click', () => copy(W.account.address, 'Address copied'));
  setTimeout(async () => {
    let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    const w = saved && W.list.find(x => x.name === saved.name && usable(x));
    if (!w) { paintWallet(); return; }
    try { await w.features['standard:connect'].connect({silent: true}); const acc = (w.accounts || []).find(a => a.address === saved.address); if (acc) setWallet(w, acc); else paintWallet(); } catch (e) { paintWallet(); }
  }, 400);

  /* sign every transaction in one prompt, then send them in order and wait for each */
  async function signAndSend(txs_b64, acc, onStep) {
    const f = W.wallet.features['solana:signTransaction'];
    const inputs = txs_b64.map(t => ({transaction: b64bytes(t), account: acc, chain: 'solana:mainnet'}));
    let signed;
    try { signed = (await f.signTransaction(...inputs)).map(o => o.signedTransaction); }
    catch (x) { if (inputs.length === 1 || /reject|cancel|denied/i.test(x.message || '')) throw x; signed = []; for (const i of inputs) { const [o] = await f.signTransaction(i); signed.push(o.signedTransaction); } }
    const sigs = [];
    for (let i = 0; i < signed.length; i++) {
      onStep && onStep(2);
      const r = await post('/api/launch/send', {tx_b64: b64(signed[i]), skip_preflight: i > 0});
      if (!r.ok) throw new Error(r.error || 'Solana did not accept the transaction. Nothing was launched.');
      sigs.push(r.signature);
      onStep && onStep(3);
      let ok = false;
      for (let k = 0; k < 60 && !ok; k++) {
        await sleep(1500);
        const s = await post('/api/launch/status', {signatures: [r.signature]});
        const s0 = s.ok && s.statuses[0];
        if (s0 && s0.error) throw new Error(i === 0 ? 'The transaction failed on Solana. Nothing was launched.' : 'A later step failed on Solana. The coin exists; check it on Solscan.');
        ok = !!(s0 && s0.confirmed);
      }
      if (!ok) throw new Error('Not confirmed yet. Check the transaction on Solscan in a minute.');
    }
    return sigs;
  }

  /* an image picked for a coin, scaled to at most 1024 px, as a data URL */
  const readImage = async f => {
    if (!f) return null;
    if (f.size > 4e6) throw new Error('The image must be under 4 MB.');
    if (f.type === 'image/gif') return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    const bmp = await createImageBitmap(f);
    const s = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  };
  const steps = (el, items, cur, bad) => { el.classList.remove('hidden');
    el.innerHTML = items.map((t, i) => `<div class="${i < cur ? 'ok' : i === cur ? (bad ? 'bad' : 'on') : ''}"><i></i>${esc(t)}</div>`).join(''); };

  /* ---------------------------------------------------------------- footer */
  if (!document.body.dataset.nofoot) {
    const f = document.createElement('footer');
    f.className = 'foot';
    f.innerHTML = `<div class="wrap wide"><div class="cols"><div>${(S.footText || []).map(t => `<p>${t}</p>`).join('')}</div>
      ${(S.footCols || []).map(([h, links]) => `<div><h4>${esc(h)}</h4>${links.map(([u, t, ext]) => `<a href="${u}"${ext ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`).join('')}</div>`).join('')}</div>
      <div class="giant" aria-hidden="true">${S.wordmark || esc(S.brand)}</div>
      <div class="fine"><span>© ${new Date().getFullYear()} ${esc(S.brand)}</span><span>Not financial advice. Coins can lose all of their value.</span></div></div>`;
    (document.querySelector('main.page') || document.body).appendChild(f);
  }

  /* ---------------------------------------------------------------- motion */
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lenis = null;
  if (window.Lenis && !reduced) {
    lenis = new Lenis({lerp: 0.085, wheelMultiplier: 1});
    window.lenis = lenis;
    if (window.gsap && window.ScrollTrigger) {
      gsap.registerPlugin(ScrollTrigger);
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(t => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    } else {
      const raf = t => { lenis.raf(t); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }
    const go = (h, im) => { const el = h && h.length > 1 && document.querySelector(h); if (!el) return false; lenis.scrollTo(el, {offset: -80, immediate: !!im}); return true; };
    document.addEventListener('click', e => { const a = e.target.closest('a[href^="#"]'); if (!a || a.getAttribute('href') === '#') return; if (go(a.getAttribute('href'))) { e.preventDefault(); history.replaceState(null, '', a.getAttribute('href')); } });
    addEventListener('load', () => { if (location.hash) setTimeout(() => go(location.hash, true), 50); });
  } else if (window.gsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); e.target.dispatchEvent(new Event('reveal')); } }), {rootMargin: '0px 0px -8% 0px', threshold: .08});
  const reveal = (root = document) => $$('.rv:not(.in)', root).forEach(el => io.observe(el));
  reveal();
  const rise = el => {
    if (!el || el.dataset.split) return;
    el.dataset.split = 1;
    el.classList.add('rise');
    let i = 0;
    el.innerHTML = el.innerHTML.split(/(<br\s*\/?>|<em>|<\/em>)/).map(part => /^<\/?(br|em)/.test(part) ? part : part.split(/(\s+)/).map(w => w.trim() ? `<span class="w"><span style="--i:${i++}">${w}</span></span>` : w).join('')).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('go')));
  };
  $$('.rise').forEach(rise);
  const rio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { rio.unobserve(e.target); rise(e.target); } }), {rootMargin: '0px 0px -10% 0px'});
  $$('[data-rise]').forEach(el => { if (reduced) { el.classList.add('rise', 'go'); return; } rio.observe(el); });
  const countTo = (el, to, {d = 0, dur = 1200, pre = '', post = '', fmt} = {}) => {
    const f = fmt || (v => pre + nf(v, d) + post);
    if (reduced) { el.textContent = f(to); return; }
    const from = parseFloat(el.dataset.v || '0') || 0, t0 = performance.now();
    el.dataset.v = to;
    const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4); el.textContent = f(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  /* a pointer-following glow on cards with .glow */
  document.addEventListener('pointermove', e => {
    const c = e.target.closest && e.target.closest('.glow');
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, {passive: true});

  window.HL = {$, $$, esc, short, sleep, nf, compact, sol, usd, pct, ago, dur, held: dur, solscan, api, post, toast, copy, avatar, ring, ringFor, mult, CURVE, HOLD: CURVE,
    W, D, cfgReady, ensureWallet, signAndSend, readImage, steps, onWallet: fn => { wl.push(fn); fn(W); }, reveal, rise, countTo, reduced, lenis: () => lenis, OFFLINE};
})();
