(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const fileInput = $('fileInput');
  const playBtn = $('playBtn');
  const playIcon = $('playIcon');
  const seek = $('seek');
  const volume = $('volume');
  const curTime = $('curTime');
  const durTime = $('durTime');
  const trackName = $('trackName');
  const hint = $('hint');
  const dropOverlay = $('dropOverlay');
  const barsBtn = $('barsBtn');

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
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Audio ----------
  const audio = new Audio();
  audio.preload = 'auto';
  audio.volume = parseFloat(volume.value);

  let actx = null, analyser = null, freqData = null;
  let objectUrl = null;

  function initAudio() {
    if (actx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    actx = new Ctx();
    const src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    src.connect(analyser);
    analyser.connect(actx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
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

  // One icon whose shape is redrawn, rather than two icons shown and hidden
  const PLAY_PATH = 'M8 5v14l11-7z';
  const PAUSE_PATH = 'M6 5h4v14H6zM14 5h4v14h-4z';
  let shownPlaying = false;
  function syncPlayIcon() {
    const playing = !audio.paused;
    playIcon.setAttribute('d', playing ? PAUSE_PATH : PLAY_PATH);
    shownPlaying = playing;
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

  // ---------- Bars toggle ----------
  let showBars = true;
  function setBars(on) {
    showBars = on;
    barsBtn.classList.toggle('active', on);
    barsBtn.setAttribute('aria-pressed', String(on));
  }
  barsBtn.addEventListener('click', (e) => { setBars(!showBars); e.currentTarget.blur(); });

  window.addEventListener('keydown', (e) => {
    if (e.target === seek || e.target === volume) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'b' || e.key === 'B') setBars(!showBars);
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
  // Everything is smoothed heavily so the picture drifts rather than flickers.
  const BARS = 48;                        // per side; bars are mirrored from the centre
  const bars = new Float32Array(BARS);    // 0..1
  const binEdges = new Int32Array(BARS + 1);

  function computeBinEdges() {
    // Log-spaced bands from 40 Hz to 14 kHz
    const bins = analyser ? analyser.frequencyBinCount : 1024;
    const nyquist = (actx ? actx.sampleRate : 44100) / 2;
    const minF = 40, maxF = 14000;
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

  // `mood` follows the music slowly; it is what drives the screen colour
  const mood = { bass: 0, mid: 0, treble: 0, level: 0 };
  let bassAvg = 0;
  let lastBeat = 0;
  let swell = 0;      // gentle brightness lift on strong beats
  let hue = 220;      // starts in calm blue/indigo
  let tone = 0.3;     // 0 = deep/bassy, 1 = bright/airy

  const follow = (cur, target, up, down, dt) => cur + (target - cur) * (1 - Math.exp(-(target > cur ? up : down) * dt));

  function analyse(t, dt) {
    const live = analyser && !audio.paused;
    if (live) analyser.getByteFrequencyData(freqData);

    for (let i = 0; i < BARS; i++) {
      let target;
      if (live) {
        const lo = binEdges[i];
        const hi = Math.max(binEdges[i + 1], lo + 1);
        let sum = 0;
        for (let b = lo; b < hi; b++) sum += freqData[b];
        target = (sum / (hi - lo)) / 255;
        target = Math.min(1, target * (0.9 + 0.6 * (i / BARS)));
        target *= target;
      } else {
        target = 0.03 + 0.025 * Math.sin(t * 0.6 + i * 0.18);
      }
      bars[i] = follow(bars[i], target, 9, 2.5, dt);
    }

    const b = live ? bandEnergy(30, 200) : 0;
    const m = live ? bandEnergy(200, 2000) : 0;
    const tr = live ? bandEnergy(2000, 10000) : 0;
    mood.bass = follow(mood.bass, b, 3, 0.8, dt);
    mood.mid = follow(mood.mid, m, 1.5, 0.5, dt);
    mood.treble = follow(mood.treble, tr, 1.5, 0.5, dt);
    mood.level = mood.bass * 0.5 + mood.mid * 0.35 + mood.treble * 0.15;

    bassAvg = follow(bassAvg, b, 0.6, 0.6, dt);
    if (live && b > 0.2 && b > bassAvg * 1.15 && t - lastBeat > 0.35) {
      lastBeat = t;
      swell = Math.min(1, swell + 0.5);
      sparkleEdges(6 + Math.round(mood.level * 10));
      spawnPulse();
    }
    swell = Math.max(0, swell - dt * 0.9);

    // Bright, treble-heavy sound pulls the colour one way, deep bassy sound the other
    const tilt = live ? tr / (b + tr + 0.01) : 0.3;
    tone = follow(tone, tilt, 0.6, 0.6, dt);

    // Slow colour drift; fuller music turns the wheel faster
    hue += dt * (2 + mood.level * 25);
  }

  // ---------- Colour field ----------
  // The whole screen is one colour wash: the music sets its hue, saturation
  // and brightness. A slight top-to-bottom shade keeps it from looking flat.
  function drawField() {
    const h = hue + tone * 140;
    const sat = 40 + mood.level * 30;
    const light = 8 + mood.level * 30 + swell * 5;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `hsl(${h - 8}, ${sat}%, ${light + 3}%)`);
    g.addColorStop(1, `hsl(${h + 12}, ${sat}%, ${Math.max(4, light - 6)}%)`);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Fine film grain breaks up gradient banding and adds texture
  const grain = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return ctx.createPattern(c, 'repeat');
  })();
  function drawGrain() {
    ctx.save();
    ctx.globalAlpha = 0.035;
    ctx.globalCompositeOperation = 'overlay';
    ctx.translate((Math.random() * 128) | 0, (Math.random() * 128) | 0);
    ctx.fillStyle = grain;
    ctx.fillRect(-128, -128, W + 256, H + 256);
    ctx.restore();
  }

  // ---------- Geometry: Voronoi diagram ----------
  // Seed points drift slowly; every frame the screen is split into the cells
  // closest to each seed. Each seed listens to its own part of the spectrum.
  // Cell walls light up at random with the music, in bursts on beats, and
  // where a ripple's wavefront crosses them.
  const sites = [];
  const edgeGlow = new Map();   // key for a pair of neighbouring seeds -> glow 0..1
  let cells = [];

  function layoutSites() {
    sites.length = 0;
    edgeGlow.clear();
    const cols = Math.max(4, Math.round(W / 210));
    const rows = Math.max(3, Math.round(H / 210));
    const cw = W / cols, ch = H / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        sites.push({
          hx: (c + 0.15 + Math.random() * 0.7) * cw,   // home position
          hy: (r + 0.15 + Math.random() * 0.7) * ch,
          amp: Math.min(cw, ch) * 0.4,
          sx: 0.05 + Math.random() * 0.08,
          sy: 0.05 + Math.random() * 0.08,
          ph: Math.random() * Math.PI * 2,
          band: Math.random(),                         // 0 = bass, 1 = treble
          energy: 0,
          ox: 0, oy: 0, vx: 0, vy: 0,                  // offset from ripple pushes
          x: 0, y: 0,
        });
      }
    }
  }
  window.addEventListener('resize', layoutSites);
  layoutSites();

  const pairKey = (i, j) => (i < j ? i * 4096 + j : j * 4096 + i);

  // Sutherland–Hodgman clip of a polygon against the half-plane nx*x + ny*y <= c.
  // Every vertex carries `e`, the neighbour that made its outgoing edge (-1 = screen border).
  function clipPoly(poly, nx, ny, c, label) {
    const out = [];
    const n = poly.length;
    for (let k = 0; k < n; k++) {
      const a = poly[k], b = poly[(k + 1) % n];
      const da = nx * a.x + ny * a.y - c;
      const db = nx * b.x + ny * b.y - c;
      if (da <= 0) out.push(a);
      if ((da <= 0) !== (db <= 0)) {
        const t = da / (da - db);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, e: da <= 0 ? label : a.e });
      }
    }
    return out;
  }

  function computeCells() {
    const m = 4;
    cells = sites.map((s, i) => {
      let poly = [
        { x: -m, y: -m, e: -1 }, { x: W + m, y: -m, e: -1 },
        { x: W + m, y: H + m, e: -1 }, { x: -m, y: H + m, e: -1 },
      ];
      for (let j = 0; j < sites.length && poly.length; j++) {
        if (j === i) continue;
        const o = sites[j];
        const nx = o.x - s.x, ny = o.y - s.y;
        const c = nx * (s.x + o.x) / 2 + ny * (s.y + o.y) / 2;
        poly = clipPoly(poly, nx, ny, c, j);
      }
      return poly;
    });
  }

  // Light a random wall of a random cell (or of cell `i`)
  function lightRandomEdge(i, v = 1) {
    const cell = cells[i];
    if (!cell || !cell.length) return;
    const k = (Math.random() * cell.length) | 0;
    const j = cell[k].e;
    if (j < 0) return;
    const key = pairKey(i, j);
    if (v > (edgeGlow.get(key) || 0)) edgeGlow.set(key, v);
  }

  function sparkleEdges(n) {
    for (let k = 0; k < n && sites.length; k++) lightRandomEdge((Math.random() * sites.length) | 0);
  }

  function updateAndDrawVoronoi(t, dt) {
    const live = analyser && !audio.paused;
    const h = hue + tone * 140;

    // Move seeds: slow drift, wider when the music is fuller, plus ripple pushes
    for (const s of sites) {
      s.vx *= Math.exp(-1.5 * dt); s.vy *= Math.exp(-1.5 * dt);
      s.ox = (s.ox + s.vx * dt) * Math.exp(-0.6 * dt);
      s.oy = (s.oy + s.vy * dt) * Math.exp(-0.6 * dt);
      const wander = 0.6 + mood.level * 0.6;
      s.x = s.hx + Math.sin(t * s.sx + s.ph) * s.amp * wander + s.ox;
      s.y = s.hy + Math.cos(t * s.sy + s.ph * 1.7) * s.amp * wander + s.oy;
      s.energy = follow(s.energy, bars[Math.min(BARS - 1, (s.band * BARS) | 0)], 4, 1.2, dt);
    }
    computeCells();

    // Random lighting: the louder a seed's band, the more often its walls glow
    for (let i = 0; i < sites.length; i++) {
      const rate = live ? sites[i].energy * 3 + mood.level * 2 : 0.12;
      if (Math.random() < rate * dt) lightRandomEdge(i, live ? 0.6 + Math.min(0.4, sites[i].energy) : 0.5);
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Cells glow faintly with their band's energy
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const e = sites[i].energy;
      if (cell.length < 3 || e < 0.02) continue;
      ctx.fillStyle = `hsla(${h + 20 + sites[i].band * 80}, 70%, 60%, ${Math.min(0.12, e * 0.18)})`;
      ctx.beginPath();
      ctx.moveTo(cell[0].x, cell[0].y);
      for (let k = 1; k < cell.length; k++) ctx.lineTo(cell[k].x, cell[k].y);
      ctx.closePath();
      ctx.fill();
    }

    // Walls: each shared wall is drawn once, from the lower-numbered cell
    const restAlpha = 0.16 + mood.level * 0.12;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `hsla(${h + 30}, 50%, 88%, ${restAlpha})`;
    ctx.beginPath();
    const lit = [];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      for (let k = 0; k < cell.length; k++) {
        const j = cell[k].e;
        if (j < 0 || j < i) continue;
        const a = cell[k], b = cell[(k + 1) % cell.length];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);

        // Ripple wavefronts light the walls they cross
        const key = pairKey(i, j);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        for (const r of ripples) {
          if (r.p <= 0) continue;
          if (Math.abs(Math.hypot(mx - r.x, my - r.y) - r.radius) < 14) {
            const v = 1 - r.p;
            if (v > (edgeGlow.get(key) || 0)) edgeGlow.set(key, v);
          }
        }
        const g = edgeGlow.get(key);
        if (g > 0.01) lit.push(a, b, g, (sites[i].band + sites[j].band) / 2);
      }
    }
    ctx.stroke();

    // Lit walls glow, then fade out over about a second
    for (let n = 0; n < lit.length; n += 4) {
      const a = lit[n], b = lit[n + 1], g = lit[n + 2];
      const edgeHue = h + 40 + lit[n + 3] * 80;
      ctx.lineWidth = 1.5 + g * 1.5;
      ctx.strokeStyle = `hsla(${edgeHue}, 90%, 80%, ${g})`;
      ctx.shadowColor = `hsla(${edgeHue}, 100%, 70%, ${g})`;
      ctx.shadowBlur = 14 * g;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    for (const [key, g] of edgeGlow) {
      const next = g - dt * 0.9;
      if (next <= 0.01) edgeGlow.delete(key); else edgeGlow.set(key, next);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Geometry: Bézier ribbons ----------
  // Three silky ribbons, each a bundle of cubic Bézier strands, sway across the
  // screen. Bass, mids and treble each bend one ribbon. Light pulses travel
  // along the strands on beats and with the music.
  const STRANDS = 14;
  const ribbons = [
    { y: 0.28, band: [0, 0.25],   hueOff: 0,  ph: 0.0, energy: 0 },
    { y: 0.52, band: [0.25, 0.6], hueOff: 50, ph: 2.1, energy: 0 },
    { y: 0.74, band: [0.6, 1],    hueOff: -40, ph: 4.2, energy: 0 },
  ];
  const pulses = [];

  function strandPoints(rb, s, t) {
    const k = s / (STRANDS - 1) - 0.5;          // -0.5..0.5 across the ribbon
    const bend = 0.18 + rb.energy * 0.35;
    return [
      -0.05 * W, H * (rb.y + 0.12 * Math.sin(t * 0.13 + rb.ph) + k * 0.05),
      0.33 * W,  H * (rb.y + bend * Math.sin(t * 0.21 + rb.ph + k * 0.9)),
      0.67 * W,  H * (rb.y - bend * Math.cos(t * 0.17 + rb.ph * 1.3 - k * 0.9)),
      1.05 * W,  H * (rb.y + 0.12 * Math.cos(t * 0.11 + rb.ph) - k * 0.05),
    ];
  }

  function bezierAt(p, u) {
    const v = 1 - u;
    const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
    return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]];
  }

  function spawnPulse(r) {
    pulses.push({
      r: r ?? (Math.random() * ribbons.length) | 0,
      s: (Math.random() * STRANDS) | 0,
      u: 0,
      speed: 0.25 + Math.random() * 0.2,
    });
  }

  function updateAndDrawRibbons(t, dt) {
    const live = analyser && !audio.paused;
    const h = hue + tone * 140;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (let r = 0; r < ribbons.length; r++) {
      const rb = ribbons[r];
      const lo = Math.floor(rb.band[0] * BARS), hi = Math.max(lo + 1, Math.floor(rb.band[1] * BARS));
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += bars[i];
      rb.energy = follow(rb.energy, sum / (hi - lo), 3, 0.8, dt);

      if (live && Math.random() < (rb.energy * 2 + mood.level) * dt) spawnPulse(r);

      ctx.lineWidth = 1;
      for (let s = 0; s < STRANDS; s++) {
        const k = Math.abs(s / (STRANDS - 1) - 0.5) * 2;   // 0 in the middle, 1 at the edges
        const p = strandPoints(rb, s, t);
        ctx.strokeStyle = `hsla(${h + rb.hueOff + s * 3}, 80%, 80%, ${(0.06 + rb.energy * 0.35) * (1 - k * 0.7)})`;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7]);
        ctx.stroke();
      }
    }

    // Light pulses: a glowing head with a short fading tail
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pl = pulses[i];
      pl.u += pl.speed * dt;
      if (pl.u > 1.05) { pulses.splice(i, 1); continue; }
      const rb = ribbons[pl.r];
      const p = strandPoints(rb, pl.s, t);
      const ph = h + rb.hueOff + 40;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `hsla(${ph}, 100%, 85%, 0.8)`;
      ctx.shadowColor = `hsla(${ph}, 100%, 70%, 1)`;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      for (let n = 0; n <= 10; n++) {
        const [x, y] = bezierAt(p, Math.max(0, pl.u - n * 0.006));
        if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Floating motes ----------
  const MOTES = 60;
  const motes = [];
  function resetMote(m, anywhere) {
    m.x = Math.random() * W;
    m.y = anywhere ? Math.random() * H : H + 10;
    m.vx = 0;
    m.vy = 0;
    m.rise = 6 + Math.random() * 14;   // px per second
    m.size = 0.6 + Math.random() * 1.6;
    m.ph = Math.random() * Math.PI * 2;
  }
  for (let i = 0; i < MOTES; i++) { const m = {}; resetMote(m, true); motes.push(m); }

  function updateAndDrawMotes(t, dt) {
    ctx.globalCompositeOperation = 'lighter';
    for (const m of motes) {
      // Ripple wavefronts nudge motes outward
      for (const r of ripples) {
        if (r.p <= 0) continue;
        const dx = m.x - r.x, dy = m.y - r.y;
        const d = Math.hypot(dx, dy) || 1;
        if (Math.abs(d - r.radius) < 30) {
          const push = (1 - r.p) * r.alpha * 1500 * dt;
          m.vx += (dx / d) * push;
          m.vy += (dy / d) * push;
        }
      }
      m.vx *= Math.exp(-2 * dt);
      m.vy *= Math.exp(-2 * dt);
      m.x += (m.vx + Math.sin(t * 0.4 + m.ph) * 6) * dt;
      m.y += (m.vy - m.rise * (1 + mood.level)) * dt;
      if (m.y < -10 || m.x < -20 || m.x > W + 20 || m.y > H + 20) resetMote(m, false);

      const twinkle = 0.5 + 0.5 * Math.sin(t * 1.2 + m.ph * 3);
      ctx.fillStyle = `hsla(${hue + 30}, 60%, 85%, ${0.12 + twinkle * (0.15 + mood.treble * 0.5)})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Bars ----------
  // Soft, translucent bars mirrored from the centre: bass in the middle.
  function drawBars() {
    const baseline = H * 0.86;
    const maxH = H * 0.32;
    const n = BARS * 2;
    const slot = W / n;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, slot * 0.45);
    ctx.globalCompositeOperation = 'screen';
    for (let p = 0; p < n; p++) {
      const i = p < BARS ? BARS - 1 - p : p - BARS;
      const v = bars[i];
      const h = 2 + v * maxH;
      const x = (p + 0.5) * slot;
      ctx.strokeStyle = `hsla(${hue + 20 + i * 1.5}, 55%, 82%, ${0.18 + v * 0.4})`;
      ctx.beginPath();
      ctx.moveTo(x, baseline);
      ctx.lineTo(x, baseline - h);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Ripples ----------
  const ripples = [];
  function addRipple(x, y, opts = {}) {
    const rings = opts.rings ?? 3;
    const maxR = opts.maxR ?? 140 + mood.level * 320 + Math.random() * 60;
    for (let i = 0; i < rings; i++) {
      ripples.push({
        x, y,
        p: -i * 0.12,                // negative = waiting to start (staggered rings)
        maxR: maxR * (1 - i * 0.18),
        duration: opts.duration ?? 1.6,
        width: (opts.width ?? 4) * (1 - i * 0.25),
        alpha: opts.alpha ?? 1,
        hue: hue + 30 + i * 25,
        radius: 0,
      });
    }
  }

  const sparks = [];
  function spawnSparks(x, y, n, h, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (1.5 + Math.random() * 4) * power;
      sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, hue: h + Math.random() * 40 - 20, size: 1 + Math.random() * 2 });
    }
  }

  let pointerDown = false;
  let lastDragRipple = 0;
  canvas.addEventListener('pointerdown', (e) => {
    pointerDown = true;
    canvas.setPointerCapture(e.pointerId);
    addRipple(e.clientX, e.clientY);
    // Push nearby Voronoi seeds away so the cells warp around the click
    for (const s of sites) {
      const dx = s.x - e.clientX, dy = s.y - e.clientY;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 260) {
        s.vx += (dx / d) * (260 - d) * 2;
        s.vy += (dy / d) * (260 - d) * 2;
      }
    }
    spawnSparks(e.clientX, e.clientY, 22, hue + 30, 1 + mood.level * 1.5);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointerDown) return;
    const now = performance.now();
    if (now - lastDragRipple > 70) {
      lastDragRipple = now;
      addRipple(e.clientX, e.clientY, { rings: 1, maxR: 70 + mood.level * 140, width: 2.5, duration: 1.1 });
      spawnSparks(e.clientX, e.clientY, 4, hue + 30, 0.6);
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
        g.addColorStop(0, `hsla(${r.hue}, 90%, 75%, ${0.22 * (1 - r.p / 0.35)})`);
        g.addColorStop(1, `hsla(${r.hue}, 90%, 60%, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.lineWidth = r.width * (1 - r.p) + 0.5;
      ctx.strokeStyle = `hsla(${r.hue}, 85%, 72%, ${fade})`;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = 1;
      ctx.strokeStyle = `hsla(${r.hue + 40}, 85%, 85%, ${fade * 0.5})`;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius * 0.82, 0, Math.PI * 2);
      ctx.stroke();
    }

    const f = dt * 60;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.vx *= 0.95; s.vy *= 0.95;
      s.x += s.vx * f; s.y += s.vy * f;
      s.life -= dt * 1.3;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.fillStyle = `hsla(${s.hue}, 90%, 78%, ${s.life})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * s.life + 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Main loop ----------
  let last = performance.now();
  let frame = 0;
  function loop() {
    // Read the clock here rather than trusting the rAF timestamp, which can be
    // earlier than `last` and would make dt negative
    const now = performance.now();
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    const t = now / 1000;

    analyse(t, dt);
    drawField();
    updateAndDrawVoronoi(t, dt);
    updateAndDrawRibbons(t, dt);
    updateAndDrawMotes(t, dt);
    if (showBars) drawBars();
    updateAndDrawRipples(dt);
    drawGrain();

    if (!seeking && isFinite(audio.duration) && audio.duration > 0) {
      seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
      curTime.textContent = fmt(audio.currentTime);
    }
    // Safety net: keep the play button in step even if a media event was missed
    if (shownPlaying === audio.paused) syncPlayIcon();
    if (++frame % 10 === 0) {
      document.documentElement.style.setProperty('--accent', `hsl(${(hue + 30) % 360} 70% 72%)`);
    }

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
