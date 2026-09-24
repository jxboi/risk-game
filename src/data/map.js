// Classic Risk world: 42 territories, 6 continents.
// `seeds` are points on a 100 x 60 board (x right, y down) that grow the
// territory's land shape; the first seed is where the army token sits.

export const CONTINENTS = [
  { id: 'na', name: 'North America', bonus: 5, tint: 0xc9a86a },
  { id: 'sa', name: 'South America', bonus: 2, tint: 0x9fbf6a },
  { id: 'eu', name: 'Europe', bonus: 5, tint: 0x7fa3c9 },
  { id: 'af', name: 'Africa', bonus: 3, tint: 0xd09a5a },
  { id: 'as', name: 'Asia', bonus: 7, tint: 0x8fbf8f },
  { id: 'au', name: 'Australia', bonus: 2, tint: 0xc98fb0 },
];

export const TERRITORIES = [
  // North America
  { id: 'alaska', name: 'Alaska', c: 'na', seeds: [[6, 9], [3, 11]] },
  { id: 'nwt', name: 'Northwest Territory', c: 'na', seeds: [[14, 8], [19, 7], [11, 9]] },
  { id: 'greenland', name: 'Greenland', c: 'na', seeds: [[33, 5], [30, 3], [36, 7]] },
  { id: 'alberta', name: 'Alberta', c: 'na', seeds: [[12, 14], [9, 15]] },
  { id: 'ontario', name: 'Ontario', c: 'na', seeds: [[19, 14], [18, 12]] },
  { id: 'quebec', name: 'Quebec', c: 'na', seeds: [[26, 14], [26, 11]] },
  { id: 'wus', name: 'Western United States', c: 'na', seeds: [[12, 21], [10, 19]] },
  { id: 'eus', name: 'Eastern United States', c: 'na', seeds: [[20, 21], [23, 19], [22, 24]] },
  { id: 'cam', name: 'Central America', c: 'na', seeds: [[15, 27], [18, 29]] },
  // South America
  { id: 'venezuela', name: 'Venezuela', c: 'sa', seeds: [[22, 33], [19, 33]] },
  { id: 'peru', name: 'Peru', c: 'sa', seeds: [[21, 39], [19, 37]] },
  { id: 'brazil', name: 'Brazil', c: 'sa', seeds: [[28, 38], [26, 35], [30, 40]] },
  { id: 'argentina', name: 'Argentina', c: 'sa', seeds: [[23, 46], [22, 50], [25, 44]] },
  // Europe
  { id: 'iceland', name: 'Iceland', c: 'eu', seeds: [[41, 9]] },
  { id: 'gb', name: 'Great Britain', c: 'eu', seeds: [[41, 16], [40, 14]] },
  { id: 'scandinavia', name: 'Scandinavia', c: 'eu', seeds: [[50, 9], [48, 11], [52, 7]] },
  { id: 'neurope', name: 'Northern Europe', c: 'eu', seeds: [[50, 17], [48, 16]] },
  { id: 'weurope', name: 'Western Europe', c: 'eu', seeds: [[42, 22], [43, 25]] },
  { id: 'seurope', name: 'Southern Europe', c: 'eu', seeds: [[51, 22], [49, 23]] },
  { id: 'ukraine', name: 'Ukraine', c: 'eu', seeds: [[59, 14], [58, 18], [58, 10]] },
  // Africa
  { id: 'nafrica', name: 'North Africa', c: 'af', seeds: [[43, 32], [41, 35], [46, 30]] },
  { id: 'egypt', name: 'Egypt', c: 'af', seeds: [[52, 29]] },
  { id: 'eafrica', name: 'East Africa', c: 'af', seeds: [[55, 36], [54, 33]] },
  { id: 'congo', name: 'Congo', c: 'af', seeds: [[49, 39], [47, 38]] },
  { id: 'safrica', name: 'South Africa', c: 'af', seeds: [[51, 46], [50, 49]] },
  { id: 'madagascar', name: 'Madagascar', c: 'af', seeds: [[59, 46], [59, 48]] },
  // Asia
  { id: 'ural', name: 'Ural', c: 'as', seeds: [[66, 13], [65, 16]] },
  { id: 'siberia', name: 'Siberia', c: 'as', seeds: [[72, 9], [71, 12]] },
  { id: 'yakutsk', name: 'Yakutsk', c: 'as', seeds: [[80, 7], [78, 6]] },
  { id: 'kamchatka', name: 'Kamchatka', c: 'as', seeds: [[89, 8], [92, 9], [87, 11]] },
  { id: 'irkutsk', name: 'Irkutsk', c: 'as', seeds: [[79, 13]] },
  { id: 'mongolia', name: 'Mongolia', c: 'as', seeds: [[80, 19], [83, 18]] },
  { id: 'japan', name: 'Japan', c: 'as', seeds: [[92, 20], [91, 17]] },
  { id: 'afghanistan', name: 'Afghanistan', c: 'as', seeds: [[64, 22], [66, 20]] },
  { id: 'china', name: 'China', c: 'as', seeds: [[76, 25], [72, 20], [79, 24]] },
  { id: 'mideast', name: 'Middle East', c: 'as', seeds: [[59, 28], [62, 31], [57, 25]] },
  { id: 'india', name: 'India', c: 'as', seeds: [[69, 31], [70, 34]] },
  { id: 'siam', name: 'Siam', c: 'as', seeds: [[78, 33], [77, 31]] },
  // Australia
  { id: 'indonesia', name: 'Indonesia', c: 'au', seeds: [[79, 41], [76, 40]] },
  { id: 'newguinea', name: 'New Guinea', c: 'au', seeds: [[89, 40], [87, 39]] },
  { id: 'waus', name: 'Western Australia', c: 'au', seeds: [[82, 50], [80, 49]] },
  { id: 'eaus', name: 'Eastern Australia', c: 'au', seeds: [[89, 49], [90, 52], [89, 46]] },
];

