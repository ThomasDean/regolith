// The rules engine: createGame + applyAction. Every rule is enforced here.
// Card effects become a queue of ops; an op that needs a decision opens a prompt, and the
// next action ('answer') resolves it and lets the queue continue.
//
// A generation runs: research → actions → production → (Venus) World Government Terraforming →
// (Colonies) colony tracks advance → (Turmoil) the Turmoil phase → next generation. The steps
// after production may need decisions, so each runs as a queue with a `then` continuation.
import type { Action, CardRes, ColonyState, Expansions, GameState, GenStep, Op, PartyId, Payment, PayLimits, Player, PlayerSeat, QueueItem, Res, StdProject } from './types';
import { EXPANSIONS, NEUTRAL, PARTIES, RESOURCES } from './types';
import { CARDS, CORP_IDS, PRELUDE_IDS, PROJECT_IDS, cardInGame, protects, roboticTargets, type CardDef } from './cards';
import { createBoard, neighbours, maxOceans, maxOxy, maxTemp, onMars, params, MAX_VENUS, type BoardId, type TrackBonus } from './board';
import { boardMA, milestoneDef, awardDef, setupRandom, gameAwards } from './ma';
import { nextRandom, shuffle } from './rng';
import { P, inPlay, resCards, space } from './helpers';
import {
  activeCards, autoPay, availableSpaces, awardCost, buyCost, canClaimMilestone, canFundAward, canPlayCard, canSP,
  cardActionAvailable, cardCost, checkPayment, greeneryCost, has, MILESTONE_COST, opsFeasible, parametersMaxed,
  payLimitsForCard, payStock, redsTax, score, spaceCostApplies, spCost, SP_NAME, steelValue, titaniumValue, venusOf, type PlayMods,
} from './queries';
import {
  COLONIES, buildableTiles, colonyAt, colonyDef, colonyTileCount, coloniesInPlay, canTrade, newColonyTile, poseidonOwners,
  tradeCost, tradeTargets, tradeTrack,
} from './colonies';
import {
  PARTY_DEFS, T, delegateCost, eventDef, influence, newTurmoil, nextDominant, partyName, removeDelegate, sendDelegate,
} from './turmoil';

const zero = (): Record<Res, number> => ({ mc: 0, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0 });

export interface NewGameOptions {
  seed?: number;
  corporateEra?: boolean;
  /** map (default Tharsis) */
  board?: BoardId;
  /** milestones and awards in play (default: the map's own, gaps filled by a balanced draw) */
  milestones?: string[];
  awards?: string[];
  /** Prelude, Venus Next, Colonies, Turmoil */
  expansions?: Expansions;
}

/** Only the known expansions, as booleans. */
export const cleanExpansions = (ex: Expansions | undefined): Expansions =>
  Object.fromEntries(EXPANSIONS.filter((e) => ex?.[e]).map((e) => [e, true]));

export function createGame(players: PlayerSeat[], opts: NewGameOptions = {}): GameState {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const corporateEra = opts.corporateEra ?? true;
  const board = opts.board ?? 'tharsis';
  const ex = cleanExpansions(opts.expansions);
  let ma = { milestones: opts.milestones, awards: opts.awards };
  if (!ma.milestones || !ma.awards) {
    const d = boardMA(board, setupRandom(seed), ex);
    ma = { milestones: ma.milestones ?? d.milestones, awards: ma.awards ?? d.awards };
  }
  if (ma.milestones!.some((id) => !milestoneDef(id)) || ma.awards!.some((id) => !awardDef(id))) fail('Unknown milestone or award');
  if (new Set(ma.milestones).size !== ma.milestones!.length || new Set(ma.awards).size !== ma.awards!.length) fail('Duplicate milestone or award');
  const s: GameState = {
    options: { corporateEra, seed, board, milestones: ma.milestones, awards: ma.awards, expansions: ex }, rng: seed, phase: 'setup', generation: 1, firstPlayer: 0, active: 0, actionsThisTurn: 0,
    temperature: -30, oxygen: 0, oceans: 0, board: createBoard(board, { venus: ex.venus }),
    players: players.map((ps, i): Player => ({
      id: i, name: ps.name, color: ps.color, cpu: ps.cpu, corp: null, tr: 20, res: zero(), prod: zero(), hand: [], played: [],
      cardRes: {}, usedActions: [], passed: false, trRaisedThisGen: false, firstActionDone: false, nextCardDiscount: 0,
      reqBonusNext: 0, stats: { greeneries: 0, citiesPlaced: 0 },
    })),
    deck: [], discard: [], milestones: [], awards: [], queue: [], prompt: null, pendingAction: null, log: [], finalOrder: [], reveal: 0,
    history: [], raised: players.map(() => ({ temp: 0, oxy: 0, ocean: 0, venus: 0 })), turns: 0,
  };
  // the base game's random draws come first, so a base game deals the same from the same seed
  s.deck = shuffle(s, PROJECT_IDS.filter((id) => cardInGame(s, id)));
  const corps = shuffle(s, CORP_IDS.filter((id) => cardInGame(s, id)));
  s.firstPlayer = Math.floor(nextRandom(s) * players.length);
  if (ex.prelude) s.preludeDeck = shuffle(s, [...PRELUDE_IDS]);
  for (const p of s.players) {
    p.setup = { corps: [corps.pop()!, corps.pop()!, 'beginner-corporation'], cards: draw(s, 10) };
    if (ex.prelude) p.setup.preludes = s.preludeDeck!.splice(-4);
  }
  if (ex.venus) s.venus = 0;
  if (ex.colonies) {
    const tiles = shuffle(s, COLONIES.map((c) => c.id));
    const n = colonyTileCount(players.length);
    s.colonies = tiles.slice(0, n).map((id) => newColonyTile(s, id));
    s.spareColonies = tiles.slice(n);
    for (const p of s.players) { p.fleets = 1; p.fleetsUsed = 0; }
  }
  if (ex.turmoil) {
    s.turmoil = newTurmoil(s);
    const t = T(s);
    t.coming = drawEvent(s);
    if (t.coming) sendDelegate(s, NEUTRAL, eventDef(t.coming).revealed);
    t.distant = drawEvent(s);
    if (t.distant) sendDelegate(s, NEUTRAL, eventDef(t.distant).revealed);
  }
  s.active = s.firstPlayer;
  log(s, null, `Generation 1. ${s.players[s.firstPlayer].name} goes first.`);
  return s;
}

function log(s: GameState, pid: number | null, text: string) {
  s.log.push({ gen: s.generation, pid, text });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}

function draw(s: GameState, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (!s.deck.length) {
      if (!s.discard.length) break;
      s.deck = shuffle(s, s.discard);
      s.discard = [];
    }
    out.push(s.deck.pop()!);
  }
  s.reveal++;
  return out;
}

function drawEvent(s: GameState): string | null {
  const t = T(s);
  if (!t.deck.length) {
    t.deck = shuffle(s, t.discard);
    t.discard = [];
  }
  return t.deck.pop() ?? null;
}

const fail = (msg: string): never => {
  throw new Error(msg);
};

const order = (s: GameState) => s.players.map((_, i) => (s.firstPlayer + i) % s.players.length);
export { order as turnOrder };

export function applyAction(state: GameState, a: Action): GameState {
  const s = structuredClone(state);
  applyActionMut(s, a);
  return s;
}

