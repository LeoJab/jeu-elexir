/* Élixir — sons (synthétisés) et effets visuels (particules, éclairs, cinématiques). */
(function (root) {
  'use strict';

  /* ---------- Sons ---------- */
  const Sfx = (() => {
    let ac = null, muted = false;
    try { muted = localStorage.getItem('elixir-mute') === '1'; } catch (e) { /* ignoré */ }
    function ctx() {
      if (muted) return null;
      try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) { return null; }
      return ac;
    }
    function tone(f, t0, d, type, vol, slide) {
      const a = ctx(); if (!a) return;
      const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + t0;
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t + d);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + d + 0.05);
    }
    function noise(t0, d, vol) {
      const a = ctx(); if (!a) return;
      const n = a.sampleRate * d, b = a.createBuffer(1, n, a.sampleRate), x = b.getChannelData(0);
      for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = a.createBufferSource(), g = a.createGain(); s.buffer = b; g.gain.value = vol || 0.15;
      s.connect(g); g.connect(a.destination); s.start(a.currentTime + t0);
    }
    const lib = {
      click: () => tone(520, 0, 0.06, 'triangle', 0.07),
      draw: () => { tone(300, 0, 0.07, 'triangle', 0.08, 500); },
      turn: () => { tone(660, 0, 0.1, 'sine', 0.1); tone(990, 0.1, 0.18, 'sine', 0.1); },
      cast1: () => { tone(500, 0, 0.18, 'triangle', 0.12, 900); },
      cast2: () => { tone(400, 0, 0.2, 'triangle', 0.13, 1000); tone(800, 0.12, 0.2, 'sine', 0.1); },
      cast3: () => { noise(0, 0.25, 0.1); tone(220, 0, 0.5, 'sawtooth', 0.1, 880); tone(660, 0.2, 0.3, 'sine', 0.12); },
      cast4: () => { noise(0, 0.6, 0.2); tone(110, 0, 0.9, 'sawtooth', 0.16, 440); tone(55, 0, 1, 'square', 0.1, 220); [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5 + i * 0.1, 0.4, 'triangle', 0.12)); },
      hit: () => { noise(0, 0.15, 0.2); tone(160, 0, 0.18, 'square', 0.12, 60); },
      alert: () => { tone(880, 0, 0.12, 'square', 0.09); tone(660, 0.14, 0.12, 'square', 0.09); tone(880, 0.28, 0.12, 'square', 0.09); },
      boom: () => { noise(0, 0.5, 0.22); tone(90, 0, 0.5, 'sawtooth', 0.15, 30); },
      shield: () => { tone(900, 0, 0.12, 'sine', 0.1); tone(1350, 0.08, 0.25, 'sine', 0.1); },
      win: () => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.12, 0.35, 'triangle', 0.14)); tone(1568, 0.7, 0.8, 'sine', 0.12); },
      fail: () => { tone(300, 0, 0.3, 'sawtooth', 0.1, 120); },
      emo: () => { tone(740, 0, 0.08, 'sine', 0.07, 1100); }
    };
    return {
      play(n) { try { if (lib[n]) lib[n](); } catch (e) { /* ignoré */ } },
      get muted() { return muted; },
      toggle() { muted = !muted; try { localStorage.setItem('elixir-mute', muted ? '1' : '0'); } catch (e) { /* ignoré */ } return muted; }
    };
  })();

  /* ---------- Particules ---------- */
  const cv = document.getElementById('fx'), g = cv.getContext('2d');
  let W = 0, H = 0, parts = [], bolts = [], raf = 0, last = 0;
  function resize() { const d = Math.min(2, window.devicePixelRatio || 1); W = cv.width = innerWidth * d; H = cv.height = innerHeight * d; cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px'; g.setTransform(d, 0, 0, d, 0, 0); W = innerWidth; H = innerHeight; }
  addEventListener('resize', resize); resize();
  const COLORS = ['#ffd426', '#ff4d6d', '#4dd2ff', '#7cff6b', '#c084fc', '#ffffff', '#ff9f1c'];
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016); last = t;
    g.clearRect(0, 0, W, H);
    parts = parts.filter(p => (p.life -= dt) > 0);
    for (const p of parts) {
      p.vy += (p.grav || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += (p.vr || 0) * dt;
      const a = Math.max(0, Math.min(1, p.life / (p.max * 0.5)));
      g.save(); g.globalAlpha = a; g.translate(p.x, p.y); g.rotate(p.r);
      if (p.emoji) { g.font = p.size + 'px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.emoji, 0, 0); }
      else if (p.rect) { g.fillStyle = p.color; g.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6); }
      else { g.fillStyle = p.color; g.shadowColor = p.color; g.shadowBlur = 8; g.beginPath(); g.arc(0, 0, p.size / 2, 0, 6.3); g.fill(); }
      g.restore();
    }
    bolts = bolts.filter(b => (b.life -= dt) > 0);
    for (const b of bolts) {
      g.save(); g.globalAlpha = Math.min(1, b.life / 0.15); g.strokeStyle = b.color; g.shadowColor = b.color; g.shadowBlur = 18; g.lineWidth = b.w; g.lineJoin = 'round';
      g.beginPath(); b.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); g.restore();
    }
    if (parts.length || bolts.length) raf = requestAnimationFrame(loop); else raf = 0;
  }
  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } };
  const R = (a, b) => a + Math.random() * (b - a);

  function burst(x, y, o) {
    o = o || {}; const n = o.n || 30;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = R(o.min || 80, o.speed || 300);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (o.up || 0), grav: o.grav == null ? 380 : o.grav, life: R(0.6, o.life || 1.3), max: o.life || 1.3, size: o.emoji ? R(16, 28) : R(5, 11), color: o.colors ? o.colors[i % o.colors.length] : COLORS[i % COLORS.length], emoji: o.emoji ? o.emoji[i % o.emoji.length] : null, vr: R(-6, 6), r: 0 });
    }
    kick();
  }
  function confetti(n) {
    for (let i = 0; i < (n || 160); i++) parts.push({ x: R(0, W), y: R(-H * 0.3, -10), vx: R(-60, 60), vy: R(120, 380), grav: 60, life: R(2.5, 4.5), max: 4, size: R(8, 15), rect: 1, color: COLORS[i % COLORS.length], vr: R(-8, 8), r: R(0, 6) });
    kick();
  }
  function fireworks(times) {
    for (let k = 0; k < (times || 6); k++) setTimeout(() => burst(R(W * 0.15, W * 0.85), R(H * 0.15, H * 0.5), { n: 46, speed: 340, min: 120, grav: 160, life: 1.6, colors: [COLORS[k % COLORS.length], '#fff', COLORS[(k + 3) % COLORS.length]] }), k * 380);
  }
  function bolt(color, count) {
    for (let k = 0; k < (count || 3); k++) {
      setTimeout(() => {
        let x = R(W * 0.1, W * 0.9), y = 0; const pts = [[x, y]];
        while (y < H * R(0.55, 0.95)) { y += R(30, 70); x += R(-50, 50); pts.push([x, y]); }
        bolts.push({ pts, life: 0.35, color: color || '#fff', w: R(2, 5) }); kick();
      }, k * 110);
    }
  }
  function flash(color, ms) {
    const d = document.createElement('div'); d.className = 'flash'; d.style.background = color || '#fff'; d.style.animationDuration = (ms || 450) + 'ms';
    document.body.appendChild(d); setTimeout(() => d.remove(), (ms || 450) + 50);
  }
  function shake(strong) {
    const el = document.getElementById('app'); el.classList.remove('shake', 'shake2'); void el.offsetWidth;
    el.classList.add(strong ? 'shake2' : 'shake'); setTimeout(() => el.classList.remove('shake', 'shake2'), strong ? 900 : 500);
  }
  function floatText(txt, x, y, color) {
    const d = document.createElement('div'); d.className = 'floaty'; d.textContent = txt; d.style.left = x + 'px'; d.style.top = y + 'px'; if (color) d.style.color = color;
    document.body.appendChild(d); setTimeout(() => d.remove(), 1600);
  }
  function centerOf(el) { if (!el) return { x: W / 2, y: H / 2 }; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  /* ---------- Cinématique de sortilège ---------- */
  const LV = { 1: { c: '#4ade80', n: 'Niveau 1' }, 2: { c: '#38bdf8', n: 'Niveau 2' }, 3: { c: '#c084fc', n: 'Niveau 3' }, 4: { c: '#fbbf24', n: 'Niveau 4' } };
  function cinematic(o) { // { sp, by, on, esc }
    const sp = o.sp, lv = LV[sp.level], el = document.createElement('div');
    el.className = 'cine lv' + sp.level; el.style.setProperty('--lc', lv.c);
    el.innerHTML = '<div class="cine-rays"></div><div class="cine-card"><div class="cine-lvl">' + '★'.repeat(sp.level) + '</div><div class="cine-emoji">' + sp.emoji + '</div><div class="cine-name">' + o.esc(sp.name) + '</div><div class="cine-who">' + o.esc(o.by) + (o.on ? ' <b>➜</b> ' + o.esc(o.on) : '') + '</div><div class="cine-txt">' + o.esc(sp.effect) + '</div><div class="cf-hint" style="margin-top:8px">✕ Touche pour fermer</div></div>';
    document.body.appendChild(el);
    const life = 30000; // reste affiché jusqu'au clic
    const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
    el.addEventListener('click', kill); setTimeout(kill, life);
    Sfx.play('cast' + sp.level);
    const x = W / 2, y = H / 2;
    if (sp.level === 1) burst(x, y, { n: 26, emoji: [sp.emoji, '✨'] });
    if (sp.level === 2) { burst(x, y, { n: 40, colors: [lv.c, '#fff'] }); flash(lv.c, 350); }
    if (sp.level === 3) { burst(x, y, { n: 60, emoji: [sp.emoji, '✨', '⚡'], speed: 400 }); bolt(lv.c, 2); flash(lv.c, 500); shake(false); }
    if (sp.level === 4) { burst(x, y, { n: 90, emoji: [sp.emoji, '🔥', '⚡', '✨'], speed: 500 }); bolt('#fff', 6); flash('#fff', 700); shake(true); setTimeout(() => burst(x, y, { n: 60, colors: [lv.c, '#ff4d6d'], speed: 450 }), 500); }
  }

  /* Montre une carte au centre de l'écran jusqu'à ce qu'on la touche, puis l'envoie vers la défausse. */
  let cardN = 0;
  function showCard(html, o) {
    o = o || {}; const el = document.createElement('div'); el.className = 'cardfly ' + (o.cls || ''); const k = cardN++ % 4;
    el.style.marginLeft = (k * 18) + 'px'; el.style.marginTop = (k * 14) + 'px'; el.style.zIndex = 84 + k;
    el.innerHTML = html + (o.by ? '<div class="cf-by">' + o.by + '</div>' : '') + '<div class="cf-hint">✕ Touche pour fermer</div>';
    document.body.appendChild(el); let gone = false;
    const bye = () => {
      if (gone) return; gone = true;
      const d = document.querySelector('[data-act="disc"]'), r = el.getBoundingClientRect();
      if (d) { const t = d.getBoundingClientRect(); el.style.transform = 'translate(-50%,-50%) translate(' + (t.left + t.width / 2 - (r.left + r.width / 2)) + 'px,' + (t.top + t.height / 2 - (r.top + r.height / 2)) + 'px) scale(.15) rotate(25deg)'; }
      el.style.opacity = '0'; setTimeout(() => el.remove(), 700);
    };
    el.addEventListener('click', bye); setTimeout(bye, 30000);
  }

  root.FX = { showCard, burst, confetti, fireworks, bolt, flash, shake, floatText, centerOf, cinematic, W: () => W, H: () => H };
  root.Sfx = Sfx;
})(window);
