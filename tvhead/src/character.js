// Procedurally built character: knit-sweater bust, segmented mechanical neck and a
// retro CRT television for a head. The hierarchy mirrors a simple skeleton
// (torso -> neck1 -> neck2 -> head) so a rigged .glb can replace it later.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createScreenMaterial } from './screen.js';
import * as tex from './textures.js';

const SCREEN_W = 1.02;
const SCREEN_H = 0.8;

function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function makeMaterials(accent) {
  const knit = tex.knitNormal();
  const rib = tex.ribNormal();
  return {
    sweater: new THREE.MeshPhysicalMaterial({
      color: 0x1d1e22,
      roughness: 0.92,
      sheen: 1,
      sheenColor: new THREE.Color(0x6b6f78),
      sheenRoughness: 0.55,
      normalMap: knit,
      normalScale: new THREE.Vector2(0.9, 0.9),
    }),
    collar: new THREE.MeshPhysicalMaterial({
      color: 0x1d1e22,
      roughness: 0.9,
      sheen: 1,
      sheenColor: new THREE.Color(0x6b6f78),
      sheenRoughness: 0.5,
      normalMap: rib,
      normalScale: new THREE.Vector2(1.2, 1.2),
    }),
    shell: new THREE.MeshPhysicalMaterial({
      color: 0xd9d2c3,
      roughness: 0.5,
      roughnessMap: tex.plasticRoughness(),
      normalMap: tex.plasticNormal(),
      normalScale: new THREE.Vector2(0.15, 0.15),
      clearcoat: 0.35,
      clearcoatRoughness: 0.35,
    }),
    darkPlastic: new THREE.MeshPhysicalMaterial({ color: 0x0f0f11, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.3 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.7 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.14 }),
    antenna: new THREE.MeshStandardMaterial({ color: 0xb8b8bc, metalness: 1, roughness: 0.28 }),
    brushed: new THREE.MeshStandardMaterial({ color: 0x6c6e74, metalness: 1, roughness: 0.38 }),
    grille: new THREE.MeshStandardMaterial({
      color: 0x2a2a2d,
      roughness: 0.6,
      metalness: 0.3,
      map: tex.grilleColor(),
      normalMap: tex.grilleNormal(),
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      roughness: 0.16,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.18,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      envMapIntensity: 1.4,
    }),
    led: new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(6) }),
    cableBlack: new THREE.MeshPhysicalMaterial({ color: 0x0d0d0e, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    cableAccent: new THREE.MeshPhysicalMaterial({ color: new THREE.Color(accent).multiplyScalar(0.55), roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
  };
}

function buildTorso(m) {
  const torso = new THREE.Group();
  torso.name = 'torso';

  // Bust silhouette: a lathe, squashed front-to-back.
  const profile = new THREE.SplineCurve([
    new THREE.Vector2(0.9, -2.8),
    new THREE.Vector2(0.95, -1.8),
    new THREE.Vector2(1.0, -0.9),
    new THREE.Vector2(1.0, -0.45),
    new THREE.Vector2(0.97, -0.22),
    new THREE.Vector2(0.86, -0.06),
    new THREE.Vector2(0.62, 0.08),
    new THREE.Vector2(0.42, 0.17),
    new THREE.Vector2(0.3, 0.22),
    new THREE.Vector2(0.001, 0.26),
  ]).getPoints(80);
  const body = new THREE.LatheGeometry(profile, 160);
  body.scale(1.22, 1, 0.6);
  body.computeVertexNormals();
  const bodyMat = m.sweater.clone();
  bodyMat.normalMap = m.sweater.normalMap.clone();
  bodyMat.normalMap.repeat.set(36, 18);
  bodyMat.normalMap.needsUpdate = true;
  torso.add(shadowed(new THREE.Mesh(body, bodyMat)));

  // Shoulders and upper arms.
  const armMat = m.sweater.clone();
  armMat.normalMap = m.sweater.normalMap.clone();
  armMat.normalMap.repeat.set(10, 10);
  armMat.normalMap.needsUpdate = true;
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.42, 64, 48), armMat);
    shoulder.scale.set(1.0, 0.92, 0.9);
    shoulder.position.set(side * 1.02, -0.42, 0);
    torso.add(shadowed(shoulder));

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.36, 2.6, 64, 1, true), armMat);
    arm.position.set(side * 1.08, -1.72, 0);
    arm.rotation.z = side * 0.06;
    torso.add(shadowed(arm));
  }

  // Ribbed turtleneck collar.
  const collarGeo = new THREE.CylinderGeometry(0.31, 0.37, 0.34, 128, 6, true);
  const pos = collarGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.012 * Math.sin(a * 48) + 0.04 * (0.17 - Math.abs(y));
    pos.setX(i, x * k);
    pos.setZ(i, z * k * 0.82);
  }
  collarGeo.computeVertexNormals();
  const collarMat = m.collar.clone();
  collarMat.normalMap = m.collar.normalMap.clone();
  collarMat.normalMap.repeat.set(12, 1);
  collarMat.normalMap.needsUpdate = true;
  collarMat.side = THREE.DoubleSide;
  const collar = shadowed(new THREE.Mesh(collarGeo, collarMat));
  collar.position.y = 0.42;
  torso.add(collar);

  const lip = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.315, 0.035, 24, 128), collarMat));
  lip.rotation.x = Math.PI / 2;
  lip.scale.set(1, 0.82, 1);
  lip.position.y = 0.59;
  torso.add(lip);

  return torso;
}