/** Applies an action in place (used by CPUs on their own copies). */
export function applyActionMut(s: GameState, a: Action): GameState {
  const pid = s.active;
  const p = P(s, pid);
  if (a.t === 'answer') {
    if (!s.prompt) fail('Nothing to answer');
    answer(s, a);
    run(s);
    return s;
  }
  if (s.prompt) fail('Answer the current prompt first');
  if (s.pendingAction) fail('An action is still resolving');
  switch (s.phase) {
    case 'setup': {
      if (a.t !== 'setup') return fail('Choose a corporation');
      setupPlayer(s, p, a);
      const next = order(s).find((i) => !P(s, i).corp);
      if (next !== undefined) s.active = next;
      else if (s.players.some((q) => q.preludes?.length)) startPreludes(s);
      else startActions(s);
      run(s);
      return s;
    }
    case 'prelude': {
      if (a.t !== 'prelude') return fail('Play your preludes');
      if (!p.preludes?.includes(a.card)) fail('That prelude isn’t yours to play');
      p.preludes!.splice(p.preludes!.indexOf(a.card), 1);
      s.pendingAction = { pid, counts: false, then: 'prelude' };
      playPrelude(s, pid, a.card);
      run(s);
      return s;
    }
    case 'research': {
      if (a.t !== 'research') return fail('Choose research cards');
      const keep = a.keep;
      const offer = p.research ?? [];
      if (keep.some((c) => !offer.includes(c)) || new Set(keep).size !== keep.length) fail('Invalid research choice');
      const price = buyCost(s, pid);
      if (keep.length * price > p.res.mc) fail('Not enough M€');
      p.res.mc -= keep.length * price;
      p.hand.push(...keep);
      s.discard.push(...offer.filter((c) => !keep.includes(c)));
      p.research = undefined;
      log(s, pid, `${p.name} bought ${keep.length} card${keep.length === 1 ? '' : 's'}.`);
      const next = order(s).find((i) => P(s, i).research);
      if (next !== undefined) s.active = next;
      else startActions(s);
      run(s);
      return s;
    }
    case 'finalGreenery': {
      if (a.t === 'plants') {
        if (p.res.plants < greeneryCost(s, pid)) fail('Not enough plants');
        if (!availableSpaces(s, pid, 'greenery', 'greenery').length) fail('No space for a greenery');
        p.res.plants -= greeneryCost(s, pid);
        log(s, pid, `${p.name} converted plants into a greenery.`);
        enqueue(s, pid, [{ k: 'tile', tile: 'greenery', rule: 'greenery' }]);
        s.pendingAction = { pid, counts: false };
        run(s);
        return s;
      }
      if (a.t !== 'pass') fail('Convert plants or finish');
      s.finalOrder.shift();
      if (s.finalOrder.length) s.active = s.finalOrder[0];
      else endGame(s);
      return s;
    }
    case 'over':
      fail('The game is over');
  }
  switch (a.t) {
    case 'pass':
      p.passed = true;
      log(s, pid, `${p.name} passed.`);
      advanceTurn(s);
      return s;
    case 'endTurn':
      if (s.actionsThisTurn < 1) fail('Take an action or pass');
      advanceTurn(s);
      return s;
    case 'play':
      return doPlay(s, pid, a.card, a.pay);
    case 'sp':
      return doSP(s, pid, a.id, a.pay, a.cards);
    case 'milestone': {
      if (!canClaimMilestone(s, pid, a.id)) fail('Milestone not available');
      // Merchant is judged after paying, so it is paid in M€
      payMC(s, pid, MILESTONE_COST, a.id === 'merchant' ? {} : a.pay);
      s.milestones.push({ id: a.id, pid });
      log(s, pid, `${p.name} claimed ${milestoneDef(a.id).name}.`);
      return beginAction(s, pid, []);
    }
    case 'award': {
      if (!canFundAward(s, pid, a.id)) fail('Award not available');
      const cost = awardCost(s);
      payMC(s, pid, cost, a.pay);
      s.awards.push({ id: a.id, pid });
      log(s, pid, `${p.name} funded ${awardDef(a.id).name} for ${cost} M€.`);
      return beginAction(s, pid, []);
    }
    case 'cardAction': {
      if (!cardActionAvailable(s, pid, a.card)) fail('Action not available');
      const c = CARDS[a.card];
      const act = c.action!;
      if (act.mc) payAction(s, pid, act.mc, act, a.pay);
      p.usedActions.push(a.card);
      log(s, pid, `${p.name} used ${c.name}: ${act.text.toLowerCase()}.`);
      return beginAction(s, pid, act.run(s, pid, a.card), a.card);
    }
    case 'plants': {
      const cost = greeneryCost(s, pid);
      if (p.res.plants < cost) fail('Not enough plants');
      if (!availableSpaces(s, pid, 'greenery', 'greenery').length) fail('No space');
      if (p.res.mc < redsTax(s, s.oxygen < maxOxy(s) ? 1 : 0)) fail('The Reds’ tax needs 3 M€');
      p.res.plants -= cost;
      log(s, pid, `${p.name} converted ${cost} plants into a greenery.`);
      return beginAction(s, pid, [{ k: 'tile', tile: 'greenery', rule: 'greenery' }]);
    }
    case 'heat': {
      if (heatAvailable(s, pid) < 8) fail('Not enough heat');
      if (s.temperature >= maxTemp(s)) fail('Temperature is maxed');
      if (p.res.mc < redsTax(s, 1)) fail('The Reds’ tax needs 3 M€');
      spendHeat(s, pid, 8);
      log(s, pid, `${p.name} converted 8 heat to raise the temperature.`);
      return beginAction(s, pid, [{ k: 'temp', n: 1 }]);
    }
    case 'trade': {
      if (!canTrade(s, pid, a.colony, a.pay)) fail('You can’t trade there');
      p.res[a.pay] -= tradeCost(s, pid, a.pay);
      const c = colonyAt(s, a.colony)!;
      s.pendingAction = { pid, counts: true };
      trade(s, pid, c);
      run(s);
      return s;
    }
    case 'delegate': {
      if (!s.turmoil) fail('Turmoil is not in this game');
      if (!PARTIES.includes(a.party)) fail('Unknown party');
      if (T(s).reserve[pid] <= 0) fail('No delegates left in your reserve');
      const cost = delegateCost(s, pid);
      if (cost) payMC(s, pid, cost);
      else T(s).lobbyUsed.push(pid);
      sendDelegate(s, pid, a.party);
      log(s, pid, `${p.name} sent a delegate to ${partyName(a.party)}${cost ? ` for ${cost} M€` : ''}.`);
      return beginAction(s, pid, []);
    }
    case 'policy': {
      const pol = s.turmoil ? PARTY_DEFS[T(s).ruling].policyAction : undefined;
      if (!pol) fail('The ruling party has no action');
      if (pol!.once && p.policyUsed) fail('Already used this generation');
      payMC(s, pid, pol!.cost);
      if (pol!.once) p.policyUsed = true;
      log(s, pid, `${p.name} used the ${partyName(T(s).ruling)} policy: ${pol!.text.toLowerCase()}.`);
      return beginAction(s, pid, structuredClone(pol!.ops));
    }
    default:
      return fail(`Unexpected action ${a.t}`);
  }
}

function setupPlayer(s: GameState, p: Player, a: Extract<Action, { t: 'setup' }>) {
  const su = p.setup ?? fail('Already set up');
  if (!su.corps.includes(a.corp)) fail('Corporation not offered');
  const corp = CARDS[a.corp];
  const beginner = a.corp === 'beginner-corporation';
  const keep = beginner ? su.cards : a.keep;
  if (keep.some((c) => !su.cards.includes(c)) || new Set(keep).size !== keep.length) fail('Invalid cards');
  let preludes: string[] = [];
  if (su.preludes) {
    preludes = a.preludes ?? [];
    if (preludes.length !== 2 || new Set(preludes).size !== 2 || preludes.some((c) => !su.preludes!.includes(c))) fail('Choose 2 preludes');
  }
  const price = a.corp === 'polyphemos' ? 5 : a.corp === 'terralabs-research' ? 1 : 3;
  const cost = beginner ? 0 : keep.length * price;
  if (cost > corp.startMC!) fail('Not enough M€ for those cards');
  p.corp = a.corp;
  p.res.mc = corp.startMC! - cost;
  if (!s.options.corporateEra) for (const r of RESOURCES) p.prod[r] = 1;
  p.hand = [...keep];
  s.discard.push(...su.cards.filter((c) => !keep.includes(c)));
  if (su.preludes) {
    p.preludes = preludes;
    s.preludeDeck!.unshift(...su.preludes.filter((c) => !preludes.includes(c)));
  }
  p.setup = undefined;
  if (corp.play) for (const op of corp.play(s, p.id, a.corp)) resolveSimple(s, p.id, op);
  if (!corp.firstAction) p.firstActionDone = true;
  if (corp.resource) activateColonies(s, corp.resource);
  log(s, p.id, `${p.name} founded ${corp.name} and kept ${keep.length} cards.`);
}

function startPreludes(s: GameState) {
  s.phase = 'prelude';
  s.active = order(s).find((i) => P(s, i).preludes?.length) ?? s.firstPlayer;
}

/** After a prelude resolves: the same player plays their next, then the next player, then actions start. */
function afterPrelude(s: GameState) {
  if (s.phase !== 'prelude') return;
  if (P(s, s.active).preludes?.length) return;
  const next = order(s).find((i) => P(s, i).preludes?.length);
  if (next !== undefined) s.active = next;
  else startActions(s);
}

