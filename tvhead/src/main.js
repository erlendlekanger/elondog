import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import gsap from 'gsap';
import { buildCharacter, addChestDecal } from './character.js';
import { createMarket, formatPrice, formatUsd, formatPct } from './market.js';
import { createAgent, createChartCanvas, createTerminalCanvas, moodFrom } from './agent.js';
import { createScreen } from './screen.js';
import { createCables } from './cables.js';

// ---------------------------------------------------------------------------
// CONFIG: change these to make the site yours.
// ---------------------------------------------------------------------------
const CONFIG = {
  name: 'TV/HEAD',
  ticker: '$TVHEAD',
  accent: '#ff3a22',     // normal colour
  pumpColor: '#39ff88',  // when the chart is going up
  dumpColor: '#ff1d1d',  // when the chart is going down
  chain: 'solana',
  // Paste your token's contract address here after launch. Empty = demo mode.
  contractAddress: '',
  links: {
    buy: 'https://pump.fun',          // e.g. your pump.fun / Jupiter / Raydium link
    chart: '',                        // empty = DexScreener page found automatically
    x: 'https://x.com',
    telegram: 'https://t.me',
  },
  // Path to your own rigged model, e.g. 'models/me.glb'. Leave null to use the
  // built-in TV-head character. See README.md for how to make one.
  modelUrl: 'models/tvhead.glb',
  // Your own clips for the TV, e.g. ['videos/face.mp4', 'videos/dance.mp4'] (muted, looped).
  // Great place for Higgsfield / phone videos. They appear as channels with CRT effects.
  screenVideos: [],
  // Bone names searched for in your model (case and symbols are ignored).
  bones: {
    torso: ['torso', 'spine2', 'mixamorigspine2', 'chest', 'spine1'],
    neck1: ['neck1', 'neck', 'mixamorigneck'],
    neck2: ['neck2', 'head', 'mixamorighead'],
    head: ['head', 'mixamorighead'],
  },
};

// ---------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------
const stage = document.getElementById('stage');
const canvas = document.createElement('canvas');
const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
if (!gl) {
  document.querySelector('[data-loader]').remove();
  const p = document.createElement('p');
  p.className = 'fallback';
  p.textContent = 'Your browser does not support WebGL 2.';
  document.body.append(p);
  throw new Error('WebGL2 unavailable');
}
stage.append(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060608);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.32;
// Real studio HDRI (Poly Haven, CC0) for believable reflections; swaps in when loaded.
new RGBELoader().load('assets/studio.hdr', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = 0.55;
  hdr.dispose();
});

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 60);
const cameraBase = new THREE.Vector3(0, 1.1, 8.4);
const cameraTarget = new THREE.Vector3(0, 0.88, 0);

// Backdrop: soft radial glow behind the head, fading to black.
const accent = new THREE.Color(CONFIG.accent);
const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 24),
  new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: { uColor: { value: accent.clone() }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; uniform vec3 uColor; uniform float uTime;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec2 p = (vUv - vec2(0.5, 0.56)) * vec2(40.0, 24.0) / 9.0;
        float g = exp(-dot(p, p) * 0.9);
        vec3 col = vec3(0.012, 0.012, 0.016) + uColor * 0.07 * g + vec3(0.02) * g;
        col += (hash(vUv * 900.0 + uTime) - 0.5) * 0.006;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }),
);
backdrop.position.z = -5;
scene.add(backdrop);

