// Card symbols, Terraforming-Mars style. Rather than hand-drawing 400 cards, each card's real
// effect ops are probed against two sample games and turned into icon rows: a production box,
// immediate gains, "cost → result" actions and "trigger : result" effects. Amounts that differ
// between the two samples ("per Jovian tag", "per city") are shown as X. Anything the probe can't
// express is simply left out; the card text below the symbols still says it in words.
import type { CardDef } from '../engine/cards';
import { CARDS } from '../engine/cards';
import { createGame } from '../engine/game';
import type { CardRes, GameState, Op, Res, Space, Tag, TileKind } from '../engine/types';
import { TAGS } from '../engine/types';

export type Amt = number | 'X';

export type Sym =
  | { s: 'res'; r: Res; n: Amt; any?: boolean }
  /** production box; its parts are 'res' symbols */
  | { s: 'prod'; parts: Sym[] }
  | { s: 'tr' | 'temp' | 'oxy' | 'ocean' | 'venus' | 'draw' | 'colony' | 'fleet' | 'trade' | 'delegate' | 'discard'; n: Amt }
  | { s: 'tile'; tile: TileKind; n: Amt }
  /** card resource; 'other' = another card (asterisk), any = from any player's card */
  | { s: 'cardres'; rtype: CardRes | null; n: Amt; target: 'this' | 'other'; any?: boolean }
  | { s: 'look'; n: Amt; keep: number }
  | { s: 'tag'; tag: Tag | 'any' }
  | { s: 'anyone' }
  | { s: 'big' }
  | { s: 'req' ; n: number }
  | { s: 'paywith'; rtype: CardRes; value: number }
  | { s: 'choose'; options: Line[] };

/** One "left → right" line. Plain gains have an empty left. */
export interface Line { left: Sym[]; right: Sym[] }

export interface Row extends Line { kind: 'play' | 'first' | 'action' | 'effect' }

// ---------- sample games ----------
let probes: [GameState, GameState] | null = null;

function sampleGames(): [GameState, GameState] {
  if (probes) return probes;
  const seats = [0, 1, 2].map((i) => ({ name: `P${i}`, color: '#888', cpu: null }));
  const a = createGame(seats, { seed: 7, expansions: { prelude: true, venus: true, colonies: true, turmoil: true } });
  const b = structuredClone(a);
  // mid-game: tags, cities, greeneries, oceans and card resources everywhere
  const projects = Object.values(CARDS).filter((c) => c.type !== 'corp' && c.type !== 'prelude');
  b.players.forEach((p, i) => {
    p.played = projects.filter((_, k) => k % 7 === i + 1).map((c) => c.id);
    for (const id of p.played) if (CARDS[id].resource) p.cardRes[id] = 5;
    p.prod = { mc: 6, steel: 3, titanium: 2, plants: 4, energy: 5, heat: 4 };
    p.res = { mc: 40, steel: 6, titanium: 5, plants: 9, energy: 6, heat: 11 };
    p.tr = 31 + i;
  });
  const land = b.board.filter((x) => x.type === 'land');
  land.slice(0, 18).forEach((sp, k) => { sp.tile = { kind: k % 3 === 0 ? 'city' : 'greenery', owner: k % 3 }; });
  b.board.filter((x) => x.type === 'ocean').slice(0, 4).forEach((sp) => { sp.tile = { kind: 'ocean', owner: null }; });
  b.oceans = 4;
  b.temperature = -12;
  b.oxygen = 6;
  if (b.venus !== undefined) b.venus = 12;
  b.colonies?.forEach((c, k) => { c.colonies = [k % 3]; c.track = 3; });
  b.generation = 5;
  probes = [a, b];
  return probes;
}

const safe = (f: () => Op[] | undefined): Op[] | null => {
  try { return f() ?? []; } catch { return null; }
};

/** Merge the same ops from two samples: numbers that differ (or are 0) become X. */
function merge(a: Op[] | null, b: Op[] | null): Op[] {
  if (!a || !b) return a ?? b ?? [];
  if (a.length !== b.length || a.some((o, i) => o.k !== b[i].k)) return a.length >= b.length ? a : b;
  return a.map((o, i) => {
    const p = b[i];
    if (o.k === 'choose' && p.k === 'choose' && o.options.length === p.options.length) {
      return { ...o, options: o.options.map((x, j) => ({ ...x, ops: merge(x.ops, p.options[j].ops) })) };
    }
    if ('n' in o && 'n' in p && typeof o.n === 'number') {
      const same = o.n === p.n && o.n !== 0;
      return same ? o : ({ ...o, n: 'X' } as unknown as Op);
    }
    return o;
  });
}

