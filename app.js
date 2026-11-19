(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const fileInput = $('fileInput');
  const playBtn = $('playBtn');
  const iconPlay = $('iconPlay');
  const iconPause = $('iconPause');
  const seek = $('seek');
  const volume = $('volume');
  const curTime = $('curTime');
  const durTime = $('durTime');
  const trackName = $('trackName');
  const hint = $('hint');
  const dropOverlay = $('dropOverlay');
  const modeButtons = document.querySelectorAll('.mode');

  // ---------- Canvas sizing ----------
  let W = 0, H = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, W, H);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Audio ----------
  const audio = new Audio();
  audio.preload = 'auto';
  audio.volume = parseFloat(volume.value);

  let actx = null, analyser = null, freqData = null, timeData = null;
  let objectUrl = null;

  function initAudio() {
    if (actx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    actx = new Ctx();
    const src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    src.connect(analyser);
    analyser.connect(actx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);
    computeBinEdges();
  }

  function isAudioFile(file) {
    return file && (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name));
  }

  function loadFile(file) {
    if (!isAudioFile(file)) {
      trackName.textContent = 'That file is not audio — try an MP3';
      return;
    }
    initAudio();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    audio.src = objectUrl;
    trackName.textContent = file.name.replace(/\.[^.]+$/, '');
    playBtn.disabled = false;
    seek.disabled = false;
    hint.classList.add('gone');
    play();
  }

  async function play() {
    if (!audio.src) return;
    initAudio();
    if (actx.state === 'suspended') await actx.resume();
    try {
      await audio.play();
    } catch (err) {
      console.warn('Playback failed:', err);
    }
  }

  function togglePlay() {
    if (!audio.src) return;
    if (audio.paused) play();
    else audio.pause();
  }

  function fmt(t) {
    if (!isFinite(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function syncPlayIcon() {
    const playing = !audio.paused;
    iconPlay.hidden = playing;
    iconPause.hidden = !playing;
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    scheduleIdle();
  }

  audio.addEventListener('play', syncPlayIcon);
  audio.addEventListener('pause', syncPlayIcon);
  audio.addEventListener('ended', syncPlayIcon);
  audio.addEventListener('loadedmetadata', () => { durTime.textContent = fmt(audio.duration); });

  fileInput.addEventListener('change', () => {
    loadFile(fileInput.files[0]);
    fileInput.value = '';
  });
  playBtn.addEventListener('click', (e) => { togglePlay(); e.currentTarget.blur(); });
  volume.addEventListener('input', () => { audio.volume = parseFloat(volume.value); });

  let seeking = false;
  seek.addEventListener('pointerdown', () => { seeking = true; });
  seek.addEventListener('input', () => {
    if (isFinite(audio.duration)) curTime.textContent = fmt((seek.value / 1000) * audio.duration);
  });
  seek.addEventListener('change', () => {
    if (isFinite(audio.duration)) audio.currentTime = (seek.value / 1000) * audio.duration;
    seeking = false;
  });

  // Drag & drop anywhere
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; dropOverlay.classList.add('show'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropOverlay.classList.remove('show'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove('show');
    if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
  });

  // ---------- Visual mode ----------
  let mode = 'radial';
  function setMode(m) {
    mode = m;
    modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  }
  modeButtons.forEach((b) => b.addEventListener('click', (e) => { setMode(b.dataset.mode); e.currentTarget.blur(); }));

  window.addEventListener('keydown', (e) => {
    if (e.target === seek || e.target === volume) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === '1') setMode('radial');
    else if (e.key === '2') setMode('bars');
    else if (e.key === '3') setMode('wave');
    else if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    }
  });

  // Hide the controls while music plays and the mouse is still
  let idleTimer = null;
  function scheduleIdle() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    if (!audio.paused) idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
  }
  window.addEventListener('pointermove', scheduleIdle);

  // ---------- Analysis ----------
  const BARS = 96;
  const bars = new Float32Array(BARS);   // smoothed, 0..1
  const peaks = new Float32Array(BARS);  // slow-falling caps
  const binEdges = new Int32Array(BARS + 1);
  const WAVE_PTS = 256;
  const wave = new Float32Array(WAVE_PTS); // -1..1

  function computeBinEdges() {
    // Log-spaced bands from 30 Hz to 16 kHz so lows and highs get fair screen space
    const bins = analyser ? analyser.frequencyBinCount : 1024;
    const nyquist = (actx ? actx.sampleRate : 44100) / 2;
    const minF = 30, maxF = 16000;
    for (let i = 0; i <= BARS; i++) {
      const f = minF * Math.pow(maxF / minF, i / BARS);
      binEdges[i] = Math.min(bins - 1, Math.max(1, Math.round((f / nyquist) * bins)));
    }
  }
  computeBinEdges();

  function bandEnergy(loHz, hiHz) {
    const nyquist = actx.sampleRate / 2;
    const n = freqData.length;
    const lo = Math.max(1, Math.floor((loHz / nyquist) * n));
    const hi = Math.min(n - 1, Math.ceil((hiHz / nyquist) * n));
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += freqData[i];
    return sum / ((hi - lo + 1) * 255);
  }

  const energy = { bass: 0, mid: 0, treble: 0, level: 0 };
  let bassAvg = 0;
  let lastBeat = 0;
  let beat = 0;      // 1 on a detected beat, decays to 0
  let hue = 200;     // global colour that drifts with the music

  function analyse(t, dt) {
    const live = analyser && !audio.paused;

    if (live) {
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);
    }

    for (let i = 0; i < BARS; i++) {
      let target;
      if (live) {
        const lo = binEdges[i];
        const hi = Math.max(binEdges[i + 1], lo + 1);
        let max = 0;
        for (let b = lo; b < hi; b++) if (freqData[b] > max) max = freqData[b];
        // Gentle tilt so the treble side is not always flat
        target = Math.min(1, (max / 255) * (0.85 + 0.45 * (i / BARS)));
        target = target * target * 1.15;
      } else {
        // Calm breathing pattern while nothing is playing
        target = 0.08 + 0.06 * Math.sin(t * 1.4 + i * 0.22) + 0.04 * Math.sin(t * 0.7 - i * 0.11);
      }
      const k = target > bars[i] ? 0.55 : 0.12;
      bars[i] += (target - bars[i]) * k;
      peaks[i] = Math.max(bars[i], peaks[i] - dt * 0.35);
    }

    const step = live ? timeData.length / WAVE_PTS : 0;
    for (let i = 0; i < WAVE_PTS; i++) {
      const target = live
        ? (timeData[Math.floor(i * step)] - 128) / 128
        : 0.06 * Math.sin(t * 2 + i * 0.12) * Math.sin(t * 0.5 + i * 0.03);
      wave[i] += (target - wave[i]) * 0.5;
    }

    if (live) {
      const b = bandEnergy(20, 250), m = bandEnergy(250, 2000), tr = bandEnergy(2000, 10000);
      energy.bass += (b - energy.bass) * 0.5;
      energy.mid += (m - energy.mid) * 0.4;
      energy.treble += (tr - energy.treble) * 0.4;
    } else {
      energy.bass *= 0.95; energy.mid *= 0.95; energy.treble *= 0.95;
    }
    energy.level = energy.bass * 0.5 + energy.mid * 0.35 + energy.treble * 0.15;

    // Simple beat detection: bass jumps well above its running average
    bassAvg += (energy.bass - bassAvg) * 0.04;
    if (live && energy.bass > 0.3 && energy.bass > bassAvg * 1.22 && t - lastBeat > 0.28) {
      lastBeat = t;
      beat = 1;
      hue += 28 + Math.random() * 20;
      onBeat();
    }
    beat = Math.max(0, beat - dt * 3);

    hue += dt * (6 + energy.treble * 60 + energy.mid * 30);
  }

  // ---------- Particles ----------
  const PARTICLES = 180;
  const particles = [];
  function resetParticle(p, burst) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * Math.min(W, H) * 0.12;
    p.x = W / 2 + Math.cos(a) * r;
    p.y = H / 2 + Math.sin(a) * r;
    const s = (burst ? 2.5 : 0.3) + Math.random() * 1.2;
    p.vx = Math.cos(a) * s;
    p.vy = Math.sin(a) * s;
    p.size = 0.6 + Math.random() * 2.2;
    p.hueOff = Math.random() * 90 - 45;
    p.life = 1;
  }
  for (let i = 0; i < PARTICLES; i++) {
    const p = {};
    resetParticle(p);
    // Scatter the initial batch across the screen
    p.x = Math.random() * W;
    p.y = Math.random() * H;
    particles.push(p);
  }

  const sparks = [];
  function spawnSparks(x, y, n, h, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (1.5 + Math.random() * 4) * power;
      sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, hue: h + Math.random() * 40 - 20, size: 1 + Math.random() * 2 });
    }
  }

  function onBeat() {
    for (let i = 0; i < 18; i++) resetParticle(particles[(Math.random() * PARTICLES) | 0], true);
    if (mode === 'radial') {
      addRipple(W / 2, H / 2, { maxR: Math.min(W, H) * 0.55, width: 2, alpha: 0.35, duration: 1.2, rings: 1 });
    }
  }

  // ---------- Ripples ----------
  const ripples = [];
  function addRipple(x, y, opts = {}) {
    const rings = opts.rings ?? 3;
    const maxR = opts.maxR ?? 140 + energy.level * 320 + Math.random() * 60;
    for (let i = 0; i < rings; i++) {
      ripples.push({
        x, y,
        p: -i * 0.12,                // negative = waiting to start (staggered rings)
        maxR: maxR * (1 - i * 0.18),
        duration: opts.duration ?? 1.5,
        width: (opts.width ?? 4) * (1 - i * 0.25),
        alpha: opts.alpha ?? 1,
        hue: hue + i * 25,
        radius: 0,
      });
    }
  }

  let pointerDown = false;
  let lastDragRipple = 0;
  canvas.addEventListener('pointerdown', (e) => {
    pointerDown = true;
    canvas.setPointerCapture(e.pointerId);
    addRipple(e.clientX, e.clientY);
    spawnSparks(e.clientX, e.clientY, 22, hue, 1 + energy.level * 1.5);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointerDown) return;
    const now = performance.now();
    if (now - lastDragRipple > 70) {
      lastDragRipple = now;
      addRipple(e.clientX, e.clientY, { rings: 1, maxR: 70 + energy.level * 140, width: 2.5, duration: 1 });
      spawnSparks(e.clientX, e.clientY, 4, hue, 0.6);
    }
  });
  const endPointer = () => { pointerDown = false; };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  const easeOut = (x) => 1 - Math.pow(1 - x, 3);

  function updateAndDrawRipples(dt) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.p += dt / r.duration;
      if (r.p < 0) continue;
      if (r.p >= 1) { ripples.splice(i, 1); continue; }
      r.radius = r.maxR * easeOut(r.p);
      const fade = (1 - r.p) * r.alpha;

      // Soft flash at the touch point
      if (r.p < 0.35 && r.alpha > 0.5) {
        const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.radius);
        g.addColorStop(0, `hsla(${r.hue}, 100%, 75%, ${0.25 * (1 - r.p / 0.35)})`);
        g.addColorStop(1, `hsla(${r.hue}, 100%, 60%, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.lineWidth = r.width * (1 - r.p) + 0.5;
      ctx.strokeStyle = `hsla(${r.hue}, 95%, 65%, ${fade})`;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = 1;
      ctx.strokeStyle = `hsla(${r.hue + 40}, 95%, 80%, ${fade * 0.5})`;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius * 0.82, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function updateAndDrawParticles(dt) {
    const speed = 0.6 + energy.level * 3.5 + beat * 3;
    const f = dt * 60;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      // Ripple wavefronts push particles outward
      for (const r of ripples) {
        if (r.p <= 0) continue;
        const dx = p.x - r.x, dy = p.y - r.y;
        const d = Math.hypot(dx, dy) || 1;
        if (Math.abs(d - r.radius) < 24) {
          const push = (1 - r.p) * 1.8 * r.alpha;
          p.vx += (dx / d) * push;
          p.vy += (dy / d) * push;
        }
      }
      p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx * speed * f;
      p.y += p.vy * speed * f;
      p.life -= dt * 0.08;
      if (p.life <= 0 || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) { resetParticle(p); continue; }

      const size = p.size * (1 + energy.treble * 1.5 + beat * 0.8);
      ctx.fillStyle = `hsla(${hue + p.hueOff}, 90%, 70%, ${0.35 + 0.5 * p.life * (0.4 + energy.level)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.vx *= 0.95; s.vy *= 0.95;
      s.x += s.vx * f; s.y += s.vy * f;
      s.life -= dt * 1.3;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.fillStyle = `hsla(${s.hue}, 100%, 75%, ${s.life})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * s.life + 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Background ----------
  function drawBackground(fadeAlpha) {
    // Translucent fill = motion trails; its hue drifts with the music
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `hsla(${hue}, 55%, ${3 + energy.bass * 5}%, ${fadeAlpha})`;
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'lighter';
    const R = Math.max(W, H) * 0.7;
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, R);
    g.addColorStop(0, `hsla(${hue + 30}, 85%, 45%, ${0.025 + energy.bass * 0.05 + beat * 0.04})`);
    g.addColorStop(0.5, `hsla(${hue + 90}, 80%, 35%, ${0.012 + energy.mid * 0.03})`);
    g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Mode: Radial ----------
  let rotation = 0;
  function drawRadial(dt) {
    const cx = W / 2, cy = H / 2;
    const unit = Math.min(W, H);
    const base = unit * 0.15 * (1 + energy.bass * 0.3 + beat * 0.06);
    rotation += dt * (0.05 + energy.mid * 0.6);

    // Core glow
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 1.4);
    g.addColorStop(0, `hsla(${hue}, 90%, 65%, ${0.18 + energy.bass * 0.35})`);
    g.addColorStop(1, `hsla(${hue}, 90%, 50%, 0)`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, base * 1.4, 0, Math.PI * 2);
    ctx.fill();

    // Mirrored spectrum bars around the circle
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, ((Math.PI * 2 * base) / (BARS * 2)) * 0.55);
    for (let i = 0; i < BARS; i++) {
      const v = bars[i];
      const len = 3 + v * unit * 0.3;
      ctx.strokeStyle = `hsla(${hue + (i / BARS) * 150}, 90%, ${50 + v * 25}%, ${0.55 + v * 0.45})`;
      for (const side of [-1, 1]) {
        const a = -Math.PI / 2 + rotation + side * ((i + 0.5) / BARS) * Math.PI;
        const cos = Math.cos(a), sin = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(cx + cos * (base + 4), cy + sin * (base + 4));
        ctx.lineTo(cx + cos * (base + 4 + len), cy + sin * (base + 4 + len));
        ctx.stroke();
      }
    }

    // Waveform ring inside the circle
    ctx.lineWidth = 2;
    ctx.strokeStyle = `hsla(${hue + 180}, 90%, 80%, 0.85)`;
    ctx.beginPath();
    for (let i = 0; i <= WAVE_PTS; i++) {
      const idx = i % WAVE_PTS;
      const a = (idx / WAVE_PTS) * Math.PI * 2 - rotation * 0.5;
      const r = base * 0.78 + wave[idx] * base * 0.45;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Mode: Bars ----------
  function drawBars() {
    const baseline = H * 0.7;
    const gap = 2;
    const bw = W / BARS;
    const maxH = H * 0.5;

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < BARS; i++) {
      const v = bars[i];
      const h = Math.max(2, v * maxH);
      const x = i * bw + gap / 2;
      const w = bw - gap;
      const c = hue + (i / BARS) * 160;

      const grad = ctx.createLinearGradient(0, baseline - h, 0, baseline);
      grad.addColorStop(0, `hsla(${c}, 95%, 70%, 0.95)`);
      grad.addColorStop(1, `hsla(${c + 30}, 90%, 45%, 0.6)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x, baseline - h, w, h);

      // Reflection
      ctx.fillStyle = `hsla(${c + 30}, 90%, 50%, 0.12)`;
      ctx.fillRect(x, baseline + 3, w, h * 0.35);

      // Peak cap
      ctx.fillStyle = `hsla(${c}, 100%, 85%, 0.9)`;
      ctx.fillRect(x, baseline - peaks[i] * maxH - 5, w, 2);
    }

    // Oscilloscope line across the top
    const midY = H * 0.24;
    const amp = H * 0.12 * (1 + energy.level);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = `hsla(${hue + 200}, 95%, 75%, 0.9)`;
    ctx.shadowColor = `hsla(${hue + 200}, 95%, 60%, 1)`;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    for (let i = 0; i < WAVE_PTS; i++) {
      const x = (i / (WAVE_PTS - 1)) * W;
      const y = midY + wave[i] * amp;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Mode: Terrain (spectrum history) ----------
  const ROWS = 36;
  const history = [];
  let historyTick = 0;
  function drawTerrain(dt) {
    historyTick += dt;
    if (historyTick > 1 / 30) {
      historyTick = 0;
      history.unshift(Float32Array.from(bars));
      if (history.length > ROWS) history.pop();
    }

    const front = H * 0.8;
    const depth = H * 0.55;
    // Draw back-to-front; each row hides the ones behind it
    for (let k = history.length - 1; k >= 0; k--) {
      const row = history[k];
      const z = k / ROWS;
      const scale = 1 - z * 0.55;
      const y0 = front - z * depth;
      const width = W * 0.92 * scale;
      const x0 = (W - width) / 2;
      const amp = H * 0.32 * scale;
      const n = BARS * 2;

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (let p = 0; p < n; p++) {
        // Symmetric: bass in the middle, treble on the edges
        const i = p < BARS ? BARS - 1 - p : p - BARS;
        const x = x0 + (p / (n - 1)) * width;
        const edge = Math.sin((p / (n - 1)) * Math.PI); // taper to zero at the sides
        ctx.lineTo(x, y0 - row[i] * amp * (0.25 + 0.75 * edge));
      }
      ctx.lineTo(x0 + width, y0);
      ctx.closePath();
      ctx.fillStyle = `hsl(${hue}, 50%, 4%)`;
      ctx.fill();
      ctx.lineWidth = k === 0 ? 2.5 : 1.5;
      ctx.strokeStyle = `hsla(${hue + k * 5}, 90%, ${65 - z * 20}%, ${1 - z * 0.85})`;
      ctx.stroke();
    }
  }

  // ---------- Main loop ----------
  let last = performance.now();
  let frame = 0;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;

    analyse(t, dt);
    drawBackground(mode === 'wave' ? 0.5 : 0.22);

    updateAndDrawParticles(dt);
    if (mode === 'radial') drawRadial(dt);
    else if (mode === 'bars') drawBars();
    else drawTerrain(dt);
    updateAndDrawRipples(dt);

    if (!seeking && isFinite(audio.duration) && audio.duration > 0) {
      seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
      curTime.textContent = fmt(audio.currentTime);
    }
    if (++frame % 6 === 0) {
      document.documentElement.style.setProperty('--accent', `hsl(${hue % 360} 90% 65%)`);
    }

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
