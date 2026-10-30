/*
 * F1 engine – trať, fyzika auta, senzory a závod.
 *
 * Tento soubor NEOBSAHUJE žádné vykreslování ani práci s klávesnicí,
 * takže běží stejně v prohlížeči i v Node.js (headless). To je důležité
 * pro fázi 2: trénink neuronové sítě může simulovat tisíce jízd
 * mnohem rychleji, než kdyby se vše kreslilo.
 *
 * Řidič (člověk, pravidlový bot nebo neuronová síť) je libovolný objekt
 * s metodou:
 *     drive(sensors, car, race) -> { throttle: 0..1, brake: 0..1, steer: -1..1 }
 * steer < 0 = doleva, steer > 0 = doprava.
 */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrapAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  // ---------------------------------------------------------------------
  // Fyzikální konstanty (jednotky: pixely a sekundy). Délka auta 24 px ≈ 5 m.
  // ---------------------------------------------------------------------
  const PHYS = {
    accel: 300,          // zrychlení motoru [px/s²]
    maxSpeed: 400,       // maximální rychlost na asfaltu [px/s]
    brake: 650,          // brzdné zpomalení
    reverseAccel: 150,   // couvání
    reverseMax: 80,
    roll: 25,            // valivý odpor
    grip: 600,           // max. boční zrychlení na asfaltu (přilnavost)
    grassGrip: 260,      // přilnavost na trávě
    grassMaxSpeed: 120,  // na trávě auto rychle zpomalí na tuto rychlost
    grassDrag: 2.2,
    maxYaw: 3.2,         // max. rychlost otáčení [rad/s] při nízké rychlosti
    yawSpeedRef: 400,    // čím rychleji, tím méně ostře jde zatočit
    steerRate: 7,        // jak rychle se natáčí volant [1/s]
    scrub: 0.6,          // smyk ubírá rychlost
    carLength: 24,
    carWidth: 12,
    carRadius: 9,        // pro kolize mezi auty
    kmhPerPxs: 0.75,     // převod px/s -> km/h pro zobrazení
  };

  // Senzory: 5 paprsků pod těmito úhly vůči směru auta (záporné = vlevo).
  const SENSORS = {
    angles: [-60, -30, 0, 30, 60].map(a => a * DEG),
    range: 300,
    carFov: 60 * DEG,    // v jakém úhlu před sebou auto vidí jiná auta
  };

  // ---------------------------------------------------------------------
  // Definice tratí – řídicí body uzavřené křivky ve světě cca 1600×1000.
  // ---------------------------------------------------------------------
  const TRACK_DEFS = [
    {
      id: 'oval',
      name: 'Ovál (nejlehčí)',
      halfWidth: 44, runoff: 45,
      points: [[350, 200], [1250, 200], [1450, 330], [1450, 670], [1250, 800], [350, 800], [150, 670], [150, 330]],
    },
    {
      id: 'velky',
      name: 'Velký okruh',
      halfWidth: 40, runoff: 45,
      points: [[300, 170], [800, 140], [1300, 170], [1470, 330], [1440, 620], [1250, 830], [1010, 850],
               [900, 690], [740, 690], [620, 850], [330, 840], [140, 650], [150, 330]],
    },
    {
      id: 'technicky',
      name: 'Technický okruh',
      halfWidth: 38, runoff: 42,
      points: [[260, 150], [640, 140], [800, 270], [970, 290], [1110, 170], [1380, 150], [1480, 370],
               [1350, 570], [1410, 780], [1180, 880], [950, 770], [710, 860], [430, 880], [230, 770],
               [300, 550], [170, 340]],
    },
  ];

  function catmullRomClosed(pts, steps) {
    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      for (let k = 0; k < steps; k++) {
        const t = k / steps, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]) });
      }
    }
    return out;
  }

  // Přerozdělí uzavřenou lomenou čáru na body se stejnou vzdáleností.
  function resampleClosed(pts, spacing) {
    const n = pts.length;
    const cum = [0];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const L = cum[n];
    const count = Math.round(L / spacing);
    const out = [];
    let seg = 0;
    for (let k = 0; k < count; k++) {
      const s = (k / count) * L;
      while (cum[seg + 1] < s) seg++;
      const a = pts[seg], b = pts[(seg + 1) % n];
      const t = (s - cum[seg]) / (cum[seg + 1] - cum[seg]);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Trať
  // ---------------------------------------------------------------------
  class Track {
    constructor(def) {
      this.id = def.id;
      this.name = def.name;
      this.halfWidth = def.halfWidth;
      this.runoff = def.runoff;
      this.barrierDist = def.halfWidth + def.runoff; // od středu trati k bariéře

      let pts = resampleClosed(catmullRomClosed(def.points, 40), 8);
      // Start/cíl umístíme na první rovinku (mezi 1. a 2. řídicí bod), ať je rošt za ním ještě na rovince.
      const mx = def.points[0][0] * 0.3 + def.points[1][0] * 0.7, my = def.points[0][1] * 0.3 + def.points[1][1] * 0.7;
      let best = 0, bd = Infinity;
      pts.forEach((p, i) => { const d = (p.x - mx) ** 2 + (p.y - my) ** 2; if (d < bd) { bd = d; best = i; } });
      pts = pts.slice(best).concat(pts.slice(0, best));

      this.pts = pts;
      this.N = pts.length;
      let L = 0;
      for (let i = 0; i < this.N; i++) {
        const a = pts[i], b = pts[(i + 1) % this.N];
        L += Math.hypot(b.x - a.x, b.y - a.y);
      }
      this.length = L;
      this.ds = L / this.N;

      // Směr trati a normály v každém bodě; okraje vozovky.
      this.dir = new Float64Array(this.N);
      this.left = []; this.right = [];
      for (let i = 0; i < this.N; i++) {
        const a = pts[(i - 1 + this.N) % this.N], b = pts[(i + 1) % this.N];
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        this.dir[i] = ang;
        const rx = -Math.sin(ang), ry = Math.cos(ang); // pravá normála (osa y míří dolů)
        const p = pts[i], hw = this.halfWidth;
        this.right.push({ x: p.x + rx * hw, y: p.y + ry * hw });
        this.left.push({ x: p.x - rx * hw, y: p.y - ry * hw });
      }

      // Úsečky okrajů vozovky – do nich narážejí paprsky senzorů.
      const segs = [];
      for (const edge of [this.left, this.right]) {
        for (let i = 0; i < this.N; i++) {
          const a = edge[i], b = edge[(i + 1) % this.N];
          segs.push(a.x, a.y, b.x, b.y);
        }
      }
      this.segs = new Float64Array(segs);
      this.segCount = segs.length / 4;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
      const m = this.barrierDist + 20;
      this.bounds = { minX: minX - m, minY: minY - m, maxX: maxX + m, maxY: maxY + m };
      this._buildGrid();
    }

    // Mřížka pro rychlé hledání úseček, které paprsek může protnout.
    _buildGrid() {
      const cs = this.cell = 64;
      const b = this.bounds;
      const gx0 = b.minX - SENSORS.range, gy0 = b.minY - SENSORS.range;
      this.gx0 = gx0; this.gy0 = gy0;
      this.gw = Math.ceil((b.maxX + SENSORS.range - gx0) / cs) + 1;
      this.gh = Math.ceil((b.maxY + SENSORS.range - gy0) / cs) + 1;
      this.grid = Array.from({ length: this.gw * this.gh }, () => []);
      for (let s = 0; s < this.segCount; s++) {
        const ax = this.segs[s * 4], ay = this.segs[s * 4 + 1], bx = this.segs[s * 4 + 2], by = this.segs[s * 4 + 3];
        const c0 = Math.floor((Math.min(ax, bx) - gx0) / cs), c1 = Math.floor((Math.max(ax, bx) - gx0) / cs);
        const r0 = Math.floor((Math.min(ay, by) - gy0) / cs), r1 = Math.floor((Math.max(ay, by) - gy0) / cs);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.grid[r * this.gw + c].push(s);
      }
      this._stamp = new Int32Array(this.segCount);
      this._stampId = 0;
    }

    // Vzdálenost od bodu (x,y) ve směru ang k nejbližšímu okraji vozovky.
    rayCast(x, y, ang, maxLen) {
      const dx = Math.cos(ang) * maxLen, dy = Math.sin(ang) * maxLen;
      const ex = x + dx, ey = y + dy;
      const cs = this.cell;
      const c0 = clamp(Math.floor((Math.min(x, ex) - this.gx0) / cs), 0, this.gw - 1);
      const c1 = clamp(Math.floor((Math.max(x, ex) - this.gx0) / cs), 0, this.gw - 1);
      const r0 = clamp(Math.floor((Math.min(y, ey) - this.gy0) / cs), 0, this.gh - 1);
      const r1 = clamp(Math.floor((Math.max(y, ey) - this.gy0) / cs), 0, this.gh - 1);
      const id = ++this._stampId;
      const S = this.segs;
      let bestT = 1;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const cell = this.grid[r * this.gw + c];
          for (let k = 0; k < cell.length; k++) {
            const s = cell[k];
            if (this._stamp[s] === id) continue;
            this._stamp[s] = id;
            const ax = S[s * 4], ay = S[s * 4 + 1];
            const sx = S[s * 4 + 2] - ax, sy = S[s * 4 + 3] - ay;
            const den = dx * sy - dy * sx;
            if (den === 0) continue;
            const qx = ax - x, qy = ay - y;
            const t = (qx * sy - qy * sx) / den;
            if (t < 0 || t >= bestT) continue;
            const u = (qx * dy - qy * dx) / den;
            if (u < 0 || u > 1) continue;
            bestT = t;
          }
        }
      }
      return bestT * maxLen;
    }

    // Nejbližší bod na středové čáře. hint = index z minulého kroku (rychlé lokální hledání).
    nearest(x, y, hint) {
      const N = this.N;
      let from = 0, to = N;
      if (hint >= 0) { from = hint - 30; to = hint + 30; }
      let bi = 0, bt = 0, bd = Infinity;
      for (let j = from; j < to; j++) {
        const i = ((j % N) + N) % N;
        const a = this.pts[i], b = this.pts[(i + 1) % N];
        const sx = b.x - a.x, sy = b.y - a.y;
        let t = ((x - a.x) * sx + (y - a.y) * sy) / (sx * sx + sy * sy);
        t = clamp(t, 0, 1);
        const px = a.x + sx * t, py = a.y + sy * t;
        const d = (x - px) ** 2 + (y - py) ** 2;
        if (d < bd) { bd = d; bi = i; bt = t; }
      }
      const a = this.pts[bi], b = this.pts[(bi + 1) % N];
      const segAng = Math.atan2(b.y - a.y, b.x - a.x);
      const side = (x - a.x) * -Math.sin(segAng) + (y - a.y) * Math.cos(segAng); // + = vpravo od středu
      return { index: bi, t: bt, dist: Math.sqrt(bd), side, s: (bi + bt) * this.ds, dir: segAng };
    }

    // Poloha a směr v bodě trati i, posunutá o `side` px doprava od středu.
    poseAt(i, side = 0) {
      i = ((i % this.N) + this.N) % this.N;
      const p = this.pts[i], ang = this.dir[i];
      return { x: p.x - Math.sin(ang) * side, y: p.y + Math.cos(ang) * side, heading: ang };
    }

    // Startovní rošt: dvojice aut za startovní čárou, mírně posunuté jako v F1.
    gridSlot(k) {
      const back = 3 + Math.floor(k / 2) * 5 + (k % 2) * 2; // body trati jsou po ≈8 px
      const i = ((-back % this.N) + this.N) % this.N;
      const p = this.pts[i], ang = this.dir[i];
      const side = (k % 2 === 0 ? -1 : 1) * this.halfWidth * 0.45;
      return { x: p.x - Math.sin(ang) * side, y: p.y + Math.cos(ang) * side, heading: ang };
    }
  }

  // ---------------------------------------------------------------------
  // Auto
  // ---------------------------------------------------------------------
  class Car {
    constructor(opts) {
      this.id = opts.id;
      this.name = opts.name || 'Auto';
      this.color = opts.color || '#e10600';
      this.driver = opts.driver || null;
      this.isHuman = !!opts.isHuman;
      this.x = opts.x; this.y = opts.y; this.heading = opts.heading;
      this.vx = 0; this.vy = 0;
      this.steer = 0;
      this.input = { throttle: 0, brake: 0, steer: 0 };
      this.crashed = false; this.crashTime = null;
      this.finished = false; this.finishTime = null;
      this.onRoad = true;
      this.slip = 0;             // boční rychlost (smyk) – pro stopy pneumatik
      this.trackInfo = null;
      this.distance = 0;         // ujetá vzdálenost po trati (může být i záporná)
      this.lapsDone = 0;
      this.lapTimes = [];
      this._lapStart = 0;
      this.sensors = null;
    }

    get speed() { return this.vx * Math.cos(this.heading) + this.vy * Math.sin(this.heading); }

    /*
     * Co auto "vidí". Tohle je jediná informace, kterou dostane řidič –
     * a v budoucnu i neuronová síť. `others` = auta, do kterých může narazit.
     */
    sense(track, others) {
      const ti = this.trackInfo;
      const rays = SENSORS.angles.map(a => track.rayCast(this.x, this.y, this.heading + a, SENSORS.range));
      const carAhead = this._carAhead(others);
      const speed = this.speed;
      const angleToTrack = wrapAngle(this.heading - ti.dir);
      const s = {
        rays,                                         // vzdálenosti k okraji vozovky [px], 0 = vlevo 60°, 4 = vpravo 60°
        carAhead,                                     // nejbližší auto před námi: { dist [px], bearing [rad, + = vpravo], closing [px/s], car } nebo null
        rayAngles: SENSORS.angles,
        range: SENSORS.range,
        speed,                                        // rychlost vpřed [px/s]
        heading: this.heading,                        // směr auta ve světě [rad]
        angleToTrack,                                 // odchylka od směru trati [rad], + = auto míří doprava
        lateral: ti.side / track.halfWidth,           // poloha napříč tratí: -1 levý okraj, 0 střed, +1 pravý okraj
        onRoad: this.onRoad,
      };
      // Normalizované vstupy přesně v té podobě, v jaké je dostane neuronová síť.
      s.inputs = rays.map(r => r / SENSORS.range).concat([speed / PHYS.maxSpeed, angleToTrack / Math.PI]);
      // Rozšířené vstupy (10 čísel) pro síť, která vidí i ostatní auta – kvůli předjíždění:
      // jak daleko je auto vpředu (1 = žádné), jestli je vlevo/vpravo (-1..1) a jak rychle se k němu blížím.
      // Strana a přibližování sílí s blízkostí auta, takže vzdálené auto je skoro jako žádné.
      const near = carAhead ? 1 - carAhead.dist / SENSORS.range : 0;
      s.inputsWithCars = s.inputs.concat(carAhead
        ? [1 - near, (carAhead.bearing / SENSORS.carFov) * near, (carAhead.closing / PHYS.maxSpeed) * near]
        : [1, 0, 0]);
      this.sensors = s;
      return s;
    }

    // Nejbližší auto v zorném poli před námi (±SENSORS.carFov).
    _carAhead(others) {
      if (!others) return null;
      let best = null;
      const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
      for (const o of others) {
        const dx = o.x - this.x, dy = o.y - this.y;
        const d = Math.hypot(dx, dy) - 2 * PHYS.carRadius;
        if (d > SENSORS.range || (best && d >= best.dist)) continue;
        const bearing = wrapAngle(Math.atan2(dy, dx) - this.heading);
        if (Math.abs(bearing) > SENSORS.carFov) continue;
        const n = Math.hypot(dx, dy) || 1;
        const closing = ((this.vx - o.vx) * dx + (this.vy - o.vy) * dy) / n;
        best = { dist: Math.max(0, d), bearing, closing, car: o };
      }
      return best;
    }

    update(dt, inp, track) {
      if (this.crashed) { this.vx = this.vy = 0; return; }
      const P = PHYS;
      const throttle = clamp(+inp.throttle || 0, 0, 1);
      const brake = clamp(+inp.brake || 0, 0, 1);
      const steerIn = clamp(+inp.steer || 0, -1, 1);
      this.input = { throttle, brake, steer: steerIn };
      this.steer += clamp(steerIn - this.steer, -P.steerRate * dt, P.steerRate * dt);

      const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
      const rx = -fy, ry = fx;
      let vf = this.vx * fx + this.vy * fy;   // rychlost vpřed
      let vr = this.vx * rx + this.vy * ry;   // rychlost bokem (smyk)

      const onRoad = this.onRoad;
      const grip = onRoad ? P.grip : P.grassGrip;

      // Podélný pohyb: plyn, brzda, odpory.
      if (throttle > 0 && vf >= -5) vf += P.accel * throttle * (1 - vf / P.maxSpeed) * dt;
      if (brake > 0) {
        if (vf > 5) vf = Math.max(0, vf - P.brake * brake * dt);
        else vf = Math.max(-P.reverseMax, vf - P.reverseAccel * brake * dt);
      }
      if (throttle > 0 && vf < -5) vf = Math.min(0, vf + P.brake * throttle * dt);
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), P.roll * dt);
      if (!onRoad && Math.abs(vf) > P.grassMaxSpeed) {
        vf -= (vf - Math.sign(vf) * P.grassMaxSpeed) * P.grassDrag * dt;
      }

      // Boční přilnavost: pneumatiky umí "zrušit" jen omezenou boční rychlost.
      // Když jedu do zatáčky moc rychle, zbytek zůstane -> setrvačnost auto vynese ven.
      const lateralFix = Math.min(Math.abs(vr), grip * dt);
      vr -= Math.sign(vr) * lateralFix;
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), Math.abs(vr) * P.scrub * dt * 10);
      this.slip = vr;

      // Zatáčení: čím rychleji, tím menší rejd.
      const lowSpeed = clamp(vf / 60, -1, 1);
      const yaw = this.steer * P.maxYaw * lowSpeed / (1 + Math.abs(vf) / P.yawSpeedRef);
      this.heading = wrapAngle(this.heading + yaw * dt);

      this.vx = fx * vf + rx * vr;
      this.vy = fy * vf + ry * vr;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }

    // Po pohybu: kde na trati jsem, jsem na asfaltu, nenarazil jsem?
    locate(track, raceTime) {
      const prevS = this.trackInfo ? this.trackInfo.s : null;
      const ti = this.trackInfo = track.nearest(this.x, this.y, this.trackInfo ? this.trackInfo.index : -1);
      this.onRoad = ti.dist <= track.halfWidth;
      if (prevS === null) {
        this.distance = ti.s > track.length / 2 ? ti.s - track.length : ti.s;
      } else {
        let d = ti.s - prevS;
        if (d > track.length / 2) d -= track.length;
        if (d < -track.length / 2) d += track.length;
        this.distance += d;
      }
      if (!this.crashed && ti.dist > track.barrierDist - PHYS.carWidth / 2) {
        // Náraz do bariéry -> auto je nepojízdné.
        // Auto posuneme přesně k bariéře, aby nezůstalo "za zdí".
        const k = (track.barrierDist - PHYS.carWidth / 2) / ti.dist;
        const a = track.pts[ti.index], b = track.pts[(ti.index + 1) % track.N];
        const cx = a.x + (b.x - a.x) * ti.t, cy = a.y + (b.y - a.y) * ti.t;
        this.x = cx + (this.x - cx) * k;
        this.y = cy + (this.y - cy) * k;
        this.crashed = true;
        this.crashTime = raceTime;
        this.vx = this.vy = 0;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Pravidlový řidič – "naprogramovaný člověkem". Vidí jen senzory.
  // Slouží jako NPC soupeř a jako srovnání pro neuronovou síť.
  // ---------------------------------------------------------------------
  class RuleBasedDriver {
    constructor(skill = 1) { this.skill = skill; }
    drive(s) {
      const [l2, l1, c, r1, r2] = s.rays;
      const R = s.range;
      // 1) Zatáčej tam, kde je víc místa.
      let steer = ((r1 + 0.6 * r2) - (l1 + 0.6 * l2)) / R * 1.6;
      // 2) Když mířím úplně jinam než trať (po hodinách), srovnej to.
      if (Math.abs(s.angleToTrack) > 1.0) steer = -Math.sign(s.angleToTrack);
      // 3) Rychlost podle toho, kolik volného místa vidím před sebou.
      const target = (90 + 330 * Math.pow(c / R, 1.3)) * this.skill;
      const throttle = s.speed < target ? 1 : 0;
      const brake = s.speed > target + 25 ? 1 : 0;
      return { throttle, brake, steer: clamp(steer, -1, 1) };
    }
  }

  // ---------------------------------------------------------------------
  // Závod – drží trať a auta, krokuje simulaci.
  // ---------------------------------------------------------------------
  class Race {
    constructor(track, opts = {}) {
      this.track = track;
      this.laps = opts.laps || 3;
      this.collisions = opts.collisions !== false;
      // contactCrash: "duch" (car.ghost) při dotyku s jiným autem havaruje – používá trénink předjíždění.
      this.contactCrash = !!opts.contactCrash;
      this.countdown = opts.countdown != null ? opts.countdown : 3;
      this.cars = [];
      this.time = 0;
      this.finishOrder = [];
    }

    get raceTime() { return Math.max(0, this.time - this.countdown); }
    get started() { return this.time >= this.countdown; }

    addCar(opts) {
      const slot = this.track.gridSlot(this.cars.length);
      const car = new Car(Object.assign({ id: this.cars.length }, opts, slot));
      car.locate(this.track, 0);
      this.cars.push(car);
      car.sense(this.track, this.visibleFor(car));
      return car;
    }

    step(dt) {
      this.time += dt;
      const track = this.track;
      const t = this.raceTime;
      if (this.started) {
        for (const car of this.cars) {
          let inp = { throttle: 0, brake: 0, steer: 0 };
          if (!car.crashed && car.driver) inp = car.driver.drive(car.sensors, car, this) || inp;
          car.update(dt, inp, track);
        }
        if (this.collisions) this._collide();
        for (const car of this.cars) {
          if (car.crashed) continue;
          car.locate(track, t);
          const laps = Math.floor(car.distance / track.length);
          if (laps > car.lapsDone && !car.finished) {
            car.lapTimes.push(t - car._lapStart);
            car._lapStart = t;
            car.lapsDone = laps;
            if (laps >= this.laps) {
              car.finished = true;
              car.finishTime = t;
              this.finishOrder.push(car);
            }
          }
        }
      }
      for (const car of this.cars) if (!car.crashed) car.sense(track, this.visibleFor(car));
    }

    // Můžou do sebe dvě auta narazit? "Duchové" (auta v tréninku) se navzájem neruší
    // a jejich vraky nepřekáží nikomu – každé trénované auto tak jede stejný závod.
    canCollide(a, b) {
      if (!this.collisions || a === b || (a.ghost && b.ghost)) return false;
      return !((a.ghost && a.crashed) || (b.ghost && b.crashed));
    }

    visibleFor(car) {
      if (!this.collisions) return null;
      return this.cars.filter(o => this.canCollide(car, o));
    }

    _collide() {
      const r = PHYS.carRadius, cs = this.cars;
      for (let i = 0; i < cs.length; i++) {
        for (let j = i + 1; j < cs.length; j++) {
          const a = cs[i], b = cs[j];
          if (!this.canCollide(a, b)) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= 4 * r * r || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, overlap = 2 * r - d;
          // Kolik se kdo odsune: vrak a "skutečné" auto proti duchovi se nehnou.
          const wa = a.crashed ? 0 : b.crashed ? 1 : a.ghost !== b.ghost ? (a.ghost ? 1 : 0) : 0.5, wb = 1 - wa;
          if (this.contactCrash) {
            for (const g of [a, b]) {
              if (g.ghost && !g.crashed) { g.crashed = true; g.hitCar = true; g.crashTime = this.raceTime; g.vx = g.vy = 0; }
            }
          }
          a.x -= nx * overlap * wa; a.y -= ny * overlap * wa;
          b.x += nx * overlap * wb; b.y += ny * overlap * wb;
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) {
            const imp = -rel * 0.65;
            if (!a.crashed && wa > 0) { a.vx -= nx * imp; a.vy -= ny * imp; }
            if (!b.crashed && wb > 0) { b.vx += nx * imp; b.vy += ny * imp; }
          }
        }
      }
    }

    // Pořadí: dojeté podle času, pak jedoucí podle ujeté vzdálenosti, havarovaní na konec.
    standings() {
      return this.cars.slice().sort((a, b) => {
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        if (a.finished) return a.finishTime - b.finishTime;
        if (a.crashed !== b.crashed) return a.crashed ? 1 : -1;
        return b.distance - a.distance;
      });
    }

    isOver() {
      return this.cars.every(c => c.finished || c.crashed);
    }
  }

  const F1 = { PHYS, SENSORS, TRACK_DEFS, Track, Car, Race, RuleBasedDriver, clamp, wrapAngle };
  root.F1 = F1;
  if (typeof module !== 'undefined' && module.exports) module.exports = F1;
})(typeof window !== 'undefined' ? window : globalThis);
