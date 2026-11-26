// Custom cards: project cards players design in the app. A custom card is plain data (cost,
// tags, requirement, VP and effects built from a fixed menu of blocks), so it can be saved,
// shared, sent with an online game and checked by the server. At load time each one is turned
// into an ordinary card definition and added to the catalogue, so the engine, the CPUs, the
// card symbols and the art treat it like any other card.
//
// Ids are made from the card's content ("cc-" + hash), so an edited card is a new card and two
// games using different versions of a card never clash.
import type { CardRes, GameState, Op, Res, Tag } from './types';
import { RESOURCES, TAGS } from './types';
import { CARDS, type CardAction, type CardDef, type Req } from './cards';
import { P } from './helpers';

/** One effect, from the menu the editor offers. */
export type Block =
  | { k: 'res'; r: Res; n: number }
  | { k: 'prod'; r: Res; n: number }
  | { k: 'tr'; n: number }
  | { k: 'temp'; n: number }
  | { k: 'oxy'; n: number }
  | { k: 'venus'; n: number }
  | { k: 'ocean' }
  | { k: 'city' }
  | { k: 'greenery' }
  | { k: 'draw'; n: number }
  /** resources onto this card (needs a resource type) */
  | { k: 'addRes'; n: number }
  /** remove up to n of a resource from any player */
  | { k: 'removeAny'; r: Res; n: number }
  /** lower any player's production */
  | { k: 'decProd'; r: Res; n: number };

export type Trigger = 'playTag' | 'anyPlayTag' | 'placeCity' | 'anyCity' | 'placeGreenery' | 'anyOcean';

export interface CustomCard {
  /** "cc-" + content hash; filled in by `finishCustom` */
  id: string;
  name: string;
  type: 'automated' | 'active' | 'event';
  cost: number;
  tags: Tag[];
  /** a global parameter at least/at most, and/or a number of your tags */
  req?: { param?: 'temp' | 'oxy' | 'oceans' | 'venus'; min?: number; max?: number; tag?: Tag; tagCount?: number };
  /** fixed VP, or 1 VP per N resources on the card */
  vp?: { n: number } | { perRes: number };
  /** resources this card holds (active cards) */
  resource?: CardRes;
  /** when played */
  play: Block[];
  /** blue action, once per generation: pay a cost, gain the blocks */
  action?: { costMC?: number; costRes?: { r: Res; n: number }; spendHere?: number; gain: Block[] };
  /** ongoing effect: whenever the trigger happens, the owner gains the blocks */
  effect?: { when: Trigger; tag?: Tag; gain: Block[] };
}

export const CARD_RES: CardRes[] = ['microbe', 'animal', 'science', 'floater', 'fighter', 'asteroid'];
export const BLOCK_KINDS: Block['k'][] = ['res', 'prod', 'tr', 'temp', 'oxy', 'venus', 'ocean', 'city', 'greenery', 'draw', 'addRes', 'removeAny', 'decProd'];
export const TRIGGERS: Trigger[] = ['playTag', 'anyPlayTag', 'placeCity', 'anyCity', 'placeGreenery', 'anyOcean'];
const CARD_TAGS: Tag[] = TAGS.filter((t) => t !== 'event' && t !== 'wild');

/** Limits per block kind: [min, max] for n. */
const RANGE: Partial<Record<Block['k'], [number, number]>> = {
  res: [-10, 20], prod: [-3, 5], tr: [1, 3], temp: [1, 3], oxy: [1, 2], venus: [1, 3], draw: [1, 4], addRes: [1, 5], removeAny: [1, 8], decProd: [1, 3],
};
export const blockRange = (k: Block['k']) => RANGE[k];

const fail = (m: string): never => { throw new Error(m); };
const int = (v: unknown, lo: number, hi: number, what: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) fail(`${what} must be a whole number from ${lo} to ${hi}`);
  return v as number;
};

function cleanBlock(b: unknown, holds: boolean, where: string): Block {
  const x = b as Record<string, unknown>;
  const k = x?.k as Block['k'];
  if (!BLOCK_KINDS.includes(k)) fail(`${where}: unknown effect`);
  const range = RANGE[k];
  const n = range ? int(x.n, range[0], range[1], `${where}: amount`) : undefined;
  if (n === 0) fail(`${where}: amount can't be 0`);
  if ((k === 'res' || k === 'prod' || k === 'removeAny' || k === 'decProd') && !RESOURCES.includes(x.r as Res)) fail(`${where}: unknown resource`);
  if (k === 'addRes' && !holds) fail(`${where}: the card needs a resource type to add resources to it`);
  return (n === undefined ? { k } : k === 'res' || k === 'prod' || k === 'removeAny' || k === 'decProd' ? { k, r: x.r, n } : { k, n }) as Block;
}

