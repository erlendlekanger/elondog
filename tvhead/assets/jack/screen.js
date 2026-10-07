import * as THREE from 'three';
import { SHOWS, SHOW_ORDER } from './shows.js';

const FACE_SIZE = 512;

const MOODS = {
  neutral: { browL: 0, browR: 0, browY: 0, eyeH: 1, eyeW: 1, happy: 0 },
  happy: { browL: -0.05, browR: 0.05, browY: -6, eyeH: 0.9, eyeW: 1.05, happy: 1 },
  smirk: { browL: 0.0, browR: -0.22, browY: 0, eyeH: 0.85, eyeW: 1, happy: 0.35 },
  think: { browL: 0.18, browR: -0.08, browY: -4, eyeH: 0.92, eyeW: 0.95, happy: 0 },
  wow: { browL: 0.08, browR: -0.08, browY: -16, eyeH: 1.22, eyeW: 1.08, happy: 0 },
  focus: { browL: -0.16, browR: 0.16, browY: 6, eyeH: 0.7, eyeW: 1.02, happy: 0 },
};

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uFace;
  uniform sampler2D uVideo;
  uniform float uVideoMix;
  uniform float uTime;
  uniform float uGlitch;
  uniform float uPower;
  uniform vec3 uTint;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  vec2 barrel(vec2 uv, float k) {
    vec2 c = uv - 0.5;
    float r2 = dot(c, c);
    return 0.5 + c * (1.0 + k * r2);
  }

  float stars(vec2 uv) {
    float s = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float scale = 60.0 + fi * 55.0;
      vec2 drift = vec2(uTime * (0.004 + fi * 0.003), uTime * 0.002);
      vec2 g = (uv + drift) * scale;
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float h = hash(id + fi * 17.0);
      if (h > 0.965) {
        vec2 o = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
        float d = length(f - o * 0.7);
        float tw = 0.55 + 0.45 * sin(uTime * (1.5 + h * 4.0) + h * 40.0);
        s += smoothstep(0.09, 0.0, d) * tw * (0.5 + fi * 0.25);
      }
    }
    return s;
  }

  vec3 sampleScreen(vec2 uv, float off) {
    vec3 col = vec3(0.0);
    // face (white strokes on transparent)
    float r = texture2D(uFace, uv + vec2(off, 0.0)).r;
    float g = texture2D(uFace, uv).g;
    float b = texture2D(uFace, uv - vec2(off, 0.0)).b;
    vec3 face = vec3(r, g, b);
    vec3 glow = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 0.5236;
      vec2 o = vec2(cos(a), sin(a));
      glow += texture2D(uFace, uv + o * 0.012).rgb;
      glow += texture2D(uFace, uv + o * 0.028).rgb * 0.6;
    }
    face = face * 1.15 + glow / 19.2 * 0.9;
    // video
    vec3 vid = vec3(
      texture2D(uVideo, uv + vec2(off * 0.6, 0.0)).r,
      texture2D(uVideo, uv).g,
      texture2D(uVideo, uv - vec2(off * 0.6, 0.0)).b
    );
    col = mix(face, vid, uVideoMix);
    return col;
  }

  void main() {
    // screen mesh UVs run 0.06 -> 0.94 vertically
    vec2 uv = vec2(1.0 - vUv.x, 1.0 - (vUv.y - 0.06) / 0.88);
    uv = barrel(uv, 0.08);

    // glitch: horizontal tearing bands
    float band = floor(uv.y * 24.0 + floor(uTime * 18.0));
    float tear = (hash(vec2(band, floor(uTime * 22.0))) - 0.5) * 0.12 * uGlitch;
    tear *= step(0.55, hash(vec2(band * 1.3, floor(uTime * 9.0))));
    uv.x += tear;
    uv.x += sin(uv.y * 340.0 + uTime * 40.0) * 0.0009;

    float off = 0.0045 + uGlitch * 0.02;
    vec3 col = sampleScreen(uv, off);

    // deep space background
    vec3 bg = vec3(0.012, 0.012, 0.018);
    bg += vec3(0.05, 0.035, 0.02) * smoothstep(0.9, 0.0, length(uv - vec2(0.35, 0.65)));
    bg += vec3(1.0, 0.92, 0.85) * stars(uv) * 0.75 * (1.0 - uVideoMix);
    col = bg + col * uTint;

    // static noise on glitches
    float n = hash(uv * 900.0 + fract(uTime * 37.0));
    col = mix(col, vec3(n), uGlitch * 0.55);
    col += (n - 0.5) * 0.045;

    // scanlines + shadow mask
    float scan = 0.82 + 0.18 * sin((uv.y * 340.0 - uTime * 2.0) * 3.14159);
    float mask = 0.92 + 0.08 * sin(uv.x * 900.0);
    col *= scan * mask;

    // rolling refresh bar
    float roll = fract(uTime * 0.11);
    col += vec3(0.035) * smoothstep(0.08, 0.0, abs(uv.y - roll));

    // vignette + edge falloff
    vec2 c = uv - 0.5;
    float vig = smoothstep(0.78, 0.25, length(c * vec2(1.05, 1.0)));
    col *= vig;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    col *= inside;

    // flicker + power
    col *= (0.96 + 0.04 * sin(uTime * 60.0)) * uPower;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class ScreenFace {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = FACE_SIZE;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;

    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.crossOrigin = 'anonymous';
    this.video.setAttribute('playsinline', '');
    this.videoTex = new THREE.VideoTexture(this.video);
    this.videoTex.flipY = false;
    this.videoTex.colorSpace = THREE.SRGBColorSpace;
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    black.needsUpdate = true;
    this.black = black;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      toneMapped: false,
      uniforms: {
        uFace: { value: this.texture },
        uVideo: { value: black },
        uVideoMix: { value: 0 },
        uTime: { value: 0 },
        uGlitch: { value: 0 },
        uPower: { value: 0 },
        uTint: { value: new THREE.Color(1.0, 0.86, 0.68) },
      },
    });

    this.mood = { ...MOODS.neutral };
    this.moodTarget = MOODS.neutral;
    this.blink = 0;
    this.nextBlink = 2;
    this.glitchAmt = 0;
    this.power = 0;
    this.videoMix = 0;
    this.videoWanted = false;
    this.brightness = 0;
    this.text = null;
    this.textAlpha = 0;
    // pump.fun-style broadcasts between lines
    this.show = null;
    this.showState = null;
    this.showT = 0;
    this.showAlpha = 0;
    this.showIdx = 0;
    this.nextShow = 4;
    this.showCanvas = document.createElement('canvas');
    this.showCanvas.width = this.showCanvas.height = FACE_SIZE;
    this.warmTint = new THREE.Color(1.0, 0.86, 0.68);
    this.white = new THREE.Color(1, 1, 1);
    this.eyeLook = new THREE.Vector2();
    this.mouthPhase = 0;
    this.hls = null;
    this.queue = [];
  }

  setMood(name) {
    this.moodTarget = MOODS[name] || MOODS.neutral;
  }

  /** Starts one of the memecoin broadcasts (pill, chart, bonding, ticker). */
  playShow(name, { forced = false } = {}) {
    const def = SHOWS[name];
    if (!def) return;
    this.show = name;
    this.showForced = forced;
    this.showT = 0;
    this.showState = def.init ? def.init() : null;
    this.glitch(0.5);
  }

  endShow() {
    if (!this.show) return;
    this.show = null;
    this.showForced = false;
    this.nextShow = 7 + Math.random() * 5;
    this.glitch(0.4);
  }

  setText(text) {
    this.text = text;
  }

  glitch(strength = 1) {
    this.glitchAmt = Math.max(this.glitchAmt, strength);
  }

  powerOn() {
    this.poweringOn = true;
  }

  /** Plays a list of HLS clips (Mux) on the CRT, then returns to the face. */
  playClips(list) {
    this.queue = (list || []).slice(0, 3);
    if (!this.queue.length) {
      this.stopClip();
      return;
    }
    this.nextClip();
  }

  nextClip() {
    const src = this.queue.shift();
    if (!src) {
      this.stopClip();
      return;
    }
    const v = this.video;
    const Hls = window.Hls;
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    v.onended = () => this.nextClip();
    v.onplaying = () => {
      this.videoWanted = true;
      this.material.uniforms.uVideo.value = this.videoTex;
      this.glitch(0.6);
    };
    v.onerror = () => this.stopClip();
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = src;
    } else if (Hls && Hls.isSupported()) {
      this.hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 10 });
      this.hls.on(Hls.Events.ERROR, (_, d) => d.fatal && this.stopClip());
      this.hls.loadSource(src);
      this.hls.attachMedia(v);
    } else {
      return;
    }
    v.play().catch(() => {});
  }

  stopClip() {
    this.queue = [];
    if (this.videoWanted) this.glitch(0.5);
    this.videoWanted = false;
  }

  update(t, dt, { look, talk }) {
    const u = this.material.uniforms;
    u.uTime.value = t;
    this.glitchAmt *= Math.pow(0.02, dt);
    u.uGlitch.value = this.glitchAmt;
    if (this.poweringOn) this.power = Math.min(1, this.power + dt * 1.6);
    u.uPower.value = this.power;
    this.videoMix += ((this.videoWanted ? 1 : 0) - this.videoMix) * (1 - Math.pow(0.01, dt));
    u.uVideoMix.value = this.videoMix;
    if (this.videoMix < 0.01 && !this.videoWanted && !this.video.paused) {
      this.video.pause();
      u.uVideo.value = this.black;
    }

    // ease mood
    const k = 1 - Math.pow(0.004, dt);
    for (const key in this.mood) this.mood[key] += (this.moodTarget[key] - this.mood[key]) * k;

    // blinking
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 1;
      this.nextBlink = 2.2 + Math.random() * 4 + (Math.random() < 0.15 ? -1.9 : 0);
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const blinkAmt = Math.sin(Math.min(1, this.blink) * Math.PI);

    this.eyeLook.lerp(look, 1 - Math.pow(0.05, dt));
    this.textAlpha += ((this.text ? 1 : 0) - this.textAlpha) * Math.max(0.25, 1 - Math.pow(0.0005, dt));

    // between lines, while JACK is quiet, the CRT drifts into a broadcast
    const idle = talk < 0.2 && !this.videoWanted && !this.text && this.power > 0.9;
    if (this.show) {
      this.showT += dt;
      if (this.showT > SHOWS[this.show].duration || (!idle && !this.showForced)) this.endShow();
    } else if (idle) {
      this.nextShow -= dt;
      if (this.nextShow <= 0) this.playShow(SHOW_ORDER[this.showIdx++ % SHOW_ORDER.length]);
    }
    this.showAlpha += ((this.show ? 1 : 0) - this.showAlpha) * Math.max(0.2, 1 - Math.pow(0.002, dt));
    u.uTint.value.copy(this.warmTint).lerp(this.white, this.showAlpha);

    this.draw(t, blinkAmt, talk);
    this.texture.needsUpdate = true;
    this.brightness = (0.35 + talk * 0.25) * (1 - this.videoMix) * this.power + this.videoMix * 0.6 * this.power;
  }

  draw(t, blinkAmt, talk) {
    const c = this.ctx;
    const S = FACE_SIZE;
    const m = this.mood;
    c.clearRect(0, 0, S, S);
    c.save();
    const faceAlpha = Math.max(0, 1 - this.textAlpha * 1.15) * (1 - this.showAlpha);
    c.globalAlpha = faceAlpha;
    c.translate(S / 2, S / 2);
    c.scale(1.5, 1.5);
    c.translate(-S / 2, -S / 2);

    const lx = this.eyeLook.x * 20;
    const ly = -this.eyeLook.y * 14;
    const cx = S / 2 + lx;
    const cy = S * 0.45 + ly;
    const gap = 76;
    const ew = 56 * m.eyeW;
    const eh = 78 * m.eyeH * (1 - blinkAmt * 0.92);

    c.fillStyle = '#fff';
    c.strokeStyle = '#fff';

    for (const side of [-1, 1]) {
      const ex = cx + side * gap;
      // eye: rounded capsule; happy mood carves the bottom into an arc
      c.beginPath();
      roundRect(c, ex - ew / 2, cy - eh / 2, ew, eh, Math.min(ew, eh) * 0.48);
      c.fill();
      if (m.happy > 0.02) {
        c.save();
        c.globalCompositeOperation = 'destination-out';
        c.beginPath();
        c.ellipse(ex, cy + eh * 0.62, ew * 0.85, eh * 0.55 * m.happy, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
      // brows: heavy, straight bars (JACK's signature)
      const tilt = side < 0 ? m.browL : m.browR;
      const by = cy - 70 * m.eyeH + m.browY - (talk * Math.max(0, Math.sin(t * 5.3 + side)) * 4);
      c.save();
      c.translate(ex, by);
      c.rotate(tilt * side * -1);
      c.beginPath();
      roundRect(c, -40, -7, 80, 14, 7);
      c.fill();
      c.restore();
    }

    // mouth: oscilloscope while talking, relaxed half-smile otherwise
    const my = cy + 118;
    c.lineWidth = 7;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    const mw = 118;
    const amp = talk * 26;
    for (let i = 0; i <= 64; i++) {
      const p = i / 64;
      const x = cx - mw / 2 + p * mw;
      const env = Math.sin(p * Math.PI);
      const wave =
        Math.sin(p * 18 + t * 21) * 0.55 + Math.sin(p * 31 - t * 13) * 0.3 + Math.sin(p * 7 + t * 9) * 0.35;
      const smile = (Math.pow(p - 0.5, 2) * -1 + 0.25) * 22 * (0.4 + m.happy) * (1 - talk);
      const smirk = (p - 0.5) * -10 * (m.browR < -0.1 ? 1 : 0) * (1 - talk);
      const y = my + wave * amp * env + smile + smirk;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
    c.restore();

    if (this.showAlpha > 0.01 && (this.show || this.lastShow)) {
      const name = this.show || this.lastShow;
      const def = SHOWS[name];
      const sc = this.showCanvas.getContext('2d');
      sc.clearRect(0, 0, S, S);
      sc.save();
      def.draw(sc, S, Math.min(1, this.showT / def.duration), t, this.showState);
      sc.restore();
      c.save();
      c.globalAlpha = this.showAlpha;
      c.drawImage(this.showCanvas, 0, 0);
      c.restore();
    }
    if (this.show) this.lastShow = this.show;

    // big screen text (used for names, numbers, reactions)
    if (this.textAlpha > 0.01 && this.text) {
      c.save();
      c.globalAlpha = this.textAlpha;
      c.fillStyle = '#fff';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const lines = String(this.text).split('\n');
      const size = lines.length > 1 ? 64 : this.text.length > 7 ? 64 : 104;
      c.font = `500 ${size}px "Inter Tight", "Helvetica Neue", Arial, sans-serif`;
      lines.forEach((l, i) => c.fillText(l, S / 2, S / 2 + (i - (lines.length - 1) / 2) * size * 1.05));
      c.restore();
    }
  }
}

function roundRect(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