const ADJ = {
  alaska: ['nwt', 'alberta', 'kamchatka'],
  nwt: ['alaska', 'alberta', 'ontario', 'greenland'],
  greenland: ['nwt', 'ontario', 'quebec', 'iceland'],
  alberta: ['alaska', 'nwt', 'ontario', 'wus'],
  ontario: ['nwt', 'alberta', 'wus', 'eus', 'quebec', 'greenland'],
  quebec: ['ontario', 'eus', 'greenland'],
  wus: ['alberta', 'ontario', 'eus', 'cam'],
  eus: ['wus', 'ontario', 'quebec', 'cam'],
  cam: ['wus', 'eus', 'venezuela'],
  venezuela: ['cam', 'peru', 'brazil'],
  peru: ['venezuela', 'brazil', 'argentina'],
  brazil: ['venezuela', 'peru', 'argentina', 'nafrica'],
  argentina: ['peru', 'brazil'],
  iceland: ['greenland', 'gb', 'scandinavia'],
  gb: ['iceland', 'scandinavia', 'neurope', 'weurope'],
  scandinavia: ['iceland', 'gb', 'neurope', 'ukraine'],
  neurope: ['gb', 'scandinavia', 'ukraine', 'seurope', 'weurope'],
  weurope: ['gb', 'neurope', 'seurope', 'nafrica'],
  seurope: ['weurope', 'neurope', 'ukraine', 'mideast', 'egypt', 'nafrica'],
  ukraine: ['scandinavia', 'neurope', 'seurope', 'mideast', 'afghanistan', 'ural'],
  nafrica: ['brazil', 'weurope', 'seurope', 'egypt', 'eafrica', 'congo'],
  egypt: ['nafrica', 'seurope', 'mideast', 'eafrica'],
  eafrica: ['egypt', 'nafrica', 'congo', 'safrica', 'madagascar', 'mideast'],
  congo: ['nafrica', 'eafrica', 'safrica'],
  safrica: ['congo', 'eafrica', 'madagascar'],
  madagascar: ['safrica', 'eafrica'],
  ural: ['ukraine', 'siberia', 'china', 'afghanistan'],
  siberia: ['ural', 'yakutsk', 'irkutsk', 'mongolia', 'china'],
  yakutsk: ['siberia', 'kamchatka', 'irkutsk'],
  kamchatka: ['yakutsk', 'irkutsk', 'mongolia', 'japan', 'alaska'],
  irkutsk: ['siberia', 'yakutsk', 'kamchatka', 'mongolia'],
  mongolia: ['irkutsk', 'siberia', 'china', 'japan', 'kamchatka'],
  japan: ['kamchatka', 'mongolia'],
  afghanistan: ['ukraine', 'ural', 'china', 'india', 'mideast'],
  china: ['afghanistan', 'ural', 'siberia', 'mongolia', 'siam', 'india'],
  mideast: ['seurope', 'ukraine', 'afghanistan', 'india', 'egypt', 'eafrica'],
  india: ['mideast', 'afghanistan', 'china', 'siam'],
  siam: ['india', 'china', 'indonesia'],
  indonesia: ['siam', 'newguinea', 'waus'],
  newguinea: ['indonesia', 'eaus', 'waus'],
  waus: ['indonesia', 'newguinea', 'eaus'],
  eaus: ['newguinea', 'waus'],
};

// Index-based structures are what the engine and AI use (fast, serialisable).
export const T_INDEX = Object.fromEntries(TERRITORIES.map((t, i) => [t.id, i]));
export const C_INDEX = Object.fromEntries(CONTINENTS.map((c, i) => [c.id, i]));
export const NEIGHBORS = TERRITORIES.map((t) => ADJ[t.id].map((n) => T_INDEX[n]));
export const T_CONTINENT = TERRITORIES.map((t) => C_INDEX[t.c]);
export const CONTINENT_MEMBERS = CONTINENTS.map((_, ci) =>
  TERRITORIES.map((_, i) => i).filter((i) => T_CONTINENT[i] === ci));
// Territories in a continent that touch another continent: the chokepoints.
export const CONTINENT_BORDERS = CONTINENT_MEMBERS.map((members, ci) =>
  members.filter((i) => NEIGHBORS[i].some((n) => T_CONTINENT[n] !== ci)));

export function areAdjacent(a, b) {
  return NEIGHBORS[a].includes(b);
}
