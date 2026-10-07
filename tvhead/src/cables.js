// Cables simulated as verlet ropes between a plug under the TV and a socket in
// the neck. They sag under gravity, swing when the head moves and are pushed
// out of the neck so they never pass through the skin.
import * as THREE from 'three';
import { braidNormal } from './textures.js';

const GRAVITY = new THREE.Vector3(0, -32, 0);
const RINGS = 56;
const SIDES = 10;

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

function makeMaterial(kind, accent) {
  const color = kind === 'accent' ? new THREE.Color(accent).multiplyScalar(0.55)
    : kind === 'grey' ? new THREE.Color(0x3a3b3f) : new THREE.Color(0x0c0c0d);
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: kind === 'grey' ? 0.55 : 0.42,
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
    normalMap: braidNormal(),
    normalScale: new THREE.Vector2(0.8, 0.8),
  });
}

// Tube mesh whose vertices are rewritten every frame (no reallocation).
function makeTube(radius, material) {
  const geo = new THREE.BufferGeometry();
  const count = RINGS * (SIDES + 1);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const uv = new Float32Array(count * 2);
  const index = [];
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j <= SIDES; j++) {
      const k = i * (SIDES + 1) + j;
      uv[k * 2] = (i / (RINGS - 1)) * 40 * radius / 0.03;
      uv[k * 2 + 1] = j / SIDES;
      if (i < RINGS - 1 && j < SIDES) {
        const a = k, b = k + SIDES + 1, c = b + 1, d = a + 1;
        index.push(a, b, d, b, c, d);
      }
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

export function createCables(model, accent) {
  const find = (name) => model.getObjectByName(name);
  const cables = [];
  for (let i = 0; ; i++) {
    const a = find(`c${i}_a`), a2 = find(`c${i}_a2`), b = find(`c${i}_b`), b2 = find(`c${i}_b2`);
    if (!a || !b) break;
    const extras = a.userData || {};
    const radius = extras.radius ?? 0.02;
    const kind = extras.kind ?? 'black';
    const slack = extras.slack ?? 1.25;
    cables.push({ a, a2, b, b2, radius, slack, kind, mesh: makeTube(radius, makeMaterial(kind, accent)), pts: null, prev: null, seg: 0 });
  }
  const group = new THREE.Group();
  cables.forEach((c) => group.add(c.mesh));

  const curve = new THREE.CatmullRomCurve3([], false, 'centripetal');
  const frameT = new THREE.Vector3(), frameN = new THREE.Vector3(), frameB = new THREE.Vector3();

  function init(c) {
    const pa = c.a.getWorldPosition(new THREE.Vector3());
    const pb = c.b.getWorldPosition(new THREE.Vector3());
    const n = 22;
    c.seg = (pa.distanceTo(pb) * c.slack) / (n - 1);
    c.pts = [];
    for (let i = 0; i < n; i++) {
      const p = pa.clone().lerp(pb, i / (n - 1));
      p.y -= Math.sin((i / (n - 1)) * Math.PI) * 0.08;
      c.pts.push(p);
    }
    c.prev = c.pts.map((p) => p.clone());
  }

  // Neck collider: capsule between two bones, elliptical radius.
  function collide(p, r, neckA, neckB, neckR) {
    const ab = tmp.subVectors(neckB, neckA);
    const t = THREE.MathUtils.clamp(tmp2.subVectors(p, neckA).dot(ab) / ab.lengthSq(), 0, 1);
    const closest = tmp2.copy(neckA).addScaledVector(ab, t);
    const d = p.distanceTo(closest);
    const min = neckR + r;
    if (d < min && d > 1e-5) p.sub(closest).multiplyScalar(min / d).add(closest);
  }

  function step(dt, neckA, neckB, neckR) {
    const sub = 2;
    const h = dt / sub;
    for (const c of cables) {
      if (!c.pts) init(c);
      const n = c.pts.length;
      const pa = c.a.getWorldPosition(new THREE.Vector3());
      const pa2 = c.a2 ? c.a2.getWorldPosition(new THREE.Vector3()) : pa.clone().add(new THREE.Vector3(0, -0.07, 0));
      const pb = c.b.getWorldPosition(new THREE.Vector3());
      const pb2 = c.b2 ? c.b2.getWorldPosition(new THREE.Vector3()) : pb.clone();
      const dirA = pa2.sub(pa).normalize();
      const dirB = pb2.sub(pb).normalize();
      for (let s = 0; s < sub; s++) {
        for (let i = 1; i < n - 1; i++) {
          const p = c.pts[i], q = c.prev[i];
          const vx = (p.x - q.x) * 0.985, vy = (p.y - q.y) * 0.985, vz = (p.z - q.z) * 0.985;
          q.copy(p);
          p.x += vx + GRAVITY.x * h * h;
          p.y += vy + GRAVITY.y * h * h;
          p.z += vz + GRAVITY.z * h * h;
        }
        // Pin both ends and make the cable leave each plug along the plug's axis.
        c.pts[0].copy(pa); c.prev[0].copy(pa);
        c.pts[1].copy(pa).addScaledVector(dirA, c.seg); c.prev[1].copy(c.pts[1]);
        c.pts[n - 1].copy(pb); c.prev[n - 1].copy(pb);
        c.pts[n - 2].copy(pb).addScaledVector(dirB, c.seg); c.prev[n - 2].copy(c.pts[n - 2]);
        for (let it = 0; it < 12; it++) {
          for (let i = 0; i < n - 1; i++) {
            const p1 = c.pts[i], p2 = c.pts[i + 1];
            const delta = tmp.subVectors(p2, p1);
            const d = delta.length() || 1e-6;
            const diff = (d - c.seg) / d;
            const pin1 = i <= 1, pin2 = i + 1 >= n - 2;
            if (pin1 && pin2) continue;
            const w1 = pin1 ? 0 : pin2 ? 1 : 0.5;
            const w2 = pin2 ? 0 : pin1 ? 1 : 0.5;
            p1.addScaledVector(delta, diff * w1);
            p2.addScaledVector(delta, -diff * w2);
          }
          for (let i = 2; i < n - 2; i++) collide(c.pts[i], c.radius, neckA, neckB, neckR);
        }
      }
      writeTube(c);
    }
  }

  function writeTube(c) {
    curve.points = c.pts;
    const pos = c.mesh.geometry.attributes.position.array;
    const nor = c.mesh.geometry.attributes.normal.array;
    let first = true;
    for (let i = 0; i < RINGS; i++) {
      const u = i / (RINGS - 1);
      const p = curve.getPointAt(u);
      curve.getTangentAt(u, frameT);
      if (first) {
        // Initial normal: any vector perpendicular to the tangent.
        frameN.set(0, 1, 0);
        if (Math.abs(frameT.y) > 0.9) frameN.set(1, 0, 0);
        frameN.cross(frameT).normalize();
        first = false;
      } else {
        // Parallel transport keeps the tube from twisting.
        frameN.sub(tmp.copy(frameT).multiplyScalar(frameN.dot(frameT))).normalize();
      }
      frameB.crossVectors(frameT, frameN);
      for (let j = 0; j <= SIDES; j++) {
        const a = (j / SIDES) * Math.PI * 2;
        const cx = Math.cos(a), sx = Math.sin(a);
        const nx = frameN.x * cx + frameB.x * sx, ny = frameN.y * cx + frameB.y * sx, nz = frameN.z * cx + frameB.z * sx;
        const k = (i * (SIDES + 1) + j) * 3;
        pos[k] = p.x + nx * c.radius; pos[k + 1] = p.y + ny * c.radius; pos[k + 2] = p.z + nz * c.radius;
        nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
      }
    }
    c.mesh.geometry.attributes.position.needsUpdate = true;
    c.mesh.geometry.attributes.normal.needsUpdate = true;
  }

  return { group, step, count: cables.length };
}