function buildNeckSegment(m, height, count) {
  const g = new THREE.Group();
  const core = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, height, 32), m.rubber));
  core.position.y = height / 2;
  g.add(core);
  for (let i = 0; i < count; i++) {
    const ring = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.045, 48), i % 2 ? m.brushed : m.darkPlastic));
    ring.position.y = (i + 0.5) * (height / count);
    g.add(ring);
    const bevel = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.012, 12, 48), m.brushed));
    bevel.rotation.x = Math.PI / 2;
    bevel.position.y = ring.position.y + 0.022;
    g.add(bevel);
  }
  return g;
}

function buildTV(m, screenMaterial) {
  const tv = new THREE.Group();
  tv.name = 'TV';
  const W = 1.66, H = 1.24, D = 0.62;

  // Front shell.
  const shell = shadowed(new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 6, 0.1), m.shell));
  tv.add(shell);

  // Tapered CRT back.
  const backGeo = new THREE.BoxGeometry(W * 0.9, H * 0.88, 0.66);
  const bp = backGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    if (bp.getZ(i) < 0) {
      bp.setX(i, bp.getX(i) * 0.58);
      bp.setY(i, bp.getY(i) * 0.62 + 0.04);
    }
  }
  backGeo.computeVertexNormals();
  const back = shadowed(new THREE.Mesh(backGeo, m.shell));
  back.position.z = -D / 2 - 0.3;
  tv.add(back);

  // Vent slots on the back taper.
  const topFront = (H * 0.88) / 2;
  const slope = (topFront - (topFront * 0.62 + 0.04)) / 0.66;
  for (let i = 0; i < 7; i++) {
    const dz = 0.1 + i * 0.07;
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.025), m.darkPlastic);
    slot.position.set(0, topFront - dz * slope + 0.004, -D / 2 + 0.03 - dz);
    slot.rotation.x = -Math.atan(slope);
    tv.add(slot);
  }

  // Screen bezel (bevelled frame).
  const sx = -0.2;
  const outer = roundedRectShape(1.18, 0.98, 0.12);
  outer.holes.push(roundedRectShape(SCREEN_W - 0.02, SCREEN_H - 0.02, 0.1));
  const bezelGeo = new THREE.ExtrudeGeometry(outer, {
    depth: 0.025,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.018,
    bevelSegments: 4,
    curveSegments: 24,
  });
  const bezel = shadowed(new THREE.Mesh(bezelGeo, m.darkPlastic));
  bezel.position.set(sx, 0.02, D / 2 - 0.01);
  tv.add(bezel);

  // Curved CRT glass with the face shader.
  const screenGeo = new THREE.PlaneGeometry(SCREEN_W + 0.04, SCREEN_H + 0.04, 48, 36);
  const sp = screenGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const nx = sp.getX(i) / (SCREEN_W / 2), ny = sp.getY(i) / (SCREEN_H / 2);
    sp.setZ(i, 0.04 * (1 - 0.5 * (nx * nx + ny * ny)));
  }
  screenGeo.computeVertexNormals();
  const screen = new THREE.Mesh(screenGeo, screenMaterial);
  screen.name = 'Screen';
  screen.position.set(sx, 0.02, D / 2 - 0.005);
  tv.add(screen);

  const glass = new THREE.Mesh(screenGeo, m.glass);
  glass.position.copy(screen.position);
  glass.position.z += 0.004;
  glass.renderOrder = 2;
  tv.add(glass);

  // Control panel: two knobs, speaker grille, power LED.
  const px = 0.6;
  for (const [i, y] of [0.27, 0.02].entries()) {
    const knobGeo = new THREE.CylinderGeometry(0.085, 0.09, 0.07, 72, 1);
    const kp = knobGeo.attributes.position;
    for (let j = 0; j < kp.count; j++) {
      const x = kp.getX(j), z = kp.getZ(j);
      const r = Math.hypot(x, z);
      if (r > 0.06) {
        const a = Math.atan2(z, x);
        const k = 1 + 0.035 * (Math.sin(a * 36) > 0 ? 1 : 0);
        kp.setX(j, x * k);
        kp.setZ(j, z * k);
      }
    }
    knobGeo.computeVertexNormals();
    const knob = shadowed(new THREE.Mesh(knobGeo, m.darkPlastic));
    knob.rotation.x = Math.PI / 2;
    knob.position.set(px, y, D / 2 + 0.035);
    tv.add(knob);
    const cap = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.02, 48), m.chrome));
    cap.rotation.x = Math.PI / 2;
    cap.position.set(px, y, D / 2 + 0.075);
    tv.add(cap);
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.01), m.darkPlastic);
    tick.position.set(px, y + 0.025, D / 2 + 0.086);
    tick.rotation.z = i ? -0.7 : 0.4;
    tv.add(tick);
  }

  const grille = shadowed(new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.3, 0.02, 3, 0.008), m.grille));
  grille.position.set(px, -0.31, D / 2 + 0.002);
  tv.add(grille);

  const led = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), m.led);
  led.position.set(px + 0.1, -0.52, D / 2 + 0.005);
  tv.add(led);

  // Neck mount under the TV.
  const mount = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.08, 48), m.darkPlastic));
  mount.position.y = -H / 2 - 0.02;
  tv.add(mount);

  // Rabbit-ear antennas.
  const antennas = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.12, H / 2 + 0.02, -0.2);
    const base = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.06, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), m.darkPlastic));
    pivot.add(base);
    const arm = new THREE.Group();
    arm.rotation.z = -side * 0.62;
    arm.rotation.x = -0.2;
    const rod = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.85, 12), m.antenna));
    rod.position.y = 0.425;
    arm.add(rod);
    const tip = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), m.antenna));
    tip.position.y = 0.85;
    arm.add(tip);
    pivot.add(arm);
    tv.add(pivot);
    antennas.push({ arm, side, baseZ: arm.rotation.z, baseX: arm.rotation.x });
  }

  return { tv, screen, antennas, size: { W, H, D } };
}

