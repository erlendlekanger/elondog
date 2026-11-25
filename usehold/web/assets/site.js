/* Hold (usehold.fun): the site's identity for core.js */
window.SITE = {
  brand: 'Hold',
  key: 'usehold',
  logo: '<svg class="logo" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><defs><linearGradient id="lg-hold" x1="0" x2="1"><stop offset="0" stop-color="#8bffcf"/><stop offset="1" stop-color="#36c5ff"/></linearGradient></defs><circle cx="16" cy="16" r="11" fill="none" stroke="#2c2c2e" stroke-width="3.6"/><path d="M16 5a11 11 0 1 1-10.46 7.6" fill="none" stroke="url(#lg-hold)" stroke-width="3.6" stroke-linecap="round"/></svg>',
  nav: [['/explore', 'Explore'], ['/launch', 'Launch'], ['/me', 'Your rewards'], ['/how', 'How it works'], ['/proof', 'Ledger']],
  navAlias: {'/c': '/explore'},
  rewardsLabel: 'Your rewards',
  curveMax: 10, curveTau: 7,
  searchPlaceholder: 'Search coins by name, ticker or address',
  searchEmpty: 'No coin has launched on Hold yet.',
  searchLoad: api => api('/api/coins').then(d => d.ok ? d.coins.map(c => ({mint: c.mint, name: c.name, symbol: c.symbol, href: '/c?mint=' + c.mint, tag: c.holders + ' holders'})) : []),
  footText: ['Every creator fee of a coin launched on Hold is paid to its holders, in SOL or in the stock it is paired with. The longer a wallet holds, the bigger its share, up to 10x.'],
  footCols: [['Product', [['/explore', 'Explore'], ['/launch', 'Launch'], ['/me', 'Your rewards']]],
             ['Protocol', [['/how', 'How it works'], ['/proof', 'Ledger'], ['/api/ledger.jsonl', 'Download the ledger']]],
             ['Elsewhere', [['https://pump.fun', 'pump.fun', 1], ['https://solscan.io', 'Solscan', 1]]]],
  wordmark: 'H<em>o</em>ld',
};