function startActions(s: GameState) {
  // the charts start from everyone's position once corporations are founded
  if (s.generation === 1 && s.history && !s.history.length) record(s, null);
  s.phase = 'action';
  s.actionsThisTurn = 0;
  s.active = s.firstPlayer;
  startTurn(s);
}

function startTurn(s: GameState) {
  const p = P(s, s.active);
  s.actionsThisTurn = 0;
  if (!p.firstActionDone) {
    p.firstActionDone = true;
    const fa = CARDS[p.corp!].firstAction!;
    log(s, p.id, `${p.name} takes their first action: ${fa.text.toLowerCase()}.`);
    beginAction(s, p.id, structuredClone(fa.ops), p.corp!);
  }
}

/** Samples the scoreboard for the end-of-game charts (skipped on CPU sandboxes, which drop the history). */
function record(s: GameState, pid: number | null) {
  if (!s.history) return;
  if (pid !== null) s.turns = (s.turns ?? 0) + 1;
  const sc = s.players.map((q) => score(s, q.id));
  s.history.push({
    gen: s.generation, turn: s.turns ?? 0, pid,
    vp: sc.map((x) => x.total), tr: s.players.map((q) => q.tr), income: s.players.map((q) => q.tr + q.prod.mc),
    temp: s.temperature, oxy: s.oxygen, oceans: s.oceans, ...(s.venus !== undefined ? { venus: s.venus } : {}),
  });
}

function advanceTurn(s: GameState) {
  record(s, s.active);
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const next = (s.active + i) % n;
    if (!P(s, next).passed) {
      s.active = next;
      startTurn(s);
      return;
    }
  }
  endGeneration(s);
}

function endGeneration(s: GameState) {
  for (const p of s.players) {
    p.res.heat += p.res.energy;
    p.res.energy = 0;
    p.res.mc += p.tr + p.prod.mc;
    for (const r of ['steel', 'titanium', 'plants', 'energy', 'heat'] as Res[]) p.res[r] += p.prod[r];
    for (const c of activeCards(s, p.id)) if (c.onProduction) for (const op of c.onProduction(s, p.id)) resolveDirect(s, p.id, op, c.id);
  }
  log(s, null, `Production for generation ${s.generation}.`);
  record(s, null);
  if (parametersMaxed(s)) {
    s.phase = 'finalGreenery';
    s.finalOrder = order(s);
    s.active = s.finalOrder[0];
    log(s, null, 'Mars is terraformed! Last chance to convert plants into greeneries.');
    return;
  }
  for (const c of coloniesInPlay(s)) c.fleet = null;
  for (const p of s.players) if (p.fleets !== undefined) p.fleetsUsed = 0;
  continueGen(s, 'solar');
}

/** The steps between production and the next generation; each may queue decisions. */
function continueGen(s: GameState, step: GenStep) {
  if (step === 'prelude') return afterPrelude(s);
  const steps: GenStep[] = ['solar', 'colonies', 'turmoil', 'turmoilEnd', 'newGen'];
  for (const st of steps.slice(steps.indexOf(step))) {
    if (st === 'solar' && has(s, 'venus')) {
      s.pendingAction = { pid: s.firstPlayer, counts: false, then: 'colonies' };
      enqueue(s, s.firstPlayer, [{ k: 'wgt' }]);
      return run(s);
    }
    if (st === 'colonies') for (const c of coloniesInPlay(s)) if (c.active && c.track < 6) c.track++;
    if (st === 'turmoil' && s.turmoil) return turmoilPhase(s);
    // only reached as the continuation of the Turmoil phase
    if (st === 'turmoilEnd' && step === 'turmoilEnd') return newGovernment(s);
    if (st === 'newGen') return newGeneration(s);
  }
}

function newGeneration(s: GameState) {
  s.generation++;
  s.firstPlayer = (s.firstPlayer + 1) % s.players.length;
  for (const p of s.players) {
    p.passed = false;
    p.usedActions = [];
    p.trRaisedThisGen = false;
    p.nextCardDiscount = 0;
    p.reqBonusNext = 0;
    p.policyUsed = false;
    p.research = draw(s, 4);
  }
  s.phase = 'research';
  s.active = s.firstPlayer;
  log(s, null, `Generation ${s.generation}. ${P(s, s.firstPlayer).name} goes first.`);
}

// ---------------- Turmoil phase ----------------
function turmoilPhase(s: GameState) {
  const t = T(s);
  log(s, null, 'Turmoil: everyone loses 1 TR.');
  for (const p of s.players) p.tr = Math.max(0, p.tr - 1);
  s.pendingAction = { pid: s.firstPlayer, counts: false, then: 'turmoilEnd' };
  if (t.current) {
    const ev = eventDef(t.current);
    log(s, null, `Global event: ${ev.name}. ${ev.text}`);
    if (ev.each) order(s).forEach((pid, i) => enqueue(s, pid, ev.each!(s, pid, influence(s, pid), i === 0)));
    if (ev.all) for (const x of ev.all(s, (pid) => influence(s, pid))) enqueue(s, x.pid, x.ops);
  }
  run(s);
}

function newGovernment(s: GameState) {
  const t = T(s);
  t.ruling = t.dominant;
  const ps = t.parties[t.ruling];
  const chair = ps.leader;
  if (chair !== null) ps.delegates.splice(ps.delegates.indexOf(chair), 1);
  for (const d of ps.delegates) if (d === NEUTRAL) t.neutral++; else t.reserve[d]++;
  ps.delegates = [];
  ps.leader = null;
  if (t.chairman === NEUTRAL) t.neutral++; else t.reserve[t.chairman]++;
  if (chair === null) {
    t.chairman = NEUTRAL;
    t.neutral = Math.max(0, t.neutral - 1);
  } else t.chairman = chair;
  log(s, null, `${partyName(t.ruling)} take power. ${chair === null || chair === NEUTRAL ? 'A neutral delegate' : P(s, chair).name} is the new chairman.`);
  s.pendingAction = { pid: s.firstPlayer, counts: false, then: 'newGen' };
  if (chair !== null && chair !== NEUTRAL) enqueue(s, chair, [{ k: 'tr', n: 1 }]);
  const pd = PARTY_DEFS[t.ruling];
  for (const pid of order(s)) enqueue(s, pid, pd.bonus(s, pid));
  t.dominant = nextDominant(s, t.ruling);
  t.lobbyUsed = [];
  if (t.current) t.discard.push(t.current);
  t.current = t.coming;
  if (t.current) sendDelegate(s, NEUTRAL, eventDef(t.current).current);
  t.coming = t.distant;
  t.distant = drawEvent(s);
  if (t.distant) sendDelegate(s, NEUTRAL, eventDef(t.distant).revealed);
  run(s);
}

function endGame(s: GameState) {
  s.phase = 'over';
  s.prompt = null;
  record(s, null);
  log(s, null, 'Final scoring.');
}

function beginAction(s: GameState, pid: number, ops: Op[], src?: string): GameState {
  s.pendingAction = { pid, counts: true };
  enqueue(s, pid, ops, src);
  run(s);
  return s;
}

function finishAction(s: GameState) {
  const pa = s.pendingAction!;
  s.pendingAction = null;
  if (pa.then) return continueGen(s, pa.then);
  if (s.phase === 'finalGreenery') return;
  if (s.phase !== 'action' || !pa.counts) return;
  s.actionsThisTurn++;
  const everyoneElsePassed = s.players.every((q) => q.id === s.active || q.passed);
  if (s.actionsThisTurn >= 2 && !everyoneElsePassed) advanceTurn(s);
  else if (s.actionsThisTurn >= 2) s.actionsThisTurn = 0;
}

function payMC(s: GameState, pid: number, cost: number, pay?: Payment) {
  const lim: PayLimits = { steel: false, titanium: false, heat: P(s, pid).corp === 'helion' };
  const pp = pay ?? autoPay(s, pid, cost, lim) ?? fail('Cannot pay');
  const mc = checkPayment(s, pid, cost, pp, lim);
  if (mc === null) return fail('Invalid payment');
  spend(s, pid, mc, pp);
}

function payAction(s: GameState, pid: number, cost: number, act: { steel?: boolean; titanium?: boolean }, pay?: Payment) {
  const lim: PayLimits = { steel: !!act.steel, titanium: !!act.titanium, heat: false };
  const pp = pay ?? autoPay(s, pid, cost, lim) ?? fail('Cannot pay');
  const mc = checkPayment(s, pid, cost, pp, lim);
  if (mc === null) return fail('Invalid payment');
  spend(s, pid, mc, pp);
}

