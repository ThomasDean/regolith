// The rules engine: createGame + applyAction. Every rule is enforced here.
// Card effects become a queue of ops; an op that needs a decision opens a prompt, and the
// next action ('answer') resolves it and lets the queue continue.
import type { Action, GameState, Op, Payment, PayLimits, Player, PlayerSeat, QueueItem, Res, StdProject } from './types';
import { MAX_OCEANS, MAX_OXY, MAX_TEMP, RESOURCES } from './types';
import { CARDS, CORP_IDS, PROJECT_IDS, protects, roboticTargets } from './cards';
import { createBoard, neighbours } from './board';
import { nextRandom, shuffle } from './rng';
import { P, space } from './helpers';
import {
  activeCards, autoPay, availableSpaces, awardCost, canClaimMilestone, canFundAward, canPlayCard, canSP,
  cardActionAvailable, cardCost, checkPayment, greeneryCost, MILESTONE_COST, MILESTONES, AWARDS, parametersMaxed,
  payLimitsForCard, spCost, SP_NAME,
} from './queries';

const zero = (): Record<Res, number> => ({ mc: 0, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0 });

export function createGame(players: PlayerSeat[], opts: { seed?: number; corporateEra?: boolean } = {}): GameState {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const corporateEra = opts.corporateEra ?? true;
  const s: GameState = {
    options: { corporateEra, seed }, rng: seed, phase: 'setup', generation: 1, firstPlayer: 0, active: 0, actionsThisTurn: 0,
    temperature: -30, oxygen: 0, oceans: 0, board: createBoard(),
    players: players.map((ps, i): Player => ({
      id: i, name: ps.name, color: ps.color, cpu: ps.cpu, corp: null, tr: 20, res: zero(), prod: zero(), hand: [], played: [],
      cardRes: {}, usedActions: [], passed: false, trRaisedThisGen: false, firstActionDone: false, nextCardDiscount: 0,
      reqBonusNext: 0, stats: { greeneries: 0, citiesPlaced: 0 },
    })),
    deck: [], discard: [], milestones: [], awards: [], queue: [], prompt: null, pendingAction: null, log: [], finalOrder: [], reveal: 0,
  };
  s.deck = shuffle(s, PROJECT_IDS.filter((id) => corporateEra || CARDS[id].set === 'base'));
  const corps = shuffle(s, CORP_IDS.filter((id) => corporateEra || CARDS[id].set === 'base'));
  s.firstPlayer = Math.floor(nextRandom(s) * players.length);
  for (const p of s.players) {
    p.setup = { corps: [corps.pop()!, corps.pop()!, 'beginner-corporation'], cards: draw(s, 10) };
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
  switch (s.phase) {
    case 'setup': {
      if (a.t !== 'setup') return fail('Choose a corporation');
      setupPlayer(s, p, a);
      const next = order(s).find((i) => !P(s, i).corp);
      if (next !== undefined) s.active = next;
      else startActions(s);
      run(s);
      return s;
    }
    case 'research': {
      if (a.t !== 'research') return fail('Choose research cards');
      const keep = a.keep;
      const offer = p.research ?? [];
      if (keep.some((c) => !offer.includes(c)) || new Set(keep).size !== keep.length) fail('Invalid research choice');
      if (keep.length * 3 > p.res.mc) fail('Not enough M€');
      p.res.mc -= keep.length * 3;
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
  if (s.pendingAction) fail('An action is still resolving');
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
      payMC(s, pid, MILESTONE_COST, a.pay);
      s.milestones.push({ id: a.id, pid });
      log(s, pid, `${p.name} claimed ${MILESTONES.find((m) => m.id === a.id)!.name}.`);
      return beginAction(s, pid, []);
    }
    case 'award': {
      if (!canFundAward(s, pid, a.id)) fail('Award not available');
      const cost = awardCost(s);
      payMC(s, pid, cost, a.pay);
      s.awards.push({ id: a.id, pid });
      log(s, pid, `${p.name} funded ${AWARDS.find((m) => m.id === a.id)!.name} for ${cost} M€.`);
      return beginAction(s, pid, []);
    }
    case 'cardAction': {
      if (!cardActionAvailable(s, pid, a.card)) fail('Action not available');
      const c = CARDS[a.card];
      const act = c.action!;
      if (act.mc) {
        const lim: PayLimits = { steel: !!act.steel, titanium: !!act.titanium, heat: false };
        const pay = a.pay ?? autoPay(s, pid, act.mc, lim) ?? fail('Cannot pay');
        const mc = checkPayment(s, pid, act.mc, pay, lim);
        if (mc === null) return fail('Invalid payment');
        spend(s, pid, mc, pay);
      }
      p.usedActions.push(a.card);
      log(s, pid, `${p.name} used ${c.name}: ${act.text.toLowerCase()}.`);
      return beginAction(s, pid, act.run(s, pid, a.card), a.card);
    }
    case 'plants': {
      const cost = greeneryCost(s, pid);
      if (p.res.plants < cost) fail('Not enough plants');
      if (!availableSpaces(s, pid, 'greenery', 'greenery').length) fail('No space');
      p.res.plants -= cost;
      log(s, pid, `${p.name} converted ${cost} plants into a greenery.`);
      return beginAction(s, pid, [{ k: 'tile', tile: 'greenery', rule: 'greenery' }]);
    }
    case 'heat': {
      if (p.res.heat < 8) fail('Not enough heat');
      if (s.temperature >= MAX_TEMP) fail('Temperature is maxed');
      p.res.heat -= 8;
      log(s, pid, `${p.name} converted 8 heat to raise the temperature.`);
      return beginAction(s, pid, [{ k: 'temp', n: 1 }]);
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
  const cost = beginner ? 0 : keep.length * 3;
  if (cost > corp.startMC!) fail('Not enough M€ for those cards');
  p.corp = a.corp;
  p.res.mc = corp.startMC! - cost;
  if (!s.options.corporateEra) for (const r of RESOURCES) p.prod[r] = 1;
  p.hand = [...keep];
  s.discard.push(...su.cards.filter((c) => !keep.includes(c)));
  p.setup = undefined;
  if (corp.play) for (const op of corp.play(s, p.id, a.corp)) resolveSimple(s, p.id, op);
  if (!corp.firstAction) p.firstActionDone = true;
  log(s, p.id, `${p.name} founded ${corp.name} and kept ${keep.length} cards.`);
}

function startActions(s: GameState) {
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

function advanceTurn(s: GameState) {
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
  }
  log(s, null, `Production for generation ${s.generation}.`);
  if (parametersMaxed(s)) {
    s.phase = 'finalGreenery';
    s.finalOrder = order(s);
    s.active = s.finalOrder[0];
    log(s, null, 'Mars is terraformed! Last chance to convert plants into greeneries.');
    return;
  }
  s.generation++;
  s.firstPlayer = (s.firstPlayer + 1) % s.players.length;
  for (const p of s.players) {
    p.passed = false;
    p.usedActions = [];
    p.trRaisedThisGen = false;
    p.nextCardDiscount = 0;
    p.reqBonusNext = 0;
    p.research = draw(s, 4);
  }
  s.phase = 'research';
  s.active = s.firstPlayer;
  log(s, null, `Generation ${s.generation}. ${P(s, s.firstPlayer).name} goes first.`);
}

function endGame(s: GameState) {
  s.phase = 'over';
  s.prompt = null;
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

function spend(s: GameState, pid: number, mc: number, pay: Payment) {
  const p = P(s, pid);
  p.res.mc -= mc;
  p.res.steel -= pay.steel ?? 0;
  p.res.titanium -= pay.titanium ?? 0;
  p.res.heat -= pay.heat ?? 0;
}

function doPlay(s: GameState, pid: number, id: string, pay?: Payment): GameState {
  const p = P(s, pid);
  if (!canPlayCard(s, pid, id)) fail('You cannot play that card now');
  const c = CARDS[id];
  const cost = cardCost(s, pid, id);
  const lim = payLimitsForCard(s, pid, id);
  const pp = pay ?? autoPay(s, pid, cost, lim) ?? fail('Cannot pay');
  const mc = checkPayment(s, pid, cost, pp, lim);
  if (mc === null) return fail('Invalid payment');
  spend(s, pid, mc, pp);
  p.hand.splice(p.hand.indexOf(id), 1);
  p.played.push(id);
  p.nextCardDiscount = 0;
  p.reqBonusNext = 0;
  if (id === 'special-design') p.reqBonusNext = 2;
  if (id === 'indentured-workers') p.nextCardDiscount = 8;
  log(s, pid, `${p.name} played ${c.name}${cost ? ` for ${cost} M€` : ''}.`);
  const ops = c.play ? c.play(s, pid, id) : [];
  s.pendingAction = { pid, counts: true };
  enqueue(s, pid, ops, id);
  for (const q of s.players) {
    for (const a of activeCards(s, q.id)) {
      if (a.onCard) enqueue(s, q.id, a.onCard(s, q.id, pid, c), a.id);
    }
  }
  run(s);
  return s;
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
  const ops: Op[] = {
    power: [{ k: 'prod', r: 'energy', n: 1 }],
    asteroid: [{ k: 'temp', n: 1 }],
    aquifer: [{ k: 'ocean' }],
    greenery: [{ k: 'tile', tile: 'greenery', rule: 'greenery' }],
    city: [{ k: 'tile', tile: 'city', rule: 'city' }, { k: 'prod', r: 'mc', n: 1 }],
  }[id as Exclude<StdProject, 'sell'>] as Op[];
  s.pendingAction = { pid, counts: true };
  enqueue(s, pid, ops);
  for (const a of activeCards(s, pid)) if (a.onSP) enqueue(s, pid, a.onSP(s, pid, SP_COST_BASE[id]), a.id);
  run(s);
  return s;
}

const SP_COST_BASE: Record<StdProject, number> = { sell: 0, power: 11, asteroid: 14, aquifer: 18, greenery: 23, city: 25 };

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

function resolveSimple(s: GameState, pid: number, op: Op) {
  const p = P(s, pid);
  if (op.k === 'res') p.res[op.r] += op.n;
  else if (op.k === 'prod') p.prod[op.r] += op.n;
}

function raiseTR(s: GameState, pid: number, n: number) {
  const p = P(s, pid);
  p.tr += n;
  if (n > 0) p.trRaisedThisGen = true;
}

function resolve(s: GameState, item: QueueItem) {
  const { pid, op } = item;
  const p = P(s, pid);
  switch (op.k) {
    case 'res':
      p.res[op.r] = Math.max(0, p.res[op.r] + op.n);
      return;
    case 'prod':
      p.prod[op.r] = Math.max(op.r === 'mc' ? -5 : 0, p.prod[op.r] + op.n);
      return;
    case 'tr':
      raiseTR(s, pid, op.n);
      return;
    case 'log':
      log(s, pid, op.text);
      return;
    case 'temp': {
      const front: QueueItem[] = [];
      for (let i = 0; i < op.n && s.temperature < MAX_TEMP; i++) {
        s.temperature += 2;
        raiseTR(s, pid, 1);
        if (s.temperature === -24 || s.temperature === -20) p.prod.heat += 1;
        if (s.temperature === 0) front.push({ pid, op: { k: 'ocean' } });
      }
      pushFront(s, front);
      return;
    }
    case 'oxy': {
      const front: QueueItem[] = [];
      for (let i = 0; i < op.n && s.oxygen < MAX_OXY; i++) {
        s.oxygen += 1;
        raiseTR(s, pid, 1);
        if (s.oxygen === 8) front.push({ pid, op: { k: 'temp', n: 1 } });
      }
      pushFront(s, front);
      return;
    }
    case 'ocean':
      if (s.oceans < MAX_OCEANS) pushFront(s, [{ pid, op: { k: 'tile', tile: 'ocean', rule: 'ocean' } }]);
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
      if (op.target === 'this') {
        const card = op.card ?? item.src!;
        if (!p.played.includes(card)) return;
        p.cardRes[card] = Math.max(0, (p.cardRes[card] ?? 0) + op.n);
        return;
      }
      const options = op.target === 'anyWithRes'
        ? p.played.filter((c) => (p.cardRes[c] ?? 0) > 0)
        : p.played.filter((c) => CARDS[c].resource === op.rtype && (op.target !== 'other' || c !== item.src));
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
        for (const c of q.played) {
          const cd = CARDS[c];
          if (c === op.gainTo || cd.resource !== op.rtype || !(q.cardRes[c] > 0) || cd.protectedRes) continue;
          if (q.id !== pid && protects(s, q.id, op.rtype as 'microbe' | 'animal')) continue;
          options.push(c);
        }
      }
      if (!options.length) return;
      s.prompt = { kind: 'card', pid, title: `Remove ${op.n === 1 ? 'a' : `up to ${op.n}`} ${op.rtype}${op.n > 1 ? 's' : ''} from which card?`, options, optional: !op.gainTo, item };
      return;
    }
    case 'draw': {
      const cards = draw(s, op.n);
      p.hand.push(...cards);
      return;
    }
    case 'look': {
      const cards = draw(s, op.n);
      const max = op.buy ? (p.res.mc >= 3 ? op.keep : 0) : op.keep;
      const min = op.buy ? 0 : Math.min(op.keep, cards.length);
      if (!cards.length) return;
      s.prompt = { kind: 'cards', pid, title: op.buy ? 'Buy this card for 3 M€?' : `Keep ${op.keep} of these`, cards, min, max: Math.min(max, cards.length), costEach: op.buy ? 3 : 0, item };
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
      s.prompt = { kind: 'amount', pid, title: op.title, max: op.max, item };
      return;
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
  }
}

const resName = (r: Res) => ({ mc: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plants', energy: 'energy', heat: 'heat' })[r];

function finishDecProd(s: GameState, item: QueueItem, target: number) {
  const op = item.op as Extract<Op, { k: 'decProd' }>;
  const q = P(s, target);
  q.prod[op.r] -= op.n;
  if (op.gain) P(s, item.pid).prod[op.r] += op.n;
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
      else if (op.k === 'removeCardRes') {
        const owner = s.players.find((q) => q.played.includes(card))!;
        const n = Math.min(op.n, owner.cardRes[card] ?? 0);
        owner.cardRes[card] -= n;
        if (op.gainTo) p.cardRes[op.gainTo] = (p.cardRes[op.gainTo] ?? 0) + n;
        log(s, pid, `${p.name} took ${n} ${op.rtype}${n === 1 ? '' : 's'} from ${CARDS[card].name}.`);
      } else if (op.k === 'robotic') {
        const prodOps = CARDS[card].play!(s, pid, card).filter((o) => o.k === 'prod');
        log(s, pid, `${p.name} copied the production of ${CARDS[card].name}.`);
        pushFront(s, prodOps.map((o) => ({ pid, op: o, src: card })));
      }
      return;
    }
    case 'choice': {
      const i = a.option ?? -1;
      if (!pr.options[i]?.ok) fail('Choose an available option');
      s.prompt = null;
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
      p.res.mc -= picked.length * pr.costEach;
      p.hand.push(...picked);
      s.discard.push(...pr.cards.filter((c) => !picked.includes(c)));
      return;
    }
    case 'amount': {
      const n = a.amount ?? -1;
      if (!Number.isInteger(n) || n < 0 || n > pr.max) fail('Invalid amount');
      s.prompt = null;
      if (op.k === 'amount' && op.id === 'insulation') {
        p.prod.heat -= n;
        p.prod.mc += n;
      }
      if (op.k === 'amount' && op.id === 'powerInfra') {
        p.res.energy -= n;
        p.res.mc += n;
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
  sp.tile = { kind, owner: kind === 'ocean' ? null : pid, card: op.card && op.card !== 'flooding' ? op.card : undefined };
  sp.claimedBy = undefined;
  for (const b of sp.bonus) {
    if (b === 'card') p.hand.push(...draw(s, 1));
    else p.res[b] += 1;
  }
  if (op.rule === 'miningRights' || op.rule === 'miningArea') p.prod[sp.bonus.includes('titanium') ? 'titanium' : 'steel'] += 1;
  const oceansNext = neighbours(s.board, id).filter((n) => n.tile?.kind === 'ocean').length;
  p.res.mc += oceansNext * 2;
  const front: QueueItem[] = [];
  if (kind === 'ocean') {
    s.oceans++;
    raiseTR(s, pid, 1);
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