/** Run a card function against both samples (each on a fresh copy) and merge. */
function probe(f: (s: GameState) => Op[] | undefined): Op[] {
  const [a, b] = sampleGames();
  return merge(safe(() => f(structuredClone(a))), safe(() => f(structuredClone(b))));
}

// ---------- ops → symbols ----------
const num = (n: unknown): Amt => (typeof n === 'number' ? n : 'X');
const neg = (n: Amt): Amt => (n === 'X' ? 'X' : -n);

function opSym(op: Op, card: CardDef): Sym | Sym[] | null {
  switch (op.k) {
    case 'res': return { s: 'res', r: op.r, n: num(op.n) };
    case 'prod': return { s: 'prod', parts: [{ s: 'res', r: op.r, n: num(op.n) }] };
    case 'decProd': {
      const parts: Sym[] = [{ s: 'res', r: op.r, n: neg(num(op.n)), any: true }];
      if (op.gain) parts.push({ s: 'res', r: op.r, n: num(op.n) });
      return { s: 'prod', parts };
    }
    case 'tr': return { s: 'tr', n: num(op.n) };
    case 'temp': return { s: 'temp', n: num(op.n) };
    case 'lowerTemp': return { s: 'temp', n: neg(num(op.n)) };
    case 'oxy': return { s: 'oxy', n: num(op.n) };
    case 'venus': return { s: 'venus', n: num(op.n) };
    case 'ocean': return { s: 'ocean', n: 1 };
    case 'tile': return op.tile === 'ocean' ? { s: 'ocean', n: 1 } : { s: 'tile', tile: op.tile, n: 1 };
    case 'removeAny': return { s: 'res', r: op.r, n: neg(num(op.n)), any: true };
    case 'steal': return [{ s: 'res', r: op.r, n: neg(num(op.n)), any: true }, { s: 'res', r: op.r, n: num(op.n) }];
    case 'addRes': {
      const n = num(op.n);
      const target = op.target === 'this' ? 'this' : 'other';
      const rtype = op.rtype ?? (op.target === 'this' ? card.resource ?? null : null);
      return { s: 'cardres', rtype, n, target };
    }
    case 'removeCardRes': {
      const out: Sym[] = [{ s: 'cardres', rtype: op.rtype, n: neg(num(op.n)), target: 'other', any: true }];
      if (op.gainTo) out.push({ s: 'cardres', rtype: op.rtype, n: num(op.n), target: 'this' });
      return out;
    }
    case 'spendRes': return { s: 'cardres', rtype: op.rtype, n: neg(num(op.n)), target: 'other' };
    case 'draw': return { s: 'draw', n: num(op.n) };
    case 'drawMatching': return { s: 'draw', n: num(op.n) };
    case 'look': return { s: 'look', n: num(op.n), keep: op.keep };
    case 'discard': return { s: 'discard', n: num(op.n) };
    case 'pay': return { s: 'res', r: 'mc', n: neg(num(op.n)) };
    case 'colony': return { s: 'colony', n: 1 };
    case 'fleet': return { s: 'fleet', n: num(op.n) };
    case 'trade': return { s: 'trade', n: 1 };
    case 'delegate': return { s: 'delegate', n: num(op.n) };
    case 'choose': return { s: 'choose', options: op.options.map((o) => line(o.ops, card, true)) };
    default: return null;
  }
}

/** A cost: something of yours that goes down (M€, resources, production, card resources). */
function isCost(x: Sym): boolean {
  if (x.s === 'res') return !x.any && typeof x.n === 'number' && x.n < 0;
  if (x.s === 'prod') return x.parts.every((p) => p.s === 'res' && !p.any && typeof p.n === 'number' && p.n < 0);
  if (x.s === 'cardres') return !x.any && typeof x.n === 'number' && x.n < 0;
  return false;
}