function spend(s: GameState, pid: number, mc: number, pay: Payment) {
  const p = P(s, pid);
  p.res.mc -= mc;
  p.res.steel -= pay.steel ?? 0;
  p.res.titanium -= pay.titanium ?? 0;
  p.res.heat -= pay.heat ?? 0;
  if (pay.floaters) p.cardRes.dirigibles = payStock(s, pid, 'floaters') - pay.floaters;
  if (pay.microbes) p.cardRes.psychrophiles = payStock(s, pid, 'microbes') - pay.microbes;
}

/** Heat for converting: Stormcraft's floaters count 2 each. */
export function heatAvailable(s: GameState, pid: number): number {
  const p = P(s, pid);
  return p.res.heat + (p.corp === 'stormcraft-incorporated' ? 2 * (p.cardRes['stormcraft-incorporated'] ?? 0) : 0);
}
function spendHeat(s: GameState, pid: number, n: number) {
  const p = P(s, pid);
  const fromHeat = Math.min(p.res.heat, n);
  p.res.heat -= fromHeat;
  let left = n - fromHeat;
  if (left > 0) {
    const fl = Math.ceil(left / 2);
    p.cardRes['stormcraft-incorporated'] -= fl;
    left -= fl * 2;
  }
}

/** Puts a played card's effects in motion: its ops, everyone's "when you play" triggers, colony wake-ups. */
function cardEffects(s: GameState, pid: number, id: string, front: boolean) {
  const p = P(s, pid);
  const c = CARDS[id];
  const before = c.type !== 'event' && inPlay(s, pid, 'aridor') ? kinds(s, pid) : null;
  p.played.push(id);
  const ops = c.play ? c.play(s, pid, id) : [];
  const items: QueueItem[] = ops.map((op) => ({ pid, op, src: id }));
  for (const q of s.players) {
    for (const a of activeCards(s, q.id)) {
      if (a.onCard) for (const op of a.onCard(s, q.id, pid, c)) items.push({ pid: q.id, op, src: a.id });
    }
  }
  if (before) {
    const n = kinds(s, pid).size - before.size;
    if (n > 0) items.push({ pid, op: { k: 'prod', r: 'mc', n }, src: 'aridor' });
  }
  if (c.resource && c.type !== 'event') activateColonies(s, c.resource);
  if (front) pushFront(s, items);
  else s.queue.push(...items);
}
const kinds = (s: GameState, pid: number) => {
  const p = P(s, pid);
  const set = new Set<string>();
  for (const id of p.corp ? [p.corp, ...p.played] : p.played) if (CARDS[id].type !== 'event') for (const t of CARDS[id].tags) if (t !== 'wild') set.add(t);
  return set;
};

function activateColonies(s: GameState, rtype: CardRes) {
  for (const c of coloniesInPlay(s)) {
    if (!c.active && colonyDef(c.id).resource === rtype) {
      c.active = true;
      log(s, null, `${colonyDef(c.id).name} opens for trade.`);
    }
  }
}

function doPlay(s: GameState, pid: number, id: string, pay?: Payment, mods: PlayMods = {}): GameState {
  if (!canPlayCard(s, pid, id, mods)) fail('You cannot play that card now');
  payForCard(s, pid, id, pay, mods);
  s.pendingAction = { pid, counts: true };
  cardEffects(s, pid, id, false);
  run(s);
  return s;
}

function payForCard(s: GameState, pid: number, id: string, pay: Payment | undefined, mods: PlayMods) {
  const p = P(s, pid);
  const c = CARDS[id];
  const cost = Math.max(0, cardCost(s, pid, id) - (mods.discount ?? 0));
  const lim = payLimitsForCard(s, pid, id);
  const pp = pay ?? autoPay(s, pid, cost, lim) ?? fail('Cannot pay');
  const mc = checkPayment(s, pid, cost, pp, lim);
  if (mc === null) return fail('Invalid payment');
  spend(s, pid, mc, pp);
  p.hand.splice(p.hand.indexOf(id), 1);
  p.nextCardDiscount = 0;
  p.reqBonusNext = 0;
  if (id === 'special-design') p.reqBonusNext = 2;
  if (id === 'indentured-workers') p.nextCardDiscount = 8;
  if (id === 'conscription') p.nextCardDiscount = 16;
  log(s, pid, `${p.name} played ${c.name}${cost ? ` for ${cost} M€` : ''}.`);
}

/** A prelude: played free; one that can't resolve in full is discarded for 15 M€. */
function playPrelude(s: GameState, pid: number, id: string, front = false) {
  const p = P(s, pid);
  const c = CARDS[id];
  const ops = c.play ? c.play(s, pid, id) : [];
  if (!opsFeasible(s, pid, ops) || (c.canPlay && !c.canPlay(s, pid))) {
    p.res.mc += 15;
    s.preludeDeck?.unshift(id);
    log(s, pid, `${p.name} couldn’t use ${c.name} and took 15 M€ instead.`);
    return;
  }
  log(s, pid, `${p.name} played the prelude ${c.name}.`);
  cardEffects(s, pid, id, front);
}

function doSP(s: GameState, pid: number, id: StdProject, pay?: Payment, cards?: string[]): GameState {
  const p = P(s, pid);
  if (!canSP(s, pid, id)) fail('Standard project not available');
  if (id === 'sell') {
    const sel = cards ?? [];
    if (!sel.length || sel.some((c) => !p.hand.includes(c)) || new Set(sel).size !== sel.length) fail('Choose cards to sell');
    p.hand = p.hand.filter((c) => !sel.includes(c));
    s.discard.push(...sel);
    p.res.mc += sel.length;
    log(s, pid, `${p.name} sold ${sel.length} card${sel.length === 1 ? '' : 's'}.`);
    return beginAction(s, pid, []);
  }
  const cost = spCost(s, pid, id);
  payMC(s, pid, cost, pay);
  log(s, pid, `${p.name} used the ${SP_NAME[id]} standard project.`);
  const ops: Op[] = ({
    power: [{ k: 'prod', r: 'energy', n: 1 }],
    asteroid: [{ k: 'temp', n: 1 }],
    aquifer: [{ k: 'ocean' }],
    greenery: [{ k: 'tile', tile: 'greenery', rule: 'greenery' }],
    city: [{ k: 'tile', tile: 'city', rule: 'city' }, { k: 'prod', r: 'mc', n: 1 }],
    venus: [{ k: 'venus', n: 1 }],
    colony: [{ k: 'colony' }],
  } as Record<Exclude<StdProject, 'sell'>, Op[]>)[id as Exclude<StdProject, 'sell'>];
  s.pendingAction = { pid, counts: true };
  enqueue(s, pid, ops);
  for (const a of activeCards(s, pid)) if (a.onSP) enqueue(s, pid, a.onSP(s, pid, SP_COST_BASE[id]), a.id);
  run(s);
  return s;
}

const SP_COST_BASE: Record<StdProject, number> = { sell: 0, power: 11, asteroid: 14, aquifer: 18, greenery: 23, city: 25, venus: 15, colony: 17 };

function enqueue(s: GameState, pid: number, ops: Op[], src?: string) {
  for (const op of ops) s.queue.push({ pid, op, src });
}

function pushFront(s: GameState, items: QueueItem[]) {
  s.queue.unshift(...items);
}

function run(s: GameState) {
  while (!s.prompt && s.queue.length) {
    const item = s.queue.shift()!;
    resolve(s, item);
  }
  if (!s.prompt && !s.queue.length && s.pendingAction) finishAction(s);
}

/** Corporation set-up effects (no prompts). */
function resolveSimple(s: GameState, pid: number, op: Op) {
  const p = P(s, pid);
  if (op.k === 'res') p.res[op.r] += op.n;
  else if (op.k === 'prod') {
    p.prod[op.r] += op.n;
    if (op.n > 0 && p.corp === 'manutech') p.res[op.r] += op.n;
  } else if (op.k === 'tr') p.tr = Math.max(0, p.tr + op.n);
}

/** Simple effects outside the queue (production-phase triggers). */
function resolveDirect(s: GameState, pid: number, op: Op, src: string) {
  const p = P(s, pid);
  if (op.k === 'res') p.res[op.r] = Math.max(0, p.res[op.r] + op.n);
  else if (op.k === 'addRes' && op.target === 'this') {
    const card = op.card ?? src;
    p.cardRes[card] = Math.max(0, (p.cardRes[card] ?? 0) + op.n);
  }
}