/** Checks a card from the editor (or from another player) and returns a clean copy with its id. */
export function finishCustom(raw: unknown): CustomCard {
  const c = raw as Partial<CustomCard>;
  if (!c || typeof c !== 'object') fail('Not a card');
  const name = typeof c.name === 'string' ? c.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 40) fail('Give the card a name (2–40 characters)');
  if (c.type !== 'automated' && c.type !== 'active' && c.type !== 'event') fail('Unknown card type');
  const cost = int(c.cost, 0, 60, 'Cost');
  const tags = Array.isArray(c.tags) ? c.tags : [];
  if (tags.length > 3 || tags.some((t) => !CARD_TAGS.includes(t))) fail('Up to 3 tags');
  const resource = c.resource === undefined ? undefined : CARD_RES.includes(c.resource) ? c.resource : fail('Unknown card resource');
  if (resource && c.type !== 'active') fail('Only active cards hold resources');
  const holds = !!resource;
  let req: CustomCard['req'];
  if (c.req) {
    const r = c.req;
    req = {};
    if (r.param) {
      if (!['temp', 'oxy', 'oceans', 'venus'].includes(r.param)) fail('Unknown requirement');
      const [lo, hi] = r.param === 'temp' ? [-30, 8] : r.param === 'oxy' ? [0, 14] : r.param === 'oceans' ? [0, 9] : [0, 30];
      if (r.min === undefined && r.max === undefined) fail('Set a minimum or maximum for the requirement');
      req.param = r.param;
      if (r.min !== undefined) req.min = int(r.min, lo, hi, 'Requirement');
      if (r.max !== undefined) req.max = int(r.max, lo, hi, 'Requirement');
    }
    if (r.tag) {
      if (!CARD_TAGS.includes(r.tag)) fail('Unknown tag requirement');
      req.tag = r.tag;
      req.tagCount = int(r.tagCount, 1, 6, 'Tag requirement');
    }
    if (!req.param && !req.tag) req = undefined;
  }
  let vp: CustomCard['vp'];
  if (c.vp) {
    if ('perRes' in c.vp) {
      if (!holds) fail('VP per resource needs a resource type');
      vp = { perRes: int(c.vp.perRes, 1, 4, 'Resources per VP') };
    } else vp = { n: int((c.vp as { n: number }).n, -3, 5, 'VP') };
    if ('n' in vp && vp.n === 0) vp = undefined;
  }
  const blocks = (xs: unknown, where: string) => {
    if (!Array.isArray(xs) || xs.length > 6) fail(`${where}: up to 6 effects`);
    return (xs as unknown[]).map((b, i) => cleanBlock(b, holds, `${where} ${i + 1}`));
  };
  const play = blocks(c.play ?? [], 'When played');
  let action: CustomCard['action'];
  let effect: CustomCard['effect'];
  if (c.action) {
    if (c.type !== 'active') fail('Only active cards have actions');
    const a = c.action;
    action = { gain: blocks(a.gain, 'Action') };
    if (!action.gain.length) fail('The action needs something to gain');
    if (a.costMC) action.costMC = int(a.costMC, 1, 30, 'Action cost');
    if (a.costRes) {
      if (!RESOURCES.includes(a.costRes.r) || a.costRes.r === 'mc') fail('Unknown action cost');
      action.costRes = { r: a.costRes.r, n: int(a.costRes.n, 1, 10, 'Action cost') };
    }
    if (a.spendHere) {
      if (!holds) fail('Spending resources from the card needs a resource type');
      action.spendHere = int(a.spendHere, 1, 5, 'Action cost');
    }
  }
  if (c.effect) {
    if (c.type !== 'active') fail('Only active cards have ongoing effects');
    const e = c.effect;
    if (!TRIGGERS.includes(e.when)) fail('Unknown trigger');
    effect = { when: e.when, gain: blocks(e.gain, 'Effect') };
    if (!effect.gain.length) fail('The effect needs something to gain');
    if (e.when === 'playTag' || e.when === 'anyPlayTag') {
      if (!e.tag || !CARD_TAGS.includes(e.tag)) fail('Choose the tag that triggers the effect');
      effect.tag = e.tag;
    }
  }
  if (!play.length && !action && !effect && !vp) fail('The card does nothing yet: add an effect or VP');
  const out: CustomCard = { id: '', name, type: c.type as CustomCard['type'], cost, tags: [...tags], play };
  if (req) out.req = req;
  if (vp) out.vp = vp;
  if (resource) out.resource = resource;
  if (action) out.action = action;
  if (effect) out.effect = effect;
  out.id = `cc-${hash(JSON.stringify({ ...out, id: undefined }))}`;
  return out;
}