/** Group same symbols (two oceans → one ocean ×2), production into one box placed first. */
function tidy(syms: Sym[]): Sym[] {
  const prodParts: Sym[] = [];
  const rest: Sym[] = [];
  for (const x of syms) {
    if (x.s === 'prod') prodParts.push(...x.parts);
    else {
      const last = rest[rest.length - 1];
      if (last && (x.s === 'ocean' || x.s === 'tile') && last.s === x.s && (x.s !== 'tile' || (last as { tile: TileKind }).tile === x.tile)
        && typeof last.n === 'number' && typeof x.n === 'number') {
        last.n += x.n;
      } else rest.push(x);
    }
  }
  // merge production of the same resource (e.g. two +1 M€ steps)
  const merged: Sym[] = [];
  for (const p of prodParts) {
    const m = merged.find((q) => q.s === 'res' && p.s === 'res' && q.r === p.r && !!q.any === !!p.any && typeof q.n === 'number' && typeof p.n === 'number' && Math.sign(q.n) === Math.sign(p.n));
    if (m && m.s === 'res' && p.s === 'res' && typeof m.n === 'number' && typeof p.n === 'number') m.n += p.n;
    else merged.push({ ...p });
  }
  // losses first inside the box, as on the printed cards
  merged.sort((x, y) => Number(x.s === 'res' && typeof x.n === 'number' && x.n > 0) - Number(y.s === 'res' && typeof y.n === 'number' && y.n > 0));
  return merged.length ? [{ s: 'prod', parts: merged }, ...rest] : rest;
}

function line(ops: Op[], card: CardDef, split: boolean): Line {
  const syms: Sym[] = [];
  for (const op of ops) {
    const x = opSym(op, card);
    if (Array.isArray(x)) syms.push(...x); else if (x) syms.push(x);
  }
  const t = tidy(syms);
  if (!split) return { left: [], right: t };
  // split costs to the left only when something remains on the right
  const left = t.filter(isCost), right = t.filter((x) => !isCost(x));
  return right.length && left.length ? { left, right } : { left: [], right: t };
}

const empty = (l: Line) => !l.left.length && !l.right.length;

// ---------- triggers ----------
type Probe = { label: Sym[]; card: CardDef };
const fake = (tags: Tag[], type: CardDef['type'] = 'automated', cost = 10): CardDef =>
  ({ id: '__probe', name: '', type, cost, tags, text: '', set: 'base' });

function cardProbes(): Probe[] {
  const out: Probe[] = TAGS.filter((t) => t !== 'wild' && t !== 'event').map((t) => ({ label: [{ s: 'tag', tag: t }], card: fake([t]) }));
  out.push({ label: [{ s: 'tag', tag: 'event' }], card: fake([], 'event') });
  out.push({ label: [{ s: 'tag', tag: 'space' }, { s: 'tag', tag: 'event' }], card: fake(['space'], 'event') });
  out.push({ label: [{ s: 'big' }], card: fake([], 'automated', 25) });
  return out;
}

const sig = (ops: Op[]) => JSON.stringify(ops);

function onCardRows(c: CardDef): Row[] {
  if (!c.onCard) return [];
  // trigger → result, grouped: tags with the same result share a row
  const groups = new Map<string, { anyone: boolean; label: Sym[]; ops: Op[] }>();
  for (const p of cardProbes()) {
    const mine = probe((s) => c.onCard!(s, 0, 0, p.card));
    const theirs = probe((s) => c.onCard!(s, 0, 1, p.card));
    const hits = theirs.length && sig(theirs) === sig(mine)
      ? [{ anyone: true, ops: mine }]
      : [{ anyone: false, ops: mine }, { anyone: true, ops: theirs }].filter((h) => h.ops.length);
    for (const h of hits) {
      const k = `${h.anyone}|${sig(h.ops)}`;
      const g = groups.get(k);
      // a combined probe (space event) only matters when neither part fires alone
      if (p.label.length > 1) { if (!g) groups.set(k, { ...h, label: [...p.label] }); continue; }
      if (g) g.label.push(...p.label); else groups.set(k, { ...h, label: [...p.label] });
    }
  }
  const rows: Row[] = [];
  for (const g of groups.values()) {
    const l = line(g.ops, c, false);
    if (empty(l)) continue;
    rows.push({ kind: 'effect', left: g.anyone ? [{ s: 'anyone' }, ...g.label] : g.label, right: l.right });
  }
  return rows;
}