function raiseTR(s: GameState, pid: number, n: number) {
  const p = P(s, pid);
  p.tr = Math.max(0, p.tr + n);
  if (n > 0) {
    p.trRaisedThisGen = true;
    // the Reds tax TR raised in actions
    if (s.pendingAction?.counts && s.turmoil?.ruling === 'reds') {
      const tax = Math.min(p.res.mc, redsTax(s, n));
      if (tax) {
        p.res.mc -= tax;
        log(s, pid, `${p.name} paid ${tax} M€ to the Reds.`);
      }
    }
  }
}

function resolve(s: GameState, item: QueueItem) {
  const { pid, op } = item;
  const p = P(s, pid);
  switch (op.k) {
    case 'res':
      p.res[op.r] = Math.max(0, p.res[op.r] + op.n);
      return;
    case 'prod': {
      const before = p.prod[op.r];
      p.prod[op.r] = Math.max(op.r === 'mc' ? -5 : 0, p.prod[op.r] + op.n);
      if (p.corp === 'manutech' && p.prod[op.r] > before) p.res[op.r] += p.prod[op.r] - before;
      return;
    }
    case 'tr':
      raiseTR(s, pid, op.n);
      return;
    case 'log':
      log(s, pid, op.text);
      return;
    case 'temp': {
      const front: QueueItem[] = [];
      for (let i = 0; i < op.n && s.temperature < maxTemp(s); i++) {
        s.temperature += 2;
        if (op.wgt) continue;
        raiseTR(s, pid, 1);
        bump(s, pid, 'temp');
        for (const b of params(s).temp) if (b.at === s.temperature) trackBonus(s, pid, b.bonus, front);
      }
      pushFront(s, front);
      return;
    }
    case 'oxy': {
      const front: QueueItem[] = [];
      for (let i = 0; i < op.n && s.oxygen < maxOxy(s); i++) {
        s.oxygen += 1;
        if (op.wgt) continue;
        raiseTR(s, pid, 1);
        bump(s, pid, 'oxy');
        for (const b of params(s).oxy) if (b.at === s.oxygen) trackBonus(s, pid, b.bonus, front);
      }
      pushFront(s, front);
      return;
    }
    case 'venus': {
      if (s.venus === undefined) return;
      const aphrodite = s.players.filter((q) => q.corp === 'aphrodite');
      for (let i = 0; i < op.n && s.venus < MAX_VENUS; i++) {
        s.venus += 2;
        for (const q of aphrodite) q.res.mc += 2;
        if (op.wgt) continue;
        raiseTR(s, pid, 1);
        bump(s, pid, 'venus');
        if (s.venus === 8) p.hand.push(...draw(s, 1));
        if (s.venus === 16) raiseTR(s, pid, 1);
      }
      return;
    }
    case 'lowerTemp':
      s.temperature = Math.max(-30, s.temperature - 2 * op.n);
      return;
    case 'ocean':
      if (s.oceans < maxOceans(s)) pushFront(s, [{ pid, op: { k: 'tile', tile: 'ocean', rule: 'ocean', wgt: op.wgt } }]);
      return;
    case 'tile': {
      const options = availableSpaces(s, pid, op.rule, op.tile);
      if (!options.length) return log(s, pid, 'No legal space; the tile is skipped.');
      const title = op.rule === 'claim'
        ? 'Choose a space to claim'
        : `Place ${op.tile === 'special' ? (op.card ? CARDS[op.card]?.name ?? 'tile' : 'tile') : op.tile === 'ocean' ? 'an ocean' : `a ${op.tile}`}`;
      s.prompt = { kind: 'space', pid, title, options, item };
      return;
    }
    case 'removeAny': {
      const options = s.players
        .filter((q) => q.res[op.r] > 0 && (q.id === pid || op.r !== 'plants' || !protects(s, q.id, 'plants')) && (!op.among || op.among.includes(q.id)))
        .map((q) => q.id);
      if (!options.length) return;
      s.prompt = { kind: 'player', pid, title: `Remove up to ${op.n} ${resName(op.r)} from a player`, options, optional: true, item };
      return;
    }
    case 'steal': {
      const options = s.players.filter((q) => q.id !== pid && q.res[op.r] > 0).map((q) => q.id);
      if (!options.length) return;
      s.prompt = { kind: 'player', pid, title: `Steal up to ${op.n} ${resName(op.r)}`, options, optional: true, item };
      return;
    }
    case 'decProd': {
      const options = s.players.filter((q) => (op.r === 'mc' ? q.prod.mc - op.n >= -5 : q.prod[op.r] >= op.n)).map((q) => q.id);
      if (!options.length) return;
      if (options.length === 1) return finishDecProd(s, item, options[0]);
      s.prompt = { kind: 'player', pid, title: `Decrease a player's ${resName(op.r)} production by ${op.n}`, options, optional: false, item };
      return;
    }
    case 'addRes': {
      if (op.n === 0) return;
      if (op.target === 'this') {
        const card = op.card ?? item.src!;
        if (!inPlay(s, pid, card)) return;
        p.cardRes[card] = Math.max(0, (p.cardRes[card] ?? 0) + op.n);
        return;
      }
      const options = resTargets(s, pid, op, item.src);
      if (!options.length) return;
      if (options.length === 1) {
        p.cardRes[options[0]] = (p.cardRes[options[0]] ?? 0) + op.n;
        return;
      }
      s.prompt = { kind: 'card', pid, title: `Add ${op.n} ${op.rtype ?? 'resource'}${op.n > 1 ? 's' : ''} to which card?`, options, optional: false, item };
      return;
    }
    case 'removeCardRes': {
      const options: string[] = [];
      for (const q of s.players) {
        for (const c of resCards(s, q.id, op.rtype)) {
          const cd = CARDS[c];
          if (c === op.gainTo || !(q.cardRes[c] > 0) || cd.protectedRes) continue;
          if (q.id !== pid && protects(s, q.id, op.rtype)) continue;
          options.push(c);
        }
      }
      if (!options.length) return;
      s.prompt = { kind: 'card', pid, title: `Remove ${op.n === 1 ? 'a' : `up to ${op.n}`} ${op.rtype}${op.n > 1 ? 's' : ''} from which card?`, options, optional: !op.gainTo, item };
      return;
    }
    case 'spendRes': {
      const options = resCards(s, pid, op.rtype).filter((c) => (p.cardRes[c] ?? 0) >= op.n);
      if (!options.length) return;
      if (options.length === 1) {
        p.cardRes[options[0]] -= op.n;
        return;
      }
      s.prompt = { kind: 'card', pid, title: `Spend ${op.n} ${op.rtype}${op.n > 1 ? 's' : ''} from which card?`, options, optional: false, item };
      return;
    }
    case 'draw': {
      const cards = draw(s, op.n);
      p.hand.push(...cards);
      return;
    }
    case 'othersDraw':
      for (const q of s.players) if (q.id !== pid) q.hand.push(...draw(s, op.n));
      return;
    case 'drawMatching': {
      const got: string[] = [];
      const seen = s.deck.length + s.discard.length;
      for (let i = 0; i < seen && got.length < op.n; i++) {
        const [c] = draw(s, 1);
        if (!c) break;
        const d = CARDS[c];
        if ((op.tag && d.tags.includes(op.tag)) || (op.rtype && d.resource === op.rtype)) got.push(c);
        else s.discard.push(c);
      }
      p.hand.push(...got);
      log(s, pid, `${p.name} revealed cards and kept ${got.length}.`);
      return;
    }
    case 'discard': {
      const n = Math.min(op.n, p.hand.length);
      if (!n) return;
      s.prompt = { kind: 'cards', pid, title: `Discard ${n} card${n > 1 ? 's' : ''}`, cards: [...p.hand], min: n, max: n, costEach: 0, item };
      return;
    }
    case 'look': {
      const cards = draw(s, op.n);
      const price = op.buy ? buyCost(s, pid) : 0;
      const max = op.buy ? (p.res.mc >= price ? op.keep : 0) : op.keep;
      const min = op.buy ? 0 : Math.min(op.keep, cards.length);
      if (!cards.length) return;
      s.prompt = { kind: 'cards', pid, title: op.buy ? `Buy this card for ${price} M€?` : `Keep ${op.keep} of these`, cards, min, max: Math.min(max, cards.length), costEach: price, item };
      return;
    }
    case 'choose': {
      const ok = op.options.map((o, i) => (o.ok ? i : -1)).filter((i) => i >= 0);
      if (!ok.length) return;
      if (ok.length === 1) return pushFront(s, op.options[ok[0]].ops.map((o) => ({ pid, op: o, src: item.src })));
      s.prompt = { kind: 'choice', pid, title: op.title, options: op.options.map((o) => ({ label: o.label, ok: o.ok })), item };
      return;
    }
    case 'discardDraw': {
      if (!p.hand.length) return;
      s.prompt = { kind: 'cards', pid, title: 'Mars University: discard a card to draw one?', cards: [...p.hand], min: 0, max: 1, costEach: 0, item };
      return;
    }
    case 'amount':
      if (op.max <= 0) return;
      s.prompt = { kind: 'amount', pid, title: op.title, max: op.max, item };
      return;
    case 'pay': {
      const lim: PayLimits = { steel: !!op.steel, titanium: !!op.titanium, heat: false };
      const pp = autoPay(s, pid, op.n, lim);
      if (pp) spend(s, pid, checkPayment(s, pid, op.n, pp, lim) ?? 0, pp);
      else p.res.mc = Math.max(0, p.res.mc - op.n);
      return;
    }
    case 'robotic': {
      const options = roboticTargets(s, pid);
      if (!options.length) return;
      s.prompt = { kind: 'card', pid, title: 'Copy the production of which building card?', options, optional: false, item };
      return;
    }
    case 'searchLife': {
      const [top] = draw(s, 1);
      if (!top) return;
      const hit = CARDS[top].tags.includes('microbe');
      if (hit) p.cardRes[op.card] = (p.cardRes[op.card] ?? 0) + 1;
      s.discard.push(top);
      log(s, pid, `${p.name} revealed ${CARDS[top].name}${hit ? ' — a microbe! Science resource added.' : '.'}`);
      return;
    }
    case 'playFromHand': {
      const mods = { discount: op.discount, ignoreReq: op.ignoreReq };
      const options = p.hand.filter((c) => canPlayCard(s, pid, c, mods));
      if (!options.length) return log(s, pid, `${p.name} had no card to play with ${CARDS[op.src].name}.`);
      s.prompt = { kind: 'card', pid, title: op.discount ? `Play a card for ${op.discount} M€ less` : 'Play a card, ignoring global requirements', options, optional: true, item };
      return;
    }
    case 'preludeDraw': {
      const offer = (s.preludeDeck ?? []).splice(-op.n);
      if (!offer.length) return;
      s.reveal++;
      s.prompt = { kind: 'cards', pid, title: 'Choose a prelude to play', cards: offer, min: 1, max: 1, costEach: 0, item };
      return;
    }
    case 'freeAward': {
      if (s.awards.length >= 3) return;
      const open = gameAwards(s).filter((a) => !s.awards.some((x) => x.id === a.id));
      if (!open.length) return;
      choice(s, item, 'Fund an award for free', open.map((a) => ({ key: a.id, label: `${a.name}: ${a.text}` })));
      return;
    }
    case 'viron': {
      const options = p.usedActions.filter((c) => c !== 'viron' && reusable(s, pid, c));
      if (!options.length) return;
      s.prompt = { kind: 'card', pid, title: 'Use which card’s action again?', options, optional: false, item };
      return;
    }
    case 'lowestProd': {
      const min = Math.min(...RESOURCES.map((r) => p.prod[r]));
      const low = RESOURCES.filter((r) => p.prod[r] === min);
      choice(s, item, 'Raise which production?', low.map((r) => ({ key: r, label: `+1 ${resName(r)} production` })));
      return;
    }
    case 'wgt': {
      const opts: { key: string; label: string }[] = [];
      if (s.temperature < maxTemp(s)) opts.push({ key: 'temp', label: 'Raise the temperature' });
      if (s.oxygen < maxOxy(s)) opts.push({ key: 'oxy', label: 'Raise the oxygen' });
      if (s.oceans < maxOceans(s)) opts.push({ key: 'ocean', label: 'Place an ocean' });
      if (venusOf(s) < MAX_VENUS) opts.push({ key: 'venus', label: 'Raise Venus' });
      if (!opts.length) return;
      choice(s, item, 'World Government Terraforming: raise one parameter (no TR)', opts);
      return;
    }
    // ---- Colonies ----
    case 'colony': {
      const tiles = buildableTiles(s, pid, op.dup);
      if (!tiles.length) return log(s, pid, 'No colony tile has room; the colony is skipped.');
      choice(s, item, 'Place a colony', tiles.map((c) => ({ key: c.id, label: `${colonyDef(c.id).name}: ${colonyDef(c.id).buildText}` })));
      return;
    }
    case 'fleet':
      p.fleets = (p.fleets ?? 0) + op.n;
      return;
    case 'trade': {
      const tiles = tradeTargets(s);
      if (!tiles.length || (p.fleets ?? 0) <= (p.fleetsUsed ?? 0)) return;
      choice(s, item, 'Trade with which colony?', tiles.map((c) => ({ key: c.id, label: `${colonyDef(c.id).name}: ${colonyDef(c.id).tradeText}` })));
      return;
    }
    case 'addColonyTile': {
      const spare = s.spareColonies ?? [];
      if (!spare.length) return;
      choice(s, item, 'Add which colony tile?', spare.map((id) => ({ key: id, label: `${colonyDef(id).name}: build ${colonyDef(id).buildText}, trade ${colonyDef(id).tradeText}` })));
      return;
    }
    case 'marketManip': {
      const act = coloniesInPlay(s).filter((c) => c.active);
      const opts: { key: string; label: string }[] = [];
      for (const up of act) for (const down of act) {
        if (up === down || up.track >= 6 || down.track <= down.colonies.length) continue;
        opts.push({ key: `${up.id}|${down.id}`, label: `Raise ${colonyDef(up.id).name}, lower ${colonyDef(down.id).name}` });
      }
      if (!opts.length) return;
      choice(s, item, 'Market Manipulation', opts);
      return;
    }
    case 'colonyBonuses': {
      const items: QueueItem[] = [];
      for (const c of coloniesInPlay(s)) for (const o of c.colonies) if (o === pid) for (const b of colonyDef(c.id).bonus) items.push({ pid, op: b });
      pushFront(s, items);
      return;
    }
    // ---- Turmoil ----
    case 'delegate': {
      if (!s.turmoil || T(s).reserve[pid] <= 0) return;
      choice(s, item, op.one && op.n > 1 ? `Place ${op.n} delegates in which party?` : 'Send a delegate to which party?', PARTIES.map((x) => ({ key: x, label: partyName(x) })));
      return;
    }
    case 'removeDelegate': {
      if (!s.turmoil) return;
      const opts: { key: string; label: string }[] = [];
      for (const party of PARTIES) {
        const ps = T(s).parties[party];
        for (const who of [...new Set(ps.delegates)]) {
          const n = ps.delegates.filter((d) => d === who).length - (ps.leader === who ? 1 : 0);
          if (n > 0) opts.push({ key: `${party}|${who}`, label: `Remove ${who === NEUTRAL ? 'a neutral' : `${P(s, who).name}’s`} delegate from ${partyName(party)}` });
        }
      }
      if (!opts.length) return;
      choice(s, item, 'Banned Delegate', opts);
      return;
    }
    case 'recruit': {
      if (!s.turmoil || T(s).reserve[pid] <= 0) return;
      const opts = PARTIES.filter((x) => {
        const ps = T(s).parties[x];
        return ps.delegates.filter((d) => d === NEUTRAL).length > (ps.leader === NEUTRAL ? 1 : 0);
      }).map((x) => ({ key: x, label: `Swap a neutral delegate in ${partyName(x)}` }));
      if (!opts.length) return;
      choice(s, item, 'Recruitment', opts);
      return;
    }
    case 'noConfidence': {
      const t = T(s);
      if (t.chairman !== NEUTRAL || t.reserve[pid] <= 0) return;
      t.neutral++;
      t.reserve[pid]--;
      t.chairman = pid;
      log(s, pid, `${p.name} took over as chairman.`);
      return;
    }
    case 'removeOcean': {
      const options = s.board.filter((x) => x.tile?.kind === 'ocean').map((x) => x.id);
      if (!options.length) return;
      s.prompt = { kind: 'space', pid, title: 'Remove an ocean tile', options, item };
      return;
    }
  }
}