// ---------------------------------------------------------------------------
// Lights: warm key with soft shadows, two coloured rims, light from the screen.
// ---------------------------------------------------------------------------
const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
key.position.set(-3.2, 4.5, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 4;
key.shadow.camera.bottom = -3;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
key.shadow.radius = 6;
scene.add(key);

const fill = new THREE.DirectionalLight(0xb9c6ff, 0.35);
fill.position.set(4, 1, 4);
scene.add(fill);

const rimL = new THREE.SpotLight(accent, 60, 14, 0.5, 0.8, 1.6);
rimL.position.set(-4, 3.5, -3.5);
rimL.target.position.set(0, 0.8, 0);
scene.add(rimL, rimL.target);

const rimR = new THREE.SpotLight(0x9fb8ff, 45, 14, 0.5, 0.8, 1.6);
rimR.position.set(4.2, 2.8, -3.2);
rimR.target.position.set(0, 0.8, 0);
scene.add(rimR, rimR.target);

const screenLight = new THREE.PointLight(accent, 1.6, 3.2, 1.8);
scene.add(screenLight);

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------
const screen = createScreen(renderer, { color: CONFIG.accent, aspect: 1.02 / 0.8 });
const character = buildCharacter(CONFIG.accent, { brand: CONFIG.name, chestText: CONFIG.ticker, screenMaterial: screen.material });
character.root.position.y = -0.55;
scene.add(character.root);

let rig = character.rig;
const screenMat = screen.material;
const U = screen.uniforms;
let cables = null;

// Rest pose is captured so motion is always added on top of it (works for any rig).
function captureRest(r) {
  const rest = {};
  for (const k of Object.keys(r)) rest[k] = r[k].rotation.clone();
  return rest;
}
let rest = captureRest(rig);

// Optional: swap in a rigged .glb.
async function loadCustomModel(url) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/');
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const find = (names) => {
    let hit = null;
    model.traverse((o) => { if (!hit && names.includes(norm(o.name))) hit = o; });
    return hit;
  };
  const torso = find(CONFIG.bones.torso);
  const neck1 = find(CONFIG.bones.neck1);
  const neck2 = find(CONFIG.bones.neck2) || neck1;
  const head = find(CONFIG.bones.head) || neck2;
  if (!torso || !neck1) {
    console.warn('[tvhead] No bones matching CONFIG.bones found, using the built-in character.');
    return;
  }
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    if (o.isSkinnedMesh) o.frustumCulled = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((mm) => mm && mm.name === 'Screen')) {
      // glTF UVs start at the top; the face shader expects v = 0 at the bottom.
      const uv = o.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      uv.needsUpdate = true;
      o.material = screenMat;
    }
  });
  model.position.y = character.root.position.y;
  character.root.visible = false;
  scene.add(model);
  rig = { torso, neck1, neck2, head };
  rest = captureRest(rig);
  headRestY = head.position.y;

  // Optional extras the site animates if the model has them.
  const pivots = ['antennal', 'antennar'].map((n) => find([n])).filter(Boolean);
  if (pivots.length) {
    antennas = pivots.map((o, i) => ({ arm: o, baseZ: o.rotation.z, baseX: o.rotation.x, side: i ? 1 : -1 }));
  }
  screenLightAnchor = find(['screenlight']) || head;
  if (find(['c0a'])) {
    cables = createCables(model, CONFIG.accent);
    scene.add(cables.group);
  }
  const sweater = find(['sweater']);
  if (sweater && CONFIG.ticker) addChestDecal(sweater, CONFIG.ticker, CONFIG.accent);
  customModel = model;
}
let antennas = character.antennas;
let screenLightAnchor = character.screenLightAnchor;
let headRestY = character.rig.head.position.y;
let customModel = null;

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
// Ambient occlusion (contact shadows in creases) on desktop GPUs only.
const isSmall = Math.min(window.innerWidth, window.innerHeight) < 700 || matchMedia('(hover: none)').matches
  || new URLSearchParams(location.search).has('lite');
if (!isSmall) {
  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({ radius: 0.35, distanceFallOff: 1, thickness: 1, scale: 1.2 });
  composer.addPass(gtao);
}
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.55, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finish = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGlitch: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uGlitch;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * (0.006 + uGlitch * 0.02) * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col *= 1.0 - r2 * 1.1;
      col += (hash(vUv * uRes + fract(uTime) * 100.0) - 0.5) * 0.045;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(finish);

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const mouse = new THREE.Vector2();       // raw target, -1..1
const fast = new THREE.Vector2();        // eyes
const mid = new THREE.Vector2();         // head
const slow = new THREE.Vector2();        // body & camera
const cursorEl = document.querySelector('[data-cursor]');
let lastMove = -10;
let elapsed = 0;

function setPointer(x, y) {
  mouse.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  lastMove = elapsed;
}

window.addEventListener('pointermove', (e) => {
  setPointer(e.clientX, e.clientY);
  cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
});

// Phones: tilt to look around.
function onOrientation(e) {
  if (e.gamma == null) return;
  mouse.set(THREE.MathUtils.clamp(e.gamma / 25, -1, 1), THREE.MathUtils.clamp((45 - e.beta) / 25, -1, 1));
  lastMove = elapsed;
}
window.addEventListener('deviceorientation', onOrientation);
window.addEventListener('touchstart', () => {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') D.requestPermission().catch(() => {});
}, { once: true });