function onTileRows(c: CardDef): Row[] {
  if (!c.onTile) return [];
  const rows: Row[] = [];
  for (const kind of ['city', 'greenery', 'ocean'] as TileKind[]) {
    const space = (owner: number): Space => ({ id: '__probe', row: 0, col: 0, x: 0, type: kind === 'ocean' ? 'ocean' : 'land', bonus: [], tile: { kind, owner: kind === 'ocean' ? null : owner } });
    const label: Sym = kind === 'ocean' ? { s: 'ocean', n: 1 } : { s: 'tile', tile: kind, n: 1 };
    const mine = line(probe((s) => c.onTile!(s, 0, 0, space(0))), c, false);
    const theirs = line(probe((s) => c.onTile!(s, 0, 1, space(1))), c, false);
    if (!empty(theirs)) rows.push({ kind: 'effect', left: [{ s: 'anyone' }, label], right: theirs.right });
    if (!empty(mine) && sig(mine.right as never) !== sig(theirs.right as never)) {
      // your own tile: show only what it adds beyond the "anyone" row
      const extra = mine.right.filter((x) => !theirs.right.some((y) => sig(y as never) === sig(x as never)));
      if (extra.length) rows.push({ kind: 'effect', left: [label], right: extra });
    }
  }
  return rows;
}

// ---------- the whole card ----------
const cache = new Map<string, Row[]>();

export function cardRows(id: string): Row[] {
  const hit = cache.get(id);
  if (hit) return hit;
  const c = CARDS[id];
  const rows: Row[] = [];
  if (c.play || c.startMC !== undefined) {
    const l = c.play ? line(probe((s) => c.play!(s, 0, id)), c, false) : { left: [], right: [] };
    if (c.startMC !== undefined) l.right.unshift({ s: 'res', r: 'mc', n: c.startMC });
    if (!empty(l)) rows.push({ kind: 'play', ...l });
  }
  if (c.firstAction) {
    const l = line(c.firstAction.ops, c, false);
    if (!empty(l)) rows.push({ kind: 'first', ...l });
  }
  if (c.action) {
    const a = c.action;
    const ops = probe((s) => a.run(s, 0, id));
    const l = line(ops, c, true);
    if (a.mc) l.left.unshift({ s: 'res', r: 'mc', n: -a.mc });
    if (l.right.length || l.left.length) rows.push({ kind: 'action', ...l });
  }
  if (c.discount) rows.push({ kind: 'effect', left: [{ s: 'tag', tag: c.discount.tag ?? 'any' }], right: [{ s: 'res', r: 'mc', n: -c.discount.n }] });
  if (c.reqBonus) rows.push({ kind: 'effect', left: [], right: [{ s: 'req', n: c.reqBonus }] });
  if (c.payWith) rows.push({ kind: 'effect', left: [{ s: 'tag', tag: c.payWith.tag }], right: [{ s: 'paywith', rtype: c.payWith.rtype, value: c.payWith.value }] });
  rows.push(...onCardRows(c), ...onTileRows(c));
  cache.set(id, rows);
  return rows;
}

// ---------- standard projects and conversions (action bar) ----------
export const SP_LINES: Record<string, Line> = {
  power: { left: [], right: [{ s: 'prod', parts: [{ s: 'res', r: 'energy', n: 1 }] }] },
  asteroid: { left: [], right: [{ s: 'temp', n: 1 }] },
  aquifer: { left: [], right: [{ s: 'ocean', n: 1 }] },
  greenery: { left: [], right: [{ s: 'tile', tile: 'greenery', n: 1 }] },
  city: { left: [], right: [{ s: 'tile', tile: 'city', n: 1 }, { s: 'prod', parts: [{ s: 'res', r: 'mc', n: 1 }] }] },
  venus: { left: [], right: [{ s: 'venus', n: 1 }] },
  colony: { left: [], right: [{ s: 'colony', n: 1 }] },
};

// ---------- requirements ----------
const REQ_ICON_KEYS = new Set(['temp', 'tempMax', 'oxy', 'oxyMax', 'oceans', 'oceansMax', 'venus', 'venusMax', 'tags', 'greeneries', 'cities', 'citiesAll', 'tr', 'colonies']);

/** Whether a requirement can be drawn as icons (Turmoil's party requirements need words). */
export const reqIcons = (req: import('../engine/cards').Req) => Object.keys(req).every((k) => REQ_ICON_KEYS.has(k));
