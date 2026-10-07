import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from '../../vendor/three/addons/environments/RoomEnvironment.js';
import { ScreenFace } from './screen.js';

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerpTable = (table, y) => {
  if (y <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (y <= table[i][0]) {
      const [y0, v0] = table[i - 1];
      const [y1, v1] = table[i];
      return v0 + ((y - y0) / (y1 - y0)) * (v1 - v0);
    }
  }
  return table[table.length - 1][1];
};

// Front-of-chest profile of the base body (y -> max z near the centre line)
const BASE_FRONT = [[-3.5, 0.78], [-3.3, 0.77], [-3.1, 0.75], [-2.9, 0.7], [-2.7, 0.63], [-2.5, 0.56], [-2.3, 0.46], [-2.1, 0.34], [-1.9, 0.23], [-1.7, 0.15], [-1.5, 0.17]];
// The male target: fuller, higher pecs and a flat, straight fall below them
const MALE_FRONT = [[-3.5, 0.66], [-3.3, 0.66], [-3.1, 0.67], [-2.9, 0.68], [-2.7, 0.68], [-2.5, 0.66], [-2.3, 0.6], [-2.1, 0.5], [-1.9, 0.36], [-1.7, 0.22], [-1.5, 0.17]];
// Neck axis (y -> z centre) used to thicken the neck and collar
const NECK_AXIS = [[-1.7, -0.32], [-1.3, -0.25], [-0.9, -0.05], [-0.4, 0.03]];

/**
 * Maps a bind-pose point of the base body onto a broader, flatter-chested male bust.
 * Geometry space equals world space for this rig (identity bind matrix).
 */
function deform(x, y, z, isNeck) {
  if (!isNeck) {
    // 1. Chest: remap the front surface to the male profile.
    if (z > 0 && y < -1.5) {
      const base = lerpTable(BASE_FRONT, y);
      const target = lerpTable(MALE_FRONT, y);
      const frontness = smooth(-0.2, 0.35, z);
      // Pecs sit a little apart from the sternum, keep a subtle centre valley
      const pec = 1 + 0.035 * Math.exp(-Math.pow((Math.abs(x) - 0.55) / 0.3, 2)) * smooth(-2.9, -2.3, y) * (1 - smooth(-2.15, -1.9, y));
      const ratio = (target / base) * pec;
      z = z * (1 + (ratio - 1) * frontness);
    }

    // 2. Shoulders: broader, squarer, with heavier trapezius.
    const below = 1 - smooth(-1.75, -1.35, y); // 0 at the collar, 1 on the body
    x *= 1 + 0.15 * below;
    const shoulderBand = smooth(0.55, 1.3, Math.abs(x)) * smooth(-2.6, -1.9, y) * (1 - smooth(-1.6, -1.35, y));
    y += 0.09 * shoulderBand;
    // A touch more depth through the upper back / lats
    if (z < 0) z *= 1 + 0.08 * below * smooth(-3.4, -2.4, y);
  }

  // 3. Neck + turtleneck collar: thicker and more columnar.
  const neckZone = isNeck ? 1 : smooth(-1.8, -1.35, y);
  if (neckZone > 0) {
    const cz = lerpTable(NECK_AXIS, y);
    x *= 1 + 0.2 * neckZone;
    z = cz + (z - cz) * (1 + 0.16 * neckZone);
  }
  return [x, y, z];
}

/** Applies a deformation to positions and carries the authored (smooth) normals through its Jacobian. */
function applyDeform(geometry, fn) {
  const p = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const e = 0.004;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    n.fromBufferAttribute(nrm, i).normalize();
    t1.set(0, 1, 0);
    if (Math.abs(n.y) > 0.9) t1.set(1, 0, 0);
    t1.cross(n).normalize();
    t2.copy(n).cross(t1).normalize();
    a.fromArray(fn(v.x, v.y, v.z));
    b.fromArray(fn(v.x + t1.x * e, v.y + t1.y * e, v.z + t1.z * e)).sub(a);
    c.fromArray(fn(v.x + t2.x * e, v.y + t2.y * e, v.z + t2.z * e)).sub(a);
    const nn = b.cross(c).normalize();
    if (nn.dot(n) < 0) nn.negate();
    p.setXYZ(i, a.x, a.y, a.z);
    nrm.setXYZ(i, nn.x, nn.y, nn.z);
  }
  p.needsUpdate = true;
  nrm.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function masculinize(geometry, { isNeck = false } = {}) {
  applyDeform(geometry, (x, y, z) => deform(x, y, z, isNeck));
}

