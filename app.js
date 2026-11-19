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
  const sceneBtn = $('sceneBtn');

  // ---------- Canvas sizing ----------
  let W = 0, H = 0;
  function resize() {
    // Capped at 1.5x: the art is soft, so this looks the same and draws far fewer pixels
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
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
    pickRandomScene();
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
    else if (e.key === 's' || e.key === 'S') nextScene();
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
      if (scene === 'glass') {
        sparkleEdges(10 + Math.round(mood.level * 20));
        spawnWave();
        spawnPulse();
        spawnPulse();
      } else if (scene === 'flow') {
        const sign = Math.random() < 0.5 ? -1 : 1;
        addVortex(W * (0.15 + Math.random() * 0.7), H * (0.15 + Math.random() * 0.7),
          sign * (1.5 + mood.level * 2.5), 120 + Math.random() * 120);
        arrowFlash = 1;
      } else {
        flashFireflies(0.35 + mood.level * 0.3);
        if (Math.random() < 0.5) spawnShootingStar();
      }
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

  // Fine film grain breaks up gradient banding and adds texture. It is a
  // static CSS layer, so it costs nothing per frame.
  (() => {
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
    $('grain').style.backgroundImage = `url(${c.toDataURL()})`;
  })();

  // ---------- Geometry: stained-glass Voronoi ----------
  // Hundreds of seeds on a jittered grid drift slowly; every frame the screen
  // is split into the cells closest to each seed and filled like stained glass.
  // Seeds near the centre listen to the bass, seeds near the edges to the
  // treble. Beats send waves of light through the glass, clicks do too, and
  // random lead lines light up with the music.
  const sites = [];
  const edgeGlow = new Map();   // key for a pair of neighbouring seeds -> glow 0..1
  const waves = [];             // expanding light waves sent out on beats
  let cells = [];
  let gridCols = 0, gridRows = 0, cellSize = 0;

  function layoutSites() {
    sites.length = 0;
    edgeGlow.clear();
    cellSize = Math.max(55, Math.sqrt((W * H) / 280));
    gridCols = Math.ceil(W / cellSize) + 1;
    gridRows = Math.ceil(H / cellSize) + 1;
    const half = Math.hypot(W, H) / 2;
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const hx = (c - 0.3 + Math.random() * 0.6) * cellSize;
        const hy = (r - 0.3 + Math.random() * 0.6) * cellSize;
        sites.push({
          hx, hy,
          sx: 0.08 + Math.random() * 0.1,
          sy: 0.08 + Math.random() * 0.1,
          ph: Math.random() * Math.PI * 2,
          // Neighbouring cells get similar colours, so hues sweep across the glass
          hueOff: Math.sin(hx * 0.004 + 1.3) * 35 + Math.cos(hy * 0.005) * 30 + (Math.random() - 0.5) * 18,
          band: Math.min(1, Math.hypot(hx - W / 2, hy - H / 2) / half),
          energy: 0, light: 0,
          ox: 0, oy: 0, vx: 0, vy: 0,
          x: hx, y: hy,
        });
      }
    }
  }
  window.addEventListener('resize', layoutSites);
  layoutSites();

  const pairKey = (i, j) => (i < j ? i * 8192 + j : j * 8192 + i);

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

  // Seeds never stray more than about a grid cell from home, so only seeds
  // within two grid cells can share a wall; that keeps this fast with hundreds of cells.
  function computeCells() {
    const m = 4;
    cells = sites.map((s, i) => {
      const r0 = (i / gridCols) | 0, c0 = i % gridCols;
      let poly = [
        { x: -m, y: -m, e: -1 }, { x: W + m, y: -m, e: -1 },
        { x: W + m, y: H + m, e: -1 }, { x: -m, y: H + m, e: -1 },
      ];
      for (let r = Math.max(0, r0 - 2); r <= Math.min(gridRows - 1, r0 + 2) && poly.length; r++) {
        for (let c = Math.max(0, c0 - 2); c <= Math.min(gridCols - 1, c0 + 2) && poly.length; c++) {
          const j = r * gridCols + c;
          if (j === i) continue;
          const o = sites[j];
          const nx = o.x - s.x, ny = o.y - s.y;
          poly = clipPoly(poly, nx, ny, nx * (s.x + o.x) / 2 + ny * (s.y + o.y) / 2, j);
        }
      }
      return poly;
    });
  }

  function glowEdge(i, j, v) {
    const key = pairKey(i, j);
    if (v > (edgeGlow.get(key) || 0)) edgeGlow.set(key, v);
  }

  // Light a random wall of cell `i`
  function lightRandomEdge(i, v = 1) {
    const cell = cells[i];
    if (!cell || !cell.length) return;
    const j = cell[(Math.random() * cell.length) | 0].e;
    if (j >= 0) glowEdge(i, j, v);
  }

  function sparkleEdges(n) {
    for (let k = 0; k < n && sites.length; k++) lightRandomEdge((Math.random() * sites.length) | 0);
  }

  function spawnWave() {
    waves.push({
      x: W * (0.25 + Math.random() * 0.5),
      y: H * (0.25 + Math.random() * 0.5),
      r: 0,
      strength: 0.5 + mood.level * 0.5,
    });
  }

  // How brightly a moving wavefront lights a point: a soft band around the ring
  function frontBump(px, py, x, y, radius, width) {
    const d = Math.abs(Math.hypot(px - x, py - y) - radius);
    return d < width ? 1 - d / width : 0;
  }

  function updateAndDrawVoronoi(t, dt) {
    const live = analyser && !audio.paused;
    const h = hue + tone * 140;
    const maxDrift = cellSize * 0.5;
    const diag = Math.hypot(W, H);

    for (let i = waves.length - 1; i >= 0; i--) {
      waves[i].r += dt * 380;
      if (waves[i].r > diag) waves.splice(i, 1);
    }

    // Move seeds and work out how lit each cell is
    for (const s of sites) {
      s.vx *= Math.exp(-1.5 * dt); s.vy *= Math.exp(-1.5 * dt);
      s.ox = Math.max(-maxDrift, Math.min(maxDrift, (s.ox + s.vx * dt) * Math.exp(-0.6 * dt)));
      s.oy = Math.max(-maxDrift, Math.min(maxDrift, (s.oy + s.vy * dt) * Math.exp(-0.6 * dt)));
      const wander = cellSize * (0.22 + mood.level * 0.2);
      s.x = s.hx + Math.sin(t * s.sx + s.ph) * wander + s.ox;
      s.y = s.hy + Math.cos(t * s.sy + s.ph * 1.7) * wander + s.oy;
      s.energy = follow(s.energy, bars[Math.min(BARS - 1, (s.band * BARS) | 0)], 5, 1.5, dt);

      let lit = 0;
      for (const w of waves) lit = Math.max(lit, frontBump(s.x, s.y, w.x, w.y, w.r, 90) * w.strength * (1 - w.r / diag));
      for (const r of ripples) if (r.p > 0) lit = Math.max(lit, frontBump(s.x, s.y, r.x, r.y, r.radius, 50) * (1 - r.p));
      const twinkle = 0.5 + 0.5 * Math.sin(t * 0.7 + s.ph * 5);
      s.light = follow(s.light, Math.min(1, s.energy * 1.4 + lit + twinkle * 0.08), 10, 2, dt);
    }
    computeCells();

    // Random lead lines light up; the louder a cell's band, the more often
    for (let i = 0; i < sites.length; i++) {
      const rate = live ? sites[i].energy * 1.2 + mood.level * 0.4 : 0.03;
      if (Math.random() < rate * dt) lightRandomEdge(i, live ? 0.6 + Math.min(0.4, sites[i].energy) : 0.5);
    }

    // Glass: every cell filled with its own colour, brighter when lit
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell.length < 3) continue;
      const s = sites[i];
      const L = s.light;
      ctx.fillStyle = `hsla(${h + s.hueOff}, ${50 + L * 30}%, ${16 + L * 38}%, ${0.5 + L * 0.35})`;
      ctx.beginPath();
      ctx.moveTo(cell[0].x, cell[0].y);
      for (let k = 1; k < cell.length; k++) ctx.lineTo(cell[k].x, cell[k].y);
      ctx.closePath();
      ctx.fill();
    }

    // Lead lines between the panes, each shared wall drawn once
    const lit = [];
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = `hsla(${h}, 35%, 5%, 0.75)`;
    ctx.beginPath();
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      for (let k = 0; k < cell.length; k++) {
        const j = cell[k].e;
        if (j < 0 || j < i) continue;
        const a = cell[k], b = cell[(k + 1) % cell.length];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);

        // Click ripples light the walls they cross
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        for (const r of ripples) {
          if (r.p > 0 && frontBump(mx, my, r.x, r.y, r.radius, 14) > 0) glowEdge(i, j, 1 - r.p);
        }
        const g = edgeGlow.get(pairKey(i, j));
        if (g > 0.01) lit.push(a, b, g, sites[i].hueOff);
      }
    }
    ctx.stroke();

    // Lit walls glow, then fade out over about a second. The glow is a wide
    // faint stroke under a thin bright one: shadowBlur looked similar but was far too slow.
    ctx.globalCompositeOperation = 'lighter';
    for (let n = 0; n < lit.length; n += 4) {
      const a = lit[n], b = lit[n + 1], g = lit[n + 2];
      const edgeHue = h + lit[n + 3] + 50;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineWidth = 3 + g * 7;
      ctx.strokeStyle = `hsla(${edgeHue}, 100%, 70%, ${g * 0.22})`;
      ctx.stroke();
      ctx.lineWidth = 1.2 + g * 1.3;
      ctx.strokeStyle = `hsla(${edgeHue}, 95%, 85%, ${g})`;
      ctx.stroke();
    }

    for (const [key, g] of edgeGlow) {
      const next = g - dt * 0.9;
      if (next <= 0.01) edgeGlow.delete(key); else edgeGlow.set(key, next);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Geometry: Bézier silk ----------
  // Four ribbons cross the screen in different directions. Each is a bundle
  // of cubic Bézier strands whose ends are swapped, so the strands twist
  // through each other like string art. Each ribbon follows one part of the
  // spectrum; light pulses travel along the strands with the music.
  const STRANDS = 40;
  const GROUPS = 6;   // strands are batched into a few paths for speed
  const ribbons = [
    { a: [-0.05, 0.15], b: [1.05, 0.8],  band: [0, 0.2],   hueOff: 0,   ph: 0.0, energy: 0 },
    { a: [-0.05, 0.9],  b: [1.05, 0.2],  band: [0.2, 0.45], hueOff: 45,  ph: 1.3, energy: 0 },
    { a: [0.2, -0.05],  b: [0.85, 1.05], band: [0.45, 0.7], hueOff: -40, ph: 2.6, energy: 0 },
    { a: [-0.05, 0.5],  b: [1.05, 0.45], band: [0.7, 1],   hueOff: 90,  ph: 3.9, energy: 0 },
  ];
  const pulses = [];

  function strandPoints(rb, s, t) {
    const k = s / (STRANDS - 1) - 0.5;        // -0.5..0.5 across the ribbon
    const ax = rb.a[0] * W, ay = rb.a[1] * H, bx = rb.b[0] * W, by = rb.b[1] * H;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const px = -(by - ay) / len, py = (bx - ax) / len;   // unit perpendicular
    const spread = len * 0.12;
    const bend = len * (0.12 + rb.energy * 0.22);
    const twist = 2.5 + rb.energy * 3;
    const o1 = bend * Math.sin(t * 0.2 + rb.ph + k * twist);
    const o2 = bend * Math.cos(t * 0.16 + rb.ph * 1.3 - k * twist);
    return [
      ax + px * k * spread, ay + py * k * spread,
      ax + (bx - ax) * 0.33 + px * o1, ay + (by - ay) * 0.33 + py * o1,
      ax + (bx - ax) * 0.67 + px * o2, ay + (by - ay) * 0.67 + py * o2,
      bx - px * k * spread, by - py * k * spread,     // ends swapped: strands cross
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
      speed: 0.2 + Math.random() * 0.2,
    });
  }

  function updateAndDrawRibbons(t, dt) {
    const live = analyser && !audio.paused;
    const h = hue + tone * 140;
    // Plain blending for the strands: additive blending doubled their cost
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'butt';
    ctx.lineWidth = 0.9;

    for (let r = 0; r < ribbons.length; r++) {
      const rb = ribbons[r];
      const lo = Math.floor(rb.band[0] * BARS), hi = Math.max(lo + 1, Math.floor(rb.band[1] * BARS));
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += bars[i];
      rb.energy = follow(rb.energy, sum / (hi - lo), 3, 0.8, dt);
      if (live && Math.random() < (rb.energy * 3 + mood.level) * dt) spawnPulse(r);

      for (let g = 0; g < GROUPS; g++) {
        const edge = g / (GROUPS - 1);   // 0 = middle strands, 1 = outer strands
        ctx.strokeStyle = `hsla(${h + rb.hueOff + g * 8}, 85%, 82%, ${(0.09 + rb.energy * 0.4) * (1 - edge * 0.55)})`;
        ctx.beginPath();
        for (let s = 0; s < STRANDS; s++) {
          const k = Math.abs(s / (STRANDS - 1) - 0.5) * 2;
          if (Math.min(GROUPS - 1, (k * GROUPS) | 0) !== g) continue;
          const p = strandPoints(rb, s, t);
          ctx.moveTo(p[0], p[1]);
          ctx.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7]);
        }
        ctx.stroke();
      }
    }

    // Light pulses: a glowing head with a short fading tail
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pl = pulses[i];
      pl.u += pl.speed * dt;
      if (pl.u > 1.05) { pulses.splice(i, 1); continue; }
      const rb = ribbons[pl.r];
      const p = strandPoints(rb, pl.s, t);
      const ph = h + rb.hueOff + 40;
      ctx.beginPath();
      for (let n = 0; n <= 12; n++) {
        const [x, y] = bezierAt(p, Math.max(0, pl.u - n * 0.005));
        if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineWidth = 8;
      ctx.strokeStyle = `hsla(${ph}, 100%, 70%, 0.2)`;
      ctx.stroke();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = `hsla(${ph}, 100%, 85%, 0.85)`;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Scene: vector field ----------
  // A smooth, slowly changing vector field covers the screen. A grid of arrows
  // shows its direction, and thousands of particles stream along it, leaving
  // fading trails that draw the flow lines. Beats drop swirling vortices into
  // the field, clicks do too, and louder music makes everything flow faster.
  const FLOW_PARTICLES = 1600;
  const FLOW_GROUPS = 6;            // particles are batched by colour group for speed
  const ARROW_STEP = 48;
  const trail = document.createElement('canvas');   // persistent layer for the trails
  const tctx = trail.getContext('2d');
  const flowParts = [];
  const vortices = [];
  let arrowFlash = 0;

  function resizeTrail() {
    trail.width = Math.max(1, Math.round(W));   // trails are soft, so CSS-pixel resolution is plenty
    trail.height = Math.max(1, Math.round(H));
  }
  window.addEventListener('resize', resizeTrail);
  resizeTrail();

  function resetFlowParticle(p) {
    p.x = Math.random() * W;
    p.y = Math.random() * H;
    p.age = 0;
    p.life = 2 + Math.random() * 4;
  }
  for (let i = 0; i < FLOW_PARTICLES; i++) {
    const p = { g: i % FLOW_GROUPS, x: 0, y: 0, age: 0, life: 0 };
    resetFlowParticle(p);
    p.age = Math.random() * p.life;
    flowParts.push(p);
  }

  function addVortex(x, y, strength, radius) {
    vortices.push({ x, y, s: strength, r: radius, life: 1 });
    if (vortices.length > 12) vortices.shift();
  }

  // Direction of the field at (x, y): layered waves that slowly evolve,
  // bent by the bass, plus the swirl of every vortex
  function fieldVec(x, y, t) {
    const k = 0.0021;
    const a = Math.sin(x * k + t * 0.11) * 1.8
      + Math.cos(y * k * 1.3 - t * 0.09) * 1.6
      + Math.sin((x + y) * k * 0.7 + t * 0.05 + mood.bass * 1.5) * 1.2;
    let vx = Math.cos(a), vy = Math.sin(a);
    for (const v of vortices) {
      const dx = x - v.x, dy = y - v.y;
      const d2 = dx * dx + dy * dy + 1;
      const f = (v.s * v.life * v.r * v.r) / (d2 + v.r * v.r);
      const d = Math.sqrt(d2);
      vx += (-dy / d) * f + (dx / d) * f * 0.15;   // mostly swirl, a little outward push
      vy += (dx / d) * f + (dy / d) * f * 0.15;
    }
    return [vx, vy];
  }

  function updateAndDrawFlow(t, dt) {
    const live = analyser && !audio.paused;
    const h = hue + tone * 140;

    for (let i = vortices.length - 1; i >= 0; i--) {
      vortices[i].life -= dt / 3.5;
      if (vortices[i].life <= 0) vortices.splice(i, 1);
    }
    arrowFlash = Math.max(0, arrowFlash - dt * 1.5);

    // Each colour group follows a slice of the spectrum
    const groupEnergy = [];
    for (let g = 0; g < FLOW_GROUPS; g++) {
      const lo = Math.floor((g / FLOW_GROUPS) * BARS), hi = Math.floor(((g + 1) / FLOW_GROUPS) * BARS);
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += bars[i];
      groupEnergy.push(live ? sum / (hi - lo) : 0.05);
    }

    // Fade old trails, then draw this frame's particle steps on top
    tctx.globalCompositeOperation = 'destination-out';
    tctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, 0.07 * dt * 60)})`;
    tctx.fillRect(0, 0, trail.width, trail.height);
    tctx.globalCompositeOperation = 'lighter';
    tctx.lineCap = 'round';
    tctx.lineWidth = 1.3;

    for (let g = 0; g < FLOW_GROUPS; g++) {
      const e = groupEnergy[g];
      const speed = (35 + mood.level * 140 + e * 120) * dt;
      tctx.strokeStyle = `hsla(${h - 45 + g * 18}, 85%, ${62 + e * 20}%, ${0.35 + e * 0.6})`;
      tctx.beginPath();
      for (let i = g; i < FLOW_PARTICLES; i += FLOW_GROUPS) {
        const p = flowParts[i];
        const [vx, vy] = fieldVec(p.x, p.y, t);
        const x0 = p.x, y0 = p.y;
        p.x += vx * speed;
        p.y += vy * speed;
        p.age += dt;
        if (p.age > p.life || p.x < -5 || p.x > W + 5 || p.y < -5 || p.y > H + 5) {
          resetFlowParticle(p);
          continue;
        }
        tctx.moveTo(x0, y0);
        tctx.lineTo(p.x, p.y);
      }
      tctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(trail, 0, 0, W, H);

    // Arrow grid showing the field's direction; flashes on beats
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `hsla(${h + 30}, 60%, 88%, ${0.16 + mood.level * 0.2 + arrowFlash * 0.35})`;
    ctx.beginPath();
    const len = 9 + mood.level * 8 + arrowFlash * 6;
    for (let y = ARROW_STEP / 2; y < H; y += ARROW_STEP) {
      for (let x = ARROW_STEP / 2; x < W; x += ARROW_STEP) {
        const [vx, vy] = fieldVec(x, y, t);
        const m = Math.min(2.5, Math.hypot(vx, vy)) || 1;
        const ux = vx / m, uy = vy / m;
        const l = len * (0.6 + m * 0.4);
        const tx = x + ux * l, ty = y + uy * l;
        ctx.moveTo(x - ux * l, y - uy * l);
        ctx.lineTo(tx, ty);
        // Arrowhead
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - ux * 5 - uy * 3.5, ty - uy * 5 + ux * 3.5);
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - ux * 5 + uy * 3.5, ty - uy * 5 - ux * 3.5);
      }
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Scene: fireflies and star dust ----------
  // Only particles: a slowly turning sky of twinkling star dust with fireflies
  // drifting through it. Treble makes the stars twinkle, bass makes them
  // pulse, each firefly glows with its own part of the spectrum, and beats
  // make groups of fireflies flash together and send shooting stars across.
  const STARS = 1400;
  const FIREFLIES = 70;
  const FIREFLY_TINTS = [40, 75, 110];   // hue offsets from the screen colour
  const stars = [];
  const fireflies = [];
  const shooting = [];
  let starSpin = 0;

  // Glows are pre-drawn sprites stamped with drawImage, which is far cheaper
  // than shadowBlur. They are re-tinted only when the colour has drifted.
  function makeGlowSprite(h) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `hsla(${h}, 100%, 92%, 1)`);
    grad.addColorStop(0.18, `hsla(${h}, 100%, 70%, 0.8)`);
    grad.addColorStop(0.5, `hsla(${h}, 100%, 55%, 0.18)`);
    grad.addColorStop(1, `hsla(${h}, 100%, 50%, 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return c;
  }
  let sprites = [];
  let spriteHue = null;
  function refreshSprites(h) {
    if (spriteHue !== null && Math.abs(h - spriteHue) < 4) return;
    spriteHue = h;
    sprites = FIREFLY_TINTS.map((o) => makeGlowSprite(h + o));
  }

  function layoutDust() {
    stars.length = 0;
    const R = Math.hypot(W, H) / 2;
    for (let i = 0; i < STARS; i++) {
      const depth = Math.random() ** 2;   // most stars are far away and faint
      stars.push({
        r: Math.sqrt(Math.random()) * R,  // even spread over the area
        a: Math.random() * Math.PI * 2,
        depth,
        size: 0.6 + depth * 1.8,
        tw: 0.8 + Math.random() * 2.5,
        ph: Math.random() * Math.PI * 2,
        ox: 0, oy: 0, vx: 0, vy: 0, x: 0, y: 0,
      });
    }
    fireflies.length = 0;
    for (let i = 0; i < FIREFLIES; i++) {
      fireflies.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: 0, vy: 0,
        ph: Math.random() * 100,
        blinkRate: 0.6 + Math.random() * 1.2,
        blinkPh: Math.random() * Math.PI * 2,
        size: 26 + Math.random() * 34,
        tint: i % FIREFLY_TINTS.length,
        band: Math.random(),
        flash: 0,
        glow: 0,
      });
    }
  }
  window.addEventListener('resize', layoutDust);
  layoutDust();

  function flashFireflies(fraction) {
    for (const f of fireflies) if (Math.random() < fraction) f.flash = 1;
  }

  function spawnShootingStar() {
    const fromLeft = Math.random() < 0.5;
    const ang = (fromLeft ? 0.35 : Math.PI - 0.35) + (Math.random() - 0.5) * 0.4;
    const sp = 700 + Math.random() * 500;
    shooting.push({
      x: fromLeft ? Math.random() * W * 0.5 : W * (0.5 + Math.random() * 0.5),
      y: Math.random() * H * 0.4,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life: 1,
    });
  }

  function updateAndDrawDust(t, dt) {
    const live = analyser && !audio.paused;
    const h = hue + tone * 140;
    refreshSprites(Math.round(h));

    // Darken the colour wash into a night sky so the lights stand out
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, W, H);

    // Star dust turns slowly around the centre; near stars turn faster
    starSpin += dt * (0.008 + mood.level * 0.04);
    const cx = W / 2, cy = H / 2;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `hsl(${h + 30}, 40%, 90%)`;
    for (const s of stars) {
      // Ripple wavefronts push stars aside; they drift back afterwards
      for (const r of ripples) {
        if (r.p <= 0) continue;
        const dx = s.x - r.x, dy = s.y - r.y;
        const d = Math.hypot(dx, dy) || 1;
        if (Math.abs(d - r.radius) < 30) {
          const push = (1 - r.p) * r.alpha * 1500 * dt;
          s.vx += (dx / d) * push;
          s.vy += (dy / d) * push;
        }
      }
      s.vx *= Math.exp(-2 * dt);
      s.vy *= Math.exp(-2 * dt);
      s.ox = (s.ox + s.vx * dt) * Math.exp(-0.8 * dt);
      s.oy = (s.oy + s.vy * dt) * Math.exp(-0.8 * dt);
      const a = s.a + starSpin * (0.4 + s.depth);
      s.x = cx + Math.cos(a) * s.r + s.ox;
      s.y = cy + Math.sin(a) * s.r + s.oy;
      if (s.x < -4 || s.x > W + 4 || s.y < -4 || s.y > H + 4) continue;

      const tw = 0.55 + 0.45 * Math.sin(t * s.tw * (1 + mood.treble * 3) + s.ph);
      const alpha = Math.min(1, (0.25 + s.depth * 0.6) * tw * (0.8 + mood.treble * 1.2));
      const size = s.size * (1 + mood.bass * 0.8 * s.depth);
      ctx.globalAlpha = alpha;
      ctx.fillRect(s.x - size / 2, s.y - size / 2, size, size);
      // The nearest stars get a small halo
      if (s.depth > 0.9) {
        ctx.globalAlpha = alpha * 0.5;
        ctx.drawImage(sprites[0], s.x - 6, s.y - 6, 12, 12);
      }
    }

    // Fireflies wander on smooth, curving paths and blink
    for (const f of fireflies) {
      const dir = Math.sin(t * 0.3 + f.ph) * 2.2 + Math.cos(t * 0.17 + f.ph * 1.7) * 1.6;
      const sp = 18 + mood.level * 40;
      const k = 1 - Math.exp(-1.5 * dt);
      f.vx += (Math.cos(dir) * sp - f.vx) * k;
      f.vy += (Math.sin(dir) * sp - f.vy) * k;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < -40) f.x = W + 40; else if (f.x > W + 40) f.x = -40;
      if (f.y < -40) f.y = H + 40; else if (f.y > H + 40) f.y = -40;

      const e = live ? bars[Math.min(BARS - 1, (f.band * BARS) | 0)] : 0;
      const blink = Math.pow(Math.max(0, Math.sin(t * f.blinkRate + f.blinkPh)), 3);
      f.flash = Math.max(0, f.flash - dt * 1.2);
      f.glow = follow(f.glow, Math.min(1, blink * 0.6 + e * 1.2 + f.flash), 8, 3, dt);
      if (f.glow < 0.02) continue;

      const size = f.size * (0.7 + f.glow * 0.6);
      ctx.globalAlpha = f.glow;
      ctx.drawImage(sprites[f.tint], f.x - size / 2, f.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;

    // Shooting stars: a bright head with a fading tail
    ctx.lineCap = 'round';
    for (let i = shooting.length - 1; i >= 0; i--) {
      const s = shooting[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt * 1.1;
      if (s.life <= 0) { shooting.splice(i, 1); continue; }
      const tx = s.x - s.vx * 0.12, ty = s.y - s.vy * 0.12;
      const g = ctx.createLinearGradient(s.x, s.y, tx, ty);
      g.addColorStop(0, `hsla(${h + 40}, 100%, 92%, ${s.life})`);
      g.addColorStop(1, `hsla(${h + 40}, 100%, 70%, 0)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Scene selection ----------
  // Each page load and each new song picks one of the backgrounds at random
  const SCENES = ['glass', 'flow', 'dust'];
  let scene = 'glass';
  function setScene(name) {
    scene = name;
    if (name === 'flow') tctx.clearRect(0, 0, trail.width, trail.height);
  }
  function pickRandomScene() {
    setScene(SCENES[(Math.random() * SCENES.length) | 0]);
  }
  pickRandomScene();

  function nextScene() {
    setScene(SCENES[(SCENES.indexOf(scene) + 1) % SCENES.length]);
  }
  sceneBtn.addEventListener('click', (e) => { nextScene(); e.currentTarget.blur(); });

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
    if (scene === 'glass') {
      // Push nearby Voronoi seeds away so the cells warp around the click
      for (const s of sites) {
        const dx = s.x - e.clientX, dy = s.y - e.clientY;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 260) {
          s.vx += (dx / d) * (260 - d) * 2;
          s.vy += (dy / d) * (260 - d) * 2;
        }
      }
    } else if (scene === 'flow') {
      // Drop a strong swirl into the vector field where you clicked
      addVortex(e.clientX, e.clientY, (Math.random() < 0.5 ? -1 : 1) * 4, 160);
      arrowFlash = 1;
    } else {
      // Nearby fireflies light up and scatter
      for (const f of fireflies) {
        const dx = f.x - e.clientX, dy = f.y - e.clientY;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 220) {
          f.flash = 1;
          f.vx += (dx / d) * 120;
          f.vy += (dy / d) * 120;
        }
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
    if (scene === 'glass') {
      updateAndDrawVoronoi(t, dt);
      updateAndDrawRibbons(t, dt);
    } else if (scene === 'flow') {
      updateAndDrawFlow(t, dt);
    } else {
      updateAndDrawDust(t, dt);
    }
    updateAndDrawMotes(t, dt);
    if (showBars) drawBars();
    updateAndDrawRipples(dt);

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
