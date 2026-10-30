/*
 * Vykreslování na canvas. Engine o kreslení nic neví – renderer jen čte stav místnosti.
 * Kreslení místnosti, lavic, žáků a hlídače je převzaté z dist/index.html.
 */
(function (root) {
  'use strict';
  const { ROOM, DESKS, RULES, clamp } = root.HK;

  class Renderer {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.sidebar = opts.sidebar != null ? opts.sidebar : 0; // šířka postranního panelu vpravo
      this.ctx = canvas.getContext('2d');
      this.resize();
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth, h = window.innerHeight;
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      this.dpr = dpr;
      const aw = w - this.sidebar, top = 48, bottom = 110;   // nahoře měřák hluku, dole příběh
      const s = Math.max(0.3, Math.min(aw / ROOM.w, (h - top - bottom) / ROOM.h) * 0.97);
      this.scale = s * dpr;
      this.ox = (aw * dpr - ROOM.w * this.scale) / 2;
      this.oy = (top + Math.max(0, (h - top - bottom - ROOM.h * s) / 2)) * dpr;
    }

    // Souřadnice kliknutí (v CSS pixelech) -> souřadnice v místnosti.
    toWorld(clientX, clientY) {
      return { x: (clientX * this.dpr - this.ox) / this.scale, y: (clientY * this.dpr - this.oy) / this.scale };
    }

    // view: { ghosts: [{ x, y, color, over }], showSensors, label }
    draw(world, view = {}) {
      const ctx = this.ctx;
      if (this.canvas.width !== Math.round(window.innerWidth * this.dpr)) this.resize();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this._meter(world, view);
      ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
      this._room(ctx, world);
      this._messes(ctx, world);
      this._students(ctx, world);
      if (view.showSensors !== false) this._sensors(ctx, world);
      for (const g of view.ghosts || []) {
        ctx.globalAlpha = g.over ? 0.12 : 0.45;
        ctx.fillStyle = g.color;
        ctx.beginPath(); ctx.arc(g.x, g.y, 11, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      this._player(ctx, world);
      this._message(ctx, world);
    }

    // Měřák hluku nad místností (ve hře je to HUD v HTML).
    _meter(world, view) {
      const ctx = this.ctx, d = this.dpr;
      const x = this.ox, w = ROOM.w * this.scale, y = 12 * d, h = 18 * d;
      ctx.fillStyle = 'rgba(246,237,220,.15)';
      ctx.fillRect(x, y, w, h);
      const n = world.noise / 100;
      ctx.fillStyle = n > 0.82 ? '#d84c3d' : n > 0.55 ? '#e1a535' : '#2f9f73';
      ctx.fillRect(x, y, w * n, h);
      ctx.fillStyle = '#f6eddc';
      ctx.font = `700 ${12 * d}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(`Hluk ${Math.round(world.noise)} %`, x + 8 * d, y + h / 2);
      ctx.textAlign = 'right';
      const t = Math.max(0, Math.ceil(world.timeLeft));
      ctx.fillText(`${view.label ? view.label + ' · ' : ''}čas ${t} s · zásahy ${world.score} · autorita ${Math.round(world.authority)}`, x + w - 8 * d, y + h / 2);
      ctx.textBaseline = 'alphabetic';
    }

    _room(ctx, world) {
      ctx.fillStyle = '#bfcbad';
      roundRect(ctx, 0, 0, ROOM.w, ROOM.h, 20); ctx.fill();
      ctx.fillStyle = '#d4a86c';
      roundRect(ctx, 28, 84, ROOM.w - 56, ROOM.h - 112, 8); ctx.fill();
      ctx.strokeStyle = 'rgba(142, 88, 52, 0.28)'; ctx.lineWidth = 2;
      for (let y = 112; y < ROOM.h - 46; y += 42) { ctx.beginPath(); ctx.moveTo(34, y); ctx.lineTo(ROOM.w - 34, y + 12); ctx.stroke(); }
      ctx.fillStyle = '#1f5f5b';
      roundRect(ctx, 228, 24, 504, 78, 6); ctx.fill();
      ctx.fillStyle = 'rgba(246, 237, 220, 0.92)';
      ctx.font = '700 24px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('Ticho je taky týmová práce', 480, 73);
      // Bez kolizí jsou lavice poloprůhledné – hlídač jimi prochází.
      ctx.globalAlpha = world.opts.deskCollisions ? 1 : 0.55;
      for (const d of DESKS) drawDesk(ctx, d.x, d.y);
      ctx.globalAlpha = 1;
    }

    _messes(ctx, world) {
      for (const m of world.messes) {
        ctx.save();
        ctx.translate(m.x, m.y); ctx.rotate(m.spin);
        ctx.fillStyle = 'rgba(23, 33, 38, 0.2)';
        ctx.beginPath(); ctx.ellipse(0, 15, 18, 6, 0, 0, Math.PI * 2); ctx.fill();
        if (m.kind === 'papir') {
          ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = '#327fc2'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(-13, -9); ctx.lineTo(12, -13); ctx.lineTo(15, 8); ctx.lineTo(-8, 13); ctx.closePath();
          ctx.fill(); ctx.stroke();
        } else {
          ctx.fillStyle = '#8e5834'; roundRect(ctx, -16, -9, 32, 18, 4); ctx.fill();
          ctx.strokeStyle = '#172126'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(-12, 9); ctx.lineTo(-20, 21); ctx.moveTo(12, 9); ctx.lineTo(20, 21); ctx.stroke();
        }
        ctx.restore();
      }
    }

    _students(ctx, world) {
      const now = performance.now(), p = world.player;
      for (const s of world.students) {
        const pulse = s.noisy ? 1 + Math.sin(now / 120 + s.x) * 0.08 : 1;
        if (s.noisy) {
          ctx.strokeStyle = s.type.color; ctx.lineWidth = 3; ctx.globalAlpha = 0.38;
          ctx.beginPath(); ctx.arc(s.x, s.y, 34 + s.noiseAge * 3.2, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = 'rgba(23, 33, 38, 0.22)';
        ctx.beginPath(); ctx.ellipse(s.x, s.y + 18, 18, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = s.noisy ? s.type.color : '#f6eddc';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#172126'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#172126';
        ctx.beginPath(); ctx.arc(s.x - 5, s.y - 2, 2.2, 0, Math.PI * 2); ctx.arc(s.x + 5, s.y - 2, 2.2, 0, Math.PI * 2); ctx.fill();
        if (s.noisy) {
          const y = s.y - 38 - Math.sin(now / 160) * 3;
          ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = s.type.color; ctx.lineWidth = 3;
          roundRect(ctx, s.x - 24, y - 17, 48, 26, 8); ctx.fill(); ctx.stroke();
          ctx.fillStyle = s.type.color; ctx.font = '800 14px system-ui'; ctx.textAlign = 'center';
          const label = { 'Bouchač': 'BUM', 'Pobíhač': '!', 'Papírkář': 'FRT' }[s.type.name] || 'PSST';
          ctx.fillText(label, s.x, y + 1);
        }
        if (s.beingCalmed && p.actionTotal > 0) {
          const progress = clamp(1 - p.action / p.actionTotal, 0, 1);
          ctx.strokeStyle = 'rgba(23, 33, 38, 0.2)'; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(s.x, s.y, 25, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = '#2f9f73'; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.arc(s.x, s.y, 25, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress); ctx.stroke();
          ctx.lineCap = 'butt';
        }
      }
    }

    // Co vidí síť: čáry ke všem narušitelům (silnější = blíž) a paprsky k nejbližší překážce.
    _sensors(ctx, world) {
      const p = world.player, se = world.sensors;
      if (!se) return;
      ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
      for (const list of [se.noisy, se.messes]) {
        for (const r of list) {
          ctx.strokeStyle = r === list[0] ? 'rgba(30, 91, 255, .85)' : 'rgba(30, 91, 255, .3)';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(r.o.x, r.o.y); ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      // paprsky: konec = kam až hlídač dojde; červená tečka = překážka blízko
      const { rays, rayRange } = root.HK.SENSORS;
      ctx.lineWidth = 1.5;
      se.rays.forEach((d, i) => {
        const ex = p.x + Math.cos(rays[i]) * d, ey = p.y + Math.sin(rays[i]) * d;
        ctx.strokeStyle = 'rgba(23, 33, 38, .3)';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ex, ey); ctx.stroke();
        if (d < rayRange) {
          ctx.fillStyle = d < 40 ? '#d84c3d' : 'rgba(23, 33, 38, .55)';
          ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, Math.PI * 2); ctx.fill();
        }
      });
      // dosah zásahu
      ctx.strokeStyle = se.inReach ? '#2f9f73' : 'rgba(216, 76, 61, .5)';
      ctx.setLineDash([8, 7]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, RULES.reach, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    _player(ctx, world) {
      const p = world.player;
      const pulse = p.action > 0 ? 1 + Math.sin(performance.now() / 70) * 0.12 : 1;
      ctx.fillStyle = 'rgba(23, 33, 38, 0.25)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 21, 23, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#25343a';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fffaf0'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#f4b86a';
      ctx.beginPath(); ctx.arc(p.x, p.y - 7, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = p.action > 0 ? '#d84c3d' : '#f6eddc'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(p.facing) * 10, p.y + Math.sin(p.facing) * 10);
      ctx.lineTo(p.x + Math.cos(p.facing) * 26, p.y + Math.sin(p.facing) * 26);
      ctx.stroke(); ctx.lineCap = 'butt';
      if (p.action > 0) {
        const progress = p.actionTotal > 0 ? clamp(1 - p.action / p.actionTotal, 0, 1) : 0;
        ctx.strokeStyle = '#d84c3d'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(p.x, p.y, 42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress); ctx.stroke();
      }
    }

    _message(ctx, world) {
      if (!world.over) return;
      ctx.fillStyle = 'rgba(246, 237, 220, 0.94)';
      ctx.strokeStyle = 'rgba(23, 33, 38, 0.22)'; ctx.lineWidth = 2;
      roundRect(ctx, 300, 116, 360, 40, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = world.result === 'won' ? '#2f9f73' : '#d84c3d';
      ctx.font = '800 18px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(world.result === 'won' ? 'Služba zvládnutá' : `Příliš velký rámus (${world.elapsed.toFixed(0)} s)`, 480, 142);
    }
  }

  function drawDesk(ctx, x, y) {
    ctx.fillStyle = '#71401f'; roundRect(ctx, x - 58, y + 32, 116, 14, 5); ctx.fill();
    ctx.fillStyle = '#bc8450'; roundRect(ctx, x - 64, y - 30, 128, 62, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)'; roundRect(ctx, x - 52, y - 20, 104, 14, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(23, 33, 38, 0.18)'; ctx.lineWidth = 3; roundRect(ctx, x - 64, y - 30, 128, 62, 7); ctx.stroke();
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  root.Renderer = Renderer;
})(window);