export class JackScene {
  constructor(container) {
    this.container = container;
    this.clock = new THREE.Clock();
    this.pointer = new THREE.Vector2();
    this.pointerSmooth = new THREE.Vector2();
    this.talk = 0;
    this.talkTarget = 0;
    this.progress = 0;
    this.progressSmooth = 0;
    this.ready = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
    this.rig = new THREE.Group();
    this.scene.add(this.rig);

    this.face = new ScreenFace();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });
    this.resize();
  }

  async load(onProgress = () => {}) {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_, loaded, total) => onProgress(loaded / total);
    const gltf = await new GLTFLoader(manager).loadAsync('assets/jack/base.glb');

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;
    pmrem.dispose();

    const root = gltf.scene;
    ['Maps', 'Raycaster', 'Plane001', 'FaceCam'].forEach((n) => {
      const o = root.getObjectByName(n);
      if (o) o.visible = false;
    });

    this.buildMaterials(root);

    const body = root.getObjectByName('BodyHP');
    masculinize(body.geometry);
    const neck = root.getObjectByName('Neck');
    masculinize(neck.geometry, { isNeck: true });

    // Neck cables are skinned to the head; push their rest shape out with the thicker neck.
    ['neck_Cables', 'neck_Cables_1', 'Small_Cables', 'SideCables'].forEach((n) => {
      const o = root.getObjectByName(n);
      if (!o?.geometry) return;
      applyDeform(o.geometry, (x, y, z) => [x * (1 + 0.17 * smooth(-1.8, -1.0, y) * (1 - smooth(-0.7, -0.4, y))), y, z]);
    });

    root.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false;
    });

    this.bones = {
      torso: root.getObjectByName('torso'),
      neck1: root.getObjectByName('neck1'),
      neck2: root.getObjectByName('neck2'),
      head: root.getObjectByName('head'),
    };
    this.rest = {};
    for (const [k, b] of Object.entries(this.bones)) {
      this.rest[k] = { q: b.quaternion.clone(), p: b.position.clone(), s: b.scale.clone() };
    }

    // Model's head sits around y ≈ 0.1, body bottom at ≈ -3.5
    this.rig.add(root);
    this.root = root;

    // Studio lights on top of the HDR environment
    const key = new THREE.DirectionalLight(0xfff3e6, 1.6);
    key.position.set(-4, 5, 6);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 2.2);
    rim.position.set(5, 3, -5);
    const fill = new THREE.HemisphereLight(0xe9ecf2, 0x2a2b30, 0.45);
    this.screenLight = new THREE.PointLight(0xffb36b, 0, 3.2, 2);
    this.screenLight.position.set(0, 0.25, 1.9);
    this.scene.add(key, rim, fill);
    root.getObjectByName('TV').add(this.screenLight);
    this.screenLight.position.set(0, -0.6, 0.9);

    this.resize();
    this.ready = true;
    this.renderer.setAnimationLoop(() => this.tick());
  }

  buildMaterials(root) {
    const byName = {};
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        (byName[m.name] ||= []).push({ mesh: o, mat: m });
      });
    });

    // Charcoal rib-knit turtleneck
    byName.Cloth?.forEach(({ mesh, mat }) => {
      const m = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0x1f2023),
        map: mat.map,
        normalMap: mat.normalMap,
        normalScale: new THREE.Vector2(1.25, 1.25),
        roughnessMap: mat.roughnessMap,
        roughness: 1,
        aoMap: mat.aoMap,
        sheen: 1,
        sheenRoughness: 0.55,
        sheenColor: new THREE.Color(0x585b63),
        side: THREE.FrontSide,
      });
      if (mat.map) {
        m.map = mat.map;
        // desaturate the beige scan towards neutral by tinting
      }
      mesh.material = m;
    });

    // Skin: slightly deeper, warmer tone, a touch rougher
    byName.Skin?.forEach(({ mat }) => {
      mat.color = new THREE.Color(0xc4ab9c);
      mat.roughness = 0.52;
    });

    // TV shell: graphite with a satin finish
    byName.light_grey?.forEach(({ mat }) => {
      mat.color = new THREE.Color(0x38383b);
      mat.metalness = 0.45;
      mat.roughness = 0.3;
      mat.envMapIntensity = 1.15;
    });
    byName.plastic_black?.forEach(({ mat }) => {
      mat.color = new THREE.Color(0x0b0b0d);
      mat.roughness = 0.42;
    });
    byName.chrome?.forEach(({ mat }) => {
      mat.color = new THREE.Color(0x8a6a48); // brushed bronze trim
      mat.metalness = 1;
      mat.roughness = 0.22;
    });

    // LED strip: emissive map we paint with the progress
    this.ledCanvas = document.createElement('canvas');
    this.ledCanvas.width = 256;
    this.ledCanvas.height = 4;
    this.ledTex = new THREE.CanvasTexture(this.ledCanvas);
    this.ledTex.colorSpace = THREE.SRGBColorSpace;
    byName.Lights?.forEach(({ mesh, mat }) => {
      mesh.material = new THREE.MeshStandardMaterial({
        color: 0x0c0c0e,
        roughness: 0.5,
        emissive: 0xffffff,
        emissiveMap: this.ledTex,
        emissiveIntensity: 2.4,
      });
    });
    byName['Lights.001']?.forEach(({ mesh }) => {
      mesh.material = new THREE.MeshBasicMaterial({
        map: this.ledTex,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
    });

    // CRT screen
    byName.Screen?.forEach(({ mesh }) => {
      mesh.material = this.face.material;
    });
    // Front glass: faint reflective layer
    byName.ScreenGlow?.forEach(({ mesh }) => {
      if (mesh.name !== 'ScreenGlow') return;
      mesh.material = new THREE.MeshPhysicalMaterial({
        color: 0x000000,
        roughness: 0.06,
        metalness: 0,
        transparent: true,
        opacity: 0.2,
        envMapIntensity: 1.4,
        clearcoat: 1,
        depthWrite: false,
      });
    });
  }

  drawLeds(t) {
    const c = this.ledCanvas.getContext('2d');
    const w = this.ledCanvas.width;
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, 4);
    const n = 6;
    const lit = Math.max(1, Math.round(this.progressSmooth * n));
    for (let i = 0; i < n; i++) {
      const on = i < lit;
      const pulse = i === lit - 1 ? 0.75 + 0.25 * Math.sin(t * 4) : 1;
      if (!on) continue;
      c.fillStyle = `rgba(255, 150, 60, ${pulse})`;
      c.fillRect((i / n + 0.35 / n) * w, 0, (0.3 / n) * w, 4);
    }
    this.ledTex.needsUpdate = true;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const mobile = aspect < 0.9;
    this.mobile = mobile;
    if (mobile) {
      this.camera.fov = 30;
      this.camera.position.set(0, -0.2, 15.5);
      this.target = new THREE.Vector3(0, -1.75, 0);
      this.camera.clearViewOffset();
    } else {
      this.camera.fov = 24;
      this.camera.position.set(0, 0.15, 9.6);
      this.target = new THREE.Vector3(0, -0.3, 0);
      // Shift the character into the right part of the frame
      const shift = Math.min(0.17, 0.11 * aspect);
      this.camera.setViewOffset(w, h, -w * shift, 0, w, h);
    }
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  setTalking(v) {
    this.talkTarget = v;
  }

  setProgress(p) {
    this.progress = p;
  }

  glitch(strength = 1) {
    this.face.glitch(strength);
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    this.pointerSmooth.lerp(this.pointer, 1 - Math.pow(0.02, dt));
    this.talk += (this.talkTarget - this.talk) * (1 - Math.pow(0.001, dt));
    this.progressSmooth += (this.progress - this.progressSmooth) * (1 - Math.pow(0.05, dt));

    const { torso, neck1, neck2, head } = this.bones;
    const R = this.rest;
    const px = this.pointerSmooth.x;
    const py = this.pointerSmooth.y;

    // Breathing
    const breath = Math.sin(t * 1.15) * 0.5 + 0.5;
    torso.position.copy(R.torso.p).add(new THREE.Vector3(0, breath * 0.018, 0));
    torso.scale.set(R.torso.s.x * (1 + breath * 0.006), R.torso.s.y, R.torso.s.z * (1 + breath * 0.012));
    torso.quaternion.copy(R.torso.q).multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.008 * Math.sin(t * 0.4), px * 0.06, Math.sin(t * 0.33) * 0.006))
    );

    // Head looks towards the visitor's pointer; small nods while talking
    const nod = this.talk * (Math.sin(t * 7.3) * 0.012 + Math.sin(t * 3.1) * 0.018);
    const idleX = Math.sin(t * 0.5) * 0.015;
    const idleY = Math.sin(t * 0.27) * 0.03;
    const yaw = px * 0.28 + idleY + (this.mobile ? 0 : -0.06);
    const pitch = -py * 0.14 + idleX + nod;
    neck1.quaternion.copy(R.neck1.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.3, yaw * 0.3, -yaw * 0.04)));
    neck2.quaternion.copy(R.neck2.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.3, yaw * 0.3, 0)));
    head.quaternion.copy(R.head.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.4, yaw * 0.4, Math.sin(t * 0.21) * 0.02)));

    this.face.update(t, dt, { look: this.pointerSmooth, talk: this.talk });
    this.screenLight.intensity = 0.4 + this.face.brightness * 1.4;
    this.drawLeds(t);

    this.renderer.render(this.scene, this.camera);
  }
}
