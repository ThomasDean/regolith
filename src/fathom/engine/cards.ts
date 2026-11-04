// Every fish in Fathom. Species are real; their numbers and abilities are Fathom's own.
//
// Columns (dive sites): 0 Kelp, 1 Reef, 2 Open Blue. Zones: S sunlight, T twilight, M midnight.
import type { Cost, Effect, EndRule, Filter, FishDef, Tag, Zone } from './types';

const Z: Record<string, Zone> = { S: 'sun', T: 'twi', M: 'mid' };
const zones = (z: string): Zone[] => [...z].map((c) => Z[c]);

interface Extra {
  site?: number;
  edge?: 'shallows' | 'abyss';
  tags?: Tag[];
  play?: Effect[];
  dive?: Effect[];
  end?: EndRule;
}

const list: FishDef[] = [];
const fish = (id: string, name: string, len: number, pts: number, z: string, cost: Cost, x: Extra = {}, starter = false) => {
  list.push({ id, name, len, pts, zones: zones(z), cost, tags: x.tags ?? [], site: x.site, edge: x.edge, play: x.play, dive: x.dive, end: x.end, ...(starter ? { starter } : {}) });
};

const D = (n = 1): Effect => ({ k: 'draw', n });
const E = (n = 1, where?: Filter): Effect => ({ k: 'egg', n, ...(where ? { where } : {}) });
const H = (n = 1): Effect => ({ k: 'hatch', n });
const F = (n = 1): Effect => ({ k: 'fry', n });
const MV: Effect = { k: 'move' };
const RC: Effect = { k: 'recover' };
const CY: Effect = { k: 'cycle' };

// ---------------------------------------------------------------- starters (two each)
fish('sergeant-major', 'Sergeant Major', 2, 1, 'S', {}, { dive: [E()] }, true);
fish('blue-tang', 'Blue Tang', 2, 1, 'ST', { cards: 1 }, { dive: [D()] }, true);
fish('clownfish', 'Clownfish', 2, 2, 'S', { cards: 1 }, { tags: ['camouflage'], play: [F()] }, true);
fish('lanternfish', 'Lanternfish', 2, 1, 'TM', {}, { tags: ['glow'], dive: [H()] }, true);
fish('hatchetfish', 'Silver Hatchetfish', 2, 1, 'TM', { cards: 1 }, { tags: ['glow'], dive: [D()] }, true);
fish('pinfish', 'Pinfish', 2, 1, 'S', {}, { play: [D()] }, true);
fish('neon-goby', 'Neon Goby', 2, 2, 'S', { cards: 1 }, { edge: 'shallows', tags: ['camouflage'], dive: [E()] }, true);
fish('bristlemouth', 'Bristlemouth', 2, 1, 'M', {}, { tags: ['glow'], dive: [E()] }, true);
fish('silverside', 'Atlantic Silverside', 2, 1, 'ST', {}, { dive: [MV] }, true);
fish('cardinalfish', 'Pajama Cardinalfish', 3, 2, 'T', { cards: 1 }, { play: [E()] }, true);

