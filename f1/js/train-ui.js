/*
 * Trénovací stránka: celá generace aut jede najednou, vedle je živě vidět
 * mozek vedoucího auta a graf, jak se generace zlepšují.
 */
(function () {
  'use strict';
  const F1 = window.F1;
  const $ = id => document.getElementById(id);
  const SIDEBAR = 410;
  const DT = 1 / 60;
  const COLOR_BEST = '#3987e5', COLOR_AVG = '#d95926';

  const renderer = new window.Renderer($('game'), { sidebar: SIDEBAR });
  const ui = {
    mode: 'train',          // 'train' | 'champ'
    paused: true,           // po otevření stránky trénink čeká na „Spustit“
    speed: 1,               // kroky simulace za snímek; 0 = co nejrychleji
    settings: { tracks: [0], population: 40, hidden: 6, mutationSize: 0.5, traffic: 0 },
    trainer: null,
    champRace: null,
    shownTrack: null,
    follow: 'leader',       // koho sleduje "Mozek auta": 'leader' | 'manual' | 'traffic'
    followCar: null,
  };

  // ---- nastavení ------------------------------------------------------------
  F1.TRACK_DEFS.forEach((d, i) => {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" value="${i}" ${i === 0 ? 'checked' : ''}> ${d.name}`;
    $('set-tracks').appendChild(l);
    $('champ-track').add(new Option(d.name, i));
  });
  $('set-tracks').addEventListener('change', () => {
    const tr = [...$('set-tracks').querySelectorAll('input:checked')].map(i => +i.value);
    if (!tr.length) { $('set-tracks').querySelector('input').checked = true; tr.push(0); }
    ui.settings.tracks = tr;
    ui.trainer.setTracks(tr);
    ui.trainer.restartGeneration();       // generace začne znovu hned na nových tratích
    if (ui.mode === 'champ') backToTraining();
    toast('Generace ' + ui.trainer.generation + ' jede znovu od startu na vybraných tratích.');
  });
  const bindRange = (id, key, fmt, live) => {
    const el = $(id), out = $(id + '-v');
    el.value = ui.settings[key];
    out.textContent = fmt(+el.value);
    el.addEventListener('input', () => {
      ui.settings[key] = +el.value;
      out.textContent = fmt(+el.value);
      if (live) live(+el.value);
    });
  };
  $('set-traffic').addEventListener('change', () => {
    const on = $('set-traffic').checked;
    ui.settings.traffic = on ? 4 : 0;
    ui.trainer.setTraffic(ui.settings.traffic);
    ui.trainer.restartGeneration();
    if (ui.mode === 'champ') backToTraining();
    $('champ-mode').value = on ? 'traffic' : 'bots';
    toast(on
      ? 'Po trati teď jezdí <b>pomalá auta</b>. Mozky dostaly 3 nové vstupy o autě vpředu – ' +
        'zatím s váhou 0, takže si jich nevšímají. Jestli se je naučí používat, ukáže evoluce.'
      : 'Trať je zase prázdná.', 7);
  });
  bindRange('set-pop', 'population', v => v + ' (platí po „Začít znovu“)');
  bindRange('set-hid', 'hidden', v => v + ' (platí po „Začít znovu“)');
  bindRange('set-mut', 'mutationSize', v => v.toFixed(1), v => { ui.trainer.opts.mutationSize = v; });
  $('b-reset').addEventListener('click', () => { newTrainer(); toast('Nová generace 0 – všechny mozky jsou zase náhodné.'); });

  function newTrainer() {
    const s = ui.settings;
    ui.seeded = false;
    ui.trainer = new F1.Trainer({ tracks: s.tracks, population: s.population, hidden: [s.hidden], mutationSize: s.mutationSize, traffic: s.traffic });
    backToTraining();
  }

  function backToTraining() {
    ui.mode = 'train';
    $('b-champ').textContent = '🏆 Předvést šampiona';
  }

  function setPaused(p) {
    ui.paused = p;
    $('b-play').textContent = p ? '▶ Pokračovat' : '⏸ Pauza';
  }

  // ---- ovládání ---------------------------------------------------------------
  $('b-play').addEventListener('click', () => setPaused(!ui.paused));
  function setSpeed(v) {
    ui.speed = v;
    $('speeds').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.speed === v));
  }
  $('speeds').addEventListener('click', e => { if (e.target.dataset.speed) setSpeed(+e.target.dataset.speed); });
  setSpeed(1);
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); $('b-play').click(); }
    if (e.code === 'Tab') { e.preventDefault(); followNext(); }
  });

  function showChampion() {
    const best = ui.trainer.bestEver;
    if (!best) { toast('Šampion zatím není – počkej, až dojede aspoň první generace.'); return; }
    startChampion(best.net, `šampion z generace ${best.generation}`);
  }
  $('b-champ').addEventListener('click', () => (ui.mode === 'champ' ? backToTraining() : showChampion()));
  // Změna trati nebo soupeřů = šampion hned jede znovu (když už nějaký je).
  $('champ-track').addEventListener('change', () => { if (ui.trainer.bestEver) showChampion(); else previewTrack(); });
  $('champ-mode').addEventListener('change', () => { if (ui.trainer.bestEver) showChampion(); });

  // Bez šampiona aspoň ukážeme vybranou trať (trénink se kvůli tomu nemění).
  function previewTrack() {
    toast(`Šampion zatím není – trať „${F1.TRACK_DEFS[+$('champ-track').value].name}“ uvidíš, až dojede první generace.
      Trénovat na ní můžeš v „Nastavení tréninku“.`, 5);
  }

  function startChampion(net, label) {
    const track = new F1.Track(F1.TRACK_DEFS[+$('champ-track').value]);
    const race = new F1.Race(track, { laps: 2, countdown: 1 });
    const traffic = $('champ-mode').value === 'traffic';
    if (traffic) {
      // Pomalá auta rozmístěná po trati jako při tréninku; šampion startuje za nimi.
      for (let k = 0; k < 4; k++) {
        const car = race.addCar({ name: 'Pomalé auto', color: '#9aa0a6', driver: new F1.RuleBasedDriver(ui.trainer.opts.trafficSkill) });
        Object.assign(car, track.poseAt(50 + Math.round(k * (track.N - 60) / 4)), { trackInfo: null });
        car.locate(track, 0);
      }
    } else {
      // Pro srovnání: tři ručně naprogramovaní boti.
      ['#00c2b8', '#ff8a00', '#c0c6cc'].forEach((c, i) =>
        race.addCar({ name: 'Bot ' + 'ABC'[i], color: c, driver: new F1.RuleBasedDriver(1 - i * 0.03) }));
    }
    const champ = race.addCar({ name: 'Neuronová síť', color: '#ffd84d', isHuman: true, driver: new F1.NeuralDriver(net.clone()) });
    if (traffic) { Object.assign(champ, track.gridSlot(0), { trackInfo: null }); champ.locate(track, 0); }
    ui.champRace = race; ui.champ = champ; ui.champLabel = label; ui.champDone = false;
    ui.champTraffic = traffic; ui.champHits = 0; ui.champTouching = false;
    ui.mode = 'champ';
    setSpeed(1);
    setPaused(false);
    $('b-champ').textContent = '⏹ Zpět k tréninku';
  }

  // ---- uložení / nahrání sítě ---------------------------------------------------
  function bestNetOrToast() {
    if (ui.trainer.bestEver) return ui.trainer.bestEver.net;
    toast('Zatím není co uložit – počkej na konec první generace.');
    return null;
  }
  $('b-use').addEventListener('click', () => {
    const net = bestNetOrToast();
    if (!net) return;
    try {
      localStorage.setItem('f1-brain', JSON.stringify(Object.assign(net.toJSON(), { generation: ui.trainer.bestEver.generation })));
      toast('Uloženo! Ve hře teď zvol soupeře „Neuronová síť“.');
    } catch (e) { toast('Prohlížeč nedovolil uložení – použij „Stáhnout síť“.'); }
  });
  $('b-save').addEventListener('click', () => {
    const net = bestNetOrToast();
    if (!net) return;
    const blob = new Blob([JSON.stringify(net.toJSON())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `f1-mozek-generace-${ui.trainer.bestEver.generation}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('b-load').addEventListener('click', () => $('f-load').click());
  $('f-load').addEventListener('change', async () => {
    const f = $('f-load').files[0];
    if (!f) return;
    try {
      seedFrom(F1.NeuralNet.fromJSON(JSON.parse(await f.text())), 'Nahraný mozek je základem nové populace.');
    } catch (e) { toast('Tenhle soubor neumím přečíst.'); }
    $('f-load').value = '';
  });
  $('b-pre').addEventListener('click', () => {
    if (ui.settings.traffic > 0 && F1.PRETRAINED_OVERTAKE) {
      seedFrom(F1.NeuralNet.fromJSON(F1.PRETRAINED_OVERTAKE), 'Načtena předtrénovaná síť, která <b>umí předjíždět</b>. Další generace vznikají z ní.');
    } else {
      seedFrom(F1.NeuralNet.fromJSON(F1.PRETRAINED), 'Načtena předtrénovaná síť (umí všechny tři tratě, ale nevidí jiná auta). Další generace vznikají z ní.');
    }
  });

  function seedFrom(net, msg) {
    ui.settings.hidden = net.sizes[1];
    $('set-hid').value = net.sizes[1]; $('set-hid-v').textContent = net.sizes[1];
    ui.trainer.seed(net);
    ui.seeded = true;
    ui.mode = 'train';
    $('b-champ').textContent = '🏆 Předvést šampiona';
    toast(msg);
  }

  // ---- které auto sleduje "Mozek auta" ---------------------------------------------
  function setFollow(mode, car = null) {
    ui.follow = mode; ui.followCar = car; ui.followIdle = 0;
    for (const [id, m] of [['f-leader', 'leader'], ['f-next', 'manual'], ['f-traffic', 'traffic']]) $(id).classList.toggle('on', m === mode);
  }
  const runningCars = () => ui.trainer.cars.filter(c => !c.crashed && !c.finished);
  function followNext() {
    if (ui.mode !== 'train') return;
    const cs = runningCars();
    if (!cs.length) return;
    const i = cs.indexOf(ui.followCar);
    setFollow('manual', cs[(i + 1) % cs.length]);
  }
  // Auto, které má nejblíž před sebou pomalé auto – tam je vidět, jak síť používá nové vstupy.
  function carNearTraffic() {
    let best = null;
    for (const c of runningCars()) {
      const a = c.sensors && c.sensors.carAhead;
      if (a && a.car.isTraffic && (!best || a.dist < best.sensors.carAhead.dist)) best = c;
    }
    return best;
  }
  $('f-leader').addEventListener('click', () => setFollow('leader'));
  $('f-next').addEventListener('click', followNext);
  $('f-traffic').addEventListener('click', () => {
    if (!ui.trainer.roundTraffic) { toast('Teď na trati žádná pomalá auta nejsou – zapni „Předjíždění“ v nastavení.'); return; }
    setFollow('traffic', carNearTraffic());
  });
  $('game').addEventListener('click', e => {
    if (ui.mode !== 'train') return;
    const r = renderer, dpr = r.dpr;
    const wx = (e.clientX * dpr - r.ox) / r.scale, wy = (e.clientY * dpr - r.oy) / r.scale;
    let best = null, bd = 30 * 30;
    for (const c of runningCars()) {
      const d = (c.x - wx) ** 2 + (c.y - wy) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (best) setFollow('manual', best);
  });

  // Vrátí auto, které se má právě sledovat (a případně vybere nové).
  function followed(elapsed) {
    const t = ui.trainer, c = ui.followCar;
    const valid = c && t.cars.includes(c) && !c.crashed && !c.finished;
    if (ui.follow === 'manual') {
      if (valid) return c;
      setFollow('leader');
    } else if (ui.follow === 'traffic') {
      // u pomalého auta: když sledované auto předjelo/havarovalo, přeskoč na další u pomalého auta
      const near = valid && c.sensors.carAhead && c.sensors.carAhead.car.isTraffic;
      ui.followIdle = near ? 0 : ui.followIdle + elapsed;
      if (!valid || ui.followIdle > 1.2) { ui.followCar = carNearTraffic() || (valid ? c : null); ui.followIdle = 0; }
      if (ui.followCar) return ui.followCar;
    }
    return t.leader();
  }

  // ---- texty pro děti -------------------------------------------------------------
  let toastTimer = 0;
  function toast(text, secs = 4) {
    $('toast').innerHTML = text;
    $('toast').classList.remove('hidden');
    toastTimer = secs;
  }

  function storyText() {
    const t = ui.trainer;
    if (ui.mode === 'champ') {
      const sees = ui.champ.driver.net.sizes[0] > F1.INPUTS;
      if (ui.champTraffic) {
        return `Tohle je <b>${ui.champLabel}</b> (žluté auto) a před ní jedou <b>pomalá auta</b>. ` + (sees
          ? `Její mozek má vstupy o autě vpředu (modrá čára ukazuje, které auto vidí). Naučila se sama, že se dá objet?`
          : `Její mozek ale vidí <b>jen okraje trati</b>, ne jiná auta. Pozná, že má před sebou překážku?`);
      }
      return `Tohle je <b>${ui.champLabel}</b> (žluté auto). Jede proti třem botům, které naprogramoval člověk pravidly
        „zatoč tam, kde je víc místa“. Síti nikdo žádná pravidla neřekl – naučila se to sama tím, že přežívali ti lepší.`;
    }
    const n = t.opts.population;
    if (t.generation === 0 && ui.paused && t.race.time === 0) {
      return `Každé z <b>${n} aut</b> má v sobě malou neuronovou síť – „mozek“ s náhodnými váhami.
        Až budeš připraven, stiskni <b>▶ Spustit trénink</b> (nebo mezerník).`;
    }
    const h = t.history[t.history.length - 1];
    if (t.opts.traffic > 0) {
      return `<b>Generace ${t.generation} – učíme se předjíždět.</b> Šedá auta jsou pomalá; kdo do nich narazí, končí.
        Každá trať se jede dvakrát: s provozem a prázdná, ať síť nezapomene jezdit sama. Skóre = kam auto dojede za
        ${t.opts.trafficTime} s – kdo se jen veze za pomalým autem, moc daleko nedojede.` +
        (h ? ` Nejlepší minulé generace: <b>${h.best.toFixed(2)}</b>.` : ` Tlačítkem <b>U pomalého auta</b> uvidíš, jak mozek reaguje na auto vpředu.`);
    }
    if (t.generation === 0 && ui.seeded) {
      return `Mozky této generace vznikly z <b>nahrané sítě</b> – jedno auto ji má přesně, ostatní ji mají trochu pozměněnou
        (<b>mutace</b>). Uvidíme, jestli se některé zlepší.`;
    }
    if (t.generation === 0) {
      return `Každé z <b>${n} aut</b> má v sobě malou neuronovou síť – „mozek“. Ten dostává 7 čísel (co auto vidí)
        a vrací 2 čísla: <b>volant</b> a <b>plyn/brzdu</b>. Teď jsou mozky úplně <b>náhodné</b>, proto auta bloudí a bourají.
        Nikdo jim neřekl, jak se řídí!`;
    }
    return `<b>Generace ${t.generation}.</b> Tyhle mozky vznikly z nejlepších aut minulé generace: zkombinovaly se
      (<b>křížení</b>) a trochu náhodně pozměnily (<b>mutace</b>). Nejlepší auto minulé generace ujelo <b>${h.best.toFixed(2)} kola</b>.
      Žlutý kroužek = auto, které teď vede – jeho mozek vidíš vpravo.`;
  }

  // ---- kreslení sítě ------------------------------------------------------------------
  function setupCanvas(c) {
    const dpr = window.devicePixelRatio || 1;
    if (!c._w) { c._w = c.width; c._h = c.height; }
    if (c.width !== c._w * dpr) { c.width = c._w * dpr; c.height = c._h * dpr; }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c._w, c._h);
    return ctx;
  }

  const IN_LABELS = ['vlevo 60°', 'vlevo 30°', 'rovně', 'vpravo 30°', 'vpravo 60°', 'rychlost', 'úhel',
    'auto: daleko', 'auto: strana', 'auto: blíží se'];
  const OUT_LABELS = ['volant', 'plyn/brzda'];

  function drawNet(net) {
    const c = $('net');
    if (!net) return;
    if (!c._w) { c._w = c.width; c._h = c.height; }
    const wantH = Math.max(250, net.sizes[0] * 29 + 30);   // víc vstupů = vyšší obrázek
    if (c._h !== wantH) { c._h = wantH; c.width = 0; }
    const ctx = setupCanvas(c), W = c._w, H = c._h;
    const L = net.sizes.length;
    const xs = net.sizes.map((_, l) => 78 + l * (W - 78 - 92) / (L - 1));
    const pos = net.sizes.map((n, l) => Array.from({ length: n }, (_, j) => ({ x: xs[l], y: (H / (n + 1)) * (j + 1) })));
    const act = net.activations;

    // váhy (čáry): barva = znaménko, tloušťka = velikost, jas = kolik signálu jimi právě teče
    for (let l = 0; l < L - 1; l++) {
      for (let j = 0; j < net.sizes[l + 1]; j++) {
        for (let i = 0; i < net.sizes[l]; i++) {
          const w = net.weights[net.weightIndex(l, j, i)];
          const flow = Math.min(1, Math.abs(w * act[l][i]));
          ctx.strokeStyle = w > 0 ? '#3ecf6e' : '#ff5a5a';
          ctx.globalAlpha = 0.08 + 0.8 * flow;
          ctx.lineWidth = Math.min(4, 0.4 + Math.abs(w) * 0.9);
          ctx.beginPath(); ctx.moveTo(pos[l][i].x, pos[l][i].y); ctx.lineTo(pos[l + 1][j].x, pos[l + 1][j].y); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    // neurony: žlutá = kladná hodnota, modrá = záporná
    ctx.font = '11px Segoe UI, sans-serif';
    for (let l = 0; l < L; l++) {
      for (let j = 0; j < net.sizes[l]; j++) {
        const p = pos[l][j], a = act[l][j];
        ctx.fillStyle = '#23272e'; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = a >= 0 ? `rgba(255,216,77,${Math.min(1, a)})` : `rgba(90,160,255,${Math.min(1, -a)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#8a9099'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#d8dbe0';
        if (l === 0) {
          ctx.textAlign = 'right';
          ctx.fillText(IN_LABELS[j] || 'vstup ' + j, p.x - 14, p.y - 1);
          ctx.fillStyle = '#8a9099'; ctx.fillText(a.toFixed(2), p.x - 14, p.y + 10);
        } else if (l === L - 1) {
          ctx.textAlign = 'left';
          ctx.fillText(OUT_LABELS[j], p.x + 14, p.y - 1);
          const txt = j === 0 ? (a < -0.15 ? '◄ doleva' : a > 0.15 ? 'doprava ►' : 'rovně')
            : (a > 0.05 ? 'plyn ' + Math.round(a * 100) + ' %' : a < -0.05 ? 'brzda ' + Math.round(-a * 100) + ' %' : 'nic');
          ctx.fillStyle = '#8a9099'; ctx.fillText(txt, p.x + 14, p.y + 11);
        }
      }
    }
    ctx.textAlign = 'center'; ctx.fillStyle = '#8a9099';
    ctx.fillText('vstupy', xs[0], 10);
    if (L > 2) ctx.fillText('skrytá vrstva', xs[1], 10);
    ctx.fillText('výstupy', xs[L - 1], 10);
  }

  // ---- graf skóre generací -----------------------------------------------------------
  const chart = { hover: null };
  const tip = document.createElement('div');
  tip.id = 'chart-tip'; tip.className = 'hidden'; document.body.appendChild(tip);
  $('chart').addEventListener('mousemove', e => {
    const r = $('chart').getBoundingClientRect();
    chart.hover = { x: (e.clientX - r.left) * ($('chart')._w / r.width), cx: e.clientX, cy: e.clientY };
    drawChart();
  });
  $('chart').addEventListener('mouseleave', () => { chart.hover = null; tip.classList.add('hidden'); drawChart(); });

  function drawChart() {
    const c = $('chart'), ctx = setupCanvas(c), W = c._w, H = c._h;
    const hist = ui.trainer.history;
    const pad = { l: 30, r: 46, t: 8, b: 20 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    let ymax = 1;
    for (const h of hist) ymax = Math.max(ymax, h.best);
    ymax = Math.ceil(ymax * 1.1);
    const n = Math.max(2, hist.length);
    const X = i => pad.l + (i / (n - 1)) * pw, Y = v => pad.t + ph - (v / ymax) * ph;

    // mřížka a osy (nenápadné)
    ctx.font = '10px Segoe UI, sans-serif'; ctx.fillStyle = '#8a9099'; ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    const step = ymax <= 5 ? 1 : Math.ceil(ymax / 5);
    ctx.textAlign = 'right';
    for (let v = 0; v <= ymax; v += step) {
      ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(pad.l + pw, Y(v)); ctx.stroke();
      ctx.fillText(v, pad.l - 5, Y(v) + 3);
    }
    ctx.textAlign = 'center';
    ctx.fillText('generace', pad.l + pw / 2, H - 4);
    if (!hist.length) { ctx.fillText('graf se objeví po první generaci', pad.l + pw / 2, pad.t + ph / 2); return; }
    ctx.textAlign = 'left'; ctx.fillText('0', pad.l, H - 4);
    ctx.textAlign = 'right'; ctx.fillText(hist.length - 1, pad.l + pw, H - 4);

    // od které generace se trénuje předjíždění (skóre se pak počítá jinak)
    const firstTraffic = hist.findIndex(h => h.traffic);
    if (firstTraffic >= 0) {
      ctx.fillStyle = 'rgba(255,216,77,.07)';
      ctx.fillRect(X(Math.max(0, firstTraffic - 0.5)), pad.t, pad.l + pw - X(Math.max(0, firstTraffic - 0.5)), ph);
      ctx.fillStyle = '#c9b25a'; ctx.textAlign = 'left';
      ctx.fillText('předjíždění', X(Math.max(0, firstTraffic - 0.5)) + 4, pad.t + 10);
    }
    const line = (key, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath();
      hist.forEach((h, i) => (i ? ctx.lineTo(X(i), Y(h[key])) : ctx.moveTo(X(i), Y(h[key]))));
      ctx.stroke();
      if (hist.length === 1) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(0), Y(hist[0][key]), 4, 0, Math.PI * 2); ctx.fill(); }
    };
    line('avg', COLOR_AVG);
    line('best', COLOR_BEST);
    // popisky posledních hodnot
    const last = hist[hist.length - 1];
    ctx.textAlign = 'left'; ctx.fillStyle = '#d8dbe0';
    let yb = Y(last.best), ya = Y(last.avg);
    if (Math.abs(yb - ya) < 12) { if (yb < ya) ya = yb + 12; else yb = ya + 12; }
    ctx.fillText(last.best.toFixed(2), pad.l + pw + 6, yb + 3);
    ctx.fillText(last.avg.toFixed(2), pad.l + pw + 6, ya + 3);

    // hover: svislá čára + tooltip
    if (chart.hover) {
      const i = Math.round(((chart.hover.x - pad.l) / pw) * (n - 1));
      if (i >= 0 && i < hist.length) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X(i), pad.t); ctx.lineTo(X(i), pad.t + ph); ctx.stroke();
        for (const [k, col] of [['best', COLOR_BEST], ['avg', COLOR_AVG]]) {
          ctx.fillStyle = col; ctx.strokeStyle = '#15181d'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(X(i), Y(hist[i][k]), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        const h = hist[i];
        tip.innerHTML = `Generace ${h.generation}<br>nejlepší: ${h.best.toFixed(2)}<br>průměr: ${h.avg.toFixed(2)}<br>všude v cíli: ${h.finished}`;
        tip.style.left = chart.hover.cx + 12 + 'px'; tip.style.top = chart.hover.cy - 70 + 'px';
        tip.classList.remove('hidden');
      }
    }
  }

  // ---- smyčka ---------------------------------------------------------------------------
  function currentRace() { return ui.mode === 'champ' ? ui.champRace : ui.trainer.race; }

  function onGenerationDone() {
    const h = ui.trainer.history[ui.trainer.history.length - 1];
    const tracks = ui.trainer.opts.tracks.length;
    toast(`<b>Generace ${h.generation} hotová.</b> Nejlepší auto ujelo ${h.best.toFixed(2)} kola` +
      (tracks > 1 ? ` (součet za ${tracks} tratě)` : '') + `, všude do cíle dojelo ${h.finished} z ${ui.trainer.opts.population}.`);
    drawChart();
  }

  function simulate() {
    if (ui.mode === 'champ') {
      const race = ui.champRace;
      const ch = ui.champ;
      if (!race.isOver() && !ch.finished && !ch.crashed) {
        race.step(DT);
        // počítáme nárazy do jiných aut
        const touching = race.cars.some(o => o !== ch && Math.hypot(o.x - ch.x, o.y - ch.y) < 2 * F1.PHYS.carRadius + 0.5);
        if (touching && !ui.champTouching) ui.champHits++;
        ui.champTouching = touching;
      } else if (!ui.champDone) {
        ui.champDone = true;
        const st = race.standings(), pos = st.indexOf(ch) + 1;
        const hits = ui.champHits ? `, do jiných aut narazila ${ui.champHits}×` : ', do nikoho nenarazila';
        if (ch.crashed) toast('Síť havarovala – tuhle trať ještě nezná. Přidej ji v „Nastavení tréninku“ a nech síť učit dál.', 8);
        else if (ui.champTraffic) {
          const passed = race.cars.filter(o => o !== ch && o.distance < ch.distance).length;
          toast(`Síť dojela 2 kola za ${ch.finishTime.toFixed(2)} s, předjela <b>${passed} ze 4</b> pomalých aut${hits}.` +
            (ch.driver.net.sizes[0] === F1.INPUTS ? ' Tahle síť jiná auta vůbec nevidí!' : ''), 10);
        } else toast(`Síť dojela <b>${pos}. z ${st.length}</b> za ${ch.finishTime.toFixed(2)} s${hits}.`, 8);
      } else race.step(DT); // ostatní dojíždějí
      return;
    }
    const t = ui.trainer;
    if (ui.speed === 0) {
      const t0 = performance.now();
      while (performance.now() - t0 < 14) if (t.step(DT)) onGenerationDone();
    } else {
      for (let k = 0; k < ui.speed; k++) if (t.step(DT)) onGenerationDone();
    }
  }

  let last = performance.now(), slow = 0;
  function frame(now) {
    const elapsed = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!ui.paused) simulate();

    const race = currentRace();
    if (ui.shownTrack !== race.track) { ui.shownTrack = race.track; renderer.setTrack(race.track); renderer.clearSkids(); }
    let selected, net;
    if (ui.mode === 'champ') { selected = ui.champ; net = ui.champ.driver.net; }
    else { selected = followed(ui.paused ? 0 : elapsed); net = selected.net; }
    renderer.draw(race, {
      selected,
      noSkids: ui.mode === 'train',
      alpha: c => (c.crashed ? 0.18 : ui.mode === 'train' && c.ghost ? 0.6 : 1),
      time: now / 1000,
    });
    drawNet(net);

    slow += elapsed;
    if (slow > 0.15) {
      slow = 0;
      const t = ui.trainer;
      $('st-gen').textContent = t.generation;
      const rounds = t.rounds.length;
      $('st-track').textContent = race.track.name.replace(/ \(.*\)/, '') +
        (ui.mode === 'train' && rounds > 1 ? ` (${t.round + 1}/${rounds}${t.opts.traffic ? (t.roundTraffic ? ', provoz' : ', prázdná') : ''})` : '');
      $('st-alive').textContent = ui.mode === 'train' ? `${t.alive} z ${t.opts.population}` : '–';
      $('st-time').textContent = race.raceTime.toFixed(1) + ' s';
      $('net-who').textContent = ui.mode === 'champ' ? '(šampion)'
        : { leader: '(vedoucí auto)', manual: `(${selected.name})`, traffic: `(${selected.name} u pomalého auta)` }[ui.follow];
      $('f-traffic').classList.toggle('dim', !ui.trainer.roundTraffic);
      $('story').innerHTML = storyText();
    }
    if (toastTimer > 0) { toastTimer -= elapsed; if (toastTimer <= 0) $('toast').classList.add('hidden'); }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => renderer.resize());
  newTrainer();
  drawChart();
  requestAnimationFrame(frame);
  window.trainUI = ui; // pro ladění v konzoli
})();
