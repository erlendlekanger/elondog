// Procedural textures, generated once at startup so the site needs no image files.
import * as THREE from 'three';

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Builds a tangent-space normal map from a height function h(u, v) in [0, 1].
function normalMapFrom(size, heightFn, strength) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) h[y * size + x] = heightFn(x / size, y / size);
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x];
      const u = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function grayTexture(size, fn) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const g = Math.max(0, Math.min(1, fn(x / size, y / size))) * 255;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Rib-knit sweater: vertical ribs with little stitch bumps and yarn fuzz.
export function knitNormal() {
  const ribs = 8, stitches = 16;
  return normalMapFrom(256, (u, v) => {
    const rib = Math.abs(Math.sin(u * Math.PI * ribs));
    const row = Math.floor(v * stitches);
    const stitch = Math.abs(Math.sin((v * stitches + (Math.floor(u * ribs) % 2) * 0.5) * Math.PI));
    const fuzz = valueNoise(u * 64, v * 64) * 0.25 + hash(u * 256, v * 256 + row) * 0.08;
    return rib * 0.7 + stitch * rib * 0.35 + fuzz;
  }, 2.2);
}

// Fine rib for the turtleneck collar.
export function ribNormal() {
  return normalMapFrom(128, (u) => Math.abs(Math.sin(u * Math.PI * 4)), 3.0);
}

// Speaker grille: grid of round holes.
export function grilleNormal() {
  const n = 14;
  return normalMapFrom(256, (u, v) => {
    const fx = (u * n) % 1 - 0.5, fy = (v * n) % 1 - 0.5;
    const d = Math.hypot(fx, fy);
    return d < 0.28 ? 0 : d < 0.36 ? (d - 0.28) / 0.08 : 1;
  }, 6.0);
}

export function grilleColor() {
  const n = 14;
  return grayTexture(256, (u, v) => {
    const fx = (u * n) % 1 - 0.5, fy = (v * n) % 1 - 0.5;
    return Math.hypot(fx, fy) < 0.3 ? 0.02 : 0.75;
  });
}

// Slight roughness variation so plastic doesn't look like CG plastic.
export function plasticRoughness() {
  return grayTexture(256, (u, v) => 0.42 + valueNoise(u * 24, v * 24) * 0.12 + hash(u * 256, v * 256) * 0.05);
}

// Micro-bumps for the injection-moulded plastic shell.
export function plasticNormal() {
  return normalMapFrom(256, (u, v) => valueNoise(u * 80, v * 80) * 0.6 + valueNoise(u * 20, v * 20) * 0.4, 0.6);
}