// ---------------------------------------------------------------- sunlight
fish('sardine', 'Pacific Sardine', 2, 1, 'S', {}, { play: [F()] });
fish('anchovy', 'Northern Anchovy', 2, 1, 'ST', {}, { dive: [F()] });
fish('herring', 'Atlantic Herring', 2, 0, 'ST', { cards: 1 }, { play: [F(2)] });
fish('damselfish', 'Yellowtail Damselfish', 2, 1, 'S', {}, { dive: [CY] });
fish('remora', 'Remora', 2, 1, 'ST', {}, { play: [RC] });
fish('mandarinfish', 'Mandarinfish', 2, 3, 'S', { cards: 1 }, { site: 1, tags: ['camouflage'], dive: [F()] });
fish('cleaner-wrasse', 'Bluestreak Cleaner Wrasse', 2, 2, 'S', {}, { site: 1, dive: [RC] });
fish('anthias', 'Lyretail Anthias', 2, 2, 'ST', { cards: 1 }, { site: 1, play: [{ k: 'eggEach', where: { sameCol: true } }] });
fish('seahorse', 'Lined Seahorse', 2, 3, 'S', { cards: 1 }, { site: 0, edge: 'shallows', tags: ['camouflage'], play: [F(2)] });
fish('pipefish', 'Bay Pipefish', 2, 2, 'S', { cards: 1 }, { site: 0, tags: ['camouflage'], dive: [F()] });
fish('moorish-idol', 'Moorish Idol', 3, 3, 'S', { cards: 1 }, { site: 1, dive: [D()] });
fish('butterflyfish', 'Copperband Butterflyfish', 3, 3, 'S', { cards: 1 }, { site: 1, play: [E()] });
fish('triggerfish', 'Picasso Triggerfish', 3, 3, 'S', { cards: 1 }, { site: 1, dive: [E()] });
fish('yellow-tang', 'Yellow Tang', 3, 2, 'ST', { cards: 1 }, { play: [{ k: 'all', e: { k: 'draw', n: 1 } }, D()] });
fish('opaleye', 'Opaleye', 3, 2, 'S', {}, { site: 0, edge: 'shallows', play: [D()] });
fish('garibaldi', 'Garibaldi', 3, 3, 'S', { cards: 1 }, { site: 0, dive: [E()] });
fish('flyingfish', 'Flying Fish', 3, 2, 'S', {}, { site: 2, dive: [MV] });
fish('mackerel', 'Atlantic Mackerel', 3, 2, 'ST', {}, { site: 2, dive: [F()] });
fish('sargassumfish', 'Sargassumfish', 3, 3, 'S', { cards: 1 }, { site: 2, tags: ['camouflage', 'predator'], play: [F()] });
fish('searobin', 'Striped Searobin', 3, 3, 'S', { cards: 1 }, { edge: 'shallows', dive: [MV] });
fish('porkfish', 'Porkfish', 3, 2, 'ST', { cards: 1 }, { dive: [E()] });
fish('stonefish', 'Reef Stonefish', 3, 4, 'S', { cards: 1, fry: 1 }, { site: 1, tags: ['venomous', 'camouflage'], end: { k: 'tag', tag: 'camouflage', pts: 1 } });
fish('frogfish', 'Warty Frogfish', 3, 4, 'ST', { cards: 1 }, { site: 1, tags: ['camouflage', 'predator'], play: [E()] });
fish('mullet', 'Striped Mullet', 3, 2, 'S', { eggs: 1 }, { edge: 'shallows', play: [{ k: 'eggEach', where: { zone: 'sun' } }] });
fish('parrotfish', 'Stoplight Parrotfish', 4, 4, 'S', { cards: 2 }, { dive: [E()] });
fish('hogfish', 'Hogfish', 4, 4, 'ST', { cards: 1, fry: 1 }, { site: 1, dive: [E()] });
fish('lionfish', 'Red Lionfish', 4, 5, 'ST', { cards: 1, eggs: 1 }, { tags: ['venomous', 'predator'], dive: [H()] });
fish('moray', 'Green Moray', 4, 4, 'ST', { cards: 1 }, { site: 1, tags: ['predator', 'camouflage'], dive: [MV] });
fish('kelp-bass', 'Kelp Bass', 4, 4, 'ST', { cards: 2 }, { site: 0, tags: ['predator'], dive: [D()] });
fish('bonefish', 'Bonefish', 4, 4, 'S', { cards: 1, fry: 1 }, { edge: 'shallows', dive: [D()] });
fish('skipjack', 'Skipjack Tuna', 4, 4, 'ST', { cards: 1, fry: 1 }, { site: 2, dive: [H()] });
fish('sheephead', 'California Sheephead', 5, 6, 'ST', { cards: 1, eat: true }, { site: 0, tags: ['predator'], play: [E(2)] });
fish('snook', 'Common Snook', 5, 5, 'ST', { cards: 1, eat: true }, { tags: ['predator'], dive: [H()] });
fish('barracuda', 'Great Barracuda', 5, 6, 'ST', { cards: 2 }, { tags: ['predator'], end: { k: 'tag', tag: 'predator', pts: 1 } });
fish('mahi', 'Mahi-mahi', 5, 6, 'S', { cards: 2, eggs: 1 }, { site: 2, tags: ['predator'], dive: [D()] });
fish('tarpon', 'Tarpon', 6, 8, 'S', { cards: 2, eat: true }, { edge: 'shallows', tags: ['predator'] });
fish('sunfish', 'Ocean Sunfish', 6, 7, 'ST', { cards: 3 }, { site: 2, end: { k: 'zone', zone: 'sun', pts: 1 } });
fish('bluefin', 'Atlantic Bluefin Tuna', 6, 9, 'ST', { cards: 2, eat: true }, { site: 2, tags: ['predator'] });
fish('manta', 'Reef Manta Ray', 6, 7, 'S', { cards: 3 }, { site: 2, play: [{ k: 'all', e: { k: 'draw', n: 1 } }], dive: [D()] });
fish('whale-shark', 'Whale Shark', 6, 10, 'ST', { cards: 2, fry: 2 }, {});
fish('grouper', 'Goliath Grouper', 6, 8, 'ST', { cards: 1, eggs: 2, eat: true }, { tags: ['predator'], end: { k: 'beneath', pts: 2 } });
fish('giant-sea-bass', 'Giant Sea Bass', 6, 9, 'ST', { cards: 2, eggs: 1, eat: true }, { site: 0, end: { k: 'eggsCol', pts: 1 } });