// ---------------------------------------------------------------------------
// Expressions & gestures
// ---------------------------------------------------------------------------
const additive = { neck2X: 0, neck2Z: 0, neck1Y: 0, torsoX: 0, headY: 0 };

function nodYes() {
  const tl = gsap.timeline();
  const a = 0.09;
  tl.to(additive, { neck2X: a, duration: 0.18, ease: 'power1.inOut' })
    .to(additive, { neck2X: -a * 0.6, duration: 0.2, ease: 'power1.inOut' })
    .to(additive, { neck2X: a * 0.7, duration: 0.2, ease: 'power1.inOut' })
    .to(additive, { neck2X: 0, duration: 0.35, ease: 'power2.out' });
  return tl;
}

function shakeNo() {
  const tl = gsap.timeline();
  const a = 0.16;
  tl.to(additive, { neck1Y: -a, duration: 0.16, ease: 'power1.inOut' })
    .to(additive, { neck1Y: a, duration: 0.22, ease: 'power1.inOut' })
    .to(additive, { neck1Y: -a * 0.6, duration: 0.2, ease: 'power1.inOut' })
    .to(additive, { neck1Y: 0, duration: 0.35, ease: 'power2.out' });
  return tl;
}

function bump() {
  gsap.timeline()
    .to(additive, { torsoX: -0.05, headY: 0.06, duration: 0.12, ease: 'power2.out' })
    .to(additive, { torsoX: 0, headY: 0, duration: 0.9, ease: 'elastic.out(1, 0.35)' });
}

function glitch(strength = 1, dur = 0.45) {
  gsap.timeline()
    .to(U.uGlitch, { value: strength, duration: 0.05 })
    .to(finish.uniforms.uGlitch, { value: strength * 0.6, duration: 0.05 }, 0)
    .to(U.uGlitch, { value: 0, duration: dur, ease: 'power2.in' })
    .to(finish.uniforms.uGlitch, { value: 0, duration: dur, ease: 'power2.in' }, '<');
}

// The market mood sets a resting expression; reactions return to it afterwards.
const baseline = { happy: 0, sad: 0 };

function expression(name, hold = 2.2) {
  const target = { happy: 0, surprise: 0, sad: 0 };
  if (name === 'happy') target.happy = 1;
  if (name === 'surprise') target.surprise = 1;
  if (name === 'sad') target.sad = 1;
  gsap.to(U.uHappy, { value: target.happy, duration: 0.25, ease: 'power2.out' });
  gsap.to(U.uSurprise, { value: target.surprise, duration: 0.2, ease: 'power2.out' });
  gsap.to(U.uSad, { value: target.sad, duration: 0.3, ease: 'power2.out' });
  if (name !== 'neutral') gsap.delayedCall(hold, restExpression);
}

function restExpression() {
  gsap.to(U.uHappy, { value: baseline.happy, duration: 0.5 });
  gsap.to(U.uSurprise, { value: 0, duration: 0.4 });
  gsap.to(U.uSad, { value: baseline.sad, duration: 0.5 });
}

// Channel change like a real set: picture loses vertical hold and rolls,
// static bursts in, then the new signal locks.
function channelSwitch(onLocked) {
  gsap.timeline()
    .to(U.uStatic, { value: 1, duration: 0.05 })
    .to(U.uWobble, { value: 1, duration: 0.05 }, 0)
    .fromTo(U.uRoll, { value: 0 }, { value: 1.0, duration: 0.5, ease: 'power2.in' }, 0)
    .add(() => onLocked?.(), 0.25)
    .to(U.uStatic, { value: 0, duration: 0.35, ease: 'power3.in' }, 0.3)
    .to(U.uWobble, { value: 0, duration: 0.6, ease: 'power2.out' }, 0.3)
    .set(U.uRoll, { value: 0 });
  glitch(0.8, 0.6);
}

let blinkTimer = 2;
function blink() {
  const tl = gsap.timeline();
  tl.to(U.uBlink, { value: 1, duration: 0.06, ease: 'power2.in' }).to(U.uBlink, { value: 0, duration: 0.12, ease: 'power2.out' });
  if (Math.random() < 0.2) tl.to(U.uBlink, { value: 1, duration: 0.06 }).to(U.uBlink, { value: 0, duration: 0.12 });
}