/** Opens a choice prompt over options built from the state; one option resolves at once. */
function choice(s: GameState, item: QueueItem, title: string, opts: { key: string; label: string }[]) {
  if (opts.length === 1) return choose(s, item, opts[0].key);
  s.prompt = { kind: 'choice', pid: item.pid, title, options: opts.map((o) => ({ label: o.label, ok: true })), keys: opts.map((o) => o.key), item };
}

/** Resolves a keyed choice. */
function choose(s: GameState, item: QueueItem, key: string) {
  const pid = item.pid;
  const p = P(s, pid);
  const op = item.op;
  switch (op.k) {
    case 'freeAward':
      s.awards.push({ id: key, pid });
      log(s, pid, `${p.name} funded ${awardDef(key).name} for free.`);
      return;
    case 'lowestProd':
      pushFront(s, [{ pid, op: { k: 'prod', r: key as Res, n: 1 } }]);
      return;
    case 'wgt': {
      log(s, pid, `World Government Terraforming: ${p.name} chose to ${key === 'ocean' ? 'place an ocean' : `raise ${key === 'temp' ? 'the temperature' : key === 'oxy' ? 'the oxygen' : 'Venus'}`}.`);
      const o: Op = key === 'temp' ? { k: 'temp', n: 1, wgt: true } : key === 'oxy' ? { k: 'oxy', n: 1, wgt: true } : key === 'venus' ? { k: 'venus', n: 1, wgt: true } : { k: 'ocean', wgt: true };
      pushFront(s, [{ pid, op: o }]);
      return;
    }
    case 'colony': {
      const c = colonyAt(s, key)!;
      c.colonies.push(pid);
      c.track = Math.max(c.track, c.colonies.length);
      log(s, pid, `${p.name} placed a colony on ${colonyDef(key).name}.`);
      const items: QueueItem[] = colonyDef(key).build.map((o) => ({ pid, op: structuredClone(o) }));
      for (const q of poseidonOwners(s)) items.push({ pid: q, op: { k: 'prod', r: 'mc', n: 1 }, src: 'poseidon' });
      pushFront(s, items);
      return;
    }
    case 'trade': {
      const c = colonyAt(s, key)!;
      trade(s, pid, c, true);
      return;
    }
    case 'addColonyTile': {
      s.spareColonies = (s.spareColonies ?? []).filter((x) => x !== key);
      s.colonies!.push(newColonyTile(s, key));
      log(s, pid, `${p.name} put ${colonyDef(key).name} into play.`);
      return;
    }
    case 'marketManip': {
      const [up, down] = key.split('|');
      colonyAt(s, up)!.track++;
      colonyAt(s, down)!.track--;
      log(s, pid, `${p.name} raised ${colonyDef(up).name} and lowered ${colonyDef(down).name}.`);
      return;
    }
    case 'delegate': {
      const party = key as PartyId;
      const n = op.one ? Math.min(op.n, T(s).reserve[pid]) : 1;
      for (let i = 0; i < n; i++) sendDelegate(s, pid, party);
      log(s, pid, `${p.name} placed ${n === 1 ? 'a delegate' : `${n} delegates`} in ${partyName(party)}.`);
      if (!op.one && op.n > 1) pushFront(s, [{ pid, op: { ...op, n: op.n - 1 } }]);
      return;
    }
    case 'removeDelegate': {
      const [party, who] = key.split('|');
      removeDelegate(s, Number(who), party as PartyId);
      log(s, pid, `${p.name} removed a delegate from ${partyName(party as PartyId)}.`);
      return;
    }
    case 'recruit': {
      const party = key as PartyId;
      removeDelegate(s, NEUTRAL, party);
      sendDelegate(s, pid, party);
      log(s, pid, `${p.name} swapped a neutral delegate in ${partyName(party)} for their own.`);
      return;
    }
  }
}

