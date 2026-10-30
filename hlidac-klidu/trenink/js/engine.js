/*
 * Hlídač klidu – engine (pravidla hry, senzory, bot).
 *
 * Věrný přepis herní logiky z dist/index.html, ale BEZ kreslení, zvuku a klávesnice,
 * takže běží stejně v prohlížeči i v Node.js (headless). To je důležité pro trénink:
 * neuronová síť může odehrát stovky směn mnohem rychleji, než kdyby se vše kreslilo.
 *
 * Rozdíly proti hře:
 *   - pevný krok 1/60 s a vlastní náhodný generátor se semínkem (seed) -> stejné semínko
 *     a stejné rozhodování dají stejnou směnu (ve hře je Math.random a proměnný krok),
 *   - kolize hlídače s lavicemi jdou vypnout (`deskCollisions: false`), aby se síť
 *     zpočátku nemusela učit obcházet překážky.
 *
 * Hlídač (člověk, pravidlový bot nebo neuronová síť) je libovolný objekt s metodou:
 *     control(sensors, world) -> { x: -1..1, y: -1..1, act: true/false }
 * x/y = směr chůze (stačí směr, hlídač jde vždy plnou rychlostí; malý vektor = stát),
 * act = stisk „Utišit“ (mezerník).
 */
(function (root) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Deterministický generátor náhodných čísel (mulberry32): stejné semínko = stejná směna.
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------------
  // Místnost a pravidla – čísla odpovídají dist/index.html.
  // ---------------------------------------------------------------------
  const ROOM = {
    w: 960, h: 620,
    padding: 46,
    top: 118,            // hlídač nemůže výš (tabule)
    studentTop: 136,
  };
  // Kudy může hlídač chodit (bez ohledu na lavice).
  const WALK = { left: ROOM.padding, right: ROOM.w - ROOM.padding, top: ROOM.top, bottom: ROOM.h - ROOM.padding };

  const DESKS = [
    { x: 154, y: 188 }, { x: 348, y: 188 }, { x: 542, y: 188 }, { x: 736, y: 188 },
    { x: 154, y: 342 }, { x: 348, y: 342 }, { x: 542, y: 342 }, { x: 736, y: 342 },
  ];
  const DESK_OBSTACLES = DESKS.map(d => ({ left: d.x - 64, right: d.x + 64, top: d.y - 30, bottom: d.y + 46 }));

  const TYPES = [
    { name: 'Povídal', color: '#327fc2', noise: 11, calmTime: 0.65, authority: 7, speed: 36, chance: 0.46 },
    { name: 'Bouchač', color: '#d84c3d', noise: 17, calmTime: 2.6, authority: 16, speed: 24, chance: 0.24 },
    { name: 'Papírkář', color: '#e1a535', noise: 9, calmTime: 1.05, authority: 10, speed: 31, chance: 0.19 },
    { name: 'Pobíhač', color: '#6352b8', noise: 13, calmTime: 1.8, authority: 13, speed: 68, chance: 0.11 },
  ];

  const RULES = {
    duration: 75,          // délka směny [s]
    playerSpeed: 178,      // [px/s]
    actionSlow: 0.32,      // během zásahu jde hlídač pomaleji
    playerRadius: 18,
    collisionRadius: 14,   // pro kolize s lavicemi
    reach: 74,             // na jakou vzdálenost jde zasáhnout
    keepReach: 88,         // když se hlídač během zásahu vzdálí víc, zásah se přeruší
    missCost: 3,           // autorita za „Utišit“ naprázdno
    messCost: 7,           // autorita za úklid
    authorityRegen: 8.5,   // [za s]
    maxMesses: 5,
    actionRepeat: 0.25,    // síť „drží“ tlačítko -> další stisk nejdřív za 0,25 s (jako opakování klávesy)
  };

  // Co hlídač „vidí“. Narušitelé i nepořádek jsou seřazení od nejbližšího.
  const SENSORS = {
    studentSlots: DESKS.length,   // 8 – všichni žáci (tichý = prázdný slot)
    messSlots: RULES.maxMesses,   // 5
    range: 1000,                  // vzdálenost, na které je „blízkost“ už 0 (úhlopříčka místnosti ≈ 980)
    // Paprsky k nejbližší překážce v pevných směrech místnosti (0° = vpravo, po směru hodinových ručiček,
    // y míří dolů). Hlídač nemá „předek“ jako auto – chodí kamkoliv, proto směry nejsou relativní.
    rays: [0, 45, 90, 135, 180, 225, 270, 315].map(a => a * Math.PI / 180),
    rayLabels: ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'],
    rayRange: 250,                // paprsek měří max. do 250 px
  };
  const INPUTS = (SENSORS.studentSlots + SENSORS.messSlots) * 3 + SENSORS.rays.length + 4;   // = 51
  const INPUT_LABELS = [];
  for (let i = 0; i < SENSORS.studentSlots; i++) INPUT_LABELS.push(`žák ${i + 1}: blízko`, `žák ${i + 1}: směr x`, `žák ${i + 1}: směr y`);
  for (let i = 0; i < SENSORS.messSlots; i++) INPUT_LABELS.push(`bordel ${i + 1}: blízko`, `bordel ${i + 1}: směr x`, `bordel ${i + 1}: směr y`);
  for (const l of SENSORS.rayLabels) INPUT_LABELS.push('překážka ' + l);
  INPUT_LABELS.push('v dosahu', 'zasahuji', 'autorita', 'hluk');

  function hitsDesk(x, y, radius) {
    return DESK_OBSTACLES.some(d => {
      const ox = x - clamp(x, d.left, d.right), oy = y - clamp(y, d.top, d.bottom);
      return ox * ox + oy * oy < radius * radius;
    });
  }

  // Jak daleko může střed hlídače dojít ze (x, y) směrem (dx, dy), než narazí do stěny
  // nebo (s kolizemi) do lavice. Lavice je zvětšená o poloměr hlídače (rohy zjednodušeně hranaté).
  function castRay(x, y, dx, dy, desks) {
    let best = SENSORS.rayRange;
    if (dx > 1e-9) best = Math.min(best, (WALK.right - x) / dx);
    if (dx < -1e-9) best = Math.min(best, (WALK.left - x) / dx);
    if (dy > 1e-9) best = Math.min(best, (WALK.bottom - y) / dy);
    if (dy < -1e-9) best = Math.min(best, (WALK.top - y) / dy);
    if (desks) {
      const r = RULES.collisionRadius;
      for (const d of DESK_OBSTACLES) {
        // průsečík paprsku s obdélníkem („slab“ metoda)
        let t0 = 0, t1 = best;
        for (const [p, v, lo, hi] of [[x, dx, d.left - r, d.right + r], [y, dy, d.top - r, d.bottom + r]]) {
          if (Math.abs(v) < 1e-9) { if (p < lo || p > hi) { t0 = Infinity; break; } continue; }
          let a = (lo - p) / v, b = (hi - p) / v;
          if (a > b) [a, b] = [b, a];
          t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        }
        if (t0 <= t1 && t0 < best) best = t0;
      }
    }
    return Math.max(0, best);
  }

  // ---------------------------------------------------------------------
  // Jedna směna jednoho hlídače.
  // ---------------------------------------------------------------------
  class World {
    constructor(opts = {}) {
      this.opts = Object.assign({ seed: 1, deskCollisions: true, messes: true, duration: RULES.duration }, opts);
      this.driver = opts.driver || null;
      this.reset();
    }

    reset() {
      const o = this.opts;
      this.rng = makeRng(o.seed);
      this.nextId = 1;
      this.time = 0;
      this.duration = o.duration;
      this.timeLeft = o.duration;
      this.noise = 8;
      this.score = 0;               // počet zásahů
      this.authority = 100;
      this.spawnTimer = 1.5;
      this.messTimer = 8;
      this.messes = [];
      this.result = null;           // null = hraje se, 'won' | 'lost'
      this.calmSum = 0;             // integrál klidu (100 − hluk) – pro skóre
      this.misses = 0;              // „Utišit“ naprázdno
      this.lastPress = -1;
      this.message = '';
      this.player = { x: 480, y: 505, r: RULES.playerRadius, facing: -Math.PI / 2, action: 0, actionTotal: 0, targetId: null };
      this.students = DESKS.map((desk, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const x = desk.x + side * 30, y = desk.y + 56;
        return {
          id: this.nextId++, x, y, homeX: x, homeY: y, r: 15,
          type: TYPES[i % TYPES.length],
          noisy: false, beingCalmed: false, noiseAge: 0,
          calmCooldown: 2 + this.rng() * 4,
          wander: this.rng() * Math.PI * 2, vx: 0, vy: 0,
        };
      });
      this.sense();
    }

    get over() { return this.result !== null; }
    get elapsed() { return this.duration - this.timeLeft; }

    chooseType() {
      const roll = this.rng();
      let acc = 0;
      for (const t of TYPES) { acc += t.chance; if (roll <= acc) return t; }
      return TYPES[0];
    }

    spawnNoise() {
      const calm = this.students.filter(s => !s.noisy && s.calmCooldown <= 0);
      if (!calm.length) return;
      const s = calm[Math.floor(this.rng() * calm.length)];
      s.type = this.chooseType();
      s.noisy = true;
      s.beingCalmed = false;
      s.noiseAge = 0;
      s.wander = this.rng() * Math.PI * 2;
      this.message = s.type.name + ' dělá rámus';
    }

    spawnMess() {
      if (this.messes.length >= RULES.maxMesses) return;
      const kind = this.rng() > 0.45 ? 'papir' : 'zidle';
      this.messes.push({
        id: this.nextId++, kind,
        x: 110 + this.rng() * 740, y: 160 + this.rng() * 360,
        r: kind === 'papir' ? 13 : 18,
        noise: kind === 'papir' ? 3.8 : 5.8,
        spin: this.rng() * Math.PI * 2,
      });
    }

    nearestProblem() {
      const p = this.player;
      let best = null, bd = Infinity;
      for (const s of this.students) {
        if (!s.noisy) continue;
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        if (d < bd) { best = { kind: 'student', item: s, distance: d }; bd = d; }
      }
      for (const m of this.messes) {
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        if (d < bd) { best = { kind: 'mess', item: m, distance: d }; bd = d; }
      }
      return best;
    }

    // Stisk „Utišit“ – stejná pravidla jako calmAction() ve hře.
    calmAction() {
      const p = this.player;
      if (this.over || p.action > 0) return;
      const problem = this.nearestProblem();
      if (!problem || problem.distance > RULES.reach) {
        this.message = 'Přibliž se k problému';
        this.authority = Math.max(0, this.authority - RULES.missCost);
        this.misses++;
        return;
      }
      const cost = problem.kind === 'student' ? problem.item.type.authority : RULES.messCost;
      if (this.authority < cost) { this.message = 'Chybí autorita'; return; }
      p.action = problem.kind === 'student' ? problem.item.type.calmTime : 0.7;
      p.actionTotal = p.action;
      p.targetId = problem.item.id;
      this.authority = Math.max(0, this.authority - cost);
      if (problem.kind === 'student') {
        problem.item.beingCalmed = true;
        this.message = 'Utišuji: ' + problem.item.type.name;
      } else {
        this.message = problem.item.kind === 'papir' ? 'Sbírám papírky' : 'Rovnám židli';
      }
    }

    finishAction() {
      const p = this.player;
      const s = this.students.find(x => x.id === p.targetId);
      if (s) {
        s.noisy = false; s.beingCalmed = false; s.noiseAge = 0;
        s.calmCooldown = 5 + this.rng() * 5;
        this.noise = Math.max(0, this.noise - 7);
        this.message = 'Zásah: ' + s.type.name + ' ztichl';
      } else {
        const m = this.messes.find(x => x.id === p.targetId);
        if (!m) return;
        this.messes = this.messes.filter(x => x !== m);
        this.noise = Math.max(0, this.noise - 5);
        this.message = m.kind === 'papir' ? 'Papírky uklizené' : 'Židle zpátky na místě';
      }
      this.score++;
      p.targetId = null;
      p.actionTotal = 0;
    }

    updateAction(dt) {
      const p = this.player;
      if (p.action <= 0) return;
      const s = this.students.find(x => x.id === p.targetId);
      const target = s || this.messes.find(x => x.id === p.targetId);
      if (!target || Math.hypot(p.x - target.x, p.y - target.y) > RULES.keepReach) {
        if (s) s.beingCalmed = false;
        p.action = 0; p.actionTotal = 0; p.targetId = null;
        this.message = 'Zásah přerušen: jsi příliš daleko';
        return;
      }
      p.action = Math.max(0, p.action - dt);
      if (p.action === 0) this.finishAction();
    }

    updatePlayer(dt, c) {
      const p = this.player;
      let dx = c.x || 0, dy = c.y || 0;
      const len = Math.hypot(dx, dy);
      if (len < 0.2) { dx = 0; dy = 0; } else { dx /= len; dy /= len; }
      const speed = p.action > 0 ? RULES.playerSpeed * RULES.actionSlow : RULES.playerSpeed;
      const blocked = (x, y) => this.opts.deskCollisions && hitsDesk(x, y, RULES.collisionRadius);
      const nx = clamp(p.x + dx * speed * dt, WALK.left, WALK.right);
      if (!blocked(nx, p.y)) p.x = nx;
      const ny = clamp(p.y + dy * speed * dt, WALK.top, WALK.bottom);
      if (!blocked(p.x, ny)) p.y = ny;
      if (dx || dy) p.facing = Math.atan2(dy, dx);
    }

    updateStudents(dt) {
      for (const s of this.students) {
        const roaming = s.type.name === 'Pobíhač' && s.noisy;
        const speed = roaming ? s.type.speed : s.type.speed * 0.3;
        if (s.beingCalmed) { s.vx = 0; s.vy = 0; }
        else if (s.noisy) {
          s.wander += (this.rng() - 0.5) * dt * (roaming ? 4.5 : 2.1);
          s.vx = Math.cos(s.wander) * speed;
          s.vy = Math.sin(s.wander) * speed;
        } else {
          s.vx = (s.homeX - s.x) * 1.5;
          s.vy = (s.homeY - s.y) * 1.5;
        }
        s.x = clamp(s.x + s.vx * dt, ROOM.padding + 12, ROOM.w - ROOM.padding - 12);
        s.y = clamp(s.y + s.vy * dt, ROOM.studentTop, ROOM.h - ROOM.padding - 12);
      }
    }

    // Jeden krok simulace (odpovídá update() ve hře).
    step(dt) {
      if (this.over) return;
      this.time += dt;
      this.timeLeft -= dt;
      this.spawnTimer -= dt;
      this.messTimer -= dt;
      this.authority = Math.min(100, this.authority + dt * RULES.authorityRegen);

      const pressure = 1 + this.elapsed / this.duration;
      if (this.spawnTimer <= 0) {
        this.spawnNoise();
        this.spawnTimer = Math.max(0.72, 3.1 - pressure * 0.85 - this.rng() * 0.8);
      }
      if (this.messTimer <= 0) {
        if (this.opts.messes) this.spawnMess();
        this.messTimer = Math.max(4.2, 9.5 - pressure * 1.9 + this.rng() * 2.4);
      }

      // Hlídač se rozhoduje podle toho, co vidí.
      const c = (this.driver && this.driver.control(this.sensors, this)) || {};
      if (c.act && this.time - this.lastPress >= RULES.actionRepeat) { this.lastPress = this.time; this.calmAction(); }
      this.updatePlayer(dt, c);
      this.updateAction(dt);
      this.updateStudents(dt);

      let added = 0;
      for (const s of this.students) {
        if (s.noisy) { s.noiseAge += dt; added += s.type.noise * (1 + Math.min(0.75, s.noiseAge / 8)); }
        else s.calmCooldown -= dt;
      }
      for (const m of this.messes) { m.spin += dt * 2.3; added += m.noise; }
      const quietBonus = added <= 0 ? 13 : 2.2;
      this.noise = clamp(this.noise + (added * 0.052 - quietBonus) * dt, 0, 100);
      this.calmSum += (100 - this.noise) * dt;

      if (this.noise >= 100) this.result = 'lost';
      else if (this.timeLeft <= 0) this.result = 'won';
      this.sense();
    }

    // Co hlídač vidí. Narušitelé jsou seřazení od nejbližšího, takže síť nemusí
    // zjišťovat, který slot je zrovna důležitý – nejbližší je vždy na prvním místě.
    sense() {
      const p = this.player;
      const rel = o => {
        const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy) || 1;
        return { o, d, dirX: dx / d, dirY: dy / d };
      };
      const noisy = this.students.filter(s => s.noisy).map(rel).sort((a, b) => a.d - b.d);
      const messes = this.messes.map(rel).sort((a, b) => a.d - b.d);
      const nearest = this.nearestProblem();
      const inReach = !!nearest && nearest.distance <= RULES.reach;
      // Paprsky vidí lavice, jen když jsou kolize zapnuté (jinak hlídače nezastaví).
      const rays = SENSORS.rays.map(a => castRay(p.x, p.y, Math.cos(a), Math.sin(a), this.opts.deskCollisions));

      // Vektor pro neuronovou síť (INPUTS čísel, všechna v rozsahu −1..1).
      const inputs = new Float64Array(INPUTS);
      let k = 0;
      const put = (list, slots) => {
        for (let i = 0; i < slots; i++, k += 3) {
          const r = list[i];
          if (!r) continue;   // prázdný slot = 0, 0, 0
          inputs[k] = 1 - Math.min(r.d, SENSORS.range) / SENSORS.range;   // blízkost: 1 = u mě, 0 = daleko
          inputs[k + 1] = r.dirX;
          inputs[k + 2] = r.dirY;
        }
      };
      put(noisy, SENSORS.studentSlots);
      put(messes, SENSORS.messSlots);
      for (const r of rays) inputs[k++] = r / SENSORS.rayRange;   // 0 = narážím, 1 = volno
      inputs[k++] = inReach ? 1 : 0;
      inputs[k++] = p.action > 0 ? 1 : 0;
      inputs[k++] = this.authority / 100;
      inputs[k++] = this.noise / 100;

      this.sensors = { noisy, messes, nearest, inReach, rays, busy: p.action > 0, authority: this.authority, noise: this.noise, inputs };
      return this.sensors;
    }
  }

  // ---------------------------------------------------------------------
  // Pravidlový hlídač: „jdi k nejbližšímu problému a zasáhni“. Slouží jako soupeř
  // pro srovnání a jako ukázka, že hlídač = cokoliv s metodou control().
  // ---------------------------------------------------------------------
  class RuleBasedGuard {
    control(sensors, world) {
      if (sensors.busy) return { x: 0, y: 0, act: false };           // zásah běží – stůj
      const n = sensors.nearest;
      if (!n) return { x: 0, y: 0, act: false };
      const p = world.player;
      const cost = n.kind === 'student' ? n.item.type.authority : RULES.messCost;
      const act = n.distance <= RULES.reach - 4 && world.authority >= cost;
      if (n.distance <= RULES.reach - 20) return { x: 0, y: 0, act };
      return { x: n.item.x - p.x, y: n.item.y - p.y, act };
    }
  }

  // Hlídač, který nic nedělá – spodní hranice skóre.
  const IdleGuard = { control() { return { x: 0, y: 0, act: false }; } };

  // Skóre směny 0..1+: průměrný klid v místnosti za celou směnu (kdo prohraje dřív,
  // dál už body nesbírá) + malý bonus za každý zásah.
  function fitness(world) {
    return world.calmSum / (100 * world.duration) + world.score * 0.01;
  }

  // Odehraje celou směnu bez kreslení.
  function playShift(driver, opts = {}) {
    const world = new World(Object.assign({}, opts, { driver }));
    while (!world.over) world.step(1 / 60);
    return world;
  }

  const HK = {
    ROOM, WALK, DESKS, DESK_OBSTACLES, TYPES, RULES, SENSORS, INPUTS, INPUT_LABELS,
    World, RuleBasedGuard, IdleGuard, fitness, playShift, makeRng, clamp, hitsDesk, castRay,
  };
  root.HK = HK;
  if (typeof module !== 'undefined' && module.exports) module.exports = HK;
})(typeof window !== 'undefined' ? window : globalThis);
