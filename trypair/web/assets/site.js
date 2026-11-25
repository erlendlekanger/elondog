/* TryPair: the site's identity for core.js */
window.SITE = {
  brand: 'TryPair',
  key: 'trypair',
  logo: '<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><circle cx="12" cy="16" r="8.5" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="20" cy="16" r="8.5" fill="var(--accent)" fill-opacity=".92"/><path d="M16 9.6a8.5 8.5 0 0 1 0 12.8" fill="none" stroke="#fff" stroke-width="2.6"/></svg>',
  nav: [['/explore', 'Explore'], ['/launch', 'Launch'], ['/me', 'Your earnings'], ['/how', 'How it works'], ['/proof', 'Ledger']],
  navAlias: {'/r': '/explore', '/p': '/explore'},
  rewardsLabel: 'Your earnings',
  curveMax: 3, curveTau: 3,
  searchPlaceholder: 'Search roots and pairs by name, ticker or address',
  searchEmpty: 'No root has launched on TryPair yet.',
  searchLoad: api => api('/api/roots').then(d => d.ok ? [
    ...d.roots.map(r => ({mint: r.mint, name: r.name, symbol: r.symbol, href: '/r?mint=' + r.mint, tag: r.pairs + ' pairs'})),
    ...d.pairs.map(p => ({mint: p.mint, name: p.name, symbol: p.symbol, href: '/p?mint=' + p.mint, tag: 'pair on $' + p.root_symbol}))] : []),
  footText: ['Launch a coin, and get paid to pair it. Every coin paired against a root locks that root; the root\'s creator fees pay the people who built the pairs, by how much they keep locked and for how long.'],
  footCols: [['Product', [['/explore', 'Explore'], ['/launch', 'Launch a root'], ['/launch?type=pair', 'Build a pair'], ['/me', 'Your earnings']]],
             ['Protocol', [['/how', 'How it works'], ['/proof', 'Ledger'], ['/api/ledger.jsonl', 'Download the ledger']]],
             ['Elsewhere', [['https://pump.fun', 'pump.fun', 1], ['https://solscan.io', 'Solscan', 1]]]],
  wordmark: 'Try<em>Pair</em>',
};
