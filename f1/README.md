# F1 Závody – hra pro výuku neuronových sítí

Formule z pohledu shora, ovládání pro 2 hráče a počítačoví soupeři (NPC).
Hra slouží hlavně jako "laboratoř": každé auto umí říct, co vidí, a ve fázi 2
se na tom naučí řídit neuronová síť – aniž by jí kdokoliv řekl jak.

## Spuštění

Stačí otevřít `index.html` v prohlížeči (dvojklik). Nepotřebuje internet ani instalaci.

Případně přes lokální server: `python -m http.server 8123` a otevřít http://localhost:8123.

## Ovládání

| | Plyn | Brzda / couvání | Doleva | Doprava |
|---|---|---|---|---|
| Hráč 1 | ↑ | ↓ | ← | → |
| Hráč 2 | W | S | A | D |

Mezerník = pauza · R = paprsky senzorů u všech aut · Tab nebo kliknutí = vybrat auto do panelu "Co vidí auto" · Esc = menu

## Fyzika (zjednodušená, ale poctivá)

- Pneumatiky udrží jen omezené boční zrychlení (`PHYS.grip`). Když se do zatáčky
  jede moc rychle, zbytek boční rychlosti zůstane → auto klouže ven (setrvačnost /
  "odstředivá síla"), na asfaltu zůstanou stopy smyku.
- Za obrubníkem je tráva: méně přilnavosti a auto rychle zpomalí.
- Za trávou je bariéra: náraz = auto je nepojízdné a závod pro něj končí.
- Simulace má pevný krok 1/60 s, takže je deterministická – stejné vstupy dají stejnou jízdu.

## Struktura

| Soubor | Co dělá |
|---|---|
| `js/engine.js` | Trať, fyzika auta, senzory, závod, pravidlový bot. **Žádné kreslení** – běží i v Node.js. |
| `js/render.js` | Kreslení na canvas. |
| `js/game.js` | Menu, klávesnice, herní smyčka, HUD. |
| `js/neural.js` | Neuronová síť, řidič řízený sítí a trenér (genetický algoritmus). Bez DOM. |
| `train.html`, `js/train-ui.js` | Trénovací stránka s vizualizací. |
| `tools/headless-test.js` | Test bez prohlížeče: `node tools/headless-test.js` (zkontroluje tratě a nechá boty odjet závod). |

## Co auto "vidí" – senzory

`car.sensors` (přepočítává se každý krok):

| Položka | Význam |
|---|---|
| `rays[0..4]` | Vzdálenost k okraji vozovky v px pod úhly −60°, −30°, 0°, +30°, +60° (záporné = vlevo), max. 300 |
| `speed` | Rychlost vpřed v px/s (max ≈ 400) |
| `angleToTrack` | O kolik auto míří jinam než trať, v radiánech (+ = doprava) |
| `heading` | Absolutní směr auta ve světě |
| `lateral` | Poloha napříč tratí (−1 levý okraj, 0 střed, +1 pravý okraj) |
| `onRoad` | Jestli je auto na asfaltu |
| `inputs` | **Hotový vektor 7 čísel pro neuronovou síť:** 5 paprsků / 300, rychlost / 400, úhel / π |
| `carAhead` | Nejbližší auto v zorném poli ±60° před námi: `{ dist, bearing, closing, car }`, nebo `null` |
| `inputsWithCars` | 10 čísel pro síť, která umí předjíždět: `inputs` + auto vpředu (daleko 0..1, strana −1..1, přibližování) – strana a přibližování sílí s blízkostí auta |

## Řidič = jakýkoliv objekt s metodou `drive`

```js
const myDriver = {
  drive(sensors, car, race) {
    return { throttle: 1, brake: 0, steer: 0 }; // steer: -1 vlevo … +1 vpravo
  }
};
```

Takhle je napsaný hráč (klávesnice), NPC bot (`F1.RuleBasedDriver` – pravidla
"zatoč tam, kde je víc místa" a "zpomal, když je vepředu blízko okraj") a stejně
tak bude napsaná neuronová síť.

## Simulace bez kreslení (pro trénink ve fázi 2)

```js
const F1 = require('./js/engine.js');            // v prohlížeči je to window.F1
const track = new F1.Track(F1.TRACK_DEFS[0]);
const race = new F1.Race(track, { laps: 1, countdown: 0, collisions: false });
const car = race.addCar({ name: 'Síť 1', driver: myDriver });
while (!race.isOver() && race.time < 60) race.step(1 / 60);
console.log(car.crashed, car.distance);          // ujetá vzdálenost = přirozené "skóre" (fitness)
```

Jeden závod 8 aut na 3 kola se spočítá zhruba za 0,1 s, takže trénink stovek
generací je otázka minut.

## Fáze 2 – neuronová síť se učí řídit

Otevři `train.html` (nebo v menu hry odkaz „🧠 Trénink neuronové sítě“).

**Jak to funguje (neuroevoluce):**
1. Každé ze 40 aut má malou neuronovou síť: 7 vstupů (`sensors.inputs`) → 6 skrytých
   neuronů → 2 výstupy (volant, plyn/brzda). Na začátku jsou váhy náhodné.
