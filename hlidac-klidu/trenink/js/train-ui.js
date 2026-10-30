/*
 * Trénovací stránka: celá generace hlídačů slouží stejnou směnu (každý ve své místnosti),
 * vidíme místnost nejlepšího z nich, ostatní jsou jen tečky. Vedle je živě vidět
 * mozek sledovaného hlídače a graf, jak se generace zlepšují.
 */
(function () {
  'use strict';
  const HK = window.HK;
  const $ = id => document.getElementById(id);
  const SIDEBAR = 410;
  const DT = 1 / 60;
  const COLOR_BEST = '#3987e5', COLOR_AVG = '#d95926';
  const SCENARIOS = [1, 2, 3, 4, 5];

  const renderer = new window.Renderer($('game'), { sidebar: SIDEBAR });
  const ui = {
    mode: 'train',          // 'train' | 'champ'
    paused: true,           // po otevření stránky trénink čeká na „Spustit“
    speed: 1,               // kroky simulace za snímek; 0 = co nejrychleji
    settings: { scenarios: [1], population: 40, hidden: 8, mutationSize: 0.5, deskCollisions: false, messes: true },
    trainer: null,
    champWorld: null,
    follow: 'leader',       // koho sleduje "Mozek hlídače": 'leader' | 'manual'
    followWorld: null,
    botScore: null,         // skóre pravidlového bota na trénovaných směnách (čárkovaná čára v grafu)
  };

  // ---- nastavení ------------------------------------------------------------
  SCENARIOS.forEach(s => {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" value="${s}" ${s === 1 ? 'checked' : ''}> ${s}.`;
    $('set-scen').appendChild(l);
    $('champ-scen').add(new Option(`směna ${s}`, s));
  });
  $('champ-scen').add(new Option('nová směna (náhodná)', 'new'));
  $('set-scen').addEventListener('change', () => {
    const sc = [...$('set-scen').querySelectorAll('input:checked')].map(i => +i.value);
    if (!sc.length) { $('set-scen').querySelector('input').checked = true; sc.push(1); }
    ui.settings.scenarios = sc;
    ui.trainer.setScenarios(sc);
    ui.trainer.restartGeneration();       // generace začne znovu hned na nových směnách
    updateBotScore();
    if (ui.mode === 'champ') backToTraining();
    toast('Generace ' + ui.trainer.generation + ' slouží znovu od začátku vybrané směny.');
  });
  $('set-desks').addEventListener('change', () => {
    ui.settings.deskCollisions = $('set-desks').checked;
    ui.trainer.setDeskCollisions(ui.settings.deskCollisions);
    ui.trainer.restartGeneration();
    updateBotScore();
    if (ui.mode === 'champ') backToTraining();
    toast(ui.settings.deskCollisions
      ? 'Lavice jsou teď <b>pevné</b> a objevily se v <b>paprscích</b> (vstupy „překážka →, ↘…“). Do teď paprsky viděly jen stěny – ' +
        'naučí se síť lavice obcházet?'
      : 'Hlídač zase prochází lavicemi.', 7);
  });
  $('set-messes').addEventListener('change', () => {
    ui.settings.messes = $('set-messes').checked;
    ui.trainer.next = Object.assign(ui.trainer.next || {}, { messes: ui.settings.messes });
    ui.trainer.restartGeneration();
    updateBotScore();
    if (ui.mode === 'champ') backToTraining();
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
  bindRange('set-pop', 'population', v => v + ' (platí po „Začít znovu“)');
  bindRange('set-hid', 'hidden', v => v + ' (platí po „Začít znovu“)');
  bindRange('set-mut', 'mutationSize', v => v.toFixed(1), v => { ui.trainer.opts.mutationSize = v; });
  $('b-reset').addEventListener('click', () => { newTrainer(); toast('Nová generace 0 – všechny mozky jsou zase náhodné.'); });

  function newTrainer() {
    const s = ui.settings;
    ui.seeded = false;
    ui.trainer = new HK.Trainer({
      scenarios: s.scenarios, population: s.population, hidden: [s.hidden], mutationSize: s.mutationSize,
      deskCollisions: s.deskCollisions, messes: s.messes,
    });
    updateBotScore();
    backToTraining();
    drawChart();
  }

  // Pravidlový bot odslouží stejné směny – pro srovnání v grafu.
  function updateBotScore() {
    const s = ui.settings;
    ui.botScore = s.scenarios.reduce((sum, seed) =>
      sum + HK.fitness(HK.playShift(new HK.RuleBasedGuard(), { seed, deskCollisions: s.deskCollisions, messes: s.messes })), 0);
    drawChart();
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

  // Klávesnice: ve hře za sebe (režim „hlídám já“) jako v původní hře, jinak ovládání stránky.
  const keys = new Set();
  const humanMode = () => ui.mode === 'champ' && ui.champWho === 'human';
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (humanMode() && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', ' '].includes(k)) {
      e.preventDefault();
      keys.add(k);
      return;
    }
    if (e.code === 'Space') { e.preventDefault(); $('b-play').click(); }
    if (e.code === 'Tab') { e.preventDefault(); followNext(); }
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  const KeyboardGuard = {
    control() {
      const x = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
      const y = (keys.has('arrowdown') || keys.has('s') ? 1 : 0) - (keys.has('arrowup') || keys.has('w') ? 1 : 0);
      const act = keys.has(' ');
      keys.delete(' ');                       // mezerník = jeden stisk, ne držení
      return { x, y, act };
    },
  };

  function showChampion() {
    const who = $('champ-who').value;
    if (who === 'champ' && !ui.trainer.bestEver) { toast('Šampion zatím není – počkej, až doběhne aspoň první generace.'); return; }
    const v = $('champ-scen').value;
    const seed = v === 'new' ? 1000 + Math.floor(Math.random() * 1e6) : +v;
    const opts = { seed, deskCollisions: ui.settings.deskCollisions, messes: ui.settings.messes };
    const driver = who === 'champ' ? new HK.NeuralGuard(ui.trainer.bestEver.net.clone())
      : who === 'bot' ? new HK.RuleBasedGuard() : KeyboardGuard;
    ui.champWorld = new HK.World(Object.assign({ driver }, opts));
    ui.champWho = who;
    ui.champLabel = who === 'champ' ? `šampion z generace ${ui.trainer.bestEver.generation}` : who === 'bot' ? 'pravidlový bot' : 'ty';
    ui.champScen = v === 'new' ? 'nová směna' : `směna ${seed}`;
    ui.champTrained = v !== 'new' && ui.trainer.opts.scenarios.includes(seed);
    // Bot na stejné směně pro srovnání (spočítá se hned, bez kreslení).
    ui.champBot = HK.playShift(new HK.RuleBasedGuard(), opts);
    ui.champDone = false;
    ui.mode = 'champ';
    keys.clear();
    setSpeed(1);
    setPaused(false);
    $('b-champ').textContent = '⏹ Zpět k tréninku';
  }
  $('b-champ').addEventListener('click', () => (ui.mode === 'champ' ? backToTraining() : showChampion()));
  $('champ-scen').addEventListener('change', () => { if (ui.mode === 'champ') showChampion(); });
  $('champ-who').addEventListener('change', () => {
    $('b-champ').textContent = ui.mode === 'champ' ? '⏹ Zpět k tréninku' : { champ: '🏆 Předvést šampiona', bot: '🤖 Předvést bota', human: '🎮 Hrát sám' }[$('champ-who').value];
    if (ui.mode === 'champ') showChampion();
  });

  // ---- uložení / nahrání sítě ---------------------------------------------------
  $('b-save').addEventListener('click', () => {
    if (!ui.trainer.bestEver) { toast('Zatím není co uložit – počkej na konec první generace.'); return; }
    const blob = new Blob([JSON.stringify(ui.trainer.bestEver.net.toJSON())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hlidac-mozek-generace-${ui.trainer.bestEver.generation}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('b-load').addEventListener('click', () => $('f-load').click());
  $('f-load').addEventListener('change', async () => {
    const f = $('f-load').files[0];
    if (!f) return;
    try {
      const net = HK.NeuralNet.fromJSON(JSON.parse(await f.text()));
      if (net.sizes[0] !== HK.INPUTS || net.sizes[net.sizes.length - 1] !== HK.OUTPUTS) throw new Error('jiný tvar sítě');
      seedFrom(net, 'Nahraný mozek je základem nové populace.');
    } catch (e) { toast('Tenhle soubor neumím přečíst.'); }
    $('f-load').value = '';
  });
  $('b-pre').addEventListener('click', () => {
    if (ui.settings.deskCollisions && HK.PRETRAINED_COLLISIONS) {
      seedFrom(HK.NeuralNet.fromJSON(HK.PRETRAINED_COLLISIONS), 'Načtena předtrénovaná síť trénovaná <b>s lavicemi</b> (navazuje na síť bez lavic). Lavice zvládá jen napůl – zkus ji trénovat dál.');
    } else if (HK.PRETRAINED) {
      seedFrom(HK.NeuralNet.fromJSON(HK.PRETRAINED), 'Načtena předtrénovaná síť (směny 1–3, <b>bez lavic</b>). Další generace vznikají z ní.');
    } else toast('Předtrénovaná síť chybí – vytvoř ji: node tools/train-headless.js 120 1,2,3 --save');
  });

  function seedFrom(net, msg) {
    ui.settings.hidden = net.sizes[1];
    $('set-hid').value = net.sizes[1]; $('set-hid-v').textContent = net.sizes[1];
    ui.trainer.seed(net);
    ui.seeded = true;
    backToTraining();
    toast(msg);
  }

  // ---- kterého hlídače sleduje "Mozek hlídače" ---------------------------------------
  function setFollow(mode, world = null) {
    ui.follow = mode; ui.followWorld = world;
    $('f-leader').classList.toggle('on', mode === 'leader');
    $('f-next').classList.toggle('on', mode === 'manual');
  }
  const runningWorlds = () => ui.trainer.worlds.filter(w => !w.over);
  function followNext() {
    if (ui.mode !== 'train') return;
    const ws = runningWorlds();
    if (!ws.length) return;
    setFollow('manual', ws[(ws.indexOf(ui.followWorld) + 1) % ws.length]);
  }
  $('f-leader').addEventListener('click', () => setFollow('leader'));
  $('f-next').addEventListener('click', followNext);
  $('game').addEventListener('click', e => {
    if (ui.mode !== 'train') return;
    const p = renderer.toWorld(e.clientX, e.clientY);
    let best = null, bd = 30 * 30;
    for (const w of runningWorlds()) {
      const d = (w.player.x - p.x) ** 2 + (w.player.y - p.y) ** 2;
      if (d < bd) { bd = d; best = w; }
    }
    if (best) setFollow('manual', best);
  });

  function followed() {
    const t = ui.trainer, w = ui.followWorld;
    if (ui.follow === 'manual') {
      if (w && t.worlds.includes(w) && !w.over) return w;
      setFollow('leader');
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
      if (ui.champWho === 'human') return `Hlídáš <b>ty</b> (${ui.champScen}): šipky/WASD a mezerník. Lavice ${ui.settings.deskCollisions ? 'jsou pevné' : 'jsou průchozí'} – stejně jako pro síť.`;
      if (ui.champWho === 'bot') return `Tohle je <b>pravidlový bot</b>: člověk mu napsal „jdi k nejbližšímu problému a zasáhni“. Síť taková pravidla nedostala.`;
      return `Tohle je <b>${ui.champLabel}</b> na směně, ${ui.champTrained ? 'kterou <b>zná z tréninku</b>' : 'kterou <b>nikdy neviděl</b>'}.
        Modré čáry = co vidí: směr a vzdálenost ke všem narušitelům. Pravidla „jdi tam a zasáhni“ mu nikdo neřekl – naučil se je sám.`;
    }
    const n = t.opts.population;
    if (t.generation === 0 && ui.paused && t.time === 0) {
      return `Každý z <b>${n} hlídačů</b> má v sobě malou neuronovou síť – „mozek“ s náhodnými váhami.
        Až budeš připraven, stiskni <b>▶ Spustit trénink</b> (nebo mezerník).`;
    }
    const h = t.history[t.history.length - 1];
    if (t.generation === 0 && ui.seeded) {
      return `Mozky této generace vznikly z <b>nahrané sítě</b> – jeden hlídač ji má přesně, ostatní trochu pozměněnou (<b>mutace</b>).`;
    }
    if (t.generation === 0) {
      return `Každý z <b>${n} hlídačů</b> má vlastní třídu a malou neuronovou síť. Ta dostává ${HK.INPUTS} čísel (kde kdo zlobí, kam
        až dojde, než narazí…) a vrací 3: <b>kam jít</b> (vodorovně, svisle) a <b>jestli zasáhnout</b>. Mozky jsou zatím <b>náhodné</b>,
        proto hlídači bloudí a „utišují“ prázdný vzduch. Vidíš třídu nejlepšího z nich, ostatní jsou barevné tečky.`;
    }
    return `<b>Generace ${t.generation}.</b> Tyhle mozky vznikly z nejlepších hlídačů minulé generace: zkombinovaly se
      (<b>křížení</b>) a trochu náhodně pozměnily (<b>mutace</b>). Nejlepší minulé generace: <b>${h.best.toFixed(2)}</b>
      ${ui.botScore != null ? `(pravidlový bot: ${ui.botScore.toFixed(2)})` : ''}.`;
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

  const OUT_LABELS = ['vlevo / vpravo', 'nahoru / dolů', 'utišit'];

  function drawNet(net) {
    const c = $('net');
    if (!net) return;
    const ctx = setupCanvas(c), W = c._w, H = c._h;
    const L = net.sizes.length;
    const xs = net.sizes.map((_, l) => 112 + l * (W - 112 - 96) / (L - 1));
    const pos = net.sizes.map((n, l) => Array.from({ length: n }, (_, j) => ({ x: xs[l], y: 18 + ((H - 24) / n) * (j + 0.5) })));
    const act = net.activations;
    const r = l => (l === 0 ? 4.5 : 8);

    // váhy (čáry): barva = znaménko, tloušťka = velikost, jas = kolik signálu jimi právě teče
    for (let l = 0; l < L - 1; l++) {
      for (let j = 0; j < net.sizes[l + 1]; j++) {
        for (let i = 0; i < net.sizes[l]; i++) {
          const w = net.weights[net.weightIndex(l, j, i)];
          const flow = Math.min(1, Math.abs(w * act[l][i]));
          ctx.strokeStyle = w > 0 ? '#3ecf6e' : '#ff5a5a';
          ctx.globalAlpha = 0.03 + 0.8 * flow;
          ctx.lineWidth = Math.min(3, 0.3 + Math.abs(w) * 0.7);
          ctx.beginPath(); ctx.moveTo(pos[l][i].x, pos[l][i].y); ctx.lineTo(pos[l + 1][j].x, pos[l + 1][j].y); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    // neurony: žlutá = kladná hodnota, modrá = záporná
    for (let l = 0; l < L; l++) {
      for (let j = 0; j < net.sizes[l]; j++) {
        const p = pos[l][j], a = act[l][j];
        ctx.fillStyle = '#23272e'; ctx.beginPath(); ctx.arc(p.x, p.y, r(l), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = a >= 0 ? `rgba(255,216,77,${Math.min(1, a)})` : `rgba(90,160,255,${Math.min(1, -a)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, r(l), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#8a9099'; ctx.lineWidth = 1; ctx.stroke();
        if (l === 0) {
          ctx.font = '9px Segoe UI, sans-serif'; ctx.textAlign = 'right';
          ctx.fillStyle = a !== 0 ? '#d8dbe0' : '#5d636b';
          ctx.fillText(HK.INPUT_LABELS[j], p.x - 8, p.y + 3);
        } else if (l === L - 1) {
          ctx.font = '11px Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#d8dbe0';
          ctx.fillText(OUT_LABELS[j], p.x + 12, p.y - 1);
          const txt = j === 2 ? (a > 0 ? 'ANO' : 'ne') : (j === 0 ? (a < -0.1 ? '◄ ' : a > 0.1 ? '► ' : '') : (a < -0.1 ? '▲ ' : a > 0.1 ? '▼ ' : '')) + a.toFixed(2);
          ctx.fillStyle = '#8a9099'; ctx.fillText(txt, p.x + 12, p.y + 11);
        }
      }
    }
    ctx.font = '11px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#8a9099';
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
    if (!ui.trainer) return;
    const c = $('chart'), ctx = setupCanvas(c), W = c._w, H = c._h;
    const hist = ui.trainer.history;
    const pad = { l: 30, r: 46, t: 8, b: 20 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    let ymax = Math.max(1, ui.botScore || 0);
    for (const h of hist) ymax = Math.max(ymax, h.best);
    ymax = Math.ceil(ymax * 1.1);
    const n = Math.max(2, hist.length);
    const X = i => pad.l + (i / (n - 1)) * pw, Y = v => pad.t + ph - (v / ymax) * ph;

    ctx.font = '10px Segoe UI, sans-serif'; ctx.fillStyle = '#8a9099'; ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    const step = ymax <= 5 ? 1 : Math.ceil(ymax / 5);
    ctx.textAlign = 'right';
    for (let v = 0; v <= ymax; v += step) {
      ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(pad.l + pw, Y(v)); ctx.stroke();
      ctx.fillText(v, pad.l - 5, Y(v) + 3);
    }
    // pravidlový bot na stejných směnách
    if (ui.botScore != null) {
      ctx.strokeStyle = '#9aa0a6'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pad.l, Y(ui.botScore)); ctx.lineTo(pad.l + pw, Y(ui.botScore)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = 'left'; ctx.fillStyle = '#9aa0a6'; ctx.fillText('bot', pad.l + 4, Y(ui.botScore) - 4);
      ctx.fillStyle = '#8a9099';
    }
    ctx.textAlign = 'center';
    ctx.fillText('generace', pad.l + pw / 2, H - 4);
    if (!hist.length) { ctx.fillText('graf se objeví po první generaci', pad.l + pw / 2, pad.t + ph / 2); return; }
    ctx.textAlign = 'left'; ctx.fillText('0', pad.l, H - 4);
    ctx.textAlign = 'right'; ctx.fillText(hist.length - 1, pad.l + pw, H - 4);

    const line = (key, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath();
      hist.forEach((h, i) => (i ? ctx.lineTo(X(i), Y(h[key])) : ctx.moveTo(X(i), Y(h[key]))));
      ctx.stroke();
      if (hist.length === 1) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(0), Y(hist[0][key]), 4, 0, Math.PI * 2); ctx.fill(); }
    };
    line('avg', COLOR_AVG);
    line('best', COLOR_BEST);
    const last = hist[hist.length - 1];
    ctx.textAlign = 'left'; ctx.fillStyle = '#d8dbe0';
    let yb = Y(last.best), ya = Y(last.avg);
    if (Math.abs(yb - ya) < 12) { if (yb < ya) ya = yb + 12; else yb = ya + 12; }
    ctx.fillText(last.best.toFixed(2), pad.l + pw + 6, yb + 3);
    ctx.fillText(last.avg.toFixed(2), pad.l + pw + 6, ya + 3);

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
        tip.innerHTML = `Generace ${h.generation}<br>nejlepší: ${h.best.toFixed(2)}<br>průměr: ${h.avg.toFixed(2)}<br>ustáli všechny směny: ${h.won}`;
        tip.style.left = chart.hover.cx + 12 + 'px'; tip.style.top = chart.hover.cy - 70 + 'px';
        tip.classList.remove('hidden');
      }
    }
  }

  // ---- smyčka ---------------------------------------------------------------------------
  function onGenerationDone() {
    const h = ui.trainer.history[ui.trainer.history.length - 1];
    const sc = ui.trainer.opts.scenarios.length;
    toast(`<b>Generace ${h.generation} hotová.</b> Nejlepší hlídač: ${h.best.toFixed(2)}` +
      (sc > 1 ? ` (součet za ${sc} směny)` : '') + `, všechny směny ustálo ${h.won} z ${ui.trainer.opts.population}.`);
    drawChart();
  }

  const describe = w => (w.result === 'won' ? 'směnu <b>ustál</b>' : `prohrál po <b>${w.elapsed.toFixed(0)} s</b>`) +
    `, zásahů ${w.score}, skóre ${HK.fitness(w).toFixed(2)}`;

  function simulate() {
    if (ui.mode === 'champ') {
      const w = ui.champWorld;
      if (!w.over) w.step(DT);
      else if (!ui.champDone) {
        ui.champDone = true;
        const who = { champ: 'Síť', bot: 'Bot', human: 'Ty jsi' }[ui.champWho];
        toast(`${who} ${describe(w)}` + (ui.champWho === 'human' ? '' : `, „utišit“ naprázdno ${w.misses}×`) + '.' +
          (ui.champWho !== 'bot' ? `<br>Pravidlový bot na stejné směně: ${describe(ui.champBot)}.` : ''), 10);
      }
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

    let world, label;
    if (ui.mode === 'champ') {
      world = ui.champWorld; label = ui.champLabel;
      renderer.draw(world, { label });
    } else {
      world = followed();
      label = ui.follow === 'leader' ? 'nejlepší hlídač' : `hlídač ${world.index + 1}`;
      // Ostatní hlídači mají vlastní třídy – kreslíme z nich jen polohu (barevné tečky).
      const ghosts = ui.trainer.worlds.filter(w => w !== world).map(w => ({ x: w.player.x, y: w.player.y, color: w.color, over: w.over }));
      renderer.draw(world, { ghosts, label });
    }
    drawNet(ui.mode === 'champ' ? (ui.champWho === 'champ' ? world.driver.net : null) : world.net);

    slow += elapsed;
    if (slow > 0.15) {
      slow = 0;
      const t = ui.trainer;
      $('st-gen').textContent = t.generation;
      const rounds = t.opts.scenarios.length;
      $('st-scen').textContent = ui.mode === 'champ' ? ui.champScen : `${t.scenario}${rounds > 1 ? ` (${t.round + 1}/${rounds})` : ''}`;
      $('st-alive').textContent = ui.mode === 'train' ? `${t.alive} z ${t.opts.population}` : '–';
      $('st-time').textContent = world.time.toFixed(1) + ' s';
      $('net-who').textContent = ui.mode === 'champ' ? (ui.champWho === 'champ' ? '(šampion)' : '(nehraje síť)') : `(${label})`;
      $('story').innerHTML = storyText();
    }
    if (toastTimer > 0) { toastTimer -= elapsed; if (toastTimer <= 0) $('toast').classList.add('hidden'); }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => renderer.resize());
  newTrainer();
  requestAnimationFrame(frame);
  window.trainUI = ui; // pro ladění v konzoli
})();