// Click the TV to poke it.
const raycaster = new THREE.Raycaster();
function hitsTV(x, y) {
  const p = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(p, camera);
  const target = customModel ? rig.head : character.tv;
  return raycaster.intersectObject(target, true).length > 0;
}

window.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button, a')) return;
  if (hitsTV(e.clientX, e.clientY)) {
    expression('surprise', 1.2);
    glitch(0.8);
    bump();
    gsap.delayedCall(1.3, () => { expression('happy', 1.6); nodYes(); });
  }
});

window.addEventListener('pointermove', (e) => {
  const over = e.target.closest('button, a') || hitsTV(e.clientX, e.clientY);
  cursorEl.classList.toggle('big', !!over);
}, { passive: true });

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
const msgEl = document.querySelector('[data-msg]');
const choicesEl = document.querySelector('[data-choices]');
let typing = null;
let talking = false;

const SCRIPT = {
  start: {
    text: () => `gm. i'm ${CONFIG.name}, a tv that watches the ${CONFIG.ticker} chart 24/7. move your mouse, i'm watching you too.`,
    choices: [[() => `what is ${CONFIG.ticker}?`, 'what'], ['show me the chart', 'chart'], ['what are you thinking?', 'think'], ['copy CA', 'ca']],
  },
  what: {
    text: () => `${CONFIG.ticker} is a memecoin with a tv for a head. no roadmap, just vibes, antennas and a very honest screen.`,
    do: () => nodYes(),
    choices: [['show me the chart', 'chart'], ['how do i buy?', 'buy'], ['back', 'start']],
  },
  chart: {
    text: () => `switching to channel ${CONFIG.ticker}...`,
    do: () => showChart(7),
    choices: [['how are we doing?', 'mood'], ['back', 'start']],
  },
  think: {
    text: () => 'switching to my internal monologue. it is mostly numbers and vibes.',
    do: () => showChannel('terminal', 8),
    choices: [['how are we doing?', 'mood'], ['back', 'start']],
  },
  mood: {
    text: () => {
      const s = market.state;
      const m = moodFrom(s.change);
      const line = m === 'pump' ? 'we are pumping. my screen is literally green.'
        : m === 'dump' ? 'we are dipping. i am fine. this is fine.'
        : 'sideways. tuning my knobs and waiting.';
      return `${line} 1h ${formatPct(s.change.h1)}, 24h ${formatPct(s.change.h24)}.`;
    },
    do: () => { const m = moodFrom(market.state.change); if (m === 'pump') { expression('happy', 2); nodYes(); } else if (m === 'dump') { expression('sad', 2.5); shakeNo(); } else nodYes(); },
    choices: [['show me the chart', 'chart'], ['copy CA', 'ca'], ['back', 'start']],
  },
  buy: {
    text: () => CONFIG.contractAddress ? 'copy the CA up top, or hit the buy button. only spend what you are happy to lose to a tv.' : 'not launched yet. stay tuned to this channel.',
    do: () => expression('happy'),
    choices: [['copy CA', 'ca'], ['back', 'start']],
  },
  ca: {
    text: () => CONFIG.contractAddress ? 'copied. always double check the address.' : 'no CA yet. anyone posting one before launch is lying.',
    do: () => { copyCA(); expression(CONFIG.contractAddress ? 'happy' : 'surprise', 1.5); },
    choices: [['how do i buy?', 'buy'], ['back', 'start']],
  },
};

