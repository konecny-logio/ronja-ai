/*
 * Neuronová síť a její učení evolucí (genetickým algoritmem) – stejně jako u F1 závodů.
 *
 * Nikdo síti neříká, jak má hlídat. Jen:
 *   1) celá "generace" hlídačů s náhodnými mozky odslouží stejnou směnu,
 *   2) změříme, jak klidná byla místnost (fitness),
 *   3) nejlepší se stanou rodiči: jejich mozky zkombinujeme a trochu náhodně pozměníme (mutace),
 *   4) opakujeme.
 *
 * Bez DOM – běží v prohlížeči i v Node.js.
 */
(function (root) {
  'use strict';
  const HK = root.HK || (typeof require !== 'undefined' ? require('./engine.js') : null);

  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ---------------------------------------------------------------------
  // Neuronová síť: vstupy -> skryté vrstvy -> výstupy, aktivace tanh (-1..1).
  // Každý neuron má navíc "bias" (práh). Stejná třída jako v F1.
  // ---------------------------------------------------------------------
  class NeuralNet {
    constructor(sizes, weights) {
      this.sizes = sizes.slice();
      let n = 0;
      for (let l = 1; l < sizes.length; l++) n += (sizes[l - 1] + 1) * sizes[l];
      this.weights = weights ? Float64Array.from(weights) : Float64Array.from({ length: n }, () => gauss());
      this.activations = sizes.map(s => new Float64Array(s));
    }

    // weight(l, j, i): váha ze vstupu i vrstvy l do neuronu j vrstvy l+1 (i = počet vstupů -> bias)
    weightIndex(l, j, i) {
      let off = 0;
      for (let k = 1; k <= l; k++) off += (this.sizes[k - 1] + 1) * this.sizes[k];
      return off + j * (this.sizes[l] + 1) + i;
    }

    forward(inputs) {
      const a = this.activations, w = this.weights;
      for (let i = 0; i < this.sizes[0]; i++) a[0][i] = inputs[i];
      let off = 0;
      for (let l = 1; l < this.sizes.length; l++) {
        const nIn = this.sizes[l - 1], prev = a[l - 1], cur = a[l];
        for (let j = 0; j < this.sizes[l]; j++) {
          let sum = w[off + nIn]; // bias
          for (let i = 0; i < nIn; i++) sum += w[off + i] * prev[i];
          cur[j] = Math.tanh(sum);
          off += nIn + 1;
        }
      }
      return a[a.length - 1];
    }

    clone() { return new NeuralNet(this.sizes, this.weights); }

    // Mutace: každá váha se s pravděpodobností `rate` trochu náhodně posune.
    mutate(rate, size) {
      for (let i = 0; i < this.weights.length; i++) {
        if (Math.random() < rate) this.weights[i] += gauss() * size;
      }
      return this;
    }

    // Křížení: každý neuron (celý, i s jeho váhami) zdědí dítě od jednoho z rodičů.
    static crossover(a, b) {
      const child = a.clone();
      let off = 0;
      for (let l = 1; l < a.sizes.length; l++) {
        const len = a.sizes[l - 1] + 1;
        for (let j = 0; j < a.sizes[l]; j++) {
          if (Math.random() < 0.5) for (let i = 0; i < len; i++) child.weights[off + i] = b.weights[off + i];
          off += len;
        }
      }
      return child;
    }

    toJSON() { return { sizes: this.sizes, weights: Array.from(this.weights, v => +v.toFixed(5)) }; }
    static fromJSON(o) { return new NeuralNet(o.sizes, o.weights); }
  }

  // ---------------------------------------------------------------------
  // Hlídač řízený sítí. Vstupy = sensors.inputs (47 čísel). Výstupy = 3 čísla:
  //   výstup 0 -> chůze vlevo (−) / vpravo (+)
  //   výstup 1 -> chůze nahoru (−) / dolů (+)
  //   výstup 2 -> „Utišit“, když je kladný
  // ---------------------------------------------------------------------
  const OUTPUTS = 3;
  class NeuralGuard {
    constructor(net) { this.net = net; }
    control(sensors) {
      const out = this.net.forward(sensors.inputs);
      return { x: out[0], y: out[1], act: out[2] > 0 };
    }
  }

  // ---------------------------------------------------------------------
  // Trenér: jedna generace = každý hlídač odslouží stejné směny (scénáře = semínka náhody).
  // Každý hlídač má vlastní místnost – žáci, které utiší jeden, jsou u ostatních dál hluční.
  // ---------------------------------------------------------------------
  const DEFAULTS = {
    population: 40,
    hidden: [8],
    mutationRate: 0.1,    // kolik vah se při mutaci změní
    mutationSize: 0.5,    // jak moc
    elite: 2,             // kolik nejlepších přejde do další generace beze změny
    initWeight: 0.3,      // velikost náhodných vah na začátku (47 vstupů -> menší váhy, jinak neurony hned "přetečou")
    scenarios: [1],       // semínka směn; každá generace odslouží všechny a skóre se sečte
    deskCollisions: false,// zatím hlídač prochází lavicemi
    messes: true,         // padá na zem bordel (papírky, židle)
    duration: HK.RULES.duration,
  };

  class Trainer {
    constructor(opts = {}) {
      this.opts = Object.assign({}, DEFAULTS, opts);
      this.generation = 0;
      this.history = [];       // { generation, best, avg, won }
      this.bestEver = null;    // { net, fitness, generation }
      const sizes = [HK.INPUTS].concat(this.opts.hidden, [OUTPUTS]);
      this.nets = Array.from({ length: this.opts.population }, () => {
        const net = new NeuralNet(sizes);
        for (let i = 0; i < net.weights.length; i++) net.weights[i] *= this.opts.initWeight;
        return net;
      });
      this.startGeneration();
    }

    // Změna scénářů / kolizí platí od další generace (skóre přes jiné směny nejde srovnávat).
    setScenarios(list) { this.next = Object.assign(this.next || {}, { scenarios: list.slice() }); }
    setDeskCollisions(on) { this.next = Object.assign(this.next || {}, { deskCollisions: on }); }

    // Hned použije čekající změny a odehraje tuto generaci znovu se stejnými mozky.
    restartGeneration() { this.startGeneration(); }

    // Nová populace odvozená z jednoho mozku (např. nahraného ze souboru).
    seed(net) {
      const o = this.opts;
      o.hidden = net.sizes.slice(1, -1);
      this.nets = Array.from({ length: o.population }, (_, i) => (i === 0 ? net.clone() : net.clone().mutate(o.mutationRate, o.mutationSize)));
      this.bestEver = null;
      this.startGeneration();
    }

    startGeneration() {
      if (this.next) { Object.assign(this.opts, this.next); this.next = null; this.bestEver = null; }
      this.round = 0;                                   // kolikátou směnu (scénář) právě slouží
      this.scores = this.nets.map(() => 0);
      this.wonAll = this.nets.map(() => true);
      this.startRound();
    }

    startRound() {
      const o = this.opts;
      this.scenario = o.scenarios[this.round];
      this.worlds = this.nets.map((net, i) => {
        const world = new HK.World({ seed: this.scenario, deskCollisions: o.deskCollisions, messes: o.messes, duration: o.duration, driver: new NeuralGuard(net) });
        world.net = net;
        world.index = i;
        world.color = `hsl(${Math.round((i * 360) / this.nets.length)}, 75%, 50%)`;
        return world;
      });
    }

    fitness(world) { return HK.fitness(world); }

    get alive() { return this.worlds.filter(w => !w.over).length; }
    get time() { return this.worlds.reduce((t, w) => Math.max(t, w.time), 0); }

    // Leader = hlídač, který je právě nejlepší (pro sledování a vizualizaci).
    leader() {
      const running = this.worlds.filter(w => !w.over);
      const pool = running.length ? running : this.worlds;
      return pool.reduce((a, b) => (this.fitness(b) > this.fitness(a) ? b : a));
    }

    // Jeden krok simulace všech místností. Vrací true, když generace skončila (a začala nová).
    step(dt) {
      let alive = 0;
      for (const w of this.worlds) if (!w.over) { w.step(dt); if (!w.over) alive++; }
      if (alive === 0) {
        this.worlds.forEach((w, i) => { this.scores[i] += this.fitness(w); this.wonAll[i] = this.wonAll[i] && w.result === 'won'; });
        this.round++;
        if (this.round < this.opts.scenarios.length) this.startRound();
        else { this.evolve(); return true; }
      }
      return false;
    }

    evolve() {
      const o = this.opts;
      const scored = this.nets.map((net, i) => ({ net, fitness: this.scores[i], won: this.wonAll[i] }))
        .sort((a, b) => b.fitness - a.fitness);
      const avg = scored.reduce((s, x) => s + x.fitness, 0) / scored.length;
      this.history.push({ generation: this.generation, best: scored[0].fitness, avg, won: scored.filter(s => s.won).length });
      if (!this.bestEver || scored[0].fitness >= this.bestEver.fitness) {
        this.bestEver = { net: scored[0].net.clone(), fitness: scored[0].fitness, generation: this.generation };
      }

      // Rodiče: lepší polovina. Výběr "turnajem" – ze 3 náhodných vyhraje nejlepší.
      const parents = scored.slice(0, Math.max(2, Math.ceil(scored.length / 2)));
      const pick = () => {
        let best = null;
        for (let k = 0; k < 3; k++) {
          const p = parents[Math.floor(Math.random() * parents.length)];
          if (!best || p.fitness > best.fitness) best = p;
        }
        return best.net;
      };
      const next = scored.slice(0, o.elite).map(s => s.net.clone());
      while (next.length < o.population) {
        const child = Math.random() < 0.7 ? NeuralNet.crossover(pick(), pick()) : pick().clone();
        next.push(child.mutate(o.mutationRate, o.mutationSize));
      }
      this.nets = next;
      this.generation++;
      this.startGeneration();
    }
  }

  const NN = { NeuralNet, NeuralGuard, Trainer, TRAINER_DEFAULTS: DEFAULTS, OUTPUTS };
  if (HK) Object.assign(HK, NN);
  if (typeof module !== 'undefined' && module.exports) module.exports = NN;
})(typeof window !== 'undefined' ? window : globalThis);
