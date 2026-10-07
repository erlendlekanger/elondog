// Small synthesized sound design: a warm room-tone drone, UI ticks, CRT glitches,
// and the agent’s voice through the browser’s speech engine (male voices only).

const MALE_VOICES = [
  'Microsoft Andrew', 'Microsoft Guy', 'Microsoft Ryan', 'Microsoft Christopher', 'Microsoft Davis', 'Microsoft Eric', 'Microsoft Brian',
  'Google UK English Male', 'Daniel', 'Aaron', 'Arthur', 'Alex', 'Fred', 'Rishi', 'Oliver', 'Tom', 'Evan', 'Nathan', 'Reed', 'Ralph', 'Eddy', 'Gordon', 'Lee', 'Thomas', 'Microsoft David', 'Microsoft Mark',
];

export class SoundBoard {
  constructor() {
    this.ctx = null;
    this.muted = true;
    this.voice = null;
    if ('speechSynthesis' in window) {
      const load = () => (this.voice = this.pickVoice());
      load();
      window.speechSynthesis.addEventListener?.('voiceschanged', load);
    }
  }

  pickVoice() {
    const voices = window.speechSynthesis.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
    for (const name of MALE_VOICES) {
      const v = voices.find((x) => x.name.includes(name) && !/female/i.test(x.name));
      if (v) return v;
    }
    return voices.find((v) => /\bmale\b/i.test(v.name) && !/female/i.test(v.name)) || null;
  }

  unlock(muted) {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
      this.buildAmbient();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.setMuted(muted);
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 1, t, 0.4);
  }

  buildAmbient() {
    const c = this.ctx;
    const bus = c.createGain();
    bus.gain.value = 0.05;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 0.6;
    bus.connect(lp).connect(this.master);

    // two detuned low saws, slowly breathing
    [55, 82.5, 110.3].forEach((f, i) => {
      const o = c.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (i - 1) * 7;
      const g = c.createGain();
      g.gain.value = i === 2 ? 0.25 : 0.4;
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.03;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 0.18;
      lfo.connect(lfoGain).connect(g.gain);
      o.connect(g).connect(bus);
      o.start();
      lfo.start();
    });

    // CRT hum and hiss
    const hum = c.createOscillator();
    hum.frequency.value = 60;
    const humGain = c.createGain();
    humGain.gain.value = 0.006;
    hum.connect(humGain).connect(this.master);
    hum.start();

    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer(2);
    noise.loop = true;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const ng = c.createGain();
    ng.gain.value = 0.004;
    noise.connect(hp).connect(ng).connect(this.master);
    noise.start();
  }

  noiseBuffer(seconds) {
    const c = this.ctx;
    const b = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  blip(freq, dur = 0.06, type = 'sine', vol = 0.06, slide = 0) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  click() {
    this.blip(520, 0.07, 'sine', 0.07, 0.6);
  }

  hover() {
    this.blip(1400, 0.025, 'sine', 0.012);
  }

  type() {
    this.blip(2200 + Math.random() * 600, 0.015, 'square', 0.006);
  }

  error() {
    this.blip(180, 0.16, 'square', 0.03, 0.8);
  }

  glitch() {
    if (!this.ctx || this.muted) return;
    const c = this.ctx;
    const t = c.currentTime;
    const n = c.createBufferSource();
    n.buffer = this.noiseBuffer(0.25);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
  }

  /** Speaks a line. Resolves when finished; returns null when no suitable voice exists. */
  speak(text, onTalk) {
    if (!('speechSynthesis' in window) || this.muted || !this.ctx) return null;
    this.voice ||= this.pickVoice();
    if (!this.voice) return null;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\bCA\b/g, 'C.A.').replace(/\bgm\b/gi, 'good morning'));
    u.voice = this.voice;
    u.lang = this.voice.lang;
    u.rate = 1.02;
    u.pitch = 0.82;
    u.volume = 0.95;
    this.speaking = u;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        onTalk(0);
        resolve();
      };
      u.onstart = () => onTalk(1);
      u.onboundary = () => onTalk(1);
      u.onend = finish;
      u.onerror = finish;
      setTimeout(finish, 2500 + text.length * 95);
      synth.speak(u);
    });
  }

  stopSpeech() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
}
