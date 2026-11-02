// Colonies: the eleven colony tiles, their build/trade/colony bonuses, and read-only queries.
// The engine (game.ts) applies them.
import type { CardRes, ColonyState, GameState, Op, Res } from './types';
import { CARDS } from './cards';
import { P, inPlay } from './helpers';

export interface ColonyDef {
  id: string;
  name: string;
  /** tiles that need a card resource start inactive */
  resource?: CardRes;
  buildText: string;
  build: Op[];
  tradeText: string;
  /** what trading gives at each track position 0–6 */
  trade: (track: number) => Op[];
  /** the track as shown on the tile */
  steps: (number | string)[];
  bonusText: string;
  bonus: Op[];
}

const res = (r: Res, n: number): Op => ({ k: 'res', r, n });
const prod = (r: Res, n: number): Op => ({ k: 'prod', r, n });
const addAny = (rtype: CardRes, n: number): Op => ({ k: 'addRes', n, rtype, target: 'any' });
const at = (xs: number[], i: number) => xs[Math.max(0, Math.min(6, i))];

function def(id: string, name: string, d: Omit<ColonyDef, 'id' | 'name' | 'trade'> & { trade: (t: number) => Op[] }): ColonyDef {
  return { id, name, ...d };
}
const gain = (r: Res, q: number[]) => (t: number) => (at(q, t) ? [res(r, at(q, t))] : []);
const cards = (rtype: CardRes, q: number[]) => (t: number) => (at(q, t) ? [addAny(rtype, at(q, t))] : []);

export const COLONIES: ColonyDef[] = [
  def('callisto', 'Callisto', { buildText: '+1 energy production', build: [prod('energy', 1)], tradeText: 'energy', steps: [0, 2, 3, 5, 7, 10, 13], trade: gain('energy', [0, 2, 3, 5, 7, 10, 13]), bonusText: '3 energy', bonus: [res('energy', 3)] }),
  def('ceres', 'Ceres', { buildText: '+1 steel production', build: [prod('steel', 1)], tradeText: 'steel', steps: [1, 2, 3, 4, 6, 8, 10], trade: gain('steel', [1, 2, 3, 4, 6, 8, 10]), bonusText: '2 steel', bonus: [res('steel', 2)] }),
  def('enceladus', 'Enceladus', { resource: 'microbe', buildText: '3 microbes to any card', build: [addAny('microbe', 3)], tradeText: 'microbes to any card', steps: [0, 1, 2, 3, 4, 4, 5], trade: cards('microbe', [0, 1, 2, 3, 4, 4, 5]), bonusText: '1 microbe to any card', bonus: [addAny('microbe', 1)] }),
  def('europa', 'Europa', {
    buildText: 'place an ocean', build: [{ k: 'ocean' }], tradeText: 'production', steps: ['M€', 'M€', 'energy', 'energy', 'plant', 'plant', 'plant'],
    trade: (t) => [prod((['mc', 'mc', 'energy', 'energy', 'plants', 'plants', 'plants'] as Res[])[Math.max(0, Math.min(6, t))], 1)],
    bonusText: '1 M€', bonus: [res('mc', 1)],
  }),
  def('ganymede', 'Ganymede', { buildText: '+1 plant production', build: [prod('plants', 1)], tradeText: 'plants', steps: [0, 1, 2, 3, 4, 5, 6], trade: gain('plants', [0, 1, 2, 3, 4, 5, 6]), bonusText: '1 plant', bonus: [res('plants', 1)] }),
  def('io', 'Io', { buildText: '+1 heat production', build: [prod('heat', 1)], tradeText: 'heat', steps: [2, 3, 4, 6, 8, 10, 13], trade: gain('heat', [2, 3, 4, 6, 8, 10, 13]), bonusText: '2 heat', bonus: [res('heat', 2)] }),
  def('luna', 'Luna', { buildText: '+2 M€ production', build: [prod('mc', 2)], tradeText: 'M€', steps: [1, 2, 4, 7, 10, 13, 17], trade: gain('mc', [1, 2, 4, 7, 10, 13, 17]), bonusText: '2 M€', bonus: [res('mc', 2)] }),
  def('miranda', 'Miranda', { resource: 'animal', buildText: '1 animal to any card', build: [addAny('animal', 1)], tradeText: 'animals to any card', steps: [0, 1, 1, 2, 2, 3, 3], trade: cards('animal', [0, 1, 1, 2, 2, 3, 3]), bonusText: 'draw a card', bonus: [{ k: 'draw', n: 1 }] }),
  def('pluto', 'Pluto', {
    buildText: 'draw 2 cards', build: [{ k: 'draw', n: 2 }], tradeText: 'cards', steps: [0, 1, 2, 2, 3, 3, 4],
    trade: (t) => (at([0, 1, 2, 2, 3, 3, 4], t) ? [{ k: 'draw', n: at([0, 1, 2, 2, 3, 3, 4], t) }] : []),
    bonusText: 'draw a card, then discard one', bonus: [{ k: 'draw', n: 1 }, { k: 'discard', n: 1 }],
  }),
  def('titan', 'Titan', { resource: 'floater', buildText: '3 floaters to any card', build: [addAny('floater', 3)], tradeText: 'floaters to any card', steps: [0, 1, 1, 2, 3, 3, 4], trade: cards('floater', [0, 1, 1, 2, 3, 3, 4]), bonusText: '1 floater to any card', bonus: [addAny('floater', 1)] }),
  def('triton', 'Triton', { buildText: '3 titanium', build: [res('titanium', 3)], tradeText: 'titanium', steps: [0, 1, 1, 2, 3, 4, 5], trade: gain('titanium', [0, 1, 1, 2, 3, 4, 5]), bonusText: '1 titanium', bonus: [res('titanium', 1)] }),
];
const BY_ID = new Map(COLONIES.map((c) => [c.id, c]));
export const colonyDef = (id: string): ColonyDef => BY_ID.get(id)!;

