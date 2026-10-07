// FOMOCARD landing: one fixed WebGL stage behind two pinned sections.
//   earth: night-side globe with city lights and atmosphere, turns and shrinks on scroll,
//          then the card drops in from above, spinning.
//   tube:  the card hangs in a cylinder of photo tiles that spins with the scroll; the
//          tiles are captured into a cube map every few frames so they glint in the card.
import * as THREE from "three";
import { RoomEnvironment } from "./vendor/env/RoomEnvironment.js";

const { gsap, ScrollTrigger, Lenis } = window;
gsap.registerPlugin(ScrollTrigger);

const canvas = document.getElementById("stage");
const isMobile = matchMedia("(pointer: coarse)").matches;
const state = { pE: 0, pT: 0, mx: 0, my: 0 };

// ------------------------------------------------------------ renderer / camera
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setClearColor(0x080808, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0.2, 7);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const loader = new THREE.TextureLoader();
const load = (url, srgb = true) => {
  const t = loader.load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
};

// ------------------------------------------------------------ earth
const SUN = new THREE.Vector3(0.26, 1.39, -3).normalize();
const earthUniforms = {
  uDay: { value: load("assets/earth_day.jpg") },
  uNight: { value: load("assets/earth_night.jpg") },
  uClouds: { value: load("assets/earth_clouds.jpg", false) },
  uSun: { value: SUN },
  uDayAtmo: { value: new THREE.Color("#a3afbd") },
  uTwilight: { value: new THREE.Color("#47649e") },
  uOpacity: { value: 1 },
};
const earthVert = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main() {
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const earth = new THREE.Mesh(
  new THREE.SphereGeometry(1, 96, 96),
  new THREE.ShaderMaterial({
    uniforms: earthUniforms,
    transparent: true,
    vertexShader: earthVert,
    fragmentShader: /* glsl */ `
      uniform sampler2D uDay, uNight, uClouds;
      uniform vec3 uSun, uDayAtmo, uTwilight; uniform float uOpacity;
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vP);
        float sunO = dot(n, uSun);
        vec4 brc = texture2D(uClouds, vUv);           // r: bump, g: roughness, b: clouds
        float cloud = smoothstep(0.2, 1.0, brc.b);
        vec3 day = mix(texture2D(uDay, vUv).rgb, vec3(1.0), clamp(cloud * 2.0, 0.0, 1.0));
        float lit = max(sunO, 0.0);
        vec3 h = normalize(uSun + v);
        float spec = pow(max(dot(n, h), 0.0), 60.0) * (1.0 - brc.g) * (1.0 - cloud) * lit;
        vec3 dayCol = day * (0.04 + 1.25 * lit) + spec * 0.8;
        vec3 night = texture2D(uNight, vUv).rgb * 1.6 * (1.0 - cloud * 0.8);
        vec3 col = mix(night, dayCol, smoothstep(-0.25, 0.5, sunO));
        float fres = 1.0 - abs(dot(v, n));
        vec3 atmo = mix(uTwilight, uDayAtmo, smoothstep(-0.25, 0.75, sunO));
        col = mix(col, atmo, clamp(smoothstep(-0.5, 1.0, sunO) * fres * fres, 0.0, 1.0));
        gl_FragColor = vec4(col, uOpacity);
      }`,
  })
);
const atmosphere = new THREE.Mesh(
  earth.geometry,
  new THREE.ShaderMaterial({
    uniforms: earthUniforms,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: earthVert,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uDayAtmo, uTwilight; uniform float uOpacity;
      varying vec3 vN; varying vec3 vP;
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vP);
        float fres = 1.0 - abs(dot(v, n));
        float sunO = dot(n, uSun);
        float a = pow(clamp((1.0 - (fres - 0.73) / 0.27), 0.0, 1.0), 3.0);
        a *= smoothstep(-0.5, 1.0, sunO);
        vec3 atmo = mix(uTwilight, uDayAtmo, smoothstep(-0.25, 0.75, sunO));
        gl_FragColor = vec4(atmo, a * uOpacity);
      }`,
  })
);
atmosphere.scale.setScalar(1.04);
const earthGroup = new THREE.Group();
earthGroup.add(earth, atmosphere);
earthGroup.position.set(0, -2.15, 0);
scene.add(earthGroup);

// ------------------------------------------------------------ tube of brand cards
// the shops the card pays at, as their own gift cards, circling the FOMOCARD
const BRAND_COUNT = 45;
const TUBE = { rows: 6, cols: 16, radius: 11, tileW: 2.6, tileH: 2.6 * 54 / 85.6, ySpacing: 2.25 };
const tube = new THREE.Group();
const tileMats = [];
const tileTextures = [];
const tilePromises = [];
for (let i = 0; i < BRAND_COUNT; i++) {
  tilePromises.push(new Promise((res) => {
    const t = loader.load(`assets/brands/${String(i).padStart(2, "0")}.png`, res, undefined, res);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tileTextures.push(t);
  }));
}
const tileGeo = new THREE.PlaneGeometry(TUBE.tileW, TUBE.tileH);
const rows = [];
for (let r = 0; r < TUBE.rows; r++) {
  const row = new THREE.Group();
  row.position.y = (r - (TUBE.rows - 1) / 2) * TUBE.ySpacing;
  for (let c = 0; c < TUBE.cols; c++) {
    const m = new THREE.MeshBasicMaterial({ map: tileTextures[(r * 11 + c * 3) % BRAND_COUNT], color: 0xa6a6a6, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    tileMats.push(m);
    const tile = new THREE.Mesh(tileGeo, m);
    const a = ((c + (r % 2) * 0.5) / TUBE.cols) * Math.PI * 2;
    tile.position.set(Math.sin(a) * TUBE.radius, 0, Math.cos(a) * TUBE.radius);
    tile.lookAt(0, 0, 0);
    row.add(tile);
  }
  row.userData.speed = (0.55 + 0.7 * (r / (TUBE.rows - 1))) * (r % 2 ? -1 : 1);
  rows.push(row);
  tube.add(row);
}
scene.add(tube);

// ------------------------------------------------------------ card
const CARD_W = 2.8, CARD_H = 2.8 * 54 / 85.6, CARD_R = 0.11, CARD_T = 0.035;
function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}
const shape = roundedRect(CARD_W, CARD_H, CARD_R);
function faceGeometry(flip) {
  const g = new THREE.ShapeGeometry(shape, 24);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const u = (p.getX(i) + CARD_W / 2) / CARD_W;
    uv.setXY(i, flip ? 1 - u : u, (p.getY(i) + CARD_H / 2) / CARD_H);
  }
  return g;
}
// reflections: the tube of photos plus a few light strips, baked once into an
// environment map and turned with the tube, so the photos slide across the card
let tubeEnv = null;
function bakeTubeEnv() {
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x050505);
  const copy = tube.clone(true);
  copy.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ map: o.material.map, transparent: true, side: THREE.DoubleSide }); });
  envScene.add(copy);
  const strip = new THREE.MeshBasicMaterial({ color: 0xffffff });
  strip.color.multiplyScalar(6);
  for (const a of [0.4, 2.3, 4.1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 14), strip);
    m.position.set(Math.sin(a) * 9, 0, Math.cos(a) * 9);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  }
  tubeEnv = pmrem.fromScene(envScene, 0.015).texture;
  for (const m of [cardFrontMat, cardBackMat, cardEdgeMat]) { m.envMap = tubeEnv; m.needsUpdate = true; }
}

const frontTex = load("assets/card_front.png");
const cardFrontMat = new THREE.MeshPhysicalMaterial({
  map: frontTex, metalness: 0.75, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04,
  envMapIntensity: 1.6,
});
const cardBackMat = new THREE.MeshPhysicalMaterial({
  map: load("assets/card_back.png"), metalness: 0.75, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04,
  envMapIntensity: 1.6,
});
const cardEdgeMat = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 1, roughness: 0.25 });
const card = new THREE.Group();
const cardBodyMat = new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, metalness: 0.9, roughness: 0.3 });
const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: CARD_T, bevelEnabled: false, curveSegments: 24 }), [cardBodyMat, cardEdgeMat]);
body.position.z = -CARD_T / 2;
const front = new THREE.Mesh(faceGeometry(false), cardFrontMat);
front.position.z = CARD_T / 2 + 0.0005;
const back = new THREE.Mesh(faceGeometry(false), cardBackMat);
back.rotation.y = Math.PI;
back.position.z = -CARD_T / 2 - 0.0005;
card.add(body, front, back);
const cardPivot = new THREE.Group();   // spin around the vertical axis of the hanging card
cardPivot.add(card);
card.rotation.z = Math.PI / 2;         // the card hangs portrait, like a tag
scene.add(cardPivot);

Promise.all(tilePromises).then(() => requestAnimationFrame(bakeTubeEnv));

const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(2, 3, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(0xbfd2ff, 1.2);
rim.position.set(-4, 1, -3);
scene.add(rim);

// ------------------------------------------------------------ scroll
const lenis = new Lenis({ lerp: 0.09 });
lenis.on("scroll", ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);

gsap.fromTo(canvas, { opacity: 0 }, {
  opacity: 1, ease: "none",
  scrollTrigger: { trigger: ".earth", start: "top 90%", end: "top 10%", scrub: true },
});
ScrollTrigger.create({ trigger: ".earth", start: "top top", end: "bottom bottom", scrub: 1, onUpdate: (s) => (state.pE = s.progress) });
ScrollTrigger.create({ trigger: ".tube", start: "top bottom", end: "bottom bottom", scrub: 1, onUpdate: (s) => (state.pT = s.progress) });
gsap.timeline({ scrollTrigger: { trigger: ".earth", start: "top top", end: "30% top", scrub: 1 } })
  .to(".earth-header", { yPercent: -60, opacity: 0, ease: "none" }, 0)
  .to(".earth-points li", { autoAlpha: 0, y: 24, stagger: { amount: 0.2, from: "random" }, ease: "none" }, 0);
gsap.timeline({ scrollTrigger: { trigger: ".tube", start: "40% bottom", end: "60% bottom", scrub: 1 } })
  .to(".tube-copy", { opacity: 1, ease: "none" });

window.addEventListener("pointermove", (e) => {
  state.mx = e.clientX / innerWidth - 0.5;
  state.my = e.clientY / innerHeight - 0.5;
});

// ------------------------------------------------------------ render loop
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const range = (x, a, b) => clamp01((x - a) / (b - a));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep the card a similar size on narrow screens
  camera.fov = w / h < 0.8 ? 50 : 35;
  camera.updateProjectionMatrix();
}
resize();
addEventListener("resize", resize);

const clock = new THREE.Clock();
let frame = 0, tubeIdle = 0;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const { pE, pT } = state;

  // earth: turn, shrink and fade as the section scrolls
  const shrink = easeOut(range(pE, 0.05, 0.75));
  earthGroup.scale.setScalar(1.95 - 1.25 * shrink);
  earthGroup.position.y = -2.15 + 0.9 * shrink;
  earthGroup.rotation.y = -Math.PI / 1.4 + (Math.PI / 1.4 - Math.PI / 5) * pE + t * 0.02;
  const earthAlpha = 1 - range(pE, 0.35, 0.65);
  earthUniforms.uOpacity.value = earthAlpha;
  earthGroup.visible = earthAlpha > 0.001;

  // card: drops in during the end of the earth section, spins once through the tube
  const drop = easeInOut(range(pE, 0.35, 0.85));
  cardPivot.position.y = 0.3 + (1 - drop) * 4.6;
  const spinIn = (1 - drop) * Math.PI * 3;
  const spinTube = easeInOut(range(pT, 0.15, 0.75)) * Math.PI * 2;
  cardPivot.rotation.y = state.forceRot ?? (spinIn + spinTube + Math.sin(t * 0.6) * 0.08 + state.mx * 0.35);
  cardPivot.rotation.x = Math.sin(t * 0.5) * 0.03 + state.my * 0.2;
  cardPivot.visible = drop > 0.001;

  // tube: fades in with the section and spins with the scroll, rows alternating
  const tubeAlpha = range(pT, 0.05, 0.2) * (1 - range(pT, 0.95, 1));
  for (const m of tileMats) m.opacity = tubeAlpha;
  tube.visible = tubeAlpha > 0.001;
  tubeIdle += dt * 0.08;
  rows.forEach((row) => (row.rotation.y = (pT * 3.2 + tubeIdle) * row.userData.speed));
  tube.rotation.x = -0.06;

  // reflections follow the tube; before the tube appears the card reflects a soft room
  const envRot = (pT * 3.2 + tubeIdle) * rows[2].userData.speed - cardPivot.rotation.y;
  for (const m of [cardFrontMat, cardBackMat, cardEdgeMat]) {
    m.envMapRotation.set(0, envRot, 0);
    m.envMapIntensity = 0.5 + 1.6 * tubeAlpha;
  }
  frame++;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
window.__fomo = { state };
tick();
