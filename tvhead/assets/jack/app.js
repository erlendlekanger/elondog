import { JackScene } from './scene.js';
import { STEPS } from './content.js';
import { SoundBoard } from './sound.js';

const $ = (sel, root = document) => root.querySelector(sel);
const html = document.documentElement;
const el = {
  stage: $('#stage'),
  jack: $('#jack'),
  previous: $('#previous'),
  line: $('#line'),
  controls: $('#controls'),
  back: $('#back'),
  progress: $('#progress'),
  toast: $('#toast'),
  loader: $('#loader'),
  loaderText: $('#loader-text'),
  loaderCount: $('#loader-count'),
  sound: $('#sound'),
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ————————————————— Loader ————————————————— */
const LOADER_LINES = ['Agent Butthole', 'ChatGPT + Claude + Grok', 'merging three brains', 'scanning markets, X, the web', 'gm'];
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*<>[]{}/\\_-+=?';

class Loader {
  constructor() {
    this.progress = 0;
    this.shown = 0;
    this.start = performance.now();
    this.spans = LOADER_LINES.map((text, i) => {
      const s = document.createElement('span');
      s.style.paddingLeft = `${[3, 0, 5, 5, 5][i]}ch`;
      el.loaderText.appendChild(s);
      return { el: s, text };
    });
    this.raf = requestAnimationFrame(() => this.tick());
  }

  tick() {
    const t = (performance.now() - this.start) / 1000;
    this.shown += (this.progress - this.shown) * 0.08;
    el.loaderCount.textContent = String(Math.round(this.shown * 100)).padStart(2, '0');
    this.spans.forEach((s, i) => {
      const resolved = Math.max(0, Math.min(1, t * 0.9 - i * 0.18)) * Math.max(0.15, this.shown);
      const n = Math.floor(resolved * s.text.length);
      let out = s.text.slice(0, n);
      const tail = Math.min(s.text.length - n, Math.floor(4 + Math.random() * 10));
      for (let k = 0; k < tail; k++) out += s.text[n + k] === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      s.el.textContent = out;
    });
    if (!this.done) this.raf = requestAnimationFrame(() => this.tick());
  }

  async finish() {
    this.progress = 1;
    await sleep(reducedMotion ? 0 : 900);
    this.done = true;
    this.spans.forEach((s) => (s.el.textContent = s.text));
    el.loaderCount.textContent = '100';
    await sleep(reducedMotion ? 0 : 350);
  }
}

/* ————————————————— Text reveal ————————————————— */
function splitInto(target, htmlString) {
  const tmp = document.createElement('div');
  tmp.innerHTML = htmlString;
  target.innerHTML = '';
  let i = 0;
  const speed = reducedMotion ? 0 : 16;
  const walk = (node, parent) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            parent.appendChild(document.createTextNode(' '));
            i++;
            return;
          }
          const word = document.createElement('span');
          word.className = 'c-word';
          for (const ch of part) {
            const c = document.createElement('span');
            c.className = 'c-char';
            c.textContent = ch;
            c.style.animationDelay = `${i * speed}ms`;
            word.appendChild(c);
            i++;
          }
          parent.appendChild(word);
        });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const clone = document.createElement(child.tagName);
        for (const attr of child.attributes) clone.setAttribute(attr.name, attr.value);
        parent.appendChild(clone);
        walk(child, clone);
      }
    });
  };
  walk(tmp, target);
  return i * speed + 600;
}

const plain = (s) => {
  const d = document.createElement('div');
  d.innerHTML = s.replace(/<br\s*\/?>/gi, ' ');
  return d.textContent.replace(/\s+/g, ' ').trim();
};

/* ————————————————— App ————————————————— */
class Jack {
  constructor() {
    this.data = {};
    this.history = [];
    this.current = null;
    this.token = 0;
    this.sound = new SoundBoard();
    this.muted = false;
    try {
      this.muted = localStorage.getItem('jack-muted') === '1';
    } catch (e) {
      /* storage unavailable */
    }
    this.updateSoundUi();
  }