function hash(t: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < t.length; i++) {
    a = Math.imul(a ^ t.charCodeAt(i), 16777619) >>> 0;
    b = Math.imul(b ^ t.charCodeAt(i), 2246822519) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}

// ---------- words ----------
const RES_WORD: Record<Res, string> = { mc: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plants', energy: 'energy', heat: 'heat' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function blockText(b: Block, resource?: CardRes): string {
  switch (b.k) {
    case 'res': return b.n > 0 ? `gain ${b.n} ${RES_WORD[b.r]}` : `lose ${-b.n} ${RES_WORD[b.r]}`;
    case 'prod': return `${b.n > 0 ? '+' : '−'}${Math.abs(b.n)} ${RES_WORD[b.r]} production`;
    case 'tr': return `raise your TR ${plural(b.n, 'step')}`;
    case 'temp': return `raise the temperature ${plural(b.n, 'step')}`;
    case 'oxy': return `raise oxygen ${plural(b.n, 'step')}`;
    case 'venus': return `raise Venus ${plural(b.n, 'step')}`;
    case 'ocean': return 'place an ocean';
    case 'city': return 'place a city';
    case 'greenery': return 'place a greenery';
    case 'draw': return `draw ${plural(b.n, 'card')}`;
    case 'addRes': return `add ${plural(b.n, resource ?? 'resource')} here`;
    case 'removeAny': return `remove up to ${b.n} ${RES_WORD[b.r]} from any player`;
    case 'decProd': return `lower any player’s ${RES_WORD[b.r]} production ${plural(b.n, 'step')}`;
  }
}

const TRIGGER_TEXT: Record<Trigger, (tag?: Tag) => string> = {
  playTag: (t) => `When you play a ${t} tag`,
  anyPlayTag: (t) => `When anyone plays a ${t} tag`,
  placeCity: () => 'When you place a city',
  anyCity: () => 'When anyone places a city',
  placeGreenery: () => 'When you place a greenery',
  anyOcean: () => 'When anyone places an ocean',
};
export const triggerText = (e: { when: Trigger; tag?: Tag }) => TRIGGER_TEXT[e.when](e.tag);

const sentence = (xs: string[]) => { const t = xs.join(', '); return t ? t[0].toUpperCase() + t.slice(1) + '.' : ''; };

export function customText(c: CustomCard): string {
  const parts: string[] = [];
  if (c.play.length) parts.push(sentence(c.play.map((b) => blockText(b, c.resource))));
  if (c.action) {
    const cost = [c.action.costMC ? `${c.action.costMC} M€` : '', c.action.costRes ? `${c.action.costRes.n} ${RES_WORD[c.action.costRes.r]}` : '', c.action.spendHere ? plural(c.action.spendHere, c.resource ?? 'resource') + ' here' : ''].filter(Boolean).join(' and ');
    parts.push(`Action: ${cost ? `spend ${cost} to ` : ''}${c.action.gain.map((b) => blockText(b, c.resource)).join(', ')}.`);
  }
  if (c.effect) parts.push(`Effect: ${triggerText(c.effect).toLowerCase()}, ${c.effect.gain.map((b) => blockText(b, c.resource)).join(', ')}.`);
  return parts.join(' ');
}

// ---------- into the catalogue ----------
export function blockOp(b: Block): Op {
  switch (b.k) {
    case 'res': case 'prod': return { k: b.k, r: b.r, n: b.n };
    case 'tr': case 'temp': case 'oxy': case 'venus': case 'draw': return { k: b.k, n: b.n } as Op;
    case 'ocean': return { k: 'ocean' };
    case 'city': return { k: 'tile', tile: 'city', rule: 'city' };
    case 'greenery': return { k: 'tile', tile: 'greenery', rule: 'greenery' };
    case 'addRes': return { k: 'addRes', n: b.n, target: 'this' };
    case 'removeAny': return { k: 'removeAny', r: b.r, n: b.n };
    case 'decProd': return { k: 'decProd', r: b.r, n: b.n };
  }
}

