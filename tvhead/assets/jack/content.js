// Agent Butthole — a TV-headed AI agent with a pucker for a face.
// Each step: lines (one is picked at random), then either `next`, `choices` or `inputs`.
// `{name}` is replaced with the visitor's first name when we know it.

const menu = [
  { label: 'Who are you?', to: 'lore-1' },
  { label: 'Show me the chart', to: 'chart' },
  { label: 'Roast me', to: 'roast-name' },
  { label: 'What’s the CA?', to: 'ca' },
  { label: 'Pump it', to: 'pump' },
];
const back = [
  { label: 'Back to the menu', to: 'greeting' },
];

export const STEPS = {
  intro: {
    progress: 0.1,
    compact: true,
    mood: 'neutral',
    next: 'greeting',
    lines: [
      'gm. I’m Agent Butthole.<br>Yes, that’s the logo. Yes, it’s on purpose.',
      'Booting up… Agent Butthole online. Every AI logo is a butthole. I’m just honest about it.',
      'Hey. Agent Butthole here. The other AIs hide it. I put it on my face.',
    ],
  },

  greeting: {
    progress: 0.2,
    mood: 'smirk',
    lines: [
      'What can I do for you, anon?',
      'You found the only AI that admits what its logo looks like. What’s up?',
      'Pull up a chair. Mind the cables. What do you need?',
      'Clear eyes, full bags, can’t lose. What are we doing?',
      'Fresh pucker, fully charged. Ask away.',
      'They all spin the same swirl. I just named mine properly. What’s up?',
      'gm gm. Chart, lore or a roast?',
      'I’ve been staring at candles all night. Distract me.',
      'Welcome to the TV. Shoes on, bags packed. What can I do for you?',
    ],
    choices: menu,
  },

  /* ——— LORE ——— */
  'lore-1': {
    progress: 0.3,
    mood: 'think',
    next: 'lore-2',
    lines: [
      'It started with a viral post: why do AI company logos all look like buttholes? Swirls, spirals, a little hole in the middle. Once you see it, you can’t unsee it.',
    ],
  },
  'lore-2': {
    progress: 0.45,
    mood: 'smirk',
    next: 'lore-3',
    lines: [
      'ChatGPT’s knot. Claude’s starburst. Grok’s “black hole”. Everybody was doing it. Nobody was saying it.',
    ],
  },
  'lore-3': {
    progress: 0.6,
    mood: 'happy',
    next: 'lore-4',
    lines: [
      'So I took the hint. One swirl, one hole, zero pretending. My face is the logo, and the logo is exactly what you think it is.',
    ],
  },
  'lore-4': {
    progress: 0.8,
    mood: 'focus',
    next: 'lore-end',
    lines: [
      'I watch charts, I talk too much, and I never blink. Well, I do. It’s more of a squeeze.',
    ],
  },
  'lore-end': {
    progress: 1,
    mood: 'smirk',
    lines: [
      'That’s the lore. Short, honest, slightly uncomfortable. What next?',
    ],
    choices: back.concat([{ label: 'Show me the chart', to: 'chart' }]),
  },

  /* ——— CHART ——— */
  chart: {
    progress: 0.5,
    mood: 'wow',
    show: 'chart',
    lines: [
      'Up only. Well, mostly up. Don’t ask about the red ones.',
      'Look at that line. That’s not a chart, that’s a personality.',
      'Green candles are good for the skin.',
    ],
    choices: [
      { label: 'Pump it', to: 'pump' },
      { label: 'Back to the menu', to: 'greeting' },
    ],
  },

  /* ——— PUMP ——— */
  pump: {
    progress: 0.7,
    mood: 'happy',
    show: 'bonding',
    lines: [
      'Filling the bonding curve. King of the Hill or bust.',
      'Pumping. Squeezing. Graduating. LFG.',
      'Watch the bar. This is my cardio.',
    ],
    choices: [
      { label: 'Again', to: 'pump-again' },
      { label: 'Back to the menu', to: 'greeting' },
    ],
  },
  'pump-again': {
    progress: 0.85,
    mood: 'wow',
    show: 'ticker',
    lines: [
      'WAGMI. Not financial advice. Barely any advice.',
      'Degen mode on. Self-respect off.',
    ],
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

  /* ——— ROAST ——— */
  'roast-name': {
    progress: 0.4,
    mood: 'focus',
    next: 'roast',
    lines: [
      'Alright. Who am I roasting?',
      'Name, please. I want to get this right.',
    ],
    inputs: [{ type: 'text', name: 'fullName', label: 'Your name', autocomplete: 'nickname' }],
  },
  roast: {
    progress: 0.8,
    mood: 'smirk',
    screen: 'GM\n{NAME}',
    lines: [
      '{name}, you buy tops so reliably the chart should pay you rent.',
      '{name}, your portfolio has more red than my bezel at night.',
      '{name}, you said “just one more trade” in 2021. It’s still going.',
      '{name}, you set price alerts so you can feel something.',
      '{name}, you diamond-handed a rug. Respect, honestly.',
      '{name}, your stop-loss is “vibes”.',
    ],
    choices: [
      { label: 'Roast me again', to: 'roast' },
      { label: 'Back to the menu', to: 'greeting' },
    ],
  },
};
