(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================================
     LOADER_CFG — todos los parámetros ajustables de la intro
     cinematográfica. Los tiempos (ms) deben coincidir con los
     animation-delay definidos en css/style.css (sección LOADER).
     ============================================================ */
  const LOADER_CFG = {
    totalDuration: 4600,       // duración total del loader (ms)
    centerXRatio: 0.5,         // punto de convergencia / destello (X, 0-1 del ancho)
    centerYRatio: 0.42,        // punto de convergencia / destello (Y, ligeramente sobre el centro)
    dove: {
      scale: 1,                // multiplicador de escala general de la paloma
      flightEnd: 2500,         // ms en que termina el recorrido (incluye la entrada)
      startXRatio: 1.18,       // posición inicial, fuera de pantalla a la derecha
      endXRatio: -0.34,        // posición final, fuera de pantalla a la izquierda
      yBandRatio: 0.24,        // banda vertical base del vuelo (0-1 del alto)
      waveAmplitudeRatio: 0.065,// amplitud del vuelo ondulado (suave)
      waveCycles: 1.1,          // ciclos de onda durante el recorrido (pocos = sin quiebres)
      flapPeriodMs: 130,       // velocidad del aleteo
    },
    converge: { start: 2300, end: 3000, strength: 1 },
    flash: { start: 2900, peak: 3080, end: 3300 },
    logo: { start: 3200 },
    particles: {
      spawnIntervalMs: 42,     // frecuencia de generación de partículas a lo largo de la estela
      maxActive: 170,          // límite de partículas simultáneas (rendimiento)
      trailColors: ['#F0B429', '#2F7DFF', '#E63946', '#2ECC71', '#B534E0'], // dorado, azul eléctrico, rojo, verde, magenta
      glow: 1,                 // intensidad general del glow (multiplicador)
    },
  };

  /* ============ LOADER: secuencia (show/hide) ============ */
  function initLoader() {
    const loader = document.getElementById('loader');
    if (!loader) return;
    const seen = sessionStorage.getItem('pactoLoaderShown');
    const finish = () => {
      loader.classList.add('is-hidden');
      sessionStorage.setItem('pactoLoaderShown', '1');
      document.body.classList.remove('no-scroll');
    };
    if (seen) {
      loader.classList.add('is-hidden');
      return;
    }
    document.body.classList.add('no-scroll');
    const showMs = reduceMotion ? 900 : LOADER_CFG.totalDuration;
    window.addEventListener('load', () => setTimeout(finish, showMs));
    setTimeout(finish, showMs + 2500); // salvaguarda
  }

  /* ============ LOADER: motor cinematográfico (Canvas) ============
     Paloma → estela multicolor → dispersión → convergencia al
     centro → destello → logo. Todo el sistema de estelas y
     partículas vive en <canvas>, animado con requestAnimationFrame
     (sin elementos DOM por partícula) para mantener 60 FPS.
     ================================================================ */
  function initCinematicLoader() {
    if (reduceMotion) return; // versión reducida: solo el fade de logo definido en CSS
    const canvas = document.getElementById('loaderCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const C = LOADER_CFG;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    let W = window.innerWidth, H = window.innerHeight, density = 1;
    function resize() {
      const DPR = Math.min(window.devicePixelRatio || 1, 1.5); // limita la resolucion para mantener 60fps
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      density = W < 640 ? 0.45 : (W < 1024 ? 0.7 : 1);
    }
    window.addEventListener('resize', resize, { passive: true });
    resize();

    const cx = () => W * C.centerXRatio;
    const cy = () => H * C.centerYRatio;
    const uiScale = () => Math.min(W, H) / 900; // factor responsivo para tamaños/anchos

    /* ---------- paloma ---------- */
    function doveProgress(t) {
      return easeInOutCubic(clamp(t / C.dove.flightEnd, 0, 1));
    }
    function dovePos(t) {
      const p = doveProgress(t);
      const d = C.dove;
      const x = (d.startXRatio - p * (d.startXRatio - d.endXRatio)) * W;
      const y = (d.yBandRatio + d.waveAmplitudeRatio * Math.sin(p * Math.PI * d.waveCycles) + p * 0.05) * H;
      return { x, y, p };
    }
    // Suavizado: la posicion "real" (dovePos) es el objetivo, pero lo que se
    // dibuja es una version filtrada que se desliza hacia ese objetivo cada
    // frame. Esto elimina cualquier quiebre visible y hace que el aleteo
    // (bank) reaccione al movimiento vertical real en vez de oscilar solo.
    let smoothX = null, smoothY = null, smoothVY = 0;
    function updateDoveSmooth(t, dt) {
      const target = dovePos(t);
      if (smoothX === null) { smoothX = target.x; smoothY = target.y; return; }
      const tau = 110; // ms: mayor = trayectoria mas fluida/perezosa
      const k = 1 - Math.exp(-Math.max(dt, 1) / tau);
      const prevY = smoothY;
      smoothX = lerp(smoothX, target.x, k);
      smoothY = lerp(smoothY, target.y, k);
      const rawVY = (smoothY - prevY) / Math.max(dt, 1);
      smoothVY = lerp(smoothVY, rawVY, 0.2);
    }
    function doveRenderPos() {
      return smoothX === null ? null : { x: smoothX, y: smoothY };
    }
    function doveAlpha(t) {
      if (t > C.dove.flightEnd + 200) return 0;
      const p = doveProgress(t);
      if (p < 0.05) return p / 0.05;
      if (p > 0.86) return clamp(1 - (p - 0.86) / 0.14, 0, 1);
      return 1;
    }

    let wingFlapScale = 1;
    function drawDoveShape(g) {
      // cola
      g.fillStyle = '#FFFFFF';
      g.beginPath(); g.moveTo(172, 72); g.quadraticCurveTo(195, 52, 230, 50); g.quadraticCurveTo(210, 68, 172, 72); g.closePath(); g.fill();
      g.fillStyle = '#DCE8FB';
      g.beginPath(); g.moveTo(172, 78); g.quadraticCurveTo(200, 72, 238, 80); g.quadraticCurveTo(215, 85, 172, 78); g.closePath(); g.fill();
      g.fillStyle = '#FFFFFF';
      g.beginPath(); g.moveTo(172, 84); g.quadraticCurveTo(195, 92, 225, 108); g.quadraticCurveTo(205, 100, 172, 84); g.closePath(); g.fill();
      // cuerpo
      g.beginPath();
      g.moveTo(18, 72);
      g.quadraticCurveTo(8, 58, 22, 50);
      g.quadraticCurveTo(55, 40, 100, 46);
      g.quadraticCurveTo(145, 52, 172, 68);
      g.quadraticCurveTo(180, 73, 172, 80);
      g.quadraticCurveTo(145, 90, 100, 92);
      g.quadraticCurveTo(55, 94, 25, 86);
      g.quadraticCurveTo(8, 80, 18, 72);
      g.closePath(); g.fill();
      // ala en abanico (con aleteo)
      g.save();
      g.translate(75, 70);
      g.scale(1, wingFlapScale);
      g.translate(-75, -70);
      const feathers = [
        ['#FFFFFF', 70, 40, 90, 20, 88, 48],
        ['#DCE8FB', 85, 30, 115, 5, 108, 40],
        ['#FFFFFF', 100, 15, 145, -8, 130, 25],
        ['#DCE8FB', 120, 10, 170, 5, 150, 30],
        ['#FFFFFF', 135, 15, 185, 30, 165, 40],
      ];
      feathers.forEach(([fill, c1x, c1y, tx, ty, c2x, c2y]) => {
        g.fillStyle = fill;
        g.beginPath();
        g.moveTo(75, 70);
        g.quadraticCurveTo(c1x, c1y, tx, ty);
        g.quadraticCurveTo(c2x, c2y, 75, 70);
        g.closePath(); g.fill();
      });
      g.restore();
      // cabeza y pico
      g.fillStyle = '#FFFFFF';
      g.beginPath(); g.arc(20, 58, 13, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(4, 56); g.lineTo(-10, 60); g.lineTo(4, 65); g.closePath(); g.fill();
      g.fillStyle = '#2A3050';
      g.beginPath(); g.arc(17, 54, 1.8, 0, Math.PI * 2); g.fill();
    }
    function drawDove(t) {
      const a = doveAlpha(t);
      if (a <= 0.01) return;
      const pos = doveRenderPos();
      if (!pos) return;
      const bank = clamp(smoothVY * 2.4, -0.16, 0.16); // inclinacion suave segun el movimiento vertical real
      wingFlapScale = 0.55 + Math.abs(Math.sin(t / C.dove.flapPeriodMs)) * 0.45;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(pos.x, pos.y);
      ctx.rotate(bank);
      ctx.scale(C.dove.scale * uiScale(), C.dove.scale * uiScale());
      // iluminacion azul/violeta muy sutil: separa la paloma del fondo sin verse plana
      ctx.shadowColor = 'rgba(130,150,255,0.55)';
      ctx.shadowBlur = 20;
      drawDoveShape(ctx);
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    /* ---------- estelas: 5 hebras que reaccionan a la posicion real de la paloma ---------- */
    const strands = C.particles.trailColors.map((color, i) => ({
      color,
      points: [],
      maxLen: [60, 78, 48, 88, 66][i % 5],
      offset: (i - 2) * 6,
      width: [2.4, 3.2, 2, 3.6, 2.6][i % 5],
      phase: i * 1.6,
    }));

    function updateTrails(t) {
      if (t <= C.dove.flightEnd + 100) {
        const pos = doveRenderPos();
        const s = uiScale();
        if (pos) {
          strands.forEach((strand, i) => {
            const wob = Math.sin(t / 420 + strand.phase) * 5 * s;
            strand.points.push({
              x: pos.x + wob,
              y: pos.y + strand.offset * s + Math.sin(t / 600 + i) * 3 * s,
            });
            if (strand.points.length > strand.maxLen) strand.points.shift();
          });
        }
      }
      if (t > C.converge.start) {
        const cp = clamp((t - C.converge.start) / (C.converge.end - C.converge.start), 0, 1);
        const pull = easeInOutCubic(cp) * C.converge.strength;
        const px = cx(), py = cy();
        strands.forEach((strand) => {
          strand.points.forEach((pt) => {
            pt.x = lerp(pt.x, px, pull * 0.065);
            pt.y = lerp(pt.y, py, pull * 0.065);
          });
          if (cp > 0.65 && strand.points.length > 4) strand.points.shift();
        });
      }
    }

    function drawTrails(t) {
      const globalFade = t > C.converge.start
        ? clamp(1 - ((t - C.converge.start) / (C.converge.end - C.converge.start)) * 1.15, 0, 1)
        : 1;
      if (globalFade <= 0.02) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const s = uiScale();
      // Glow "falso" y barato: una pasada ancha y muy translucida (el halo)
      // y una pasada nitida encima (el nucleo), sin shadowBlur — esa es la
      // operacion mas cara de Canvas y la causante principal de la caida de FPS.
      strands.forEach((strand) => {
        const pts = strand.points;
        const n = pts.length;
        if (n < 2) return;
        const chunks = 3;
        const chunkLen = Math.max(1, Math.ceil(n / chunks));
        for (let c = 0; c < chunks; c++) {
          const from = c * chunkLen;
          const to = Math.min(n - 1, from + chunkLen);
          if (to <= from) continue;
          const age = (from + to) / 2 / n; // 0 = cola vieja, 1 = cabeza junto a la paloma
          const alpha = Math.pow(age, 1.6) * globalFade * C.particles.glow;
          if (alpha <= 0.015) continue;
          ctx.beginPath();
          ctx.moveTo(pts[from].x, pts[from].y);
          for (let i = from + 1; i <= to; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.strokeStyle = strand.color;

          // halo ancho y tenue
          ctx.globalAlpha = alpha * 0.22;
          ctx.lineWidth = strand.width * (1.6 + age * 1.4) * s;
          ctx.stroke();

          // nucleo nitido
          ctx.globalAlpha = alpha * 0.85;
          ctx.lineWidth = strand.width * (0.4 + age * 0.7) * s;
          ctx.stroke();
        }
      });
      ctx.restore();
    }

    /* ---------- particulas: medianas + diminutas, ligadas a la estela ---------- */
    let particles = [];
    let spawnAcc = 0;
    let flashBurstDone = false;

    function spawnAlong(t, dt) {
      if (t > C.dove.flightEnd) return;
      spawnAcc += dt;
      const interval = C.particles.spawnIntervalMs / Math.max(density, 0.35);
      let guard = 0;
      while (spawnAcc > interval && guard < 6) {
        spawnAcc -= interval;
        guard++;
        const strand = strands[Math.floor(Math.random() * strands.length)];
        const pt = strand.points[strand.points.length - 1];
        if (!pt) continue;
        const kind = Math.random() < 0.72 ? 'tiny' : 'medium';
        const s = uiScale();
        const scatter = (kind === 'tiny' ? 22 : 13) * s;
        particles.push({
          x: pt.x + (Math.random() - 0.5) * scatter,
          y: pt.y + (Math.random() - 0.5) * scatter,
          vx: (Math.random() - 0.5) * 0.02,
          vy: (Math.random() - 0.5) * 0.02 - 0.01,
          size: (kind === 'tiny' ? 0.6 + Math.random() * 1 : 1.6 + Math.random() * 1.8) * s,
          color: strand.color,
          bornT: t,
          life: kind === 'tiny' ? 1200 + Math.random() * 900 : 1600 + Math.random() * 1000,
          kind,
          noConverge: false,
          convergeDelay: null,
          convergeDur: 900 + Math.random() * 900,
          startX: 0, startY: 0,
          curAlpha: 0, curSize: 0,
        });
      }
      if (particles.length > C.particles.maxActive) {
        particles.splice(0, particles.length - C.particles.maxActive);
      }
    }

    function maybeBurst(t) {
      if (flashBurstDone || t < C.flash.start) return;
      flashBurstDone = true;
      const s = uiScale();
      const n = Math.round(22 * density);
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 0.08 + Math.random() * 0.2;
        particles.push({
          x: cx(), y: cy(),
          vx: Math.cos(ang) * spd * s, vy: Math.sin(ang) * spd * s,
          size: (0.8 + Math.random() * 1.6) * s,
          color: C.particles.trailColors[i % C.particles.trailColors.length],
          bornT: t,
          life: 500 + Math.random() * 500,
          kind: 'tiny',
          noConverge: true,
          convergeDelay: null,
          convergeDur: 0,
          startX: 0, startY: 0,
          curAlpha: 0, curSize: 0,
        });
      }
    }

    function updateParticles(t, dt) {
      const px = cx(), py = cy();
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const age = t - p.bornT;

        if (!p.noConverge && t > C.converge.start && p.convergeDelay === null) {
          p.convergeDelay = C.converge.start + Math.random() * (C.converge.end - C.converge.start) * 0.55;
          p.startX = p.x; p.startY = p.y;
        }

        if (!p.noConverge && p.convergeDelay !== null && t > p.convergeDelay) {
          const cp = clamp((t - p.convergeDelay) / p.convergeDur, 0, 1);
          const e = easeInOutCubic(cp);
          p.x = lerp(p.startX, px, e);
          p.y = lerp(p.startY, py, e);
          p.curSize = lerp(p.size, p.size * 0.2, e);
          p.curAlpha = (1 - Math.max(0, cp - 0.82) / 0.18) * 0.9;
          if (cp >= 1) { particles.splice(i, 1); continue; }
        } else {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.curSize = p.size;
          const lifeP = age / p.life;
          p.curAlpha = lifeP < 0.15 ? lifeP / 0.15 : lifeP > 0.7 ? clamp(1 - (lifeP - 0.7) / 0.3, 0, 1) : 1;
          if (age > p.life) { particles.splice(i, 1); continue; }
        }
      }
    }

    function drawParticles() {
      // Sin shadowBlur (costoso): las medianas llevan un halo extra dibujado
      // como un circulo mas grande y translucido antes del nucleo nitido.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      particles.forEach((p) => {
        const a = clamp(p.curAlpha, 0, 1) * (p.kind === 'tiny' ? 0.55 : 0.88) * C.particles.glow;
        if (a <= 0.02) return;
        const size = Math.max(0.3, p.curSize);
        ctx.fillStyle = p.color;
        if (p.kind !== 'tiny') {
          ctx.globalAlpha = a * 0.28;
          ctx.beginPath();
          ctx.arc(p.x, p.y, size * 2.1, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    /* ---------- destello cinematografico: nucleo + halos + flares ---------- */
    function drawFlash(t) {
      const { start, peak, end } = C.flash;
      const tail = end + (end - peak); // cola breve tras el pico
      if (t < start || t > tail) return;
      const dur = end - start;
      const p = clamp((t - start) / dur, 0, 1);
      const peakP = (peak - start) / dur;
      let intensity = p < peakP
        ? easeOutCubic(p / peakP)
        : clamp(1 - easeInOutCubic((p - peakP) / (1 - peakP)), 0, 1);
      if (intensity <= 0.015) return;

      const px = cx(), py = cy(), s = uiScale();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      let r = 190 * intensity * s + 16;
      let g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(150,90,230,${0.32 * intensity})`);
      g.addColorStop(1, 'rgba(150,90,230,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();

      r = 120 * intensity * s + 12;
      g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(80,150,255,${0.5 * intensity})`);
      g.addColorStop(1, 'rgba(80,150,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();

      r = 44 * intensity * s + 5;
      g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(255,255,255,${intensity})`);
      g.addColorStop(0.5, `rgba(255,255,255,${0.6 * intensity})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();

      const flareLen = W * 0.42 * intensity;
      const lg = ctx.createLinearGradient(px - flareLen, py, px + flareLen, py);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, `rgba(255,255,255,${0.4 * intensity})`);
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(px - flareLen, py - 1.1, flareLen * 2, 2.2);

      const flareLenV = H * 0.22 * intensity;
      const lg2 = ctx.createLinearGradient(px, py - flareLenV, px, py + flareLenV);
      lg2.addColorStop(0, 'rgba(255,255,255,0)');
      lg2.addColorStop(0.5, `rgba(255,255,255,${0.14 * intensity})`);
      lg2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg2;
      ctx.fillRect(px - 0.8, py - flareLenV, 1.6, flareLenV * 2);

      ctx.restore();
    }

    /* ---------- bucle principal ---------- */
    let startTime = null;
    let lastT = 0;
    function frame(now) {
      if (startTime === null) startTime = now;
      const t = now - startTime;
      let dt = t - lastT;
      if (dt > 48) dt = 48; // evita saltos si la pestana estuvo en segundo plano
      lastT = t;

      ctx.clearRect(0, 0, W, H);

      updateDoveSmooth(t, dt);
      updateTrails(t);
      spawnAlong(t, dt);
      maybeBurst(t);
      updateParticles(t, dt);

      drawTrails(t);
      drawParticles();
      if (t >= C.flash.start) drawFlash(t);
      drawDove(t);

      if (t < C.totalDuration) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ============ HEADER / SCROLL SPY ============ */
  function initHeader() {
    const header = document.getElementById('header');
    const progress = document.getElementById('headerProgress');
    if (!header) return;

    const onScroll = () => {
      const scrolled = window.scrollY > 40;
      header.classList.toggle('is-scrolled', scrolled);
      if (progress) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const pct = max > 0 ? (window.scrollY / max) * 100 : 0;
        progress.style.width = pct + '%';
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const nav = document.getElementById('nav');
    const pill = document.getElementById('navPill');
    const navLinksInMain = nav ? Array.from(nav.querySelectorAll('.nav__link')) : [];

    const movePill = (link) => {
      if (!pill || !link || !nav) return;
      const navRect = nav.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();
      pill.style.width = linkRect.width + 'px';
      pill.style.transform = `translateX(${linkRect.left - navRect.left}px)`;
      pill.classList.add('is-visible');
    };

    if (nav && pill) {
      navLinksInMain.forEach((link) => {
        link.addEventListener('mouseenter', () => movePill(link));
      });
      nav.addEventListener('mouseleave', () => {
        const active = nav.querySelector('.nav__link.active');
        if (active) movePill(active); else pill.classList.remove('is-visible');
      });
      window.addEventListener('resize', () => {
        const active = nav.querySelector('.nav__link.active');
        if (active) movePill(active);
      });
    }

    const sections = document.querySelectorAll('main section[id]');
    const navLinks = document.querySelectorAll('[data-nav]');
    if (!sections.length) return;

    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          navLinks.forEach((link) => {
            const match = link.getAttribute('href') === `#${id}`;
            link.classList.toggle('active', match);
          });
          const activeInMain = nav ? nav.querySelector('.nav__link.active') : null;
          if (activeInMain) movePill(activeInMain);
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

    sections.forEach((s) => spy.observe(s));
    window.addEventListener('load', () => {
      const active = nav ? nav.querySelector('.nav__link.active') : null;
      if (active) movePill(active);
    });
  }

  /* ============ MOBILE MENU ============ */
  function initMobileMenu() {
    const btn = document.getElementById('hamburger');
    const menu = document.getElementById('mobileMenu');
    const overlay = document.getElementById('mobileOverlay');
    if (!btn || !menu || !overlay) return;

    const close = () => {
      btn.setAttribute('aria-expanded', 'false');
      menu.classList.remove('is-open');
      overlay.classList.remove('is-open');
      document.body.classList.remove('no-scroll');
    };
    const open = () => {
      btn.setAttribute('aria-expanded', 'true');
      menu.classList.add('is-open');
      overlay.classList.add('is-open');
      document.body.classList.add('no-scroll');
    };

    btn.addEventListener('click', () => {
      const isOpen = menu.classList.contains('is-open');
      isOpen ? close() : open();
    });
    overlay.addEventListener('click', close);
    menu.querySelectorAll('[data-nav]').forEach((a) => a.addEventListener('click', close));
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  /* ============ WORD-BY-WORD TITLE REVEAL ============ */
  function wrapWords(el) {
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === 3) {
          const parts = child.textContent.split(/(\s+)/);
          const frag = document.createDocumentFragment();
          parts.forEach((part) => {
            if (part.trim() === '') {
              frag.appendChild(document.createTextNode(part));
            } else {
              const span = document.createElement('span');
              span.className = 'word';
              span.textContent = part;
              frag.appendChild(span);
            }
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1 && child.tagName !== 'BR') {
          walk(child);
        }
      });
    };
    walk(el);
    el.querySelectorAll('.word').forEach((w, i) => {
      w.style.transitionDelay = `${i * 0.05}s`;
    });
  }

  function initWordReveal() {
    if (reduceMotion) return;
    document.querySelectorAll('.section-title, .hero__title').forEach(wrapWords);
  }

  /* ============ SECTION DIVIDERS (draw-on-scroll) ============ */
  function initDividers() {
    const targets = document.querySelectorAll('.seam');
    if (reduceMotion) {
      targets.forEach((t) => t.classList.add('in-view'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    targets.forEach((t) => io.observe(t));
  }

  /* ============ CARD TILT ============ */
  function initTilt() {
    if (reduceMotion || window.matchMedia('(pointer: coarse)').matches) return;
    document.querySelectorAll('.news-card').forEach((card) => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `translateY(-6px) rotateX(${(-y * 8).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg)`;
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = '';
      });
    });
  }

  /* ============ SCROLL REVEAL ============ */
  function initReveal() {
    const targets = document.querySelectorAll('[data-animate]');
    if (!targets.length) return;

    if (reduceMotion) {
      targets.forEach((t) => t.classList.add('in-view'));
      return;
    }

    const groups = new Map();
    targets.forEach((el) => {
      const parent = el.closest('.hero__stats, .propuestas__grid, .testi-list') || null;
      if (parent) {
        if (!groups.has(parent)) groups.set(parent, []);
      }
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    targets.forEach((el) => io.observe(el));
  }

  /* ============ COUNTERS ============ */
  function initCounters() {
    const nums = document.querySelectorAll('.stat__num[data-count]');
    if (!nums.length) return;

    const animate = (el) => {
      const target = parseInt(el.getAttribute('data-count'), 10) || 0;
      const suffix = el.getAttribute('data-suffix') || '';
      const duration = 1400;
      const start = performance.now();

      const step = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(target * eased) + suffix;
        if (progress < 1) requestAnimationFrame(step);
      };
      if (reduceMotion) {
        el.textContent = target + suffix;
      } else {
        requestAnimationFrame(step);
      }
    };

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animate(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    nums.forEach((n) => io.observe(n));
  }

  /* ============ VIDEO MODAL (mock player) ============ */
  /* ============ TESTIMONIO EN AUDIO (voz sintetizada del navegador) ============ */
  function initAudioTestimonial() {
    const openBtn = document.getElementById('playVideoBtn');
    const overlay = document.getElementById('videoOverlay');
    const closeBtn = document.getElementById('videoClose');
    const playBtn = document.getElementById('audioPlayBtn');
    const wave = document.getElementById('audioWave');
    const note = document.getElementById('audioNote');
    if (!openBtn || !overlay) return;

    const TEXT = 'Yo vivo en la vereda La Mesa, cerca de Valledupar. Durante años pedimos que arreglaran el acueducto y nadie volvía después de las elecciones. Daniel fue diferente: volvió, se sentó con nosotros, y ahora estamos viendo los primeros arreglos. Por eso confío en él para la Asamblea del Cesar.';
    const supported = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

    const setPlaying = (isPlaying) => {
      if (playBtn) {
        playBtn.classList.toggle('is-playing', isPlaying);
        playBtn.setAttribute('aria-label', isPlaying ? 'Pausar testimonio' : 'Reproducir testimonio');
      }
      if (wave) wave.classList.toggle('is-active', isPlaying);
    };

    const pickSpanishVoice = () => {
      const voices = supported ? window.speechSynthesis.getVoices() : [];
      return voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('es')) || null;
    };

    const speak = () => {
      if (!supported) {
        if (note) note.hidden = false;
        return;
      }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(TEXT);
      utter.lang = 'es-CO';
      utter.rate = 0.98;
      utter.pitch = 1.05;
      const voice = pickSpanishVoice();
      if (voice) utter.voice = voice;
      utter.onstart = () => setPlaying(true);
      utter.onend = () => setPlaying(false);
      utter.onerror = () => setPlaying(false);
      window.speechSynthesis.speak(utter);
    };

    const stopSpeak = () => {
      if (supported) window.speechSynthesis.cancel();
      setPlaying(false);
    };

    const open = () => {
      overlay.classList.add('is-open');
      document.body.classList.add('no-scroll');
      setTimeout(speak, 350);
    };
    const close = () => {
      overlay.classList.remove('is-open');
      document.body.classList.remove('no-scroll');
      stopSpeak();
    };

    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (!supported) { note.hidden = false; return; }
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
          window.speechSynthesis.pause();
          setPlaying(false);
        } else if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
          setPlaying(true);
        } else {
          speak();
        }
      });
    }
  }

  /* ============ MAP INTERACTION ============ */
  function initMap() {
    const wrap = document.querySelector('.territorio__map');
    const btn = document.getElementById('explorarMapaBtn');
    const pins = document.querySelectorAll('.map-pin');
    const chips = document.querySelectorAll('.map-chip');
    const panelTitle = document.getElementById('mapPanelTitle');
    const panelDesc = document.getElementById('mapPanelDesc');
    const panel = document.getElementById('mapPanel');
    if (!wrap) return;

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => entry.target.classList.toggle('in-view', entry.isIntersecting));
    }, { threshold: 0.3 });
    io.observe(wrap);

    const selectMun = (mun) => {
      pins.forEach((p) => p.classList.toggle('is-active', p.getAttribute('data-mun') === mun));
      chips.forEach((c) => c.classList.toggle('is-active', c.getAttribute('data-mun') === mun));
      const chip = wrap.querySelector(`.map-chip[data-mun="${mun}"]`);
      if (chip && panel && panelTitle && panelDesc) {
        panel.classList.add('is-updating');
        setTimeout(() => {
          panelTitle.textContent = chip.getAttribute('data-title') || chip.textContent;
          panelDesc.textContent = chip.getAttribute('data-desc') || '';
          panel.classList.remove('is-updating');
        }, 120);
      }
    };

    pins.forEach((pin) => {
      pin.addEventListener('click', () => selectMun(pin.getAttribute('data-mun')));
      pin.addEventListener('mouseenter', () => selectMun(pin.getAttribute('data-mun')));
    });
    chips.forEach((chip) => {
      chip.addEventListener('click', () => selectMun(chip.getAttribute('data-mun')));
    });

    if (btn) {
      btn.addEventListener('click', () => {
        wrap.classList.add('in-view');
        wrap.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        let i = 0;
        const seq = [...pins];
        clearInterval(btn._seqTimer);
        btn._seqTimer = setInterval(() => {
          selectMun(seq[i].getAttribute('data-mun'));
          i = (i + 1) % seq.length;
        }, 900);
        setTimeout(() => clearInterval(btn._seqTimer), 900 * seq.length);
      });
    }
  }

  /* ============ CONTACT FORM ============ */
  function initContactForm() {
    const form = document.getElementById('contactForm');
    const success = document.getElementById('formSuccess');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      success.classList.add('is-visible');
      form.reset();
      setTimeout(() => success.classList.remove('is-visible'), 5000);
    });
  }

  /* ============ BACK TO TOP ============ */
  function initBackToTop() {
    const btn = document.getElementById('backToTop');
    if (!btn) return;
    window.addEventListener('scroll', () => {
      btn.classList.toggle('is-visible', window.scrollY > 700);
    }, { passive: true });
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  /* ============ HERO PARALLAX (desktop only) ============ */
  function initParallax() {
    if (reduceMotion || window.matchMedia('(max-width: 860px)').matches) return;
    const photo = document.querySelector('.hero__photo-wrap');
    const hero = document.querySelector('.hero');
    if (!photo || !hero) return;

    hero.addEventListener('mousemove', (e) => {
      const rect = hero.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      photo.style.transform = `translate(${x * 14}px, ${y * 14}px)`;
    });
    hero.addEventListener('mouseleave', () => {
      photo.style.transform = 'translate(0,0)';
    });
  }

  /* ============ INIT ============ */
  document.addEventListener('DOMContentLoaded', () => {
    initLoader();
    if (!sessionStorage.getItem('pactoLoaderShown')) initCinematicLoader();
    initHeader();
    initMobileMenu();
    initWordReveal();
    initDividers();
    initReveal();
    initCounters();
    initAudioTestimonial();
    initMap();
    initTilt();
    initContactForm();
    initBackToTop();
    initParallax();
  });
})();