/** A card definition the engine can use, from a checked custom card. */
export function compileCustom(c: CustomCard): CardDef {
  const def: CardDef = { id: c.id, name: c.name, type: c.type, cost: c.cost, tags: c.tags, set: 'custom', text: customText(c) };
  if (c.req) {
    const r: Req = {};
    const { param, min, max } = c.req;
    if (param === 'temp') { if (min !== undefined) r.temp = min; if (max !== undefined) r.tempMax = max; }
    if (param === 'oxy') { if (min !== undefined) r.oxy = min; if (max !== undefined) r.oxyMax = max; }
    if (param === 'oceans') { if (min !== undefined) r.oceans = min; if (max !== undefined) r.oceansMax = max; }
    if (param === 'venus') { if (min !== undefined) r.venus = min; if (max !== undefined) r.venusMax = max; }
    if (c.req.tag) r.tags = { [c.req.tag]: c.req.tagCount };
    def.req = r;
  }
  if (c.resource) def.resource = c.resource;
  if (c.vp) {
    if ('n' in c.vp) def.vp = c.vp.n;
    else {
      const per = c.vp.perRes;
      def.vp = (s: GameState, pid: number, id: string) => Math.floor((P(s, pid).cardRes[id] ?? 0) / per);
      def.vpText = `1 VP per ${plural(per, c.resource ?? 'resource')} here`;
    }
  }
  if (c.play.length) {
    const ops = c.play.map(blockOp);
    def.play = () => ops.map((o) => ({ ...o }));
  }
  if (c.action) {
    const a = c.action;
    const gain = a.gain.map(blockOp);
    const act: CardAction = {
      text: customText({ ...c, play: [], effect: undefined }).replace(/^Action: /, ''),
      can: (s, pid, id) => (!a.costRes || P(s, pid).res[a.costRes.r] >= a.costRes.n) && (!a.spendHere || (P(s, pid).cardRes[id] ?? 0) >= a.spendHere),
      run: () => [
        ...(a.costRes ? [{ k: 'res', r: a.costRes.r, n: -a.costRes.n } as Op] : []),
        ...(a.spendHere ? [{ k: 'addRes', n: -a.spendHere, target: 'this' } as Op] : []),
        ...gain.map((o) => ({ ...o })),
      ],
    };
    if (a.costMC) act.mc = a.costMC;
    def.action = act;
  }
  if (c.effect) {
    const e = c.effect;
    const gain = () => e.gain.map((b) => blockOp(b));
    if (e.when === 'playTag' || e.when === 'anyPlayTag') {
      def.onCard = (_s, owner, player, card) => ((e.when === 'anyPlayTag' || owner === player) && card.tags.includes(e.tag!) ? gain() : []);
    } else {
      const kind = e.when === 'anyOcean' ? 'ocean' : e.when === 'placeGreenery' ? 'greenery' : 'city';
      const anyone = e.when === 'anyCity' || e.when === 'anyOcean';
      def.onTile = (_s, owner, placer, sp) => ((anyone || owner === placer) && sp.tile?.kind === kind ? gain() : []);
    }
  }
  return def;
}

/** Adds custom cards to the catalogue (once each; ids are content hashes). */
export function registerCustom(cards: readonly CustomCard[] | undefined): void {
  for (const c of cards ?? []) if (!CARDS[c.id]) CARDS[c.id] = compileCustom(c);
}

/** Makes sure a game's custom cards are in the catalogue before anything looks them up. */
export const ensureCustom = (s: Pick<GameState, 'options'>) => registerCustom(s.options.custom);

/** The most custom cards one game can carry. */
export const MAX_CUSTOM = 60;

/** Checks a list sent with a new game: every card valid and its id matching its content. */
export function cleanCustomList(list: unknown): CustomCard[] {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > MAX_CUSTOM) fail(`Up to ${MAX_CUSTOM} custom cards`);
  const out = (list as unknown[]).map((c) => finishCustom(c));
  return [...new Map(out.map((c) => [c.id, c])).values()];
}