  async boot() {
    const loader = new Loader();
    this.scene = new JackScene(el.stage);
    try {
      await this.scene.load((p) => (loader.progress = Math.max(loader.progress, p * 0.95)));
    } catch (err) {
      console.error(err);
    }
    await loader.finish();
    html.classList.remove('is-loading');
    html.classList.add('is-ready');
    this.scene.face?.powerOn();
    this.scene.glitch(1);
    this.bind();
    await sleep(reducedMotion ? 0 : 700);
    this.go('intro');
  }

  bind() {
    el.back.addEventListener('click', () => this.back());
    el.sound.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-sound]');
      if (!b) return;
      this.setMuted(b.dataset.sound === 'off');
    });
    document.querySelector('[data-talk]').addEventListener('click', () => {
      this.unlockAudio();
      this.go('ca');
    });
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === 'ArrowRight') && this.autoNext && !e.target.closest('input, textarea, button, a')) {
        e.preventDefault();
        this.autoNext();
      }
    });
    el.line.addEventListener('click', () => this.skipReveal());
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => this.unlockAudio(), { once: true, passive: true }));
  }

  unlockAudio() {
    this.sound.unlock(this.muted);
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('jack-muted', m ? '1' : '0');
    } catch (e) {
      /* ignore */
    }
    this.updateSoundUi();
    this.sound.unlock(m);
    this.sound.setMuted(m);
    if (m) this.sound.stopSpeech();
  }

  updateSoundUi() {
    el.sound.querySelector('[data-sound="on"]').classList.toggle('is-active', !this.muted);
    el.sound.querySelector('[data-sound="off"]').classList.toggle('is-active', this.muted);
  }

  firstName() {
    const n = (this.data.fullName || '').trim().split(/\s+/)[0];
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : '';
  }

  fill(str, raw = false) {
    const first = this.firstName() || 'friend';
    const name = raw ? first : escapeHtml(first);
    return str.replace(/\{name\}/g, name).replace(/\{NAME\}/g, name.toUpperCase());
  }

  resolveLines(step) {
    if (step.linesBy) return step.linesBy[this.data[step.linesBy.key]] || Object.values(step.linesBy).find(Array.isArray);
    return step.lines;
  }

  resolveChoices(step) {
    if (step.choicesBy) {
      const c = step.choicesBy;
      const list = c[this.data[c.key]] || c.custom;
      return list.map((label) => ({ label, set: { [c.set]: label }, to: c.to }));
    }
    return step.choices;
  }

  go(id, { push = true } = {}) {
    const step = STEPS[id];
    if (!step) return;
    if (push && this.current) this.history.push(this.current);
    this.current = id;
    this.render(id, step);
  }

  back() {
    const prev = this.history.pop();
    if (!prev) return;
    this.sound.click();
    this.go(prev, { push: false });
  }

  skipReveal() {
    el.line.querySelectorAll('.c-char').forEach((c) => {
      c.style.animationDelay = '0ms';
      c.style.animationDuration = '0.2s';
    });
    this.revealResolve?.();
  }

  async render(id, step) {
    const token = ++this.token;
    clearTimeout(this.autoTimer);
    this.autoNext = null;
    this.sound.stopSpeech();

    const lineHtml = this.fill(pick(this.resolveLines(step)));
    const text = plain(lineHtml);

    // previous line drifts up, blurred
    if (this.lastLine && !step.compact) el.previous.innerHTML = this.lastLine;
    else el.previous.innerHTML = '';
    this.lastLine = lineHtml;

    el.jack.classList.toggle('-compact', !!step.compact);
    el.jack.classList.toggle('-long', text.length > 150);
    el.controls.innerHTML = '';
    el.back.hidden = this.history.length === 0;
    el.progress.style.setProperty('--progress', step.progress ?? 0);

    // TV head
    const sc = this.scene;
    sc.setProgress(step.progress ?? 0);
    sc.face.setMood(step.mood || 'neutral');
    sc.face.setText(step.screen ? this.fill(step.screen, true) : null);
    if (step.media?.length) sc.face.playClips(step.media);
    else sc.face.stopClip();
    if (step.show) sc.face.playShow(step.show, { forced: true });
    else if (sc.face.showForced) sc.face.endShow();
    sc.glitch(0.45);
    this.sound.glitch();

    // reveal + voice
    const revealMs = splitInto(el.line, lineHtml);
    sc.setTalking(1);
    const speech = this.muted ? null : this.sound.speak(text, (v) => sc.setTalking(v));
    const revealDone = new Promise((r) => {
      this.revealResolve = r;
      setTimeout(r, revealMs);
    });
    await revealDone;
    if (token !== this.token) return;
    if (!speech) setTimeout(() => token === this.token && sc.setTalking(0), 250);

    this.renderControls(id, step, token, text, speech);
  }

  renderControls(id, step, token, text, speech) {
    const wrap = el.controls;
    let delay = 0;
    const reveal = (node) => {
      node.classList.add('c-reveal');
      node.style.animationDelay = `${delay}ms`;
      delay += 55;
      return node;
    };

    const choices = this.resolveChoices(step);
    if (choices) {
      const list = document.createElement('div');
      list.className = 'c-choices';
      choices.forEach((choice) => list.appendChild(reveal(this.buildChoice(choice, step))));
      wrap.appendChild(list);
      return;
    }

    if (step.inputs) {
      wrap.appendChild(reveal(this.buildForm(step, reveal)));
      return;
    }

    if (step.next) {
      const row = document.createElement('div');
      row.className = 'c-auto';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'c-next -ghost';
      btn.setAttribute('aria-label', 'Next');
      btn.textContent = '→';
      row.appendChild(btn);
      const bar = document.createElement('div');
      bar.className = 'c-auto_bar';
      const fillBar = document.createElement('i');
      bar.appendChild(fillBar);
      row.appendChild(bar);
      wrap.appendChild(reveal(row));

      const advance = () => {
        if (token !== this.token) return;
        this.sound.click();
        this.go(step.next);
      };
      this.autoNext = advance;
      btn.addEventListener('click', advance);

      // reading time, then auto-advance (waits for the voice when it’s on)
      const readMs = Math.max(1600, text.length * (text.length > 150 ? 52 : 42));
      const start = performance.now();
      const run = async () => {
        await Promise.all([sleep(readMs), speech || Promise.resolve()]);
        if (token !== this.token) return;
        const elapsed = performance.now() - start;
        fillBar.style.transition = 'none';
        fillBar.style.transform = 'scaleX(1)';
        await sleep(450);
        advance();
        return elapsed;
      };
      fillBar.style.transition = `transform ${readMs}ms linear`;
      requestAnimationFrame(() => requestAnimationFrame(() => (fillBar.style.transform = 'scaleX(1)')));
      run();
    }
  }

  buildChoice(choice, step) {
    const isLink = !!choice.href;
    const node = document.createElement(isLink ? 'a' : 'button');
    node.className = 'c-button';
    if (choice.secondary) node.classList.add('-secondary');
    node.innerHTML = choice.label;
    if (isLink) {
      node.href = choice.href;
      node.target = '_blank';
      node.rel = 'noopener';
      node.classList.add('-external');
    } else {
      node.type = 'button';
    }
    if (choice.copy) {
      node.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>');
    }
    if (choice.screen) {
      node.addEventListener('pointerenter', () => this.scene.face.setText(choice.screen));
      node.addEventListener('pointerleave', () => this.scene.face.setText(step.screen ? this.fill(step.screen, true) : null));
    }
    node.addEventListener('pointerenter', () => this.sound.hover());
    node.addEventListener('click', async (e) => {
      this.unlockAudio();
      this.sound.click();
      if (choice.copy) {
        e.preventDefault();
        try {
          await navigator.clipboard.writeText(choice.copy);
          this.toast(`${choice.copy} has been copied to the clipboard`);
        } catch (err) {
          window.location.href = `mailto:${choice.copy}`;
        }
        return;
      }
      if (choice.set) Object.assign(this.data, choice.set);
      if (choice.to) this.go(choice.to);
    });
    return node;
  }

  buildForm(step) {
    const form = document.createElement('form');
    form.className = 'c-form';
    form.noValidate = true;
    const fields = [];

    step.inputs.forEach((input, idx) => {
      const isLast = idx === step.inputs.length - 1;
      if (input.type === 'checkboxes') {
        const fs = document.createElement('fieldset');
        fs.className = 'c-checks';
        fs.innerHTML = `<legend>${input.label}</legend>`;
        const selected = new Set(this.data[input.name] || []);
        input.choices.forEach((c) => {
          const lab = document.createElement('label');
          lab.className = 'c-check';
          lab.innerHTML = `<input type="checkbox" name="${input.name}" value="${c.value}" ${selected.has(c.label) ? 'checked' : ''}><span>${c.label}</span>`;
          lab.querySelector('input').addEventListener('change', () => this.sound.click());
          fs.appendChild(lab);
        });
        form.appendChild(fs);
        fields.push({ input, get: () => [...fs.querySelectorAll('input:checked')].map((i) => input.choices.find((c) => c.value === i.value).label), wrap: fs });
        if (isLast) form.appendChild(this.nextRow());
        return;
      }

      const row = document.createElement('div');
      row.className = 'c-form_row';
      const field = document.createElement('label');
      field.className = 'c-field';
      const tag = input.type === 'textarea' ? 'textarea' : 'input';
      field.innerHTML = `<span class="c-field_label">${input.label}</span>`;
      const ctrl = document.createElement(tag);
      ctrl.className = 'c-field_input';
      ctrl.name = input.name;
      if (tag === 'input') ctrl.type = input.type;
      if (input.type === 'month') ctrl.placeholder = 'YYYY-MM';
      if (input.type === 'url') ctrl.placeholder = 'https://';
      if (input.autocomplete) ctrl.autocomplete = input.autocomplete;
      if (tag === 'textarea') {
        ctrl.rows = 3;
        ctrl.addEventListener('input', () => {
          ctrl.style.height = 'auto';
          ctrl.style.height = `${ctrl.scrollHeight}px`;
        });
        ctrl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit();
        });
      }
      ctrl.value = this.data[input.name] || '';
      ctrl.addEventListener('input', () => {
        field.classList.remove('-invalid');
        field.querySelector('.c-field_error')?.remove();
        this.sound.type();
        this.scene.setTalking(0.15);
        clearTimeout(this.typeTimer);
        this.typeTimer = setTimeout(() => this.scene.setTalking(0), 300);
      });
      field.appendChild(ctrl);
      row.appendChild(field);
      if (isLast) row.appendChild(this.nextButton());
      form.appendChild(row);
      fields.push({ input, get: () => ctrl.value.trim(), wrap: field, ctrl });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let firstBad = null;
      fields.forEach((f) => {
        const v = f.get();
        let err = '';
        if (f.input.type === 'checkboxes') {
          if (!v.length) err = 'Pick at least one';
        } else if (!v && !f.input.optional) err = 'Required';
        else if (v && f.input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) err = 'That doesn’t look like an email';
        else if (v && f.input.type === 'url' && !/^https?:\/\/\S+\.\S+/.test(v)) err = 'Paste a full link (https://…)';
        else if (v && f.input.type === 'month' && !/^\d{4}-\d{2}$/.test(v) && !/\w/.test(v)) err = 'Format: YYYY-MM';
        f.wrap.querySelector('.c-field_error')?.remove();
        if (err) {
          f.wrap.classList.add('-invalid');
          if (f.input.type !== 'checkboxes') f.wrap.insertAdjacentHTML('beforeend', `<span class="c-field_error">${err}</span>`);
          else f.wrap.querySelector('legend').textContent = `${f.input.label} — ${err.toLowerCase()}`;
          firstBad ||= f;
        }
      });
      if (firstBad) {
        this.scene.face.setMood('think');
        this.scene.glitch(0.25);
        this.sound.error();
        firstBad.ctrl?.focus();
        return;
      }
      fields.forEach((f) => (this.data[f.input.name] = f.get()));
      this.sound.click();
      this.go(step.next);
    });

    // focus the first field once it’s visible
    setTimeout(() => {
      const first = form.querySelector('input:not([type=checkbox]), textarea');
      if (first && window.matchMedia('(pointer: fine)').matches) first.focus({ preventScroll: true });
    }, 450);
    return form;
  }

  nextButton() {
    const b = document.createElement('button');
    b.className = 'c-next';
    b.type = 'submit';
    b.setAttribute('aria-label', 'Next');
    b.textContent = '→';
    return b;
  }

  nextRow() {
    const row = document.createElement('div');
    row.className = 'c-form_row';
    row.appendChild(this.nextButton());
    return row;
  }

  toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 2600);
  }
}

const app = new Jack();
app.boot();
window.JACK = app;