2. Celá generace jede najednou (auta do sebe nenarážejí). Kdo havaruje nebo 3 s nepostoupí, vypadává.
3. Skóre = ujetá kola (+ bonus za rychlost pro ty, kdo dojedou do cíle). Při více tratích se sčítá.
4. Dva nejlepší jdou do další generace beze změny, ostatní vzniknou křížením lepší poloviny
   a mutací (náhodné drobné změny vah).

**Na stránce:** živá vizualizace mozku vedoucího auta (vstupy, váhy, výstupy), graf
nejlepšího a průměrného skóre, rychlost 1× / 3× / 10× / max, nastavení (tratě, počet aut,
neuronů, síla mutace), „Předvést šampiona“ proti botům, uložení/nahrání sítě.

**Návrh průběhu hodiny:**
1. Generace 0 na oválu, rychlost 1×: auta bloudí a bourají – „nikdo jim neřekl, jak řídit“.
2. Pár generací na 3× – průměr v grafu roste, v mozku je vidět, jak „rovně“ ovlivňuje plyn.
3. Předvést šampiona na **Technickém okruhu** → havaruje. Proč? Učil se jen na oválu.
4. V nastavení přidat další tratě, pustit na max → šampion pak zvládne všechny.
5. „Použít ve hře“ → děti závodí proti síti, kterou samy vytrénovaly.

## Fáze 3 – předjíždění (volitelné pokračování)

Síť z fáze 2 jiná auta **nevidí** – její paprsky měří jen okraje trati. Ve hře proto
jede za pomalejším autem v koloně (nebo do něj naráží). To se dá dětem nejdřív ukázat:
„Předvést šampiona“ → „v pomalém provozu“ → síť do pomalých aut naráží.

Pak v „Nastavení tréninku“ zapnout **Předjíždění**:
- Mozky dostanou **3 nové vstupy** o nejbližším autu vpředu: jak je daleko, na které straně
  a jak rychle se k němu blíží. Nové váhy začínají na **nule**, takže síť zpočátku řídí přesně
  jako dřív – nové „oči“ se musí naučit používat sama. (Ve vizualizaci přibudou 3 vstupní neurony,
  na trati modrá čára k autu, které síť vidí.)
- Po trati jezdí 4 **pomalá auta**; dotyk s nimi = havárie.
- Skóre = kam auto dojede za 40 s. Kdo se jen „veze“ za pomalým autem, nedojede daleko.
- Každá trať se v generaci jede dvakrát – s provozem a prázdná –, jinak síť zapomene jezdit sama.

**Co se při ladění ukázalo (hodí se jako příběh pro děti):**
- S 5 paprsky na auta se síť předjíždět nenaučila: úzké auto přímo vpředu trefí jen prostřední
  paprsek, síť neví, z které strany objíždět – a tak se naučila jen *zpomalit a jet za ním*.
- Když se skóre počítalo „kolik kol zvládneš“, vyplatilo se jezdit pomalu a bezpečně.
  Teprve skóre „kam dojedeš za 40 s“ předjíždění odměňuje.
- Evoluce je náhodná – některé běhy najdou předjíždění za pár desítek generací, jiné uvíznou
  u „jedu za ním“. Proto je k dispozici záloha.

**Záloha:** `js/pretrained-overtake.js` – síť, která umí předjíždět (tlačítko „Načíst
předtrénovanou“ při zapnutém předjíždění; ve hře volba „Předtrénovaná – umí předjíždět“).
Ve hře si lze vybrat i „nevidí jiná auta“ a porovnat obě sítě v závodě s boty.

**Výsledky (headless test, 4 pomalá auta, síť startuje za nimi):** slepá síť „předjede“ 2 ze 4
jen odstrkováním (8–20 nárazů), síť s předjížděním předjede 4 ze 4 s 0–2 nárazy.

**Omezení:** síť umí to, na čem se učila – předjíždět *pomalá* auta v řídkém provozu, kde dotyk
= konec. Ve hře v hustém balíku stejně rychlých botů je proto opatrná, brzdí a dojede hůř než
slepá síť, která ostatní prostě odstrčí (ve hře je náraz jen odraz). I to je dobrá lekce: síť se
naučí přesně to, co odměňujeme, a v situacích, které nezažila, si neporadí.

**Záloha:** `js/pretrained.js` obsahuje síť natrénovanou na všech třech tratích (tlačítko
„Načíst předtrénovaná“). Ve hře se použije, když z trénovací stránky nic uloženo není.
Je rychlejší než ručně naprogramovaní boti (např. Technický okruh 41 s oproti 51 s).

**Trénink bez prohlížeče** (zhruba 45 s na 60 generací přes všechny tratě):

```
node tools/train-headless.js 60 0,1,2 --save
```

Argumenty: počet generací, indexy tratí; `--save` přepíše `js/pretrained.js`.
S `--overtake` naváže na `js/pretrained.js`, učí předjíždění a `--save` uloží `js/pretrained-overtake.js`:

```
node tools/train-headless.js 150 0,1,2 --overtake --save
```
