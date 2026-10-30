/*
 * Neuronová síť a její učení evolucí (genetickým algoritmem).
 *
 * Nikdo síti neříká, jak má řídit. Jen:
 *   1) necháme celou "generaci" aut s náhodnými mozky jet,
 *   2) změříme, kam která dojela (fitness),
 *   3) nejlepší se stanou rodiči: jejich mozky zkombinujeme a trochu náhodně pozměníme (mutace),
 *   4) opakujeme.
 *
 * Bez DOM – běží v prohlížeči i v Node.js.
 */
(function (root) {
  'use strict';
  const F1 = root.F1 || (typeof require !== 'undefined' ? require('./engine.js') : null);

  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ---------------------------------------------------------------------
  // Neuronová síť: vstupy -> skryté vrstvy -> výstupy, aktivace tanh (-1..1).
  // Každý neuron má navíc "bias" (práh).
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

    // Kopie sítě s víc vstupy. Nové vstupy mají váhu 0, takže síť se zatím chová
    // úplně stejně – nové "oči" začne používat, až ji to naučí evoluce.
    withInputs(n) {
      const old = this.sizes[0];
      if (n <= old) return this.clone();
      const net = new NeuralNet([n].concat(this.sizes.slice(1)));
      net.weights.fill(0);
      let src = 0, dst = 0;
      for (let j = 0; j < this.sizes[1]; j++) {
        for (let i = 0; i < old; i++) net.weights[dst + i] = this.weights[src + i];
        net.weights[dst + n] = this.weights[src + old]; // bias
        src += old + 1; dst += n + 1;
      }
      for (; src < this.weights.length; src++, dst++) net.weights[dst] = this.weights[src];
      return net;
    }

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
  // Řidič řízený sítí. Vstupy = sensors.inputs (7 čísel), nebo sensors.inputsWithCars
  // (10 čísel – i nejbližší auto vpředu), podle toho, kolik vstupů síť má. Výstupy = 2 čísla:
  //   výstup 0 -> volant (-1 vlevo .. +1 vpravo)
  //   výstup 1 -> plyn (kladné) nebo brzda (záporné)
  // ---------------------------------------------------------------------
  class NeuralDriver {
    constructor(net) { this.net = net; }
    drive(sensors) {
      const out = this.net.forward(this.net.sizes[0] > 7 ? sensors.inputsWithCars : sensors.inputs);
      return { steer: out[0], throttle: Math.max(0, out[1]), brake: Math.max(0, -out[1]) };
    }
  }

  // ---------------------------------------------------------------------
  // Trenér: jedna generace = jeden "závod" celé populace. Trénovaná auta jsou "duchové" –
  // navzájem se neruší. Volitelně jezdí po trati pomalejší auta (provoz), která je
  // potřeba předjet; dotyk s nimi = havárie.
  // ---------------------------------------------------------------------
  const DEFAULTS = {
    population: 40,
    hidden: [6],
    mutationRate: 0.15,   // kolik vah se při mutaci změní
    mutationSize: 0.5,    // jak moc
    elite: 2,             // kolik nejlepších přejde do další generace beze změny
    laps: 2,
    timeLimit: 60,        // max. délka generace [s herního času]
    stuckTime: 3,         // kdo se 3 s nepohne dopředu, vypadává
    tracks: [0],          // indexy tratí z F1.TRACK_DEFS; každá generace odjede všechny a skóre se sečte
    traffic: 0,           // počet pomalých aut na trati (0 = bez provozu, nic k předjíždění)
    trafficSkill: 0.6,    // jak rychle provoz jede (1 = jako normální bot)
    trafficTime: 40,      // při tréninku předjíždění se jede na čas: skóre = kam auto dojede za 40 s
  };
  const INPUTS = 7, INPUTS_WITH_CARS = 10;

  class Trainer {
    constructor(opts = {}) {
      this.opts = Object.assign({}, DEFAULTS, opts);
      this.generation = 0;
      this.history = [];       // { generation, best, avg, finished }
      this.bestEver = null;    // { net, fitness, generation }
      this.tracks = {};
      const sizes = [this.opts.traffic ? INPUTS_WITH_CARS : INPUTS].concat(this.opts.hidden, [2]);
      this.nets = Array.from({ length: this.opts.population }, () => new NeuralNet(sizes));
      this.startGeneration();
    }

    // Změna tratí platí od další generace (skóre přes jiné tratě nejde srovnávat).
    setTracks(tracks) { this.nextTracks = tracks.slice(); }

    // Zapnutí/vypnutí provozu platí od další generace. Při zapnutí dostanou mozky nové
    // vstupy (auto vpředu) hned – s nulovými vahami, takže zatím řídí stejně.
    setTraffic(n) {
      this.nextTraffic = n;
      if (n > 0 && this.nets[0].sizes[0] < INPUTS_WITH_CARS) this.nets = this.nets.map(net => net.withInputs(INPUTS_WITH_CARS));
    }

    // Hned použije čekající změny (tratě, provoz) a odjede tuto generaci znovu se stejnými mozky.
    restartGeneration() { this.startGeneration(); }

    // Nová populace odvozená z jednoho mozku (např. nahraného ze souboru).
    seed(net) {
      const o = this.opts;
      const traffic = this.nextTraffic != null ? this.nextTraffic : o.traffic;
      if (traffic > 0) net = net.withInputs(INPUTS_WITH_CARS);
      o.hidden = net.sizes.slice(1, -1);
      this.nets = Array.from({ length: o.population }, (_, i) => (i === 0 ? net.clone() : net.clone().mutate(o.mutationRate, o.mutationSize)));
      this.bestEver = null;
      this.startGeneration();
    }

    startGeneration() {
      if (this.nextTracks) { this.opts.tracks = this.nextTracks; this.nextTracks = null; this.bestEver = null; }
      if (this.nextTraffic != null) { this.opts.traffic = this.nextTraffic; this.nextTraffic = null; this.bestEver = null; }
      // Plán kol této generace: každá trať jednou; s provozem každá trať dvakrát –
      // jednou s pomalými auty a jednou prázdná (aby síť nezapomněla jezdit sama).
      this.rounds = this.opts.traffic > 0
        ? this.opts.tracks.flatMap(t => [{ track: t, traffic: this.opts.traffic }, { track: t, traffic: 0 }])
        : this.opts.tracks.map(t => ({ track: t, traffic: 0 }));
      this.round = 0;                                   // kolikáté kolo plánu právě jede
      this.scores = this.nets.map(() => 0);
      this.finishedAll = this.nets.map(() => true);
      this.startRound();
    }

    track(idx) {
      if (!this.tracks[idx]) this.tracks[idx] = new F1.Track(F1.TRACK_DEFS[idx]);
      return this.tracks[idx];
    }

    startRound() {
      const o = this.opts;
      const plan = this.rounds[this.round];
      this.trackIndex = plan.track;
      this.roundTraffic = plan.traffic;
      const timed = o.traffic > 0;                      // trénink předjíždění: všechna kola na čas
      const race = this.race = new F1.Race(this.track(this.trackIndex),
        { laps: timed ? 99 : o.laps, countdown: 0, collisions: plan.traffic > 0, contactCrash: true });
      const track = race.track;
      // Provoz: pomalá auta rozmístěná rovnoměrně po trati před startem.
      this.traffic = [];
      for (let k = 0; k < plan.traffic; k++) {
        // První auto je až za dohledem (300 px), ať se síť naučí jezdit i po prázdné trati.
        const pose = track.poseAt(50 + Math.round(k * (track.N - 60) / plan.traffic));
        const car = race.addCar({ name: 'Pomalé auto', color: '#9aa0a6', driver: new F1.RuleBasedDriver(o.trafficSkill) });
        Object.assign(car, pose, { trackInfo: null });
        car.locate(track, 0);
        car.isTraffic = true;
        this.traffic.push(car);
      }
      // Všechna auta startují ze stejného místa (pole position), ať mají stejné podmínky.
      const slot = race.track.gridSlot(0);
      this.cars = this.nets.map((net, i) => {
        const color = `hsl(${Math.round((i * 360) / this.nets.length)}, 80%, 55%)`;
        const car = race.addCar({ name: 'Auto ' + (i + 1), color, driver: new NeuralDriver(net) });
        Object.assign(car, { x: slot.x, y: slot.y, heading: slot.heading, trackInfo: null, ghost: true });
        car.locate(race.track, 0);
        car.sense(race.track, race.visibleFor(car));
        car.net = net;
        car.bestDist = car.distance;
        car.bestDistTime = 0;
        car.stuck = false;
        return car;
      });
    }

    // Skóre v ujetých kolech: hlavně jak daleko auto dojelo. Kdo dojede do cíle,
    // dostane bonus (0..1) za rychlost.
    fitness(car) {
      if (car.finished) return this.opts.laps + (this.opts.timeLimit - car.finishTime) / this.opts.timeLimit;
      return Math.max(0, car.distance) / this.race.track.length;
    }

    get alive() { return this.cars.filter(c => !c.crashed && !c.finished).length; }

    // Leader = auto, které právě vede (pro sledování a vizualizaci).
    leader() {
      const running = this.cars.filter(c => !c.crashed);
      const pool = running.length ? running : this.cars;
      return pool.reduce((a, b) => (this.fitness(b) > this.fitness(a) ? b : a));
    }

    // Jeden krok simulace. Vrací true, když generace skončila (a začala nová).
    step(dt) {
      const race = this.race, o = this.opts;
      race.step(dt);
      for (const c of this.cars) {
        if (c.crashed || c.finished) continue;
        if (c.distance > c.bestDist + 10) { c.bestDist = c.distance; c.bestDistTime = race.time; }
        else if (race.time - c.bestDistTime > o.stuckTime) { c.crashed = true; c.stuck = true; c.crashTime = race.time; }
      }
      if (this.alive === 0 || race.time >= (o.traffic > 0 ? o.trafficTime : o.timeLimit)) {
        this.cars.forEach((c, i) => { this.scores[i] += this.fitness(c); this.finishedAll[i] = this.finishedAll[i] && c.finished; });
        this.round++;
        if (this.round < this.rounds.length) this.startRound();
        else { this.evolve(); return true; }
      }
      return false;
    }

    evolve() {
      const o = this.opts;
      const scored = this.nets.map((net, i) => ({ net, fitness: this.scores[i], finished: this.finishedAll[i] }))
        .sort((a, b) => b.fitness - a.fitness);
      const avg = scored.reduce((s, x) => s + x.fitness, 0) / scored.length;
      this.history.push({
        generation: this.generation, best: scored[0].fitness, avg,
        finished: scored.filter(s => s.finished).length, traffic: o.traffic > 0,
      });
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

  const NN = { NeuralNet, NeuralDriver, Trainer, TRAINER_DEFAULTS: DEFAULTS, INPUTS, INPUTS_WITH_CARS };
  if (F1) Object.assign(F1, NN);
  if (typeof module !== 'undefined' && module.exports) module.exports = NN;
})(typeof window !== 'undefined' ? window : globalThis);
