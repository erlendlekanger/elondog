// CRT screen material: an animated face drawn with signed distance functions,
// plus barrel distortion, scanlines, phosphor mask, rolling band, static and glitch.
import * as THREE from 'three';

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform vec2  uLook;
uniform float uBlink;
uniform float uHappy;
uniform float uSurprise;
uniform float uSad;
uniform float uChart;
uniform sampler2D tChart;
uniform float uTalk;
uniform float uGlitch;
uniform float uStatic;
uniform float uPower;
uniform float uAspect;
uniform vec3  uColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Arc of radius ra and thickness rb, spanning +-aperture around the +y axis.
float sdArc(vec2 p, float ra, float rb, float aperture) {
  p.x = abs(p.x);
  vec2 sc = vec2(sin(aperture), cos(aperture));
  return ((sc.y * p.x > sc.x * p.y) ? length(p - sc * ra) : abs(length(p) - ra)) - rb;
}

float eye(vec2 p, float side) {
  // neutral / blinking pill
  float h = mix(0.085, 0.006, uBlink);
  vec2 size = mix(vec2(0.052, h), vec2(0.07, max(h, 0.07) * 1.05), uSurprise);
  float pill = sdRoundBox(p, size, min(size.x, size.y));
  // happy ^ eye
  float happy = sdArc(p + vec2(0.0, 0.03), 0.065, 0.017, 1.1);
  // sad: droopy lids cut the top of the pill, lower on the outer side
  float sad = max(sdRoundBox(p + vec2(0.0, 0.01), vec2(0.052, 0.07), 0.052), (p.y - 0.005 + 0.45 * side * p.x) * 0.9);
  return mix(mix(pill, happy, uHappy), sad, uSad);
}

float mouth(vec2 p) {
  float smile = sdArc((p - vec2(0.0, 0.16)) * vec2(1.0, -1.0), 0.2, 0.014, 0.42 + 0.18 * uHappy);
  vec2 ab = vec2(0.075 + 0.02 * uHappy, 0.012 + 0.055 * uTalk);
  float open = (length(p / ab) - 1.0) * min(ab.x, ab.y);
  float o = length(p) - 0.055;
  float frown = sdArc(p + vec2(0.0, 0.22), 0.2, 0.014, 0.38);
  smile = mix(smile, frown, uSad);
  float m = mix(smile, open, smoothstep(0.02, 0.15, uTalk));
  return mix(m, abs(o) - 0.014, uSurprise);
}

float face(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  p -= uLook * vec2(0.075, 0.05);
  float d = min(eye(p - vec2(-0.19, 0.075), -1.0), eye(p - vec2(0.19, 0.075), 1.0));
  d = min(d, mouth(p - vec2(0.0, -0.14)));
  float core = smoothstep(0.004, -0.003, d);
  float halo = exp(-max(d, 0.0) * 38.0) * 0.32;
  return core + halo;
}

float chart(vec2 uv) {
  float a = texture2D(tChart, uv).a;
  return a * 1.1;
}

float picture(vec2 uv) {
  float f = uChart < 0.999 ? face(uv) : 0.0;
  float ch = uChart > 0.001 ? chart(uv) : 0.0;
  return mix(f, ch, uChart);
}

void main() {
  // barrel distortion
  vec2 c = vUv - 0.5;
  c *= 1.0 + 0.09 * dot(c, c);
  vec2 uv = c + 0.5;

  // glitch: horizontal block tearing
  float t = uTime;
  float band = floor(uv.y * 24.0 + floor(t * 18.0) * 3.1);
  float tear = (hash(vec2(band, floor(t * 30.0))) - 0.5) * step(0.55, hash(vec2(band, 7.0))) * uGlitch;
  uv.x += tear * 0.18;
  float split = 0.004 + uGlitch * 0.02;

  vec3 col;
  col.r = picture(uv + vec2(split, 0.0));
  col.g = picture(uv);
  col.b = picture(uv - vec2(split, 0.0));
  col = vec3(col.g * 0.25 + col.r * 0.75, col.g, col.g * 0.25 + col.b * 0.75) * uColor;

  // phosphor background glow
  float vig = 1.0 - smoothstep(0.15, 0.75, length(c * vec2(1.0, 1.2)));
  col += uColor * 0.035 * vig;

  // rolling refresh band
  float roll = smoothstep(0.0, 0.08, fract(uv.y * 0.7 - t * 0.12)) * (1.0 - smoothstep(0.08, 0.2, fract(uv.y * 0.7 - t * 0.12)));
  col *= 1.0 + roll * 0.25;

  // scanlines + aperture-grille mask
  float scan = 0.72 + 0.28 * sin(uv.y * 260.0 * 3.14159);
  float mask = 0.85 + 0.15 * sin(gl_FragCoord.x * 2.094);
  col *= scan * mask;

  // static noise
  float n = hash(floor(uv * vec2(260.0, 200.0)) + fract(t * 61.0) * 100.0);
  col = mix(col, vec3(n) * 0.9 * (0.6 + 0.4 * scan), uStatic);
  col += (hash(uv * 400.0 + t) - 0.5) * 0.02;

  // flicker
  col *= 0.96 + 0.04 * sin(t * 120.0) * hash(vec2(floor(t * 10.0)));

  // dark rounded corners of the tube
  float corner = sdRoundBox(c, vec2(0.5), 0.09);
  col *= smoothstep(0.0, -0.025, corner);
  col *= vig * 0.55 + 0.45;

  gl_FragColor = vec4(max(col, 0.0) * uPower, 1.0);
}
`;

export function createScreenMaterial(color, aspect) {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uTime: { value: 0 },
      uLook: { value: new THREE.Vector2() },
      uBlink: { value: 0 },
      uHappy: { value: 0 },
      uSurprise: { value: 0 },
      uSad: { value: 0 },
      uChart: { value: 0 },
      tChart: { value: null },
      uTalk: { value: 0 },
      uGlitch: { value: 0 },
      uStatic: { value: 0 },
      uPower: { value: 3.2 },
      uAspect: { value: aspect },
      uColor: { value: new THREE.Color(color) },
    },
  });
}
