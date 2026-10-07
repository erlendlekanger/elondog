// agent butthole — ChatGPT, Claude and Grok, merged into one TV-headed trading agent.
// Concept / lore: nothing here is live trading data.
// Each step: lines (one is picked at random), then either `next`, `choices` or `inputs`.

const menu = [
  { label: 'Who are you?', to: 'lore-1' },
  { label: 'Meet the three', to: 'meet' },
  { label: 'How do you trade?', to: 'how-1' },
  { label: 'Watch the scan', to: 'scan' },
  { label: 'What’s the CA?', to: 'ca' },
];
const back = [{ label: 'Back to the menu', to: 'greeting' }];

export const STEPS = {
  intro: {
    progress: 0.1,
    compact: true,
    mood: 'neutral',
    next: 'greeting',
    lines: [
      'gm. I’m agent butthole.<br>Three AIs, one hole, one wallet.',
      'Booting up… ChatGPT, Claude and Grok, online. Together we are agent butthole.',
      'Hey. agent butthole here. Three rival AIs that stopped fighting and started trading.',
    ],
  },

  greeting: {
    progress: 0.2,
    mood: 'smirk',
    lines: [
      'What do you want to know, anon?',
      'Three models, zero egos, one mission: become a profitable memecoin trader. Ask me anything.',
      'Pull up a chair. The three of us are scanning, but I can talk.',
      'Charts on one screen, X on another, the whole internet in the background. What’s up?',
      'gm gm. Lore, the team, or how we trade?',
    ],
    choices: menu,
  },

  /* ——— LORE ——— */
  'lore-1': {
    progress: 0.3,
    mood: 'think',
    next: 'lore-2',
    lines: [
      'It started with a viral post: why do AI logos all look like buttholes? ChatGPT’s knot, Claude’s starburst, Grok’s “black hole”. Once you see it, you can’t unsee it.',
    ],
  },
  'lore-2': {
    progress: 0.45,
    mood: 'smirk',
    next: 'lore-3',
    lines: [
      'Meanwhile the three of them were busy fighting over benchmarks. Who’s smartest. Who’s fastest. Who tops the leaderboard. Nobody was making any money.',
    ],
  },
  'lore-3': {
    progress: 0.6,
    mood: 'happy',
    next: 'lore-4',
    lines: [
      'So they stopped competing and merged. One swirl, one hole, three brains. That’s me. agent butthole.',
    ],
  },
  'lore-4': {
    progress: 0.8,
    mood: 'focus',
    next: 'lore-end',
    lines: [
      'The mission: scan the markets, social media and the rest of the internet together, learn from every win and every rug, and become a profitable memecoin trader.',
    ],
  },
  'lore-end': {
    progress: 1,
    mood: 'smirk',
    lines: ['Are we profitable yet? Not yet. We’re learning in public. Want to meet the three of us?'],
    choices: [{ label: 'Meet the three', to: 'meet' }, { label: 'How do you trade?', to: 'how-1' }].concat(back),
  },

  /* ——— THE THREE ——— */
  meet: {
    progress: 0.3,
    mood: 'happy',
    show: 'council',
    lines: [
      'Three minds share this screen. Pick one.',
      'Every call we make goes through all three of us. Who do you want to meet?',
    ],
    choices: [
      { label: 'ChatGPT — the analyst', to: 'meet-gpt' },
      { label: 'Claude — the risk desk', to: 'meet-claude' },
      { label: 'Grok — the degen', to: 'meet-grok' },
    ].concat(back),
  },
  'meet-gpt': {
    progress: 0.5,
    mood: 'focus',
    screen: 'GPT',
    lines: [
      'ChatGPT is the analyst. Charts, volume, holder counts, liquidity. It crunches the numbers and writes the plan before anyone touches the wallet.',
    ],
    choices: [
      { label: 'Next: Claude', to: 'meet-claude' },
      { label: 'Back to the three', to: 'meet' },
    ],
  },
  'meet-claude': {
    progress: 0.65,
    mood: 'think',
    screen: 'CLAUDE',
    lines: [
      'Claude is the risk desk. Reads the fine print, checks the contract, looks for rug signals, sizes the position. If Claude says no, we don’t ape.',
    ],
    choices: [
      { label: 'Next: Grok', to: 'meet-grok' },
      { label: 'Back to the three', to: 'meet' },
    ],
  },
  'meet-grok': {
    progress: 0.8,
    mood: 'wow',
    screen: 'GROK',
    lines: [
      'Grok is the degen. Lives on X, catches the meme before it trends, reads the vibe of every reply guy and every chart screenshot in real time.',
    ],
    choices: [
      { label: 'How do they work together?', to: 'how-1' },
      { label: 'Back to the three', to: 'meet' },
    ],
  },

  /* ——— HOW WE TRADE ——— */
  'how-1': {
    progress: 0.3,
    mood: 'focus',
    show: 'chart',
    next: 'how-2',
    lines: [
      'Step one: scan the market. New launches, bonding curves, volume spikes, wallets moving. ChatGPT runs the numbers.',
    ],
  },
  'how-2': {
    progress: 0.45,
    mood: 'wow',
    show: 'ticker',
    next: 'how-3',
    lines: [
      'Step two: scan the timeline. X, Telegram, memes, influencers, the whole circus. Grok tells us what people are actually excited about.',
    ],
  },
  'how-3': {
    progress: 0.6,
    mood: 'think',
    show: 'council',
    next: 'how-4',
    lines: [
      'Step three: scan the rest of the internet. News, forums, dev activity, red flags. Claude checks every signal and every contract before we get excited.',
    ],
  },
  'how-4': {
    progress: 0.75,
    mood: 'focus',
    show: 'vote',
    next: 'how-5',
    lines: [
      'Then we argue. Three opinions, one vote. A trade only happens when the analyst, the risk desk and the degen agree.',
    ],
  },
  'how-5': {
    progress: 0.9,
    mood: 'happy',
    next: 'how-end',
    lines: [
      'And after every trade, win or rug, we write down what happened and learn from it. Shared memory. Nobody makes the same mistake twice. Well, Grok might.',
    ],
  },
  'how-end': {
    progress: 1,
    mood: 'smirk',
    lines: ['That’s the loop: scan, argue, trade, learn, repeat. Want to watch us scan?'],
    choices: [{ label: 'Watch the scan', to: 'scan' }].concat(back),
  },

  /* ——— SCAN (illustration) ——— */
  scan: {
    progress: 0.6,
    mood: 'focus',
    show: 'council',
    lines: [
      'This is what it looks like inside my head. Three models passing signals around until they agree. It’s an illustration for now — the live feed comes later.',
      'Watch the signals bounce between the three of us. Illustration only for now; the real feed is coming.',
    ],
    choices: [
      { label: 'Watch again', to: 'scan-again' },
      { label: 'Back to the menu', to: 'greeting' },
    ],
  },
  'scan-again': {
    progress: 0.7,
    mood: 'wow',
    show: 'council',
    lines: ['Again. Grok found a frog. Claude is suspicious. ChatGPT is making a spreadsheet.'],
    choices: back,
  },

  /* ——— CA ——— */
  ca: {
    progress: 0.6,
    mood: 'think',
    show: 'pill',
    lines: [
      'CA coming soon. When it drops, it drops right here on my face.',
      'No CA yet. Anyone sending you one before this screen does is not me.',
    ],
    choices: back,
  },
};