/** Colony tiles in play: players + 2, plus one more with two players. */
export const colonyTileCount = (players: number) => players + 2 + (players <= 2 ? 1 : 0);

export const coloniesInPlay = (s: GameState): ColonyState[] => s.colonies ?? [];
export const colonyCount = (s: GameState, pid: number) => coloniesInPlay(s).reduce((a, c) => a + c.colonies.filter((o) => o === pid).length, 0);
export const colonyAt = (s: GameState, id: string) => coloniesInPlay(s).find((c) => c.id === id);

/** Whether any card in play can hold this resource (inactive tiles wake up when one is played). */
export const resourceInPlay = (s: GameState, rtype: CardRes) =>
  s.players.some((p) => (p.corp ? [p.corp, ...p.played] : p.played).some((id) => CARDS[id].resource === rtype && CARDS[id].type !== 'event'));

/** A new tile in play: tracks start at 1; resource tiles wait for a matching card. */
export function newColonyTile(s: GameState, id: string): ColonyState {
  const d = colonyDef(id);
  const active = !d.resource || resourceInPlay(s, d.resource);
  return { id, track: 1, active, colonies: [], fleet: null };
}

export function canBuildOn(s: GameState, pid: number, c: ColonyState, dup = false): boolean {
  return c.active && c.colonies.length < 3 && (dup || !c.colonies.includes(pid));
}
export const buildableTiles = (s: GameState, pid: number, dup = false) => coloniesInPlay(s).filter((c) => canBuildOn(s, pid, c, dup));

/** Cards that make trading cheaper (Cryo-Sleep, Rim Freighters) or move the track first (Trade Envoys, Trading Colony). */
function sumOf(s: GameState, pid: number, key: 'tradeDiscount' | 'tradeOffset'): number {
  const p = P(s, pid);
  let n = 0;
  for (const id of p.corp ? [p.corp, ...p.played] : p.played) n += CARDS[id][key] ?? 0;
  return n;
}
export const tradeDiscount = (s: GameState, pid: number) => sumOf(s, pid, 'tradeDiscount');
export const tradeOffset = (s: GameState, pid: number) => sumOf(s, pid, 'tradeOffset');

/** What a trade costs in each currency (9 M€, 3 energy or 3 titanium, less discounts). */
export function tradeCost(s: GameState, pid: number, pay: 'mc' | 'energy' | 'titanium'): number {
  return Math.max(0, (pay === 'mc' ? 9 : 3) - tradeDiscount(s, pid));
}
export const fleetsFree = (s: GameState, pid: number) => (P(s, pid).fleets ?? 0) - (P(s, pid).fleetsUsed ?? 0);
export const tradeTargets = (s: GameState) => coloniesInPlay(s).filter((c) => c.active && c.fleet === null);

export function canTrade(s: GameState, pid: number, colony: string, pay: 'mc' | 'energy' | 'titanium'): boolean {
  if (!s.colonies || fleetsFree(s, pid) <= 0) return false;
  const c = colonyAt(s, colony);
  if (!c || !c.active || c.fleet !== null) return false;
  return P(s, pid).res[pay] >= tradeCost(s, pid, pay);
}

/** Where the marker ends up for a trade after any track boosts. */
export const tradeTrack = (s: GameState, pid: number, c: ColonyState) => Math.min(6, c.track + tradeOffset(s, pid));

export const poseidonOwners = (s: GameState) => s.players.filter((p) => inPlay(s, p.id, 'poseidon')).map((p) => p.id);
