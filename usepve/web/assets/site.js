/* PVE: the site's identity for core.js */
window.SITE = {
  brand: 'PVE',
  key: 'usepve',
  logo: '<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.5 28 9.4v13.2L16 29.5 4 22.6V9.4Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 8.5 22.6 12.3v7.4L16 23.5l-6.6-3.8v-7.4Z" fill="var(--accent)"/></svg>',
  nav: [['/r', 'PVE'], ['/explore', 'Raid board'], ['/launch', 'Spawn a pair'], ['/me', 'Your loot'], ['/how', 'How to play'], ['/proof', 'Ledger']],
  navAlias: {'/p': '/explore'},
  rewardsLabel: 'Your loot',
  curveMax: 3, curveTau: 3,
  searchPlaceholder: 'Search players by name, ticker or address',
  searchEmpty: 'No player has spawned yet.',
  searchLoad: api => api('/api/roots').then(d => d.ok ? [
    ...d.roots.map(r => ({mint: r.mint, name: r.name, symbol: r.symbol, href: '/r', tag: 'the boss coin'})),
    ...d.pairs.map(p => ({mint: p.mint, name: p.name, symbol: p.symbol, href: '/p?mint=' + p.mint, tag: 'player'}))] : []),
  footText: ['PVE is a co-op coin. Every coin paired against PVE buys PVE and locks it, and PVE\'s creator fees are paid to the people who built those pairs, by how much PVE they keep locked and for how long.'],
  footCols: [['Play', [['/explore', 'Raid board'], ['/launch', 'Spawn a pair'], ['/me', 'Your loot']]],
             ['Rules', [['/how', 'How to play'], ['/proof', 'Ledger'], ['/api/ledger.jsonl', 'Download the ledger']]],
             ['Elsewhere', [['https://pump.fun', 'pump.fun', 1], ['https://solscan.io', 'Solscan', 1]]]],
  wordmark: 'P<em>V</em>E',
  t: {
    pairTitle: 'Spawn a pair', pairLede: 'Launch a coin that trades against PVE. Every buy of your coin buys PVE first and locks it in your curve, and you are paid a cut of PVE\'s creator fees for the PVE you keep locked.',
    pairSum: 'What your player earns', pairBtn: 'Spawn the pair', pairDone: 'Your player has spawned', pairName: 'Raid Frog', pairTick: 'RAID',
    genesisTitle: 'Genesis', genesisLede: 'The one launch of PVE itself, from the owner wallet. Its creator fees are locked to the players in the same transaction.', rootName: 'PVE', rootTick: 'PVE',
    builderWord: 'player', pairsWord: 'Players', rootBadge: 'The boss coin', pairBadge: 'Player', pairItBtn: 'Spawn a pair', buildFirst: 'Spawn your first pair',
    lockedLabel: 'of PVE locked by players', noRoots: 'PVE has not launched yet.',
  },
};