/** Trades with a colony tile: track boosts first, the trade income, then every colony's bonus. */
function trade(s: GameState, pid: number, c: ColonyState, front = false) {
  const p = P(s, pid);
  const d = colonyDef(c.id);
  p.fleetsUsed = (p.fleetsUsed ?? 0) + 1;
  c.fleet = pid;
  const track = tradeTrack(s, pid, c);
  log(s, pid, `${p.name} traded with ${d.name}${track > c.track ? ` (track raised to ${track})` : ''}.`);
  const items: QueueItem[] = d.trade(track).map((o) => ({ pid, op: o }));
  for (const owner of c.colonies) for (const b of d.bonus) items.push({ pid: owner, op: structuredClone(b) });
  c.track = c.colonies.length;
  if (front) pushFront(s, items);
  else s.queue.push(...items);
}

/** Cards that can take resources for an addRes op. */
function resTargets(s: GameState, pid: number, op: Extract<Op, { k: 'addRes' }>, src?: string): string[] {
  const p = P(s, pid);
  if (op.target === 'anyWithRes') return resCards(s, pid).filter((c) => (p.cardRes[c] ?? 0) > 0);
  return resCards(s, pid, op.rtype, op.tag).filter((c) => op.target !== 'other' || c !== src);
}

/** Whether a used card action could run again now (Viron). */
function reusable(s: GameState, pid: number, id: string): boolean {
  const a = CARDS[id].action;
  if (!a || !a.can(s, pid, id) || !opsFeasible(s, pid, a.run(s, pid, id))) return false;
  if (a.mc) {
    const p = P(s, pid);
    const metal = (a.steel ? p.res.steel * steelValue(s, pid) : 0) + (a.titanium ? p.res.titanium * titaniumValue(s, pid) : 0);
    if (p.res.mc + metal < a.mc) return false;
  }
  return true;
}

/** A bonus printed on a global-parameter track, for the player who raised it to that value. */
function trackBonus(s: GameState, pid: number, b: TrackBonus, front: QueueItem[]) {
  const p = P(s, pid);
  if (b === 'heatProd') front.push({ pid, op: { k: 'prod', r: 'heat', n: 1 } });
  else if (b === 'plantProd') front.push({ pid, op: { k: 'prod', r: 'plants', n: 1 } });
  else if (b === 'card') p.hand.push(...draw(s, 1));
  else if (b === 'ocean') front.push({ pid, op: { k: 'ocean' } });
  else if (b === 'temp') front.push({ pid, op: { k: 'temp', n: 1 } });
}

function bump(s: GameState, pid: number, k: 'temp' | 'oxy' | 'ocean' | 'venus') {
  if (s.raised?.[pid]) s.raised[pid][k] = (s.raised[pid][k] ?? 0) + 1;
}

const STANDARD_RES: Res[] = ['mc', 'steel', 'titanium', 'plants', 'energy', 'heat'];

