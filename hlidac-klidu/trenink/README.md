# Hlídač klidu – neuronová síť se učí hlídat třídu

Laboratoř k webové hře `../dist/index.html` (Hlídač klidu), postavená stejně jako trénink
v F1 závodech (`Documents\Ronja`): engine bez kreslení → neuronová síť + genetický algoritmus →
trénovací stránka a trénink v Node.js.

## Spuštění

Otevři `train.html` v prohlížeči (dvojklik), nebo přes lokální server z kořene repozitáře:
`python -m http.server 8124` → http://localhost:8124/hlidac-ai/train.html

## Struktura

| Soubor | Co dělá |
|---|---|
| `js/engine.js` | Pravidla hry přepsaná z `dist/index.html` (žáci, bordel, hluk, autorita, zásahy), senzory, pravidlový bot. **Žádné kreslení** – běží i v Node.js. |
| `js/neural.js` | Neuronová síť (stejná jako v F1), hlídač řízený sítí a trenér (genetický algoritmus). Bez DOM. |
| `js/render.js` | Kreslení místnosti (převzaté z hry) + čáry „co síť vidí“. |
| `train.html`, `js/train-ui.js` | Trénovací stránka s vizualizací mozku a grafem. |
| `js/pretrained.js` | Záloha: síť natrénovaná na směnách 1–3 bez kolizí. |
| `js/pretrained-collisions.js` | Záloha: síť dotrénovaná s lavicemi (navazuje na `pretrained.js`). |
| `tools/train-headless.js` | Trénink bez prohlížeče. |

Původní hra se nemění. Engine je její kopie – když se změní pravidla ve hře, je potřeba je přenést i sem.

## Rozdíly proti hře

- **Kolize s lavicemi jdou vypnout** (`deskCollisions: false`, výchozí pro trénink) – hlídač prochází lavicemi,
  síť se tak nejdřív učí jen „kam jít a kdy zasáhnout“. Žáci lavicemi procházejí i ve hře. Bez kolizí lavice
  nejsou ani v paprscích (viz níže) – paprsky vidí jen to, co hlídače opravdu zastaví.
- Pevný krok 1/60 s a náhoda se **semínkem** (směna 1, 2, 3…): stejná směna = stejné pořadí, kdo začne zlobit.
  Díky tomu všichni hlídači v generaci dostanou stejné podmínky (jako stejná trať v F1).
- Síť „drží“ tlačítko Utišit → další stisk nejdřív za 0,25 s (jako opakování klávesy). Stisk naprázdno stojí
  3 autority stejně jako ve hře.

## Co hlídač „vidí“ – senzory (51 čísel)

`world.sensors.inputs`, všechno v rozsahu −1..1:

| Vstupy | Význam |
|---|---|
| 8 × 3 | **Hluční žáci** seřazení od nejbližšího: blízkost (1 = u mě, 0 = 1000 px a dál), směr x, směr y. Tichý žák = prázdný slot (0, 0, 0). |
| 5 × 3 | **Bordel** na zemi (max. 5), stejně: blízkost, směr x, směr y. |
| 8 | **Paprsky k nejbližší překážce** v pevných směrech → ↘ ↓ ↙ ← ↖ ↑ ↗: jak daleko může hlídač dojít, než narazí do stěny nebo (s kolizemi) do lavice. / 250 px, 1 = volno. |
| 4 | Nejbližší problém je **v dosahu** zásahu (0/1), právě **zasahuji** (0/1), **autorita** / 100, **hluk** / 100. |

Seřazení od nejbližšího je důležité: síť nemusí zjišťovat, který slot je zrovna důležitý.

Proč 8 paprsků v pevných směrech (a ne relativně k natočení jako v F1): hlídač nemá volant, chodí kamkoliv
a jeho výstupy jsou „vodorovně/svisle“ – paprsek „↑“ přímo odpovídá výstupu „nahoru“. Se 4 paprsky by síť
neviděla rohy lavic šikmo před sebou. Lavice jsou v paprsku zvětšené o poloměr hlídače a rohy jsou zjednodušeně
hranaté (paprsek hlásí roh o pár px dřív).

**Výstupy (3):** chůze vlevo/vpravo, chůze nahoru/dolů (stačí směr, hlídač jde plnou rychlostí; malý vektor = stát),
a „Utišit“ (když je výstup kladný).

## Hlídač = jakýkoliv objekt s metodou `control`