export function buildCharacter(accent) {
  const m = makeMaterials(accent);
  const screenMaterial = createScreenMaterial(accent, SCREEN_W / SCREEN_H);

  const root = new THREE.Group();
  const torso = buildTorso(m);
  root.add(torso);

  const neck1 = new THREE.Group();
  neck1.name = 'neck1';
  neck1.position.y = 0.4;
  neck1.add(buildNeckSegment(m, 0.3, 3));
  torso.add(neck1);

  const neck2 = new THREE.Group();
  neck2.name = 'neck2';
  neck2.position.y = 0.3;
  neck2.add(buildNeckSegment(m, 0.18, 2));
  neck1.add(neck2);

  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 0.18;
  neck2.add(head);

  const { tv, screen, antennas, size } = buildTV(m, screenMaterial);
  tv.position.y = size.H / 2 + 0.06;
  head.add(tv);

  // Cable anchors: TV underside -> into the collar.
  const anchors = [
    { from: new THREE.Vector3(-0.42, -size.H / 2 + 0.02, -0.1), to: new THREE.Vector3(-0.26, 0.5, -0.06), r: 0.032, mat: m.cableBlack, out: -1 },
    { from: new THREE.Vector3(-0.3, -size.H / 2 + 0.02, -0.22), to: new THREE.Vector3(-0.18, 0.5, -0.17), r: 0.022, mat: m.cableAccent, out: -1 },
    { from: new THREE.Vector3(0.4, -size.H / 2 + 0.02, -0.18), to: new THREE.Vector3(0.25, 0.5, -0.1), r: 0.028, mat: m.cableBlack, out: 1 },
  ];
  const cables = anchors.map((a) => {
    const startObj = new THREE.Object3D();
    startObj.position.copy(a.from);
    tv.add(startObj);
    const endObj = new THREE.Object3D();
    endObj.position.copy(a.to);
    torso.add(endObj);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), a.mat);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
    return { startObj, endObj, mesh, r: a.r, out: a.out };
  });

  // Point in front of the screen used to place the screen's light.
  const screenLightAnchor = new THREE.Object3D();
  screenLightAnchor.position.set(screen.position.x, -size.H / 2 - 0.15, size.D / 2 + 0.45);
  tv.add(screenLightAnchor);

  return {
    root,
    rig: { torso, neck1, neck2, head },
    tv,
    screen,
    screenMaterial,
    antennas,
    cables,
    screenLightAnchor,
  };
}