const resName = (r: Res) => ({ mc: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plants', energy: 'energy', heat: 'heat' })[r];

function finishDecProd(s: GameState, item: QueueItem, target: number) {
  const op = item.op as Extract<Op, { k: 'decProd' }>;
  const q = P(s, target);
  q.prod[op.r] -= op.n;
  if (op.gain) pushFront(s, [{ pid: item.pid, op: { k: 'prod', r: op.r, n: op.n } }]);
  if (target !== item.pid) log(s, item.pid, `${P(s, item.pid).name} reduced ${q.name}'s ${resName(op.r)} production by ${op.n}.`);
}

function answer(s: GameState, a: Extract<Action, { t: 'answer' }>) {
  const pr = s.prompt!;
  const item = pr.item;
  const pid = item.pid;
  const p = P(s, pid);
  const op = item.op;
  switch (pr.kind) {
    case 'space': {
      if (!a.space || !pr.options.includes(a.space)) fail('Choose a highlighted space');
      s.prompt = null;
      if (op.k === 'removeOcean') {
        const sp = space(s, a.space!);
        sp.tile = undefined;
        s.oceans = Math.max(0, s.oceans - 1);
        log(s, pid, `${p.name} removed an ocean tile.`);
        return;
      }
      placeTile(s, item, a.space!);
      return;
    }
    case 'player': {
      const target = a.player ?? null;
      if (target === null) {
        if (!pr.optional) fail('Choose a player');
        s.prompt = null;
        return;
      }
      if (!pr.options.includes(target)) fail('Choose a listed player');
      s.prompt = null;
      const q = P(s, target);
      if (op.k === 'decProd') return finishDecProd(s, item, target);
      if (op.k === 'removeAny') {
        const n = Math.min(op.n, q.res[op.r]);
        q.res[op.r] -= n;
        log(s, pid, `${p.name} removed ${n} ${resName(op.r)} from ${q.name}.`);
      } else if (op.k === 'steal') {
        const n = Math.min(op.n, q.res[op.r]);
        q.res[op.r] -= n;
        p.res[op.r] += n;
        log(s, pid, `${p.name} stole ${n} ${resName(op.r)} from ${q.name}.`);
      }
      return;
    }
    case 'card': {
      const card = a.card ?? null;
      if (card === null) {
        if (!pr.optional) fail('Choose a card');
        s.prompt = null;
        return;
      }
      if (!pr.options.includes(card)) fail('Choose a listed card');
      s.prompt = null;
      if (op.k === 'addRes') p.cardRes[card] = (p.cardRes[card] ?? 0) + op.n;
      else if (op.k === 'spendRes') p.cardRes[card] = Math.max(0, (p.cardRes[card] ?? 0) - op.n);
      else if (op.k === 'removeCardRes') {
        const owner = s.players.find((q) => inPlay(s, q.id, card))!;
        const n = Math.min(op.n, owner.cardRes[card] ?? 0);
        owner.cardRes[card] -= n;
        if (op.gainTo) p.cardRes[op.gainTo] = (p.cardRes[op.gainTo] ?? 0) + n;
        log(s, pid, `${p.name} took ${n} ${op.rtype}${n === 1 ? '' : 's'} from ${CARDS[card].name}.`);
      } else if (op.k === 'robotic') {
        const prodOps = CARDS[card].play!(s, pid, card).filter((o) => o.k === 'prod');
        log(s, pid, `${p.name} copied the production of ${CARDS[card].name}.`);
        pushFront(s, prodOps.map((o) => ({ pid, op: o, src: card })));
      } else if (op.k === 'playFromHand') {
        payForCard(s, pid, card, undefined, { discount: op.discount, ignoreReq: op.ignoreReq });
        cardEffects(s, pid, card, true);
      } else if (op.k === 'viron') {
        const act = CARDS[card].action!;
        if (act.mc) payAction(s, pid, act.mc, act);
        log(s, pid, `${p.name} used ${CARDS[card].name} again.`);
        pushFront(s, act.run(s, pid, card).map((o) => ({ pid, op: o, src: card })));
      }
      return;
    }
    case 'choice': {
      const i = a.option ?? -1;
      if (!pr.options[i]?.ok) fail('Choose an available option');
      s.prompt = null;
      if (pr.keys) return choose(s, item, pr.keys[i]);
      const ch = (op as Extract<Op, { k: 'choose' }>).options[i];
      pushFront(s, ch.ops.map((o) => ({ pid, op: o, src: item.src })));
      return;
    }
    case 'cards': {
      const picked = a.cards ?? [];
      if (picked.some((c) => !pr.cards.includes(c)) || new Set(picked).size !== picked.length) fail('Invalid cards');
      if (picked.length < pr.min || picked.length > pr.max) fail(`Choose ${pr.min === pr.max ? pr.min : `${pr.min}–${pr.max}`} cards`);
      if (picked.length * pr.costEach > p.res.mc) fail('Not enough M€');
      s.prompt = null;
      if (op.k === 'discardDraw') {
        if (picked.length) {
          p.hand.splice(p.hand.indexOf(picked[0]), 1);
          s.discard.push(picked[0]);
          p.hand.push(...draw(s, 1));
          log(s, pid, `${p.name} swapped a card using Mars University.`);
        }
        return;
      }
      if (op.k === 'discard') {
        for (const c of picked) p.hand.splice(p.hand.indexOf(c), 1);
        s.discard.push(...picked);
        log(s, pid, `${p.name} discarded ${picked.length} card${picked.length === 1 ? '' : 's'}.`);
        return;
      }
      if (op.k === 'preludeDraw') {
        s.preludeDeck!.unshift(...pr.cards.filter((c) => !picked.includes(c)));
        playPrelude(s, pid, picked[0], true);
        return;
      }
      p.res.mc -= picked.length * pr.costEach;
      p.hand.push(...picked);
      s.discard.push(...pr.cards.filter((c) => !picked.includes(c)));
      return;
    }
    case 'amount': {
      const n = a.amount ?? -1;
      if (!Number.isInteger(n) || n < 0 || n > pr.max) fail('Invalid amount');
      s.prompt = null;
      if (op.k !== 'amount') return;
      if (op.id === 'insulation') {
        p.prod.heat -= n;
        pushFront(s, [{ pid, op: { k: 'prod', r: 'mc', n } }]);
      } else if (op.id === 'powerInfra') {
        p.res.energy -= n;
        p.res.mc += n;
      } else if (op.id === 'sulphur' && item.src) {
        p.cardRes[item.src] = Math.max(0, (p.cardRes[item.src] ?? 0) - n);
        p.res.mc += 3 * n;
      } else if (op.id === 'titanShuttles' && item.src) {
        p.cardRes[item.src] = Math.max(0, (p.cardRes[item.src] ?? 0) - n);
        p.res.titanium += n;
      }
      return;
    }
  }
}

function placeTile(s: GameState, item: QueueItem, id: string) {
  const op = item.op as Extract<Op, { k: 'tile' }>;
  const pid = item.pid;
  const p = P(s, pid);
  const sp = space(s, id);
  if (op.rule === 'claim') {
    sp.claimedBy = pid;
    log(s, pid, `${p.name} claimed a space.`);
    return;
  }
  const kind = op.tile;
  if (op.wgt) {
    // World Government (or a global event) places a neutral ocean: no TR, no bonuses
    sp.tile = { kind, owner: null };
    sp.claimedBy = undefined;
    if (kind === 'ocean') s.oceans++;
    log(s, pid, `${p.name} placed an ocean for the World Government.`);
    return;
  }
  const charged = spaceCostApplies(s, sp);
  sp.tile = { kind, owner: kind === 'ocean' ? null : pid, card: op.card && op.card !== 'flooding' ? op.card : undefined };
  sp.claimedBy = undefined;
  const front: QueueItem[] = [];
  if (charged) {
    p.res.mc = Math.max(0, p.res.mc - sp.cost!);
    log(s, pid, `${p.name} paid ${sp.cost} M€ for ${sp.name ?? 'the space'}.`);
  }
  for (const b of sp.bonus) {
    if (b === 'card') p.hand.push(...draw(s, 1));
    else if (b === 'ocean') { if (charged) front.push({ pid, op: { k: 'ocean' } }); }
    else if (b === 'temp') { if (charged) front.push({ pid, op: { k: 'temp', n: 1 } }); }
    else if (b === 'delegate') { if (s.turmoil) front.push({ pid, op: { k: 'delegate', n: 1, from: 'reserve' } }); }
    else if (b === 'wild') {
      front.push({ pid, op: { k: 'choose', title: 'Take one standard resource', options: STANDARD_RES.map((r) => ({ label: `1 ${resName(r)}`, ok: true, ops: [{ k: 'res', r, n: 1 } as Op] })) } });
    } else p.res[b] += 1;
  }
  if (op.rule === 'miningRights' || op.rule === 'miningArea') front.push({ pid, op: { k: 'prod', r: sp.bonus.includes('titanium') ? 'titanium' : 'steel', n: 1 } });
  const oceansNext = neighbours(s.board, id).filter((n) => n.tile?.kind === 'ocean').length;
  p.res.mc += oceansNext * (p.corp === 'lakefront-resorts' ? 3 : 2);
  const rul = s.turmoil?.ruling;
  if (rul === 'mars' && onMars(sp)) p.res.steel += 1;
  if (rul === 'greens' && kind === 'greenery') p.res.mc += 4;
  if (kind === 'ocean') {
    s.oceans++;
    raiseTR(s, pid, 1);
    bump(s, pid, 'ocean');
  }
  if (kind === 'greenery') {
    p.stats.greeneries++;
    if (s.phase !== 'finalGreenery') front.push({ pid, op: { k: 'oxy', n: 1 } });
  }
  if (kind === 'city') p.stats.citiesPlaced++;
  const label = kind === 'special' ? CARDS[op.card!]?.name ?? 'a tile' : kind === 'ocean' ? 'an ocean' : `a ${kind}`;
  log(s, pid, `${p.name} placed ${label}${sp.name ? ` on ${sp.name}` : ''}.`);
  if (op.card === 'flooding') {
    const owners = [...new Set(neighbours(s.board, id).map((n) => n.tile?.owner).filter((o): o is number => o !== null && o !== undefined && o !== pid))];
    if (owners.length) front.push({ pid, op: { k: 'removeAny', r: 'mc', n: 4, among: owners } });
  }
  for (const q of s.players) {
    for (const a of activeCards(s, q.id)) {
      if (a.onTile) for (const o of a.onTile(s, q.id, pid, sp)) front.push({ pid: q.id, op: o, src: a.id });
    }
  }
  pushFront(s, front);
}

export type { CardDef };
