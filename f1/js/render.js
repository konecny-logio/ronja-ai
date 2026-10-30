/*
 * Vykreslování na canvas. Engine o kreslení nic neví – renderer jen čte stav závodu.
 */
(function (root) {
  'use strict';
  const { PHYS } = root.F1;

  class Renderer {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.sidebar = opts.sidebar != null ? opts.sidebar : 300; // šířka postranního panelu vpravo
      this.ctx = canvas.getContext('2d');
      this.trackLayer = document.createElement('canvas');
      this.skidLayer = document.createElement('canvas');
      this.track = null;
    }

    setTrack(track) {
      this.track = track;
      this.infield = this._findInfield(track);
      this.resize();
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth, h = window.innerHeight;
      for (const c of [this.canvas, this.trackLayer, this.skidLayer]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      this.dpr = dpr;
      if (!this.track) return;
      const b = this.track.bounds;
      const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
      const aw = w - this.sidebar;
      const s = Math.min(aw / bw, h / bh) * 0.97;
      this.scale = s * dpr;
      this.ox = (aw * dpr - bw * this.scale) / 2 - b.minX * this.scale;
      this.oy = (h * dpr - bh * this.scale) / 2 - b.minY * this.scale;
      this._drawTrack();
    }

    clearSkids() {
      this.skidLayer.getContext('2d').clearRect(0, 0, this.skidLayer.width, this.skidLayer.height);
    }

    _world(ctx) { ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy); }

    _path(ctx, pts) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    }

    _drawTrack() {
      const t = this.track, ctx = this.trackLayer.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#2b5e2b';
      ctx.fillRect(0, 0, this.trackLayer.width, this.trackLayer.height);
      // trocha "trávy"
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 2500; i++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.04)';
        ctx.fillRect(rnd() * this.trackLayer.width, rnd() * this.trackLayer.height, 6 * this.dpr, 6 * this.dpr);
      }

      this._world(ctx);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const pts = t.pts, bd = t.barrierDist, hw = t.halfWidth;

      // Bariéra (červeno-bílé pneumatiky)
      this._path(ctx, pts);
      ctx.lineWidth = 2 * bd + 10; ctx.strokeStyle = '#eee'; ctx.setLineDash([]); ctx.stroke();
      ctx.strokeStyle = '#d42020'; ctx.setLineDash([12, 12]); ctx.stroke();
      ctx.setLineDash([]);
      // Únikový prostor – tráva (tady auto zpomalí)
      ctx.lineWidth = 2 * bd; ctx.strokeStyle = '#4f9a3a'; ctx.stroke();
      // Obrubníky
      ctx.lineWidth = 2 * hw + 8; ctx.strokeStyle = '#f4f4f4'; ctx.stroke();
      ctx.strokeStyle = '#e02a2a'; ctx.setLineDash([14, 14]); ctx.stroke();
      ctx.setLineDash([]);
      // Asfalt
      ctx.lineWidth = 2 * hw; ctx.strokeStyle = '#5a5d62'; ctx.stroke();
      // přerušovaná středová čára (jen jemně)
      ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.setLineDash([16, 22]); ctx.stroke();
      ctx.setLineDash([]);

      // Start / cíl – šachovnice napříč tratí
      const p = pts[0], a = t.dir[0];
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(a);
      const sq = (2 * hw) / 10;
      for (let r = 0; r < 2; r++) for (let k = 0; k < 10; k++) {
        ctx.fillStyle = (r + k) % 2 ? '#111' : '#fff';
        ctx.fillRect(r * sq - sq, -hw + k * sq, sq, sq);
      }
      ctx.restore();

      // Startovní rošt
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5;
      for (let k = 0; k < 10; k++) {
        const g = t.gridSlot(k);
        ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.heading);
        ctx.beginPath(); ctx.moveTo(18, -8); ctx.lineTo(14, -8); ctx.lineTo(14, 8); ctx.lineTo(18, 8); ctx.stroke();
        ctx.restore();
      }
    }

    // Stopy pneumatik při smyku – ukazují, kde působila odstředivá síla.
    _skids(race) {
      const ctx = this.skidLayer.getContext('2d');
      this._world(ctx);
      for (const car of race.cars) {
        const slip = Math.abs(car.slip);
        if (car.crashed || slip < 25 || !car.onRoad) continue;
        ctx.fillStyle = `rgba(20,20,20,${Math.min(0.35, slip / 400)})`;
        const c = Math.cos(car.heading), s = Math.sin(car.heading);
        for (const side of [-5, 5]) {
          ctx.fillRect(car.x - c * 8 - s * side - 1.2, car.y - s * 8 + c * side - 1.2, 2.4, 2.4);
        }
      }
    }

    draw(race, view) {
      const ctx = this.ctx;
      if (this.canvas.width !== Math.round(window.innerWidth * this.dpr)) this.resize();
      if (!this.trackLayer.width || !this.trackLayer.height) return; // okno má zatím nulovou velikost
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.trackLayer, 0, 0);
      if (!view.noSkids) {
        this._skids(race);
        ctx.drawImage(this.skidLayer, 0, 0);
      }
      this._world(ctx);

      for (const car of race.cars) {
        if (view.showAllRays || car === view.selected) this._rays(ctx, car);
      }
      for (const car of race.cars) {
        if (car === view.selected) continue;
        ctx.globalAlpha = view.alpha ? view.alpha(car) : 1;
        this._car(ctx, car, false, view.time);
      }
      ctx.globalAlpha = 1;
      if (view.selected) this._car(ctx, view.selected, true, view.time); // vybrané auto vždy navrchu
      if (view.gauge && view.gauge.length) this._gauge(ctx, view.gauge);
    }

    // Nejvolnější místo uvnitř okruhu: bod uvnitř smyčky, který je nejdál od trati.
    _findInfield(t) {
      const pts = t.pts, b = t.bounds, step = 12;
      const inside = (x, y) => {
        let c = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const a = pts[i], p = pts[j];
          if ((a.y > y) !== (p.y > y) && x < (p.x - a.x) * (y - a.y) / (p.y - a.y) + a.x) c = !c;
        }
        return c;
      };
      let best = null;
      for (let y = b.minY; y < b.maxY; y += step) for (let x = b.minX; x < b.maxX; x += step) {
        if (!inside(x, y)) continue;
        let d2 = Infinity;
        for (const p of pts) d2 = Math.min(d2, (p.x - x) ** 2 + (p.y - y) ** 2);
        if (!best || d2 > best.d2) best = { x, y, d2 };
      }
      if (!best) return null;
      return { x: best.x, y: best.y, r: Math.sqrt(best.d2) - t.barrierDist - 12 };
    }

    // Klasický ručičkový tachometr uprostřed okruhu. needles = [{ kmh, color, label }]
    _gauge(ctx, needles) {
      const f = this.infield;
      if (!f || f.r < 50) return;
      const R = Math.min(f.r, 180), MAX = 300;
      const A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;          // od 7:30 do 4:30 jako na hodinkách
      const ang = v => A0 + SWEEP * Math.max(0, Math.min(1, v / MAX));
      ctx.save();
      ctx.translate(f.x, f.y);

      // ciferník
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(R * 0.03, R * 0.05, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#14181d'; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#9aa0a6'; ctx.lineWidth = R * 0.04; ctx.stroke();

      // červená zóna (nad 260 km/h)
      ctx.strokeStyle = '#e02a2a'; ctx.lineWidth = R * 0.07;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.84, ang(260), ang(MAX)); ctx.stroke();

      // dílky a čísla
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(R * 0.13)}px Segoe UI, sans-serif`;
      for (let v = 0; v <= MAX; v += 10) {
        const a = ang(v), c = Math.cos(a), s = Math.sin(a), major = v % 50 === 0;
        const r1 = R * (major ? 0.74 : 0.8), r2 = R * 0.88;
        ctx.strokeStyle = v >= 260 ? '#ff6b6b' : '#e8e8e8';
        ctx.lineWidth = R * (major ? 0.025 : 0.012);
        ctx.beginPath(); ctx.moveTo(c * r1, s * r1); ctx.lineTo(c * r2, s * r2); ctx.stroke();
        if (major) { ctx.fillStyle = '#e8e8e8'; ctx.fillText(v, c * R * 0.6, s * R * 0.6); }
      }
      ctx.fillStyle = '#9aa0a6'; ctx.font = `${Math.round(R * 0.09)}px Segoe UI, sans-serif`;
      ctx.fillText('km/h', 0, -R * 0.3);

      // digitální údaj(e) dole
      ctx.font = `700 ${Math.round(R * (needles.length > 1 ? 0.14 : 0.2))}px Segoe UI, sans-serif`;
      needles.forEach((n, i) => {
        const x = needles.length > 1 ? (i - (needles.length - 1) / 2) * R * 0.5 : 0;
        ctx.fillStyle = n.color; ctx.fillText(Math.round(n.kmh), x, R * 0.5);
      });

      // ručičky
      for (const n of needles) {
        const a = ang(n.kmh);
        ctx.save(); ctx.rotate(a);
        ctx.fillStyle = n.color; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = R * 0.01;
        ctx.beginPath(); ctx.moveTo(-R * 0.15, -R * 0.03); ctx.lineTo(R * 0.82, 0); ctx.lineTo(-R * 0.15, R * 0.03); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = '#2a2f36'; ctx.beginPath(); ctx.arc(0, 0, R * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#9aa0a6'; ctx.lineWidth = R * 0.015; ctx.stroke();
      ctx.restore();
    }

    _rays(ctx, car) {
      const s = car.sensors;
      if (!s || car.crashed) return;
      if (s.carAhead) {
        // modrá čára = nejbližší auto vpředu, které auto vidí
        const o = s.carAhead.car;
        ctx.strokeStyle = '#4db8ff'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(car.x, car.y); ctx.lineTo(o.x, o.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(o.x, o.y, 13, 0, Math.PI * 2); ctx.stroke();
      }
      for (let i = 0; i < s.rays.length; i++) {
        const d = s.rays[i], a = car.heading + s.rayAngles[i];
        const ex = car.x + Math.cos(a) * d, ey = car.y + Math.sin(a) * d;
        const k = d / s.range; // 0 = blízko (červená), 1 = daleko (zelená)
        const col = `hsl(${Math.round(k * 120)}, 90%, 55%)`;
        ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.moveTo(car.x, car.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.globalAlpha = 1;
        if (d < s.range - 0.5) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ex, ey, 3.2, 0, Math.PI * 2); ctx.fill(); }
      }
    }

    _car(ctx, car, selected, time) {
      ctx.save();
      ctx.translate(car.x, car.y);
      if (selected) {
        ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.rotate(car.heading);
      const body = car.crashed ? '#555' : car.color;
      // stín
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(-11, -6, 24, 13);
      // kola
      ctx.fillStyle = '#111';
      const wheelTurn = car.steer * 0.4;
      for (const sy of [-1, 1]) {
        ctx.fillRect(-10, sy * 7.5 - 2.5, 6, 5);                          // zadní
        ctx.save(); ctx.translate(7, sy * 7); ctx.rotate(wheelTurn);
        ctx.fillRect(-2.5, -2, 5, 4); ctx.restore();                       // přední (natáčí se)
      }
      // zadní křídlo
      ctx.fillStyle = '#222'; ctx.fillRect(-12.5, -6.5, 3, 13);
      // tělo
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.lineTo(5, -2.2); ctx.lineTo(-2, -4.5); ctx.lineTo(-10, -3.5);
      ctx.lineTo(-10, 3.5); ctx.lineTo(-2, 4.5); ctx.lineTo(5, 2.2); ctx.closePath(); ctx.fill();
      // přední křídlo
      ctx.fillRect(10, -6.5, 2.5, 13);
      // kokpit a helma
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(-1, 0, 3.2, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = car.crashed ? '#888' : '#ffd84d'; ctx.beginPath(); ctx.arc(-1, 0, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      if (car.crashed) {
        // kouř z vraku
        for (let i = 0; i < 4; i++) {
          const ph = (time * 0.7 + i / 4) % 1;
          ctx.fillStyle = `rgba(120,120,120,${0.5 * (1 - ph)})`;
          ctx.beginPath(); ctx.arc(car.x + Math.sin(i * 2.1 + time) * 4, car.y - ph * 26, 4 + ph * 8, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (car.isHuman) {
        ctx.font = 'bold 11px Segoe UI, sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3;
        ctx.strokeText(car.name, car.x, car.y - 16); ctx.fillText(car.name, car.x, car.y - 16);
      }
    }
  }

  root.Renderer = Renderer;
})(window);
