// Fathom rules engine: createGame + applyAction. Every rule is enforced here; the UI and CPUs
// only ever go through applyAction (or applyActionMut on their own copies).
import { BAIT, DECK, FISH, fishDef, SITE_NAMES, STARTERS } from './cards';
import {
  ABYSS, COLS, DIVERS, ROWS, SCHOOL_PTS, SHALLOWS, SLOTS, TIDES, colOf, rowOf, slotOf, zoneOf, zoneOfRow,
  type Effect, type FAction, type Filter, type FOptions, type FPlayer, type FPrompt, type FState, type GoalId,
  type PromptOption, type QueueItem, type SeatSpec, type Slot, type Zone,
} from './types';

// ---------------------------------------------------------------- randomness

export function rand(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function shuffle<T>(s: { rng: number }, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

const fail = (msg: string): never => { throw new Error(msg); };

// ---------------------------------------------------------------- the ocean

/** Printed bait fish, the eggs on two of them, and the starting fry. */
export const BAIT_SLOTS = [slotOf(1, 0), slotOf(3, 1), slotOf(4, 2)];
const START_EGGS = [slotOf(1, 0), slotOf(3, 1)];
const START_FRY = slotOf(2, 2);

/** Dive site bonuses: the top one needs a fish in the site's Sunlight rows, and so on down. */
export const TOP_BONUS: Effect[] = [{ k: 'draw', n: 1 }, { k: 'egg', n: 1 }, { k: 'hatch', n: 1 }];
export const TWI_BONUS: Effect[] = [{ k: 'egg', n: 1 }, { k: 'hatch', n: 1 }, { k: 'draw', n: 1 }];
export const MID_BONUS: Effect[] = [{ k: 'hatch', n: 1 }, { k: 'draw', n: 1 }, { k: 'egg', n: 1 }];
/** the first dive to reach the bottom of a site each tide */
export const BOTTOM_BONUS: Effect[][] = [[{ k: 'draw', n: 2 }], [{ k: 'egg', n: 2 }], [{ k: 'fry', n: 1 }, { k: 'move' }]];

const emptySlot = (): Slot => ({ fish: [], egg: false, fry: 0, school: false });

export function startingOcean(): Slot[] {
  const o = Array.from({ length: SLOTS }, emptySlot);
  for (const i of BAIT_SLOTS) o[i].fish.push(BAIT);
  for (const i of START_EGGS) o[i].egg = true;
  o[START_FRY].fry = 1;
  return o;
}

export const top = (sl: Slot): string | null => sl.fish[sl.fish.length - 1] ?? null;
export const slotName = (i: number) => `${SITE_NAMES[colOf(i)]} ${rowOf(i) + 1}`;

// ---------------------------------------------------------------- goals

export interface GoalDef { id: GoalId; name: string; text: string; per: number; metric: (p: FPlayer) => number }

export const GOALS: Record<GoalId, GoalDef> = {
  brood: { id: 'brood', name: 'Brood', text: '1 point per egg and per fry', per: 1, metric: (p) => p.ocean.reduce((n, x) => n + (x.egg ? 1 : 0) + x.fry, 0) },
  rows: { id: 'rows', name: 'Full rows', text: '2 points per row with a fish in all three sites', per: 2, metric: (p) => range(ROWS).filter((r) => range(COLS).every((c) => top(p.ocean[slotOf(r, c)]))).length },
  schools: { id: 'schools', name: 'Schools', text: '3 points per school', per: 3, metric: (p) => p.ocean.filter((x) => x.school).length },
  hunters: { id: 'hunters', name: 'Hunters', text: '1 point per Predator tag', per: 1, metric: (p) => tagCount(p, 'predator') },
  deep: { id: 'deep', name: 'Deep dwellers', text: '1 point per fish in Midnight', per: 1, metric: (p) => fishInZone(p, 'mid') },
  sunlit: { id: 'sunlit', name: 'Sunlit', text: '1 point per fish in Sunlight', per: 1, metric: (p) => fishInZone(p, 'sun') },
  giants: { id: 'giants', name: 'Giants', text: '2 points per fish of length 5 or more', per: 2, metric: (p) => p.ocean.filter((x) => top(x) && fishDef(top(x)!).len >= 5).length },
  feast: { id: 'feast', name: 'Feast', text: '2 points per fish eaten', per: 2, metric: (p) => eatenCount(p) },
  columns: { id: 'columns', name: 'Plumb lines', text: '3 points per site with a fish in every zone', per: 3, metric: (p) => range(COLS).filter((c) => (['sun', 'twi', 'mid'] as Zone[]).every((z) => range(ROWS).some((r) => zoneOfRow(r) === z && top(p.ocean[slotOf(r, c)])))).length },
};
export const GOAL_IDS = Object.keys(GOALS) as GoalId[];
export const CLASSIC_GOALS: GoalId[] = ['brood', 'rows', 'schools'];
export const goalPoints = (p: FPlayer, g: GoalId) => GOALS[g].metric(p) * GOALS[g].per;

function range(n: number) { return Array.from({ length: n }, (_, i) => i); }
export function tagCount(p: FPlayer, tag: string): number {
  return p.ocean.reduce((n, x) => { const t = top(x); return n + (t ? fishDef(t).tags.filter((y) => y === tag).length : 0); }, 0);
}
export const fishInZone = (p: FPlayer, z: Zone) => p.ocean.filter((x, i) => zoneOf(i) === z && top(x)).length;
export const eatenCount = (p: FPlayer) => p.ocean.reduce((n, x) => n + Math.max(0, x.fish.length - 1), 0);

// ---------------------------------------------------------------- setup

export function createGame(seats: SeatSpec[], opts: Partial<FOptions> = {}): FState {
  if (seats.length < 1 || seats.length > 5) fail('Fathom takes 1 to 5 players');
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const s: FState = {
    game: 'fathom', v: 1, options: { seed, variable: !!opts.variable }, rng: seed, phase: 'play', tide: 1, turn: 0, first: 0, active: 0,
    players: [], deck: [], goals: [], queue: [], prompt: null, acting: null, log: [], lastDive: null, history: [],
  };
  s.deck = shuffle(s, [...DECK]);
  const starters = shuffle(s, [...STARTERS]);
  s.goals = s.options.variable ? shuffle(s, [...GOAL_IDS]).slice(0, 3) : [...CLASSIC_GOALS];
  s.players = seats.map((x, id) => ({
    id, name: x.name, color: x.color, cpu: x.cpu, hand: [starters.pop()!, starters.pop()!], discard: [], ocean: startingOcean(),
    divers: DIVERS, bottom: [false, false, false], goals: [], stats: { released: 0, dives: 0, eaten: 0 },
  }));
  for (const p of s.players) draw(s, p, 3);
  s.first = Math.floor(rand(s) * seats.length);
  s.active = s.first;
  log(s, null, `Tide 1 begins. ${s.players[s.first].name} goes first.`);
  return s;
}

function log(s: FState, pid: number | null, text: string) {
  s.log.push({ tide: s.tide, pid, text });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}

export function draw(s: FState, p: FPlayer, n: number): number {
  let got = 0;
  for (let i = 0; i < n; i++) {
    if (!s.deck.length) {
      // a dry deck is refilled from everyone's discard piles
      const pile = s.players.flatMap((x) => x.discard.splice(0));
      if (!pile.length) break;
      s.deck = shuffle(s, pile);
      log(s, null, 'The deck ran dry: the discard piles were shuffled into a new one.');
    }
    p.hand.push(s.deck.pop()!);
    got++;
  }
  return got;
}

// ---------------------------------------------------------------- queries

export const decider = (s: FState) => (s.prompt ? s.prompt.pid : s.active);

/** Can this fish go in this slot of this player's ocean (ignoring costs)? */
export function canPlace(p: FPlayer, card: string, slot: number): boolean {
  const d = FISH[card];
  if (!d || slot < 0 || slot >= SLOTS) return false;
  const row = rowOf(slot);
  if (!d.zones.includes(zoneOfRow(row))) return false;
  if (d.site !== undefined && colOf(slot) !== d.site) return false;
  if (d.edge === 'shallows' && row !== SHALLOWS) return false;
  if (d.edge === 'abyss' && row !== ABYSS) return false;
  const t = top(p.ocean[slot]);
  if (t && fishDef(t).len >= d.len) return false;
  if (d.cost.eat && !t) return false;
  return true;
}

export const legalSlots = (p: FPlayer, card: string) => range(SLOTS).filter((i) => canPlace(p, card, i));
export const eggCount = (p: FPlayer) => p.ocean.filter((x) => x.egg).length;
export const fryCount = (p: FPlayer) => p.ocean.reduce((n, x) => n + x.fry, 0);

/** Can the player pay for this fish at all (enough cards, eggs and fry, and somewhere to put it)? */
export function canAfford(p: FPlayer, card: string): boolean {
  const c = FISH[card]?.cost;
  if (!c) return false;
  return p.hand.length - 1 >= (c.cards ?? 0) && eggCount(p) >= (c.eggs ?? 0) && fryCount(p) >= (c.fry ?? 0) && legalSlots(p, card).length > 0;
}

export function whyNot(p: FPlayer, card: string): string | null {
  const c = FISH[card].cost;
  if (p.hand.length - 1 < (c.cards ?? 0)) return `Needs ${c.cards} other card${c.cards === 1 ? '' : 's'} to discard`;
  if (eggCount(p) < (c.eggs ?? 0)) return `Needs ${c.eggs} egg${c.eggs === 1 ? '' : 's'}`;
  if (fryCount(p) < (c.fry ?? 0)) return `Needs ${c.fry} fry`;
  if (!legalSlots(p, card).length) return FISH[card].cost.eat ? 'Nothing smaller to eat where it can live' : 'No room where it can live';
  return null;
}

function matches(p: FPlayer, i: number, where: Filter | undefined, srcSlot: number | undefined): boolean {
  const t = top(p.ocean[i]);
  if (!t) return false;
  if (!where) return true;
  if (where.zone && zoneOf(i) !== where.zone) return false;
  if (where.tag && !fishDef(t).tags.includes(where.tag)) return false;
  if (where.sameCol && (srcSlot === undefined || colOf(i) !== colOf(srcSlot))) return false;
  return true;
}

export function eggTargets(p: FPlayer, where?: Filter, srcSlot?: number): number[] {
  return range(SLOTS).filter((i) => !p.ocean[i].egg && matches(p, i, where, srcSlot));
}

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/** Every legal move of one fry or one school in a straight line. */
export function moveOptions(p: FPlayer): PromptOption[] {
  const out: PromptOption[] = [];
  for (let from = 0; from < SLOTS; from++) {
    const a = p.ocean[from];
    for (const [dr, dc] of DIRS) {
      let r = rowOf(from) + dr, c = colOf(from) + dc;
      // fry: passing a slot with two fry (and no school) makes a school there and stops
      if (a.fry > 0) {
        for (let rr = r, cc = c; rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS; rr += dr, cc += dc) {
          const to = slotOf(rr, cc);
          out.push({ label: `Fry: ${slotName(from)} → ${slotName(to)}`, move: { from, to, what: 'fry' } });
          const b = p.ocean[to];
          if (b.fry === 2 && !b.school) break;
        }
      }
      // a school can't enter or pass a slot with a school
      if (a.school) {
        for (; r >= 0 && r < ROWS && c >= 0 && c < COLS; r += dr, c += dc) {
          const to = slotOf(r, c);
          if (p.ocean[to].school) break;
          out.push({ label: `School: ${slotName(from)} → ${slotName(to)}`, move: { from, to, what: 'school' } });
        }
      }
    }
  }
  return out;
}

function addFry(sl: Slot, n: number) {
  sl.fry += n;
  formSchool(sl);
}
function formSchool(sl: Slot) {
  if (!sl.school && sl.fry >= 3) { sl.fry -= 3; sl.school = true; }
}

// ---------------------------------------------------------------- scoring

export interface Score { fish: number; eaten: number; eggs: number; fry: number; schools: number; abilities: number; goals: number; total: number }

export function endAbility(p: FPlayer, i: number): number {
  const t = top(p.ocean[i]);
  const r = t ? fishDef(t).end : undefined;
  if (!r) return 0;
  switch (r.k) {
    case 'tag': return tagCount(p, r.tag) * r.pts;
    case 'zone': return fishInZone(p, r.zone) * r.pts;
    case 'eggsCol': return range(ROWS).filter((row) => p.ocean[slotOf(row, colOf(i))].egg).length * r.pts;
    case 'fishCol': return range(ROWS).filter((row) => top(p.ocean[slotOf(row, colOf(i))])).length * r.pts;
    case 'schools': return p.ocean.filter((x) => x.school).length * r.pts;
    case 'hand': return Math.min(p.hand.length, r.max) * r.pts;
    case 'beneath': return (p.ocean[i].fish.length - 1) * r.pts;
  }
}

export function score(s: FState, pid: number): Score {
  const p = s.players[pid];
  const sc: Score = { fish: 0, eaten: 0, eggs: 0, fry: 0, schools: 0, abilities: 0, goals: 0, total: 0 };
  p.ocean.forEach((x, i) => {
    const t = top(x);
    if (t) sc.fish += fishDef(t).pts;
    sc.eaten += Math.max(0, x.fish.length - 1);
    if (x.egg) sc.eggs++;
    sc.fry += x.fry;
    if (x.school) sc.schools += SCHOOL_PTS;
    sc.abilities += endAbility(p, i);
  });
  sc.goals = p.goals.reduce((a, b) => a + b, 0);
  sc.total = sc.fish + sc.eaten + sc.eggs + sc.fry + sc.schools + sc.abilities + sc.goals;
  return sc;
}

/** Final order: forfeited players last, then points, then cards in hand. */
export function standings(s: FState): { pid: number; sc: Score }[] {
  return s.players.map((p) => ({ pid: p.id, sc: score(s, p.id) }))
    .sort((a, b) => Number(!!s.players[a.pid].forfeited) - Number(!!s.players[b.pid].forfeited)
      || b.sc.total - a.sc.total || s.players[b.pid].hand.length - s.players[a.pid].hand.length);
}

// ---------------------------------------------------------------- actions

export function applyAction(state: FState, a: FAction): FState {
  const s = structuredClone(state);
  applyActionMut(s, a);
  return s;
}

export function applyActionMut(s: FState, a: FAction): FState {
  if (s.phase === 'over') fail('The game is over');
  if (a.t === 'answer') {
    if (!s.prompt) fail('Nothing to answer');
    answer(s, a.choice);
    run(s);
    return s;
  }
  if (s.prompt || s.acting !== null) fail('Finish the current choice first');
  const p = s.players[s.active];
  if (p.divers <= 0) fail('No divers left this tide');
  if (a.t === 'release') release(s, p, a);
  else if (a.t === 'dive') dive(s, p, a.col);
  else fail('Unknown action');
  run(s);
  return s;
}

function release(s: FState, p: FPlayer, a: Extract<FAction, { t: 'release' }>) {
  const d = FISH[a.card];
  if (!d || !p.hand.includes(a.card)) fail('That fish is not in your hand');
  if (!canPlace(p, a.card, a.slot)) fail(`${d.name} can't go there`);
  const c = d.cost;
  const pay = a.pay ?? { cards: [], eggs: [], fry: [] };
  // cards
  const cards = pay.cards ?? [];
  if (cards.length !== (c.cards ?? 0) || new Set(cards).size !== cards.length || cards.some((x) => x === a.card || !p.hand.includes(x))) fail(`Discard exactly ${c.cards ?? 0} other card${c.cards === 1 ? '' : 's'}`);
  // eggs
  const eggs = pay.eggs ?? [];
  if (eggs.length !== (c.eggs ?? 0) || new Set(eggs).size !== eggs.length || eggs.some((i) => !p.ocean[i]?.egg)) fail(`Pay exactly ${c.eggs ?? 0} egg${c.eggs === 1 ? '' : 's'}`);
  // fry
  const fry = pay.fry ?? [];
  const need = new Map<number, number>();
  for (const i of fry) need.set(i, (need.get(i) ?? 0) + 1);
  if (fry.length !== (c.fry ?? 0) || [...need].some(([i, n]) => !p.ocean[i] || p.ocean[i].fry < n)) fail(`Pay exactly ${c.fry ?? 0} fry`);

  for (const x of cards) { p.hand.splice(p.hand.indexOf(x), 1); p.discard.push(x); }
  for (const i of eggs) p.ocean[i].egg = false;
  for (const [i, n] of need) p.ocean[i].fry -= n;
  p.hand.splice(p.hand.indexOf(a.card), 1);
  const sl = p.ocean[a.slot];
  const eaten = top(sl);
  sl.fish.push(a.card);
  p.divers--;
  p.stats.released++;
  if (eaten) p.stats.eaten++;
  s.acting = p.id;
  log(s, p.id, `${p.name} released ${d.name} at ${slotName(a.slot)}${eaten ? `, eating ${eaten === BAIT ? 'a bait shoal' : FISH[eaten].name}` : ''}.`);
  for (const e of d.play ?? []) s.queue.push({ pid: p.id, e, src: d.name, slot: a.slot });
}

function dive(s: FState, p: FPlayer, col: number) {
  if (!Number.isInteger(col) || col < 0 || col >= COLS) fail('No such dive site');
  const has = (rows: number[]) => rows.some((r) => top(p.ocean[slotOf(r, col)]));
  const q: QueueItem[] = [];
  const site = SITE_NAMES[col];
  if (has([0, 1])) q.push({ pid: p.id, e: TOP_BONUS[col], src: `${site}: Sunlight bonus` });
  for (let r = 0; r < ROWS; r++) {
    if (r === 2 && has([2, 3])) q.push({ pid: p.id, e: TWI_BONUS[col], src: `${site}: Twilight bonus` });
    if (r === 4 && has([4, 5])) q.push({ pid: p.id, e: MID_BONUS[col], src: `${site}: Midnight bonus` });
    const i = slotOf(r, col);
    const t = top(p.ocean[i]);
    for (const e of t ? fishDef(t).dive ?? [] : []) q.push({ pid: p.id, e, src: FISH[t!].name, slot: i });
  }
  if (!p.bottom[col]) {
    p.bottom[col] = true;
    for (const e of BOTTOM_BONUS[col]) q.push({ pid: p.id, e, src: `${site}: first to the bottom` });
  }
  p.divers--;
  p.stats.dives++;
  s.acting = p.id;
  s.lastDive = { pid: p.id, col, turn: s.turn };
  log(s, p.id, `${p.name} dove the ${site} site.`);
  s.queue.push(...q);
}

/** Resolves queued effects until one needs a choice; ends the turn when nothing is left. */
function run(s: FState) {
  while (!s.prompt && s.queue.length) resolve(s, s.queue.shift()!);
  if (!s.prompt && !s.queue.length && s.acting !== null) {
    s.acting = null;
    endTurn(s);
  }
}

function resolve(s: FState, it: QueueItem) {
  const p = s.players[it.pid];
  const e = it.e;
  const ask = (kind: FPrompt['kind'], title: string, options: PromptOption[], left = 0, auto = false) => {
    if (!options.length) return;
    if (auto && options.length === 1) {
      apply(s, p, kind, options[0], it.src);
      if (left > 0 && 'n' in e) s.queue.unshift({ ...it, e: { ...e, n: left } as Effect });
      return;
    }
    s.prompt = { pid: p.id, kind, title, src: it.src, options, left, item: it, srcSlot: it.slot };
  };
  switch (e.k) {
    case 'draw': {
      const got = draw(s, p, e.n);
      if (got) log(s, p.id, `${p.name} drew ${got} card${got === 1 ? '' : 's'} (${it.src}).`);
      return;
    }
    case 'egg':
      return ask('egg', e.n > 1 ? `Lay an egg (up to ${e.n})` : 'Lay an egg', eggTargets(p, e.where, it.slot).map((i) => ({ label: slotName(i), slot: i })), e.n - 1, true);
    case 'eggEach': {
      const xs = eggTargets(p, e.where, it.slot);
      for (const i of xs) p.ocean[i].egg = true;
      if (xs.length) log(s, p.id, `${p.name} laid ${xs.length} egg${xs.length === 1 ? '' : 's'} (${it.src}).`);
      return;
    }
    case 'hatch':
      return ask('hatch', e.n > 1 ? `Hatch an egg (up to ${e.n})` : 'Hatch an egg', p.ocean.flatMap((x, i) => (x.egg ? [{ label: slotName(i), slot: i }] : [])), e.n - 1, true);
    case 'fry':
      return ask('fry', e.n > 1 ? `Place a fry (${e.n} to place)` : 'Place a fry', p.ocean.map((_, i) => ({ label: slotName(i), slot: i })), e.n - 1);
    case 'move':
      return ask('move', 'Move a fry or a school', moveOptions(p));
    case 'recover': {
      if (!p.discard.length) { if (draw(s, p, 1)) log(s, p.id, `${p.name} drew a card (${it.src}).`); return; }
      return ask('recover', 'Take a card back from your discard pile', [...new Set(p.discard)].map((c) => ({ label: FISH[c].name, card: c })), 0, true);
    }
    case 'cycle':
      return ask('cycle', 'Discard a card to draw one', p.hand.map((c) => ({ label: FISH[c].name, card: c })));
    case 'all': {
      for (const q of s.players) {
        if (q.forfeited && q.id !== p.id) continue;
        resolve(s, { pid: q.id, e: e.e, src: it.src, slot: q.id === p.id ? it.slot : undefined });
      }
      return;
    }
  }
}

function apply(s: FState, p: FPlayer, kind: FPrompt['kind'], o: PromptOption, src: string) {
  switch (kind) {
    case 'egg':
      p.ocean[o.slot!].egg = true;
      log(s, p.id, `${p.name} laid an egg at ${slotName(o.slot!)} (${src}).`);
      return;
    case 'hatch':
      p.ocean[o.slot!].egg = false;
      addFry(p.ocean[o.slot!], 1);
      log(s, p.id, `${p.name} hatched an egg at ${slotName(o.slot!)} (${src}).`);
      return;
    case 'fry':
      addFry(p.ocean[o.slot!], 1);
      log(s, p.id, `${p.name} placed a fry at ${slotName(o.slot!)} (${src}).`);
      return;
    case 'move': {
      const { from, to, what } = o.move!;
      const a = p.ocean[from], b = p.ocean[to];
      if (what === 'fry') { a.fry--; addFry(b, 1); }
      else { a.school = false; b.school = true; formSchool(a); }
      log(s, p.id, `${p.name} moved a ${what} from ${slotName(from)} to ${slotName(to)} (${src}).`);
      return;
    }
    case 'recover':
      p.discard.splice(p.discard.indexOf(o.card!), 1);
      p.hand.push(o.card!);
      log(s, p.id, `${p.name} took ${FISH[o.card!].name} back from the discard pile (${src}).`);
      return;
    case 'cycle':
      p.hand.splice(p.hand.indexOf(o.card!), 1);
      p.discard.push(o.card!);
      draw(s, p, 1);
      log(s, p.id, `${p.name} swapped ${FISH[o.card!].name} for a new card (${src}).`);
      return;
  }
}

function answer(s: FState, choice: number | null) {
  const pr = s.prompt!;
  const it = pr.item;
  s.prompt = null;
  if (choice === null) {
    log(s, pr.pid, `${s.players[pr.pid].name} skipped: ${pr.title.toLowerCase()}.`);
    return;
  }
  const o = pr.options[choice];
  if (!o) { s.prompt = pr; fail('Not one of the choices'); }
  apply(s, s.players[pr.pid], pr.kind, o, pr.src);
  if (pr.left > 0 && 'n' in it.e) s.queue.unshift({ ...it, e: { ...it.e, n: pr.left } as Effect });
}

function endTurn(s: FState) {
  s.turn++;
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const q = s.players[(s.active + k) % n];
    if (q.divers > 0) { s.active = q.id; return; }
  }
  endTide(s);
}

function endTide(s: FState) {
  if (s.tide <= 3) {
    const g = s.goals[s.tide - 1];
    const pts = s.players.map((p) => goalPoints(p, g));
    const best = Math.max(...pts);
    s.players.forEach((p, i) => {
      const bonus = s.options.variable && best > 0 && pts[i] === best ? 3 : 0;
      p.goals[s.tide - 1] = pts[i] + bonus;
    });
    log(s, null, `End of tide ${s.tide}: ${GOALS[g].name} scored ${s.players.map((p) => `${p.name} ${p.goals[s.tide - 1]}`).join(', ')}.`);
  }
  s.history.push(s.players.map((p) => score(s, p.id).total));
  if (s.tide >= TIDES) return endGame(s);
  s.tide++;
  s.first = (s.first + 1) % s.players.length;
  s.active = s.first;
  for (const p of s.players) { p.divers = DIVERS; p.bottom = [false, false, false]; }
  log(s, null, `Tide ${s.tide} begins. ${s.players[s.first].name} goes first.`);
}

function endGame(s: FState) {
  s.phase = 'over';
  s.prompt = null;
  s.queue = [];
  s.acting = null;
  const w = standings(s)[0];
  log(s, null, `Final scoring: ${s.players[w.pid].name} wins with ${w.sc.total} points.`);
}

/**
 * A player gives up. Their seat is played out by a Normal CPU so everyone else can finish, and
 * they rank last. If that leaves fewer than two players, or no human, the game ends now.
 */
export function forfeitMut(s: FState, pid: number): FState {
  const p = s.players[pid];
  if (!p || s.phase === 'over') fail('The game is over');
  if (p.forfeited) fail(`${p.name} has already forfeited`);
  p.forfeited = true;
  log(s, pid, `${p.name} forfeited.`);
  const left = s.players.filter((x) => !x.forfeited);
  if (left.length < 2 || !left.some((x) => !x.cpu)) {
    s.endedBy = 'forfeit';
    s.history.push(s.players.map((x) => score(s, x.id).total));
    endGame(s);
    return s;
  }
  p.cpu ??= 'normal';
  return s;
}

export const forfeit = (state: FState, pid: number) => forfeitMut(structuredClone(state), pid);

/** Turns left for this player, this one included. */
export const turnsLeft = (s: FState, pid: number) => s.players[pid].divers + DIVERS * (TIDES - s.tide);

export { fishDef };
