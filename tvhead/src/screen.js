// The TV picture, built like a real CRT in three stages:
//   1. content  – what the "broadcast" is (face, chart, terminal, video, static),
//                 rendered flat into an offscreen 640x500 picture;
//   2. phosphor – the previous frame fades out slowly, so bright things leave
//                 short glowing trails like real phosphor;
//   3. tube     – the shader on the 3D screen: curved glass, aperture-grille
//                 stripes, scanlines, halation, sync wobble, vertical roll,
//                 and the classic power-on/off line.
import * as THREE from 'three';

const W = 640, H = 500;

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const meshVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const contentFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime, uBlink, uHappy, uSurprise, uSad, uTalk, uAspect, uStatic;
uniform float uChart, uTerm, uVideo;
uniform vec2 uLook;
uniform vec3 uColor;
uniform sampler2D tChart, tTerm, tVideo;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sdRoundBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdArc(vec2 p, float ra, float rb, float ap) {
  p.x = abs(p.x); vec2 sc = vec2(sin(ap), cos(ap));
  return ((sc.y * p.x > sc.x * p.y) ? length(p - sc * ra) : abs(length(p) - ra)) - rb;
}
float eye(vec2 p, float side) {
  float h = mix(0.085, 0.006, uBlink);
  vec2 size = mix(vec2(0.052, h), vec2(0.07, max(h, 0.07) * 1.05), uSurprise);
  float pill = sdRoundBox(p, size, min(size.x, size.y));
  float happy = sdArc(p + vec2(0.0, 0.03), 0.065, 0.017, 1.1);
  float sad = max(sdRoundBox(p + vec2(0.0, 0.01), vec2(0.052, 0.07), 0.052), (p.y - 0.005 + 0.45 * side * p.x) * 0.9);
  return mix(mix(pill, happy, uHappy), sad, uSad);
}
float mouth(vec2 p) {
  float smile = sdArc((p - vec2(0.0, 0.16)) * vec2(1.0, -1.0), 0.2, 0.014, 0.42 + 0.18 * uHappy);
  smile = mix(smile, sdArc(p + vec2(0.0, 0.22), 0.2, 0.014, 0.38), uSad);
  vec2 ab = vec2(0.075 + 0.02 * uHappy, 0.012 + 0.055 * uTalk);
  float open = (length(p / ab) - 1.0) * min(ab.x, ab.y);
  float m = mix(smile, open, smoothstep(0.02, 0.15, uTalk));
  return mix(m, abs(length(p) - 0.055) - 0.014, uSurprise);
}
float face(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0) - uLook * vec2(0.075, 0.05);
  float d = min(eye(p - vec2(-0.19, 0.075), -1.0), eye(p - vec2(0.19, 0.075), 1.0));
  d = min(d, mouth(p - vec2(0.0, -0.14)));
  return smoothstep(0.006, -0.004, d) + exp(-max(d, 0.0) * 30.0) * 0.18;
}
void main() {
  vec2 uv = vUv;
  float faceW = clamp(1.0 - uChart - uTerm - uVideo, 0.0, 1.0);
  vec3 col = vec3(0.0);
  if (faceW > 0.0) col += uColor * face(uv) * faceW;
  if (uChart > 0.0) col += uColor * texture2D(tChart, uv).a * 1.1 * uChart;
  if (uTerm > 0.0) col += uColor * texture2D(tTerm, uv).a * uTerm;
  if (uVideo > 0.0) {
    vec3 v = texture2D(tVideo, uv).rgb;
    v = pow(v, vec3(2.2));                    // video is sRGB
    col += v * 1.6 * uVideo;
  }
  col += uColor * 0.025;                      // faint raster glow of a powered tube
  float n = hash(floor(uv * vec2(W_, H_ * 0.5)) + fract(uTime * 61.0) * 100.0);
  col = mix(col, vec3(n * n) * 1.4, uStatic);
  gl_FragColor = vec4(col, 1.0);
}
`.replace('W_', W.toFixed(1)).replace('H_', H.toFixed(1));

const phosphorFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tNow, tPrev;
uniform float uDecay;
void main() {
  vec3 now = texture2D(tNow, vUv).rgb;
  vec3 prev = texture2D(tPrev, vUv).rgb;
  // Green phosphor lingers longest, blue fades first (P22-ish).
  gl_FragColor = vec4(max(now, prev * uDecay * vec3(0.92, 0.97, 0.85)), 1.0);
}
`;

const tubeFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tPicture;
uniform float uTime, uPower, uPowerOn, uGlitch, uRoll, uWobble;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sdRoundBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

