// Thin cables simulated as verlet ropes. Each starts at an anchor on the
// monitor (c{i}_a, with c{i}_a2 giving the direction it leaves the plug) and
// either ends on the body (c{i}_b / c{i}_b2) or hangs free with a small jack
// plug on the tip. They fall under gravity, swing when the head moves and rest
// on the body via sphere colliders (empties named col_* with a radius `r`).
import * as THREE from 'three';

const GRAVITY = -26;
const SEG = 0.045;
const RINGS = 72;
const SIDES = 8;

const tmp = new THREE.Vector3();

function makeMaterial(kind, accent) {
  const color = kind === 'accent' ? new THREE.Color(accent).multiplyScalar(0.6) : new THREE.Color(0x0a0a0b);
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.15 });
}

function makeTube(radius, material) {
  const geo = new THREE.BufferGeometry();
  const count = RINGS * (SIDES + 1);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const index = [];
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = i * (SIDES + 1) + j, b = a + SIDES + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  geo.setIndex(index);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

export function createCables(model, accent) {
  const find = (name) => model.getObjectByName(name);
  const colliders = [];
  model.traverse((o) => { if (o.name.startsWith('col_') && o.userData.r) colliders.push({ obj: o, r: o.userData.r, pos: new THREE.Vector3() }); });

  const plugMat = new THREE.MeshStandardMaterial({ color: 0xd9d9dc, metalness: 1, roughness: 0.25 });
  const plugGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
  const group = new THREE.Group();
  const cables = [];
  for (let i = 0; ; i++) {
    const a = find(`c${i}_a`);
    if (!a) break;
    const d = a.userData || {};
    const c = {
      a, a2: find(`c${i}_a2`), b: find(`c${i}_b`), b2: find(`c${i}_b2`),
      radius: d.radius ?? 0.012,
      slack: d.slack ?? 1.25,
      freeLength: d.length || 0,
      mesh: makeTube(d.radius ?? 0.012, makeMaterial(d.kind, accent)),
      pts: null, prev: null, seg: SEG,
      // Thin cables keep a memory of being coiled: a gentle helical bend.
      curl: 0.18 + 0.14 * ((i * 0.618) % 1),
      phase: i * 2.4,
    };
    group.add(c.mesh);
    if (!c.b) {
      c.plug = new THREE.Mesh(plugGeo, plugMat);
      c.plug.scale.set(c.radius * 1.6, 0.07, c.radius * 1.6);
      c.plug.castShadow = true;
      group.add(c.plug);
    }
    cables.push(c);
  }

  const curve = new THREE.CatmullRomCurve3([], false, 'centripetal');
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  const pa = new THREE.Vector3(), pa2 = new THREE.Vector3(), pb = new THREE.Vector3(), pb2 = new THREE.Vector3();

  function init(c) {
    c.a.getWorldPosition(pa);
    let length;
    if (c.b) { c.b.getWorldPosition(pb); length = pa.distanceTo(pb) * c.slack; } else length = c.freeLength;
    const n = Math.max(8, Math.round(length / SEG) + 1);
    c.seg = length / (n - 1);
    c.pts = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      c.pts.push(c.b ? pa.clone().lerp(pb, t) : pa.clone().add(new THREE.Vector3(0, -length * t, -0.05 * t)));
    }
    c.prev = c.pts.map((p) => p.clone());
  }

  function step(dt) {
    for (const col of colliders) col.obj.getWorldPosition(col.pos);
    const sub = 3;
    const h = Math.min(dt, 1 / 30) / sub;
    for (const c of cables) {
      if (!c.pts) init(c);
      const n = c.pts.length;
      c.a.getWorldPosition(pa);
      if (c.a2) c.a2.getWorldPosition(pa2); else pa2.copy(pa).y -= 0.07;
      const dirA = pa2.sub(pa).normalize();
      if (c.b) {
        c.b.getWorldPosition(pb);
        if (c.b2) c.b2.getWorldPosition(pb2); else pb2.copy(pb);
      }
      const dirB = c.b ? pb2.sub(pb).normalize() : null;
      for (let s = 0; s < sub; s++) {
        for (let i = 2; i < n; i++) {
          const p = c.pts[i], q = c.prev[i];
          const vx = (p.x - q.x) * 0.99, vy = (p.y - q.y) * 0.99, vz = (p.z - q.z) * 0.99;
          q.copy(p);
          p.x += vx;
          p.y += vy + GRAVITY * h * h;
          p.z += vz;
        }
        c.pts[0].copy(pa); c.prev[0].copy(pa);
        c.pts[1].copy(pa).addScaledVector(dirA, c.seg); c.prev[1].copy(c.pts[1]);
        if (c.b) {
          c.pts[n - 1].copy(pb); c.prev[n - 1].copy(pb);
          c.pts[n - 2].copy(pb).addScaledVector(dirB, c.seg); c.prev[n - 2].copy(c.pts[n - 2]);
        }
        const last = c.b ? n - 3 : n - 1;
        for (let it = 0; it < 14; it++) {
          for (let i = 0; i < n - 1; i++) {
            const p1 = c.pts[i], p2 = c.pts[i + 1];
            const delta = tmp.subVectors(p2, p1);
            const d = delta.length() || 1e-6;
            const diff = (d - c.seg) / d;
            const fixed1 = i <= 1, fixed2 = c.b && i + 1 >= n - 2;
            if (fixed1 && fixed2) continue;
            const w1 = fixed1 ? 0 : fixed2 ? 1 : 0.5;
            const w2 = fixed2 ? 0 : fixed1 ? 1 : 0.5;
            p1.addScaledVector(delta, diff * w1);
            p2.addScaledVector(delta, -diff * w2);
          }
          // Curl: nudge each point sideways in a slowly turning direction.
          for (let i = 2; i <= last - 1; i++) {
            const p0 = c.pts[i - 1], p = c.pts[i], p1 = c.pts[i + 1];
            T.subVectors(p1, p0).normalize();
            N.set(0, 1, 0);
            if (Math.abs(T.y) > 0.9) N.set(1, 0, 0);
            N.cross(T).normalize();
            B.crossVectors(T, N);
            const ang = i * 0.55 + c.phase;
            const k = c.curl * c.seg * 0.12;
            p.x += (N.x * Math.cos(ang) + B.x * Math.sin(ang)) * k;
            p.y += (N.y * Math.cos(ang) + B.y * Math.sin(ang)) * k;
            p.z += (N.z * Math.cos(ang) + B.z * Math.sin(ang)) * k;
          }
          for (let i = 2; i <= last; i++) {
            const p = c.pts[i];
            for (const col of colliders) {
              const min = col.r + c.radius;
              const dx = p.x - col.pos.x, dy = p.y - col.pos.y, dz = p.z - col.pos.z;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < min * min && d2 > 1e-8) {
                const k = min / Math.sqrt(d2);
                p.set(col.pos.x + dx * k, col.pos.y + dy * k, col.pos.z + dz * k);
                // friction: the cable sticks a little where it rests on fabric
                c.prev[i].lerp(p, 0.3);
              }
            }
          }
        }
      }
      writeTube(c);
      if (c.plug) {
        const tip = c.pts[n - 1];
        const dir = tmp.subVectors(tip, c.pts[n - 2]).normalize();
        c.plug.position.copy(tip).addScaledVector(dir, 0.035);
        c.plug.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      }
    }
  }

  function writeTube(c) {
    curve.points = c.pts;
    const pos = c.mesh.geometry.attributes.position.array;
    const nor = c.mesh.geometry.attributes.normal.array;
    for (let i = 0; i < RINGS; i++) {
      const u = i / (RINGS - 1);
      const p = curve.getPointAt(u);
      curve.getTangentAt(u, T);
      if (i === 0) {
        N.set(0, 0, 1);
        if (Math.abs(T.z) > 0.9) N.set(1, 0, 0);
        N.cross(T).normalize();
      } else {
        N.sub(tmp.copy(T).multiplyScalar(N.dot(T))).normalize();   // parallel transport
      }
      B.crossVectors(T, N);
      for (let j = 0; j <= SIDES; j++) {
        const ang = (j / SIDES) * Math.PI * 2;
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const nx = N.x * cs + B.x * sn, ny = N.y * cs + B.y * sn, nz = N.z * cs + B.z * sn;
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