function say(id) {
  const node = SCRIPT[id];
  choicesEl.innerHTML = '';
  if (typing) typing.kill();
  node.do?.();
  const text = typeof node.text === 'function' ? node.text() : node.text;
  const state = { n: 0 };
  talking = true;
  typing = gsap.to(state, {
    n: text.length,
    duration: text.length * 0.024,
    ease: 'none',
    onUpdate: () => {
      msgEl.innerHTML = '';
      msgEl.append(text.slice(0, Math.round(state.n)));
      const caret = document.createElement('span');
      caret.className = 'caret';
      msgEl.append(caret);
    },
    onComplete: () => {
      talking = false;
      node.choices.forEach(([label, next], i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = typeof label === 'function' ? label() : label;
        b.addEventListener('click', () => say(next));
        choicesEl.append(b);
        setTimeout(() => b.classList.add('in'), 80 * i + 30);
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Memecoin layer: market data, agent feed, mood colours, header
// ---------------------------------------------------------------------------
const market = createMarket({ chain: CONFIG.chain, contractAddress: CONFIG.contractAddress });
const agent = createAgent(market, CONFIG.ticker);
const chartCanvas = createChartCanvas(CONFIG.ticker);
const chartTexture = new THREE.CanvasTexture(chartCanvas.canvas);
U.tChart.value = chartTexture;

const $ = (sel) => document.querySelector(sel);
const statEls = { price: $('[data-stat="price"]'), h24: $('[data-stat="h24"]'), mcap: $('[data-stat="mcap"]') };
const feedEl = $('[data-feed]');
const toastEl = $('[data-toast]');

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

function copyCA() {
  if (!CONFIG.contractAddress) { toast('CA not live yet'); return; }
  navigator.clipboard?.writeText(CONFIG.contractAddress).then(() => toast('CA copied'), () => toast(CONFIG.contractAddress));
}

// Channels: 0 = face, then chart, terminal and any videos from CONFIG.screenVideos.
const terminal = createTerminalCanvas(CONFIG.ticker);
const terminalTexture = new THREE.CanvasTexture(terminal.canvas);
U.tTerm.value = terminalTexture;
const videos = CONFIG.screenVideos.map((src) => {
  const v = document.createElement('video');
  Object.assign(v, { src, muted: true, loop: true, playsInline: true, crossOrigin: 'anonymous', preload: 'auto' });
  return v;
});
let channelTimer = null;
let onChannel = 'face';

function tuneTo(name) {
  channelSwitch(() => {
    U.uChart.value = name === 'chart' ? 1 : 0;
    U.uTerm.value = name === 'terminal' ? 1 : 0;
    U.uVideo.value = name.startsWith('video') ? 1 : 0;
    videos.forEach((v) => v.pause());
    if (name.startsWith('video')) {
      const v = videos[Number(name.slice(5))];
      v.currentTime = 0;
      v.play().catch(() => {});
      U.tVideo.value = new THREE.VideoTexture(v);
    }
    onChannel = name;
  });
}

function showChannel(name, seconds = 6) {
  clearTimeout(channelTimer);
  tuneTo(name);
  channelTimer = setTimeout(() => tuneTo('face'), seconds * 1000);
}

function showChart(seconds = 6) { showChannel('chart', seconds); }

// Accent colour follows the market: green pump, red dump.
const accentNow = new THREE.Color(CONFIG.accent);
function setAccent(hex) {
  const from = accentNow.clone();
  const to = new THREE.Color(hex);
  const o = { t: 0 };
  gsap.to(o, {
    t: 1,
    duration: 1.2,
    ease: 'power2.inOut',
    onUpdate: () => {
      accentNow.copy(from).lerp(to, o.t);
      U.uColor.value.copy(accentNow);
      screenLight.color.copy(accentNow);
      rimL.color.copy(accentNow);
      backdrop.material.uniforms.uColor.value.copy(accentNow);
      document.documentElement.style.setProperty('--accent', `#${accentNow.getHexString()}`);
    },
  });
}

let lastMood = null;
let pendingMood = null;
let pendingCount = 0;
let lastMoodChange = -Infinity;
market.onUpdate((st) => {
  statEls.price.textContent = formatPrice(st.price);
  statEls.h24.textContent = formatPct(st.change.h24);
  statEls.h24.className = st.change.h24 >= 0 ? 'up' : 'down';
  statEls.mcap.textContent = formatUsd(st.marketCap);
  chartCanvas.draw(st);
  chartTexture.needsUpdate = true;
  if (!CONFIG.links.chart && st.url) $('[data-link="chart"]')?.setAttribute('href', st.url);

  // Hysteresis: a new mood must hold for two updates and 15 s must pass between changes.
  const raw = moodFrom(st.change);
  pendingCount = raw === pendingMood ? pendingCount + 1 : 1;
  pendingMood = raw;
  const mood = lastMood === null || (pendingCount >= 2 && performance.now() - lastMoodChange > 15000) ? raw : lastMood;
  if (mood !== lastMood) {
    lastMoodChange = performance.now();
    baseline.happy = mood === 'pump' ? 1 : 0;
    baseline.sad = mood === 'dump' ? 0.8 : 0;
    setAccent(mood === 'pump' ? CONFIG.pumpColor : mood === 'dump' ? CONFIG.dumpColor : CONFIG.accent);
    if (lastMood) { glitch(0.7); mood === 'pump' ? nodYes() : mood === 'dump' ? shakeNo() : null; }
    restExpression();
    lastMood = mood;
  }
});

function pushFeed(text) {
  const li = document.createElement('li');
  li.className = 'new';
  const time = document.createElement('time');
  time.textContent = new Date().toTimeString().slice(0, 5);
  li.append(time, text);
  feedEl.append(li);
  terminal.push(text);
  while (feedEl.children.length > 12) feedEl.firstElementChild.remove();
}

function setupHeader() {
  $('[data-mode]').textContent = market.state.demo ? 'demo' : 'live';
  $('[data-ca-value]').textContent = CONFIG.contractAddress
    ? `${CONFIG.contractAddress.slice(0, 4)}…${CONFIG.contractAddress.slice(-4)}`
    : 'coming soon';
  $('[data-ca]').addEventListener('click', copyCA);
  const buy = $('[data-buy]');
  buy.textContent = `Buy ${CONFIG.ticker}`;
  buy.href = CONFIG.links.buy || '#';
  const nav = $('[data-links]');
  for (const [key, label] of [['chart', 'Chart'], ['x', 'X'], ['telegram', 'Telegram']]) {
    const url = CONFIG.links[key] || (key === 'chart' ? '#' : '');
    if (!url) continue;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = label;
    a.dataset.link = key;
    nav.append(a);
  }
  $('[data-chat-label]').textContent = `// ${CONFIG.name.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  finish.uniforms.uRes.value.set(w, h);
  camera.aspect = w / h;
  // Pull back on tall screens so the whole head fits.
  cameraBase.z = w / h < 0.8 ? 12.8 : w / h < 1.2 ? 10.2 : 8.4;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
const range = (v, a, b) => THREE.MathUtils.lerp(a, b, THREE.MathUtils.smoothstep(v, -1, 1));
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
const antennaState = [{ x: 0, v: 0 }, { x: 0, v: 0 }];
let prevHeadY = 0;
const clock = new THREE.Clock();
const neckA = new THREE.Vector3(), neckB = new THREE.Vector3();

function updateCables(lag) {
  for (const c of character.cables) {
    c.startObj.getWorldPosition(tmpA);
    c.endObj.getWorldPosition(tmpB);
    character.root.worldToLocal(tmpA);
    character.root.worldToLocal(tmpB);
    const c1 = tmpA.clone().add(tmpC.set(c.out * 0.1 + lag.x * 0.25, -0.28 + lag.y * 0.05, 0.03));
    const c2 = tmpB.clone().add(tmpC.set(c.out * 0.12 + lag.x * 0.15, 0.3, 0.02));
    const curve = new THREE.CubicBezierCurve3(tmpA, c1, c2, tmpB);
    c.mesh.geometry.dispose();
    c.mesh.geometry = new THREE.TubeGeometry(curve, 48, c.r, 10, false);
  }
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  const t = elapsed;

  // Idle: wander gaze when the pointer has been still for a while.
  const target = mouse.clone();
  const idle = THREE.MathUtils.smoothstep(t - lastMove, 4, 6);
  if (idle > 0) {
    const wander = new THREE.Vector2(Math.sin(t * 0.31) * 0.6 + Math.sin(t * 0.83) * 0.2, Math.sin(t * 0.47) * 0.3);
    target.lerp(wander, idle);
  }

  fast.x = damp(fast.x, target.x, 9, dt);  fast.y = damp(fast.y, target.y, 9, dt);
  mid.x = damp(mid.x, target.x, 2.6, dt);  mid.y = damp(mid.y, target.y, 2.6, dt);
  slow.x = damp(slow.x, target.x, 1.1, dt); slow.y = damp(slow.y, target.y, 1.1, dt);

  const { torso, neck1, neck2 } = rig;

  // Body follows a little, slowly.
  torso.rotation.y = rest.torso.y + range(slow.x, -0.12, 0.12);
  torso.rotation.x = rest.torso.x + range(slow.y, 0.045, -0.045) + additive.torsoX + Math.sin(t * 1.3) * 0.006;
  torso.rotation.z = rest.torso.z + range(slow.x, 0.012, -0.012);

  // Head leads.
  neck1.rotation.y = rest.neck1.y + range(mid.x, -0.42, 0.42) + additive.neck1Y;
  neck1.rotation.x = rest.neck1.x + range(mid.y, 0.16, -0.2);
  neck1.rotation.z = rest.neck1.z + range(mid.x, 0.07, -0.07);

  // Upper neck: idle sway + gestures.
  neck2.rotation.x = rest.neck2.x + Math.sin(t * 0.51) * 0.035 + additive.neck2X;
  neck2.rotation.z = rest.neck2.z + Math.sin(t * 0.23) * 0.03;
  neck2.rotation.y = rest.neck2.y;

  // Breathing.
  (customModel || character.root).position.y = -0.55 + Math.sin(t * 1.3) * 0.008;
  rig.head.position.y = headRestY + additive.headY;

  // Antennas: damped springs driven by head velocity.
  const headVel = (neck1.rotation.y - prevHeadY) / Math.max(dt, 1e-4);
  prevHeadY = neck1.rotation.y;
  antennas.forEach((a, i) => {
    const s = antennaState[i];
    s.v += (-55 * s.x - 5 * s.v - headVel * 0.9) * dt;
    s.x += s.v * dt;
    a.arm.rotation.z = a.baseZ + s.x * 0.4 + Math.sin(t * 1.7 + i) * 0.01;
    a.arm.rotation.x = a.baseX + s.x * 0.2;
  });

  // Screen face.
  U.uTime.value = t;
  U.uLook.value.set(fast.x, fast.y);
  U.uTalk.value = talking ? 0.35 + 0.35 * Math.sin(t * 22) * Math.sin(t * 7.3) : damp(U.uTalk.value, 0, 12, dt);
  blinkTimer -= dt;
  if (blinkTimer <= 0) { blink(); blinkTimer = 2 + Math.random() * 3.5; }

  // Cables swing from the difference between fast and slow motion.
  if (!customModel) updateCables(tmpC.set(fast.x - slow.x, fast.y - slow.y, 0).clone());

  // Screen light follows the TV and flickers with the picture.
  screenLightAnchor.getWorldPosition(screenLight.position);
  screenLight.intensity = (1.3 + Math.sin(t * 50) * 0.05 + U.uStatic.value * 1.5) * (U.uPower.value / 2.4);

  // Camera parallax.
  camera.position.set(cameraBase.x + slow.x * 0.35, cameraBase.y + slow.y * 0.2, cameraBase.z);
  camera.lookAt(cameraTarget);

  backdrop.material.uniforms.uTime.value = t;
  finish.uniforms.uTime.value = t;
  if (onChannel === 'terminal') { terminal.draw(t); terminalTexture.needsUpdate = true; }
  if (cables) cables.step(dt, rig.neck1.getWorldPosition(neckA), rig.head.getWorldPosition(neckB), 0.235);
  U.uDecay.value = Math.pow(0.8, dt * 60); // phosphor fade, frame-rate independent
  screen.update();
  composer.render();
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
// ?debug exposes internals for automated screenshots.
if (new URLSearchParams(location.search).has('debug')) window.__tvhead = { gsap, U, mouse, character, camera, market, scene };

document.title = CONFIG.name;
document.querySelector('[data-brand]').textContent = CONFIG.name;
setupHeader();
document.documentElement.style.setProperty('--accent', CONFIG.accent);

(async () => {
  if (CONFIG.modelUrl) {
    try { await loadCustomModel(CONFIG.modelUrl); } catch (err) { console.warn('[tvhead] Kunne ikke laste modell:', err); }
  }
  await document.fonts?.ready;
  tick();
  const loader = document.querySelector('[data-loader]');
  gsap.to(loader, { opacity: 0, duration: 0.8, delay: 0.3, onComplete: () => loader.remove() });
  // CRT power-on: a dot, a bright line, then the picture opens up.
  U.uPowerOn.value = 0;
  gsap.timeline({ delay: 0.6 })
    .to(U.uPowerOn, { value: 1, duration: 1.0, ease: 'power3.out' })
    .fromTo(U.uStatic, { value: 0.6 }, { value: 0, duration: 0.8, ease: 'power2.in' }, 0.4)
    .add(() => { nodYes(); say('start'); }, '+=0.1');

  market.start();
  pushFeed('booting agent... signal acquired');
  setInterval(() => pushFeed(agent.next()), 3500);
  // Flip channels now and then.
  const auto = ['chart', 'terminal', ...videos.map((_, i) => `video${i}`)];
  let autoI = 0;
  setInterval(() => { if (!document.hidden && onChannel === 'face') showChannel(auto[autoI++ % auto.length], 7); }, 24000);
})();