// ---------------------------------------------------------------- twilight
fish('pollock', 'Walleye Pollock', 3, 2, 'ST', {}, { play: [{ k: 'all', e: { k: 'eggEach', where: { zone: 'twi' } } }] });
fish('barreleye', 'Barreleye', 3, 4, 'TM', { cards: 1 }, { tags: ['glow'], dive: [D()] });
fish('viperfish', "Sloane's Viperfish", 3, 4, 'TM', { cards: 1 }, { tags: ['glow', 'predator'], play: [E()] });
fish('electric-ray', 'Lesser Electric Ray', 3, 3, 'ST', { cards: 1 }, { tags: ['electric'], dive: [D()] });
fish('cabezon', 'Cabezon', 4, 4, 'ST', { cards: 1 }, { site: 0, tags: ['camouflage', 'venomous'], play: [F()] });
fish('hake', 'Silver Hake', 4, 4, 'T', { cards: 1 }, { site: 0, dive: [D()] });
fish('rockfish', 'Yelloweye Rockfish', 4, 5, 'T', { cards: 1, eggs: 1 }, { site: 0, end: { k: 'eggsCol', pts: 1 } });
fish('john-dory', 'John Dory', 4, 4, 'T', { cards: 1, eggs: 1 }, { tags: ['predator', 'camouflage'], dive: [H()] });
fish('sablefish', 'Sablefish', 4, 3, 'TM', { cards: 1 }, { dive: [E()] });
fish('torpedo', 'Atlantic Torpedo', 4, 4, 'TM', { cards: 1 }, { tags: ['electric'], dive: [MV] });
fish('stargazer', 'Northern Stargazer', 4, 4, 'ST', { cards: 1, eat: true }, { tags: ['electric', 'venomous', 'camouflage'], dive: [E()] });
fish('wolffish', 'Atlantic Wolffish', 5, 5, 'TM', { cards: 2 }, { tags: ['predator'], dive: [D()] });
fish('lancetfish', 'Longnose Lancetfish', 5, 4, 'TM', { cards: 1, fry: 1 }, { tags: ['predator'], play: [D(2)] });
fish('opah', 'Opah', 5, 6, 'T', { cards: 2 }, { end: { k: 'zone', zone: 'twi', pts: 1 } });
fish('lingcod', 'Lingcod', 5, 6, 'TM', { cards: 1, eat: true }, { site: 0, tags: ['predator'], dive: [E()] });
fish('angelshark', 'Angelshark', 5, 5, 'TM', { cards: 1, eat: true }, { tags: ['camouflage', 'predator'], end: { k: 'zone', zone: 'twi', pts: 1 } });
fish('oarfish', 'Giant Oarfish', 6, 7, 'TM', { cards: 2, fry: 1 }, { site: 2, dive: [D()] });
fish('thresher', 'Bigeye Thresher', 6, 7, 'ST', { cards: 2, eat: true }, { site: 2, tags: ['predator'], play: [D()] });
fish('mako', 'Shortfin Mako', 6, 8, 'ST', { cards: 2, eggs: 1 }, { site: 2, tags: ['predator'] });
fish('great-white', 'Great White Shark', 6, 10, 'ST', { cards: 1, fry: 2 }, { tags: ['predator', 'predator'] });
fish('hammerhead', 'Scalloped Hammerhead', 6, 8, 'ST', { cards: 2 }, { tags: ['predator', 'electric'], dive: [H()] });
fish('swordfish', 'Swordfish', 6, 8, 'STM', { cards: 2, fry: 1 }, { site: 2, tags: ['predator'], play: [D(2)] });

