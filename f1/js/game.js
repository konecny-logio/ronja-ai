/*
 * Hra v prohlížeči: menu, klávesnice, herní smyčka, HUD.
 */
(function () {
  'use strict';
  const { Track, Race, RuleBasedDriver, NeuralNet, NeuralDriver, TRACK_DEFS, PHYS } = window.F1;
  const $ = id => document.getElementById(id);

  // ---- klávesnice ---------------------------------------------------------
  const keys = new Set();
  const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Tab'];
  window.addEventListener('keydown', e => {
    if (GAME_KEYS.includes(e.code) && state.race) e.preventDefault();
    keys.add(e.code);
    onKey(e.code);
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // Citlivost volantu pro hráče (1 = plný rejd). Platí jen pro klávesnici,
  // NPC a neuronové sítě řídí dál s plným rozsahem.
  const KEY_STEER = 0.7;

  class KeyboardDriver {
    constructor(map) { this.map = map; }
    drive() {
      const m = this.map;
      return {
        throttle: keys.has(m.up) ? 1 : 0,
        brake: keys.has(m.down) ? 1 : 0,
        steer: KEY_STEER * ((keys.has(m.right) ? 1 : 0) - (keys.has(m.left) ? 1 : 0)),
      };
    }
  }
  const P1_KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  const P2_KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };

  // Mozek pro soupeře "neuronová síť": z trénovací stránky (localStorage), nebo předtrénovaný.
  function savedBrain() {
    try {
      const saved = JSON.parse(localStorage.getItem('f1-brain'));
      if (saved && saved.weights) return saved;
    } catch (e) { /* nic uloženého */ }
    return null;
  }
  const sees = net => (net.sizes[0] > window.F1.INPUTS ? 'vidí jiná auta' : 'nevidí jiná auta');
  function loadBrain(choice) {
    const saved = savedBrain();
    if (choice === 'saved' && saved) {
      const net = NeuralNet.fromJSON(saved);
      return { net, info: `Síť z tvého tréninku (generace ${saved.generation}, ${sees(net)}).` };
    }
    if (choice === 'overtake' && window.F1.PRETRAINED_OVERTAKE) {
      return { net: NeuralNet.fromJSON(window.F1.PRETRAINED_OVERTAKE), info: 'Předtrénovaná síť, která vidí jiná auta a umí je předjíždět.' };
    }
    return { net: NeuralNet.fromJSON(window.F1.PRETRAINED),
      info: (choice === 'saved' ? 'Z tréninku zatím nic uloženo – použije se předtrénovaná. ' : '') + 'Předtrénovaná síť, nevidí jiná auta.' };
  }
  if (!savedBrain()) $('opt-brain').value = 'pre';
  const showBrainInfo = () => { $('opt-brain-info').textContent = loadBrain($('opt-brain').value).info; };
  $('opt-brain').addEventListener('change', showBrainInfo);
  showBrainInfo();

  const NPC = [
    { name: 'Bot Alfa', color: '#00c2b8' }, { name: 'Bot Beta', color: '#ff8a00' },
    { name: 'Bot Gama', color: '#c0c6cc' }, { name: 'Bot Delta', color: '#ffe100' },
    { name: 'Bot Epsilon', color: '#9b4dff' }, { name: 'Bot Zeta', color: '#2fd34a' },
    { name: 'Bot Éta', color: '#ff5fb0' }, { name: 'Bot Théta', color: '#ffffff' },
  ];

  // ---- stav -----------------------------------------------------------------
  const renderer = new window.Renderer($('game'));
  const state = { race: null, config: null, paused: false, showAllRays: false, selected: null, over: false };

  // ---- menu -----------------------------------------------------------------
  TRACK_DEFS.forEach((d, i) => $('opt-track').add(new Option(d.name, i)));
  $('opt-npc').addEventListener('input', () => { $('opt-npc-val').textContent = $('opt-npc').value; });
  $('btn-start').addEventListener('click', () => {
    state.config = {
      players: +$('opt-players').value,
      npcs: +$('opt-npc').value,
      npcType: $('opt-npc-type').value,
      brain: $('opt-brain').value,
      track: +$('opt-track').value,
      laps: +$('opt-laps').value,
      rays: $('opt-rays').checked,
      collisions: $('opt-coll').checked,
    };
    startRace();
  });
  $('btn-again').addEventListener('click', startRace);
  $('btn-menu').addEventListener('click', showMenu);

  function showMenu() {
    state.race = null;
    $('results').classList.add('hidden');
    $('hud').classList.add('hidden');
    $('menu').classList.remove('hidden');
  }

  function startRace() {
    const cfg = state.config;
    if (cfg.players + cfg.npcs === 0) cfg.npcs = 1;
    const track = new Track(TRACK_DEFS[cfg.track]);
    const race = new Race(track, { laps: cfg.laps, collisions: cfg.collisions });

    // Boti startují vpředu, hráči za nimi (aby měli koho předjíždět).
    const npcs = [];
    for (let i = 0; i < cfg.npcs; i++) npcs.push(NPC[i]);
    const brain = loadBrain(cfg.brain).net;
    npcs.forEach((n, i) => {
      const neural = cfg.npcType === 'nn' || (cfg.npcType === 'mix' && i % 2 === 1);
      // Každá kopie sítě je nepatrně pozměněná, aby nejela všechna auta úplně stejně.
      const driver = neural ? new NeuralDriver(brain.clone().mutate(0.3, 0.03)) : new RuleBasedDriver(1 - i * 0.025);
      race.addCar({ name: neural ? n.name.replace('Bot', 'Síť') : n.name, color: n.color, driver });
    });
    if (cfg.players >= 1) race.addCar({ name: 'Hráč 1', color: '#e10600', isHuman: true, driver: new KeyboardDriver(P1_KEYS) });
    if (cfg.players >= 2) race.addCar({ name: 'Hráč 2', color: '#1e5bff', isHuman: true, driver: new KeyboardDriver(P2_KEYS) });

    state.race = race;
    state.over = false;
    state.paused = false;
    state.showAllRays = cfg.rays;
    state.selected = race.cars.find(c => c.isHuman) || race.cars[0];
    renderer.setTrack(track);
    renderer.clearSkids();
    buildInspector();
    $('menu').classList.add('hidden');
    $('results').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('banner').classList.add('hidden');
  }

  function onKey(code) {
    if (!state.race) return;
    if (code === 'Escape') showMenu();
    else if (code === 'Space' && !state.over) {
      state.paused = !state.paused;
      setBanner(state.paused ? 'PAUZA' : '');
    } else if (code === 'KeyR') state.showAllRays = !state.showAllRays;
    else if (code === 'Tab') {
      const cs = state.race.cars;
      state.selected = cs[(cs.indexOf(state.selected) + 1) % cs.length];
    }
  }

  // Kliknutím na auto ho vybereš do panelu "Co vidí auto".
  $('game').addEventListener('click', e => {
    if (!state.race) return;
    const r = renderer, dpr = r.dpr;
    const wx = (e.clientX * dpr - r.ox) / r.scale, wy = (e.clientY * dpr - r.oy) / r.scale;
    let best = null, bd = 30 * 30;
    for (const c of state.race.cars) {
      const d = (c.x - wx) ** 2 + (c.y - wy) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (best) state.selected = best;
  });

  window.addEventListener('resize', () => { if (state.race) renderer.resize(); });

  function setBanner(text) {
    $('banner').textContent = text;
    $('banner').classList.toggle('hidden', !text);
  }

  // ---- HUD ------------------------------------------------------------------
  const fmtTime = t => {
    const m = Math.floor(t / 60), s = t - m * 60;
    return (m ? m + ':' + (s < 10 ? '0' : '') : '') + s.toFixed(2);
  };
  const kmh = v => Math.round(Math.abs(v) * PHYS.kmhPerPxs);

  function buildInspector() {
    const labels = ['L60°', 'L30°', 'rovně', 'P30°', 'P60°'];
    $('insp-bars').innerHTML = labels.map(l => `<div class="bar"><div class="fill"></div><div class="lbl">${l}</div></div>`).join('');
  }

  function updateHud() {
    const race = state.race, track = race.track;
    const st = race.standings();

    $('standings').innerHTML = `<div style="margin-bottom:4px;opacity:.8">${track.name} · ${fmtTime(race.raceTime)}</div>` +
      st.map((c, i) => {
        const status = c.finished ? fmtTime(c.finishTime) : c.crashed ? 'havárie' : `kolo ${Math.min(c.lapsDone + 1, race.laps)}/${race.laps}`;
        return `<div class="row ${c.crashed ? 'crashed' : ''} ${c === state.selected ? 'sel' : ''}">
          <span class="pos">${i + 1}.</span><span class="dot" style="background:${c.color}"></span>
          <span class="name">${c.name}</span><span class="state">${status}</span></div>`;
      }).join('');

    $('players').innerHTML = race.cars.filter(c => c.isHuman).map(c => {
      const pos = st.indexOf(c) + 1;
      let main, sub;
      if (c.crashed) { main = 'HAVÁRIE'; sub = 'Auto je nepojízdné'; }
      else if (c.finished) { main = `${pos}. místo`; sub = 'v cíli za ' + fmtTime(c.finishTime); }
      else {
        main = `${kmh(c.speed)} km/h`;
        sub = `pozice ${pos}/${race.cars.length} · kolo ${Math.min(c.lapsDone + 1, race.laps)}/${race.laps}` + (c.onRoad ? '' : ' · TRÁVA!');
      }
      return `<div class="player ${c.crashed ? 'crash' : ''}" style="border-color:${c.color}">
        <div class="small">${c.name}</div><div class="big">${main}</div><div class="small">${sub}</div></div>`;
    }).join('');

    const car = state.selected, s = car.sensors;
    $('insp-name').textContent = car.name;
    $('insp-name').style.color = car.color;
    const fills = $('insp-bars').querySelectorAll('.fill');
    s.rays.forEach((d, i) => {
      const k = d / s.range;
      fills[i].style.height = (k * 100).toFixed(0) + '%';
      fills[i].style.background = `hsl(${Math.round(k * 120)}, 85%, 50%)`;
    });
    $('insp-speed').textContent = `${kmh(s.speed)} km/h`;
    $('insp-angle').textContent = `${Math.round(s.angleToTrack * 180 / Math.PI)}°`;
    $('insp-road').textContent = car.crashed ? 'havárie' : s.onRoad ? 'ano' : 'ne (tráva)';
    const fmt = a => a.map(v => v.toFixed(2)).join(', ');
    $('insp-inputs').textContent = '[' + fmt(s.inputs) + ']  auto vpředu: [' + fmt(s.inputsWithCars.slice(7)) + ']';
    const o = car.input;
    $('insp-outputs').textContent = `plyn ${o.throttle.toFixed(2)}, brzda ${o.brake.toFixed(2)}, volant ${o.steer.toFixed(2)}`;

    // Startovní světla: rozsvěcují se po 0,5 s, pak zhasnou = start.
    const lights = $('lights');
    if (race.time < race.countdown + 0.8) {
      lights.classList.remove('hidden');
      const on = race.started ? 0 : Math.min(5, Math.floor(race.time / (race.countdown / 6)));
      lights.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < on));
      if (race.started && !state.paused) setBanner('START!');
    } else {
      lights.classList.add('hidden');
      if ($('banner').textContent === 'START!') setBanner('');
    }
  }

  function showResults() {
    const race = state.race;
    $('results-table').innerHTML = race.standings().map((c, i) => {
      const best = c.lapTimes.length ? fmtTime(Math.min(...c.lapTimes)) : '–';
      const res = c.finished ? fmtTime(c.finishTime) : c.crashed ? 'havárie' : 'nedojel';
      return `<tr><td>${i + 1}.</td><td><span class="pill" style="background:${c.color};color:#000">&nbsp;</span> ${c.name}</td>
        <td>${res}</td><td style="opacity:.7">nejl. kolo ${best}</td></tr>`;
    }).join('');
    $('results').classList.remove('hidden');
  }

  // ---- herní smyčka (pevný krok 1/60 s => stejná fyzika jako v tréninku) ----
  const DT = 1 / 60;
  let acc = 0, last = performance.now(), hudTimer = 0, overTimer = 0;
  function frame(now) {
    const elapsed = Math.min(0.1, (now - last) / 1000);
    last = now;
    const race = state.race;
    if (race) {
      if (!state.paused) {
        acc += elapsed;
        while (acc >= DT) { race.step(DT); acc -= DT; }
      }
      // Tachometr: ručička pro každého hráče, bez hráčů pro vybrané auto.
      const humans = race.cars.filter(c => c.isHuman);
      const gauge = (humans.length ? humans : [state.selected]).filter(Boolean)
        .map(c => ({ kmh: c.crashed ? 0 : kmh(c.speed), color: c.color }));
      renderer.draw(race, { showAllRays: state.showAllRays, selected: state.selected, time: now / 1000, gauge });
      hudTimer += elapsed;
      if (hudTimer > 0.08) { hudTimer = 0; updateHud(); }

      // Konec: všichni hráči dojeli/havarovali (nebo všichni boti, když nikdo nehraje).
      const watch = race.cars.some(c => c.isHuman) ? race.cars.filter(c => c.isHuman) : race.cars;
      if (!state.over && race.started && watch.every(c => c.finished || c.crashed)) {
        state.over = true; overTimer = 0;
        setBanner(watch.every(c => c.crashed) ? 'HAVÁRIE!' : 'CÍL!');
      }
      if (state.over) {
        overTimer += elapsed;
        if (overTimer > 2.5 && $('results').classList.contains('hidden')) { setBanner(''); showResults(); }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.game = state; // pro ladění v konzoli
})();