void main() {
  float t = uTime;
  vec2 c = vUv - 0.5;
  c *= 1.0 + 0.1 * dot(c, c);                 // curved glass
  vec2 uv = c + 0.5;

  // Power on/off: a bright horizontal line that opens up vertically.
  float open = smoothstep(0.3, 1.0, uPowerOn);
  float lineW = smoothstep(0.0, 0.3, uPowerOn);
  float inLine = step(abs(c.x), 0.5 * lineW);
  uv.y = 0.5 + (uv.y - 0.5) / max(open, 0.004);
  float collapse = 1.0 + (1.0 - open) * 6.0;

  // Sync: tiny horizontal wobble, block tearing on glitch, vertical roll.
  uv.x += sin(uv.y * 30.0 + t * 7.0) * 0.0012 * (1.0 + uWobble * 6.0);
  float band = floor(uv.y * 24.0 + floor(t * 18.0) * 3.1);
  uv.x += (hash(vec2(band, floor(t * 30.0))) - 0.5) * step(0.55, hash(vec2(band, 7.0))) * uGlitch * 0.18;
  float rolled = uv.y + uRoll;
  float rollBar = smoothstep(0.0, 0.02, fract(rolled)) * smoothstep(1.0, 0.98, fract(rolled));
  uv.y = fract(rolled);
  float inside = step(0.0, uv.y) * step(uv.y, 1.0);

  // Picture with a little colour bleed + halation from the blurred mip.
  float split = 0.0012 + uGlitch * 0.012;
  vec3 col;
  col.r = texture2D(tPicture, uv + vec2(split, 0.0)).r;
  col.g = texture2D(tPicture, uv).g;
  col.b = texture2D(tPicture, uv - vec2(split, 0.0)).b;
  vec3 halo = textureLod(tPicture, uv, 4.0).rgb + textureLod(tPicture, uv, 6.0).rgb;
  col += halo * 0.16;

  // Scanlines that get thinner in dark areas and bloom in bright ones.
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  float line = sin(uv.y * 250.0 * 3.14159);
  float scan = mix(0.35, 1.0, pow(abs(line), mix(2.2, 0.6, clamp(lum, 0.0, 1.0))));
  // Interlace: alternate fields flicker very slightly.
  scan *= 1.0 - 0.03 * step(0.5, fract(uv.y * 125.0 + floor(t * 30.0) * 0.5));
  // Aperture grille: vertical RGB phosphor stripes.
  float px = vUv.x * 380.0 * 3.0;
  vec3 mask = vec3(
    0.75 + 0.25 * smoothstep(0.0, 0.5, 1.0 - abs(fract(px / 3.0) * 3.0 - 0.5)),
    0.75 + 0.25 * smoothstep(0.0, 0.5, 1.0 - abs(fract(px / 3.0) * 3.0 - 1.5)),
    0.75 + 0.25 * smoothstep(0.0, 0.5, 1.0 - abs(fract(px / 3.0) * 3.0 - 2.5)));
  col *= scan * mask;

  // Tube: brighter centre, dark rounded corners, slight flicker.
  float vig = 1.0 - smoothstep(0.2, 0.75, length(c * vec2(1.0, 1.15)));
  col *= vig * 0.6 + 0.4;
  col *= smoothstep(0.0, -0.022, sdRoundBox(c, vec2(0.5), 0.09));
  col *= 0.97 + 0.03 * sin(t * 120.0);
  col *= inside * rollBar;
  col *= inLine * step(abs(vUv.y - 0.5) * 2.0, max(open, 0.012)) * collapse;
  col += (hash(vUv * 500.0 + t) - 0.5) * 0.012 * uPowerOn;

  gl_FragColor = vec4(max(col, 0.0) * uPower, 1.0);
}
`;

export function createScreen(renderer, { color, aspect }) {
  const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  const contentRT = new THREE.WebGLRenderTarget(W, H, rtOpts);
  const mipOpts = { ...rtOpts, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter };
  let readRT = new THREE.WebGLRenderTarget(W, H, mipOpts);
  let writeRT = new THREE.WebGLRenderTarget(W, H, mipOpts);

  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  blank.needsUpdate = true;

  // One uniforms object shared by all stages, so callers tween a single set.
  const uniforms = {
    uTime: { value: 0 },
    uLook: { value: new THREE.Vector2() },
    uBlink: { value: 0 },
    uHappy: { value: 0 },
    uSurprise: { value: 0 },
    uSad: { value: 0 },
    uTalk: { value: 0 },
    uAspect: { value: aspect },
    uColor: { value: new THREE.Color(color) },
    uStatic: { value: 0 },
    uChart: { value: 0 },
    uTerm: { value: 0 },
    uVideo: { value: 0 },
    tChart: { value: blank },
    tTerm: { value: blank },
    tVideo: { value: blank },
    uGlitch: { value: 0 },
    uPower: { value: 2.4 },
    uPowerOn: { value: 1 },
    uRoll: { value: 0 },
    uWobble: { value: 0 },
    uDecay: { value: 0.8 },
    tNow: { value: contentRT.texture },
    tPrev: { value: readRT.texture },
    tPicture: { value: readRT.texture },
  };

  const content = new THREE.ShaderMaterial({ vertexShader: quadVertex, fragmentShader: contentFragment, uniforms, depthTest: false });
  const phosphor = new THREE.ShaderMaterial({ vertexShader: quadVertex, fragmentShader: phosphorFragment, uniforms, depthTest: false });
  const material = new THREE.ShaderMaterial({ vertexShader: meshVertex, fragmentShader: tubeFragment, uniforms });
  material.name = 'ScreenTube';

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), content);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.Camera();

  function update() {
    const prevTarget = renderer.getRenderTarget();
    quad.material = content;
    renderer.setRenderTarget(contentRT);
    renderer.render(quadScene, quadCam);
    uniforms.tPrev.value = readRT.texture;
    quad.material = phosphor;
    renderer.setRenderTarget(writeRT);
    renderer.render(quadScene, quadCam);
    [readRT, writeRT] = [writeRT, readRT];
    uniforms.tPicture.value = readRT.texture;
    renderer.setRenderTarget(prevTarget);
  }

  return { material, uniforms, update };
}