// ---------------------------------------------------------------- midnight
fish('cookiecutter', 'Cookiecutter Shark', 2, 2, 'TM', {}, { tags: ['glow', 'predator'], dive: [CY] });
fish('snailfish', 'Hadal Snailfish', 2, 5, 'M', { cards: 2 }, { edge: 'abyss', end: { k: 'zone', zone: 'mid', pts: 1 } });
fish('anglerfish', 'Humpback Anglerfish', 3, 4, 'M', { cards: 1 }, { tags: ['glow', 'predator'], end: { k: 'tag', tag: 'glow', pts: 1 } });
fish('fangtooth', 'Fangtooth', 3, 3, 'M', { cards: 1 }, { tags: ['predator'], dive: [E()] });
fish('blobfish', 'Blobfish', 3, 3, 'M', {}, { edge: 'abyss', play: [F()] });
fish('tripodfish', 'Tripod Fish', 3, 4, 'M', { cards: 1 }, { edge: 'abyss', dive: [E()] });
fish('hagfish', 'Pacific Hagfish', 3, 1, 'M', {}, { edge: 'abyss', dive: [RC] });
fish('black-swallower', 'Black Swallower', 3, 4, 'M', { cards: 1, eat: true }, { tags: ['predator'], play: [E()] });
fish('loosejaw', 'Stoplight Loosejaw', 3, 3, 'M', { cards: 1 }, { tags: ['glow', 'predator'], dive: [D()] });
fish('grenadier', 'Roundnose Grenadier', 4, 3, 'TM', { eggs: 1 }, { dive: [D()] });
fish('gulper', 'Gulper Eel', 4, 4, 'M', { cards: 1, eat: true }, { tags: ['predator'], play: [D()] });
fish('dragonfish', 'Black Dragonfish', 4, 5, 'M', { cards: 1, eggs: 1 }, { tags: ['glow', 'predator'], dive: [H()] });
fish('pelican-eel', 'Pelican Eel', 4, 4, 'M', { cards: 1 }, { tags: ['predator'], dive: [F()] });
fish('lizardfish', 'Deep-sea Lizardfish', 4, 4, 'M', { cards: 1 }, { edge: 'abyss', tags: ['predator'], end: { k: 'tag', tag: 'predator', pts: 1 } });
fish('frilled-shark', 'Frilled Shark', 5, 6, 'M', { cards: 1, eat: true }, { tags: ['predator'], dive: [H()] });
fish('coelacanth', 'Coelacanth', 5, 7, 'TM', { cards: 2 }, { site: 1, end: { k: 'hand', pts: 1, max: 4 } });
fish('sixgill', 'Bluntnose Sixgill', 6, 8, 'TM', { cards: 2, fry: 1 }, { tags: ['predator'], dive: [E()] });
fish('greenland-shark', 'Greenland Shark', 6, 9, 'TM', { cards: 2, eat: true }, { tags: ['predator'], end: { k: 'beneath', pts: 2 } });
fish('goblin-shark', 'Goblin Shark', 6, 8, 'M', { cards: 2, eggs: 1 }, { edge: 'abyss', tags: ['predator'] });
fish('sawtail', 'Ribbon Sawtail', 4, 3, 'TM', {}, { tags: ['glow'], end: { k: 'schools', pts: 2 } });

export const FISH: Record<string, FishDef> = Object.fromEntries(list.map((f) => [f.id, f]));
export const STARTERS = list.filter((f) => f.starter).map((f) => f.id);
export const DECK = list.filter((f) => !f.starter).map((f) => f.id);

/** The printed bait fish every ocean starts with. */
export const BAIT = 'bait';
export const BAIT_DEF: FishDef = { id: BAIT, name: 'Bait shoal', len: 1, pts: 0, zones: ['sun', 'twi', 'mid'], cost: {}, tags: [] };
export const fishDef = (id: string): FishDef => (id === BAIT ? BAIT_DEF : FISH[id]);

export const SITE_NAMES = ['Kelp', 'Reef', 'Open Blue'];
export const SITE_COLORS = ['#58b368', '#a77be0', '#4aa3df'];
export const ZONE_NAMES: Record<Zone, string> = { sun: 'Sunlight', twi: 'Twilight', mid: 'Midnight' };
export const TAG_NAMES: Record<Tag, string> = { predator: 'Predator', venomous: 'Venomous', camouflage: 'Camouflage', glow: 'Glowing', electric: 'Electric' };