```js
const myGuard = {
  control(sensors, world) {
    return { x: 0, y: -1, act: sensors.inReach };   // jdi nahoru, zasáhni, když je někdo v dosahu
  }
};
const HK = require('./js/engine.js');                 // v prohlížeči je to window.HK
const world = HK.playShift(myGuard, { seed: 1, deskCollisions: false });
console.log(world.result, world.score, HK.fitness(world));
```

Takhle je napsaný pravidlový bot (`HK.RuleBasedGuard` – „jdi k nejbližšímu problému a zasáhni“),
hráč na klávesnici v trénovací stránce i neuronová síť (`HK.NeuralGuard`).

## Skóre (fitness)

Průměrný klid ve třídě za celou směnu (100 % − hluk, kdo prohraje dřív, už body nesbírá) + 0,01 za každý zásah.
Hlídač, který nic nedělá, má ≈ 0,26 (rámus po ~26 s); pravidlový bot bez kolizí ≈ 1,16–1,37 a ustojí všechny směny.
Při tréninku na více směnách se skóre sčítá.

## Trénovací stránka

Každý ze 40 hlídačů má **vlastní třídu** (koho jeden utiší, u ostatních zlobí dál). Kreslí se třída nejlepšího
hlídače, ostatní hlídači jsou barevné tečky. Vpravo živě mozek (51 vstupů → 8 skrytých → 3 výstupy), graf skóre
generací s čárkovanou čarou pravidlového bota, rychlost 1× / 3× / 10× / max.

V nastavení: na kterých směnách se trénuje, **kolize s lavicemi**, bordel, počet hlídačů, neuronů, síla mutace.

„Předvést“: hlídá síť / pravidlový bot / **ty sám** (WASD + mezerník) na vybrané nebo úplně nové směně;
na konci se ukáže srovnání s botem na stejné směně.

**Návrh průběhu hodiny (stejně jako u F1):**
1. Generace 0 na 1×: hlídači bloudí a „utišují“ prázdný vzduch – nikdo jim neřekl, co mají dělat.
2. Pustit na max – po pár desítkách generací hlídači chodí k narušitelům a zasahují.
3. Předvést šampiona na **nové směně** – někdy selže, protože se učil jen na směně 1. Přidat směny 2–3 a trénovat dál.
4. Zapnout **kolize s lavicemi** – lavice se objeví v paprscích, ale síť je zatím neumí používat. Co se stane?
   (I pravidlový bot u lavic uvízne a prohrává.) Nechat trénovat dál a porovnat s botem.

## Trénink bez prohlížeče

```
node tools/train-headless.js 120 1,2,3 --save
```

Argumenty: počet generací, semínka směn; `--collisions` zapne lavice, `--continue` naváže na `js/pretrained.js`
(síť bez lavic), `--save` uloží nejlepší síť do `js/pretrained.js` (s `--collisions` do `js/pretrained-collisions.js`). `0` generací = jen otestovat uloženou síť. Na konci se síť i bot
otestují na trénovaných i nových směnách (101–105).

```
node tools/train-headless.js 120 1,2,3 --collisions --continue --save
```

**Výsledky ladění:** s počátečními váhami ×0,3 (`initWeight`) se síť učí výrazně lépe než s váhami jako v F1 –
hodně vstupů s velkými vahami neurony hned „přetečou“. Bez lavic: za 120 generací (~4 min) dosáhne skóre bota
a uložená síť ustojí 8 z 8 směn, z toho 5 nových (se 4 vzdálenostmi ke stěnám místo paprsků to bylo 5 z 8). Hodně „utišuje naprázdno“ – stojí to autoritu,
ale ne tolik, aby se to evoluci vyplatilo odnaučit.

**S lavicemi (120 generací, směny 1–3):**

| | ustál směn | skóre na nových směnách 101–105 |
|---|---|---|
| pravidlový bot („jdi rovnou k problému“) | 0 z 8 – uvízne o lavici | 0,47–0,53 |
| síť trénovaná s lavicemi od nuly | 1 z 8 | 0,28–0,48 |
| síť bez lavic → dotrénovaná s lavicemi (`--continue`) | 1 z 8 | 0,36–0,71, lepší než bot na 3 z 5 |

Navázat na síť, která už umí hlídat, se vyplatí (stejně jako u předjíždění v F1). Lavice ale zvládá jen napůl:
paprsky jí řeknou, *že* má před sebou překážku, ne *kudy* ji obejít – síť nemá paměť ani plán cesty, jen reaguje.
I to je dobrá lekce pro děti. Co by mohlo pomoct: delší trénink, víc skrytých neuronů, nebo síti místo přímého
směru k narušiteli dávat „směr cesty“ (první krok nejkratší cesty kolem lavic) – pak by obcházení dostala zadarmo.
