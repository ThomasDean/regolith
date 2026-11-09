// Fathom's illustrated rules, and a per-card explainer that spells out what a fish does.
import { useState } from 'react';
import { FISH, SITE_COLORS, SITE_NAMES, TAG_NAMES, ZONE_NAMES } from '../engine/cards';
import { BOTTOM_BONUS, GOAL_IDS, GOALS, MID_BONUS, TOP_BONUS, TWI_BONUS } from '../engine/game';
import { costText, effectText, endText } from '../engine/text';
import { ABYSS, COLS, DIVERS, ROWS, SCHOOL_PTS, SHALLOWS, TIDES, zoneOfRow, type Effect, type FishDef, type GoalId, type Tag, type Zone } from '../engine/types';
import {
  CardGlyph, CostIcons, DiveGlyph, EatGlyph, EffectIcon, Egg, EndGlyph, FishCard, Fry, ReleaseGlyph, School, ZoneMark,
} from './FishCard';
import { FishArt } from './FishArt';
import { GoalIcon } from './GoalArt';

const ZONES: Zone[] = ['sun', 'twi', 'mid'];
const ZONE_BONUS: Record<Zone, Effect[]> = { sun: TOP_BONUS, twi: TWI_BONUS, mid: MID_BONUS };

/** Can this fish ever live in this row and site (ignoring what's already there)? */
const fits = (d: FishDef, row: number, col: number) =>
  d.zones.includes(zoneOfRow(row)) && (d.site === undefined || d.site === col)
  && (d.edge !== 'shallows' || row === SHALLOWS) && (d.edge !== 'abyss' || row === ABYSS);

/** A tiny map of the ocean with the slots this fish can live in lit up. */
export function PlacementMap({ id }: { id: string }) {
  const d = FISH[id];
  const cw = 18, ch = 11, g = 2, left = 12, topY = 10;
  const W = left + COLS * (cw + g), H = topY + ROWS * (ch + g) + 2;
  const zoneBg: Record<Zone, string> = { sun: '#2c6f86', twi: '#1b4766', mid: '#0c1f35' };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="fm-place-map" role="img" aria-label={`Where ${d.name} can live`}>
      {Array.from({ length: COLS }, (_, c) => (
        <text key={c} x={left + c * (cw + g) + cw / 2} y={7} textAnchor="middle" fontSize="6" fontWeight="700" fill={SITE_COLORS[c]}>{SITE_NAMES[c][0]}</text>
      ))}
      {Array.from({ length: ROWS }, (_, r) => (
        <g key={r}>
          {r % 2 === 0 && <circle cx={5} cy={topY + r * (ch + g) + ch + 0.5} r={2.6} fill={zoneOfRow(r) === 'sun' ? '#f2c14e' : zoneOfRow(r) === 'twi' ? '#8fb5e0' : '#6b6fa8'} />}
          {Array.from({ length: COLS }, (_, c) => {
            const ok = fits(d, r, c);
            return (
              <rect key={c} x={left + c * (cw + g)} y={topY + r * (ch + g)} width={cw} height={ch} rx={2}
                fill={ok ? '#f2c14e' : zoneBg[zoneOfRow(r)]} stroke={ok ? '#fff6d8' : 'rgba(255,255,255,0.12)'} strokeWidth={ok ? 0.8 : 0.5} opacity={ok ? 1 : 0.7} />
            );
          })}
        </g>
      ))}
    </svg>
  );
}

function whereText(d: FishDef): string {
  const z = d.zones.map((x) => ZONE_NAMES[x]);
  const zones = z.length === 3 ? 'any zone' : z.length === 2 ? `${z[0]} or ${z[1]}` : z[0];
  const site = d.site !== undefined ? `the ${SITE_NAMES[d.site]} site only` : 'any site';
  const edge = d.edge === 'shallows' ? ', and only the shallows (the very top row)' : d.edge === 'abyss' ? ', and only the abyss (the very bottom row)' : '';
  return `${zones}, ${site}${edge}.`;
}

function SizeScale({ len }: { len: number }) {
  return (
    <span className="fm-size-scale" aria-hidden="true">
      {[1, 2, 3, 4, 5, 6].map((n) => <i key={n} className={n < len ? 'eats' : n === len ? 'me' : 'eaten-by'} style={{ height: 6 + n * 2.5 }}>{n}</i>)}
    </span>
  );
}

const TAG_HELP: Record<Tag, string> = {
  predator: 'counts for the Hunters goal and for abilities that score Predators',
  venomous: 'counts for abilities that score Venomous fish',
  camouflage: 'counts for abilities that score Camouflage fish',
  glow: 'counts for abilities that score Glowing fish',
  electric: 'counts for abilities that score Electric fish',
};

/** Spells a card out row by row: what it costs, where it lives, what eats what, and when each ability fires. */
export function CardHow({ id }: { id: string }) {
  const d = FISH[id];
  const c = d.cost;
  const costParts: string[] = [];
  if (c.cards) costParts.push(`discard ${c.cards} other card${c.cards === 1 ? '' : 's'} from your hand`);
  if (c.eggs) costParts.push(`remove ${c.eggs} egg${c.eggs === 1 ? '' : 's'} from your ocean`);
  if (c.fry) costParts.push(`remove ${c.fry} fry from your ocean`);
  if (c.eat) costParts.push('cover (eat) a smaller fish');
  return (
    <div className="fm-how" aria-label={`How ${d.name} works`}>
      <div className="how-row">
        <div className="how-pic"><CostIcons id={id} scale={1.5} /></div>
        <div><b>Cost</b> {costParts.length ? <>To release it, {costParts.length > 1 ? `${costParts.slice(0, -1).join(', ')} and ${costParts[costParts.length - 1]}` : costParts[0]}.</> : <>Free: releasing it just uses a diver.</>}</div>
      </div>
      <div className="how-row">
        <div className="how-pic"><PlacementMap id={id} /></div>
        <div><b>Lives in</b> {whereText(d)} <span className="muted">Lit slots on the map.</span></div>
      </div>
      <div className="how-row">
        <div className="how-pic"><SizeScale len={d.len} /></div>
        <div>
          <b>Size {d.len}</b> {d.len > 1 ? <>It can be released on top of a fish of size {d.len === 2 ? '1' : `1–${d.len - 1}`}, eating it. </> : null}
          {d.len < 6 ? <>A size {d.len + 1}+ fish can eat it.</> : <>Nothing can eat it.</>}
          {c.eat ? <> <EatGlyph /> It <i>must</i> eat a smaller fish.</> : null}
        </div>
      </div>
      {d.play?.length ? (
        <div className="how-row play">
          <div className="how-pic"><span className="how-when play"><ReleaseGlyph size={16} /></span>{d.play.map((e, i) => <EffectIcon key={i} e={e} scale={1.6} />)}</div>
          <div><b>When released</b> Once, right away: {d.play.map((e) => effectText(e).toLowerCase()).join(', then ')}.</div>
        </div>
      ) : null}
      {d.dive?.length ? (
        <div className="how-row dive">
          <div className="how-pic"><span className="how-when dive"><DiveGlyph size={16} /></span>{d.dive.map((e, i) => <EffectIcon key={i} e={e} scale={1.6} />)}</div>
          <div><b>When dived</b> Every time you dive the site it lives in, the diver passes it and you {d.dive.map((e) => effectText(e).toLowerCase()).join(', then ')}. It keeps working all game.</div>
        </div>
      ) : null}
      {d.end ? (
        <div className="how-row end">
          <div className="how-pic"><span className="how-when end"><EndGlyph size={16} /></span></div>
          <div><b>At game end</b> {endText(d.end)}, on top of its {d.pts} printed point{d.pts === 1 ? '' : 's'}.</div>
        </div>
      ) : null}
      {d.tags.length > 0 && (
        <div className="how-row">
          <div className="how-pic fc-tags">{d.tags.map((t, i) => <span key={i} className={`tag t-${t}`}>{TAG_NAMES[t]}</span>)}</div>
          <div><b>Tags</b> {d.tags.map((t) => `${TAG_NAMES[t]} ${TAG_HELP[t]}`).join('; ')}.</div>
        </div>
      )}
      <div className="how-row">
        <div className="how-pic"><span className="fc-pts">{d.pts}</span></div>
        <div><b>{d.pts} point{d.pts === 1 ? '' : 's'}</b> at the end of the game if it's still on top (not eaten).</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the rules guide

type Tab = 'basics' | 'ocean' | 'cards' | 'goals';
const TABS: [Tab, string][] = [['basics', 'Basics'], ['ocean', 'Ocean & diving'], ['cards', 'Reading cards'], ['goals', 'Goals & scoring']];

export function RulesGuide({ goals }: { goals?: GoalId[] }) {
  const [tab, setTab] = useState<Tab>('basics');
  return (
    <div className="fm-guide">
      <div className="fm-guide-tabs" role="tablist" aria-label="Rules sections">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" className="fm-guide-body">
        {tab === 'basics' && <Basics />}
        {tab === 'ocean' && <OceanRules />}
        {tab === 'cards' && <CardsRules />}
        {tab === 'goals' && <GoalsRules goals={goals} />}
      </div>
    </div>
  );
}

function Basics() {
  return (
    <>
      <p className="guide-lede">Build an ocean of fish from the sunlit shallows down to the midnight deep, then send divers down to set it working. Most points after <b>{TIDES} tides</b> wins.</p>
      <h4>A tide</h4>
      <p>Everyone gets <b>{DIVERS} divers</b> <span className="divers guide-divers">{Array.from({ length: DIVERS }, (_, k) => <i key={k} className="on" />)}</span> each tide. Players take turns placing one diver at a time. When everyone is out of divers, the tide ends and its goal scores.</p>
      <div className="guide-flow" aria-label="The four tides">
        {Array.from({ length: TIDES }, (_, i) => (
          <span key={i} className="guide-flow-step">
            <span className="chip">Tide {i + 1}</span>
            <span className="arrow">→</span>
            <span className={`chip ${i < 3 ? 'goal' : 'final'}`}>{i < 3 ? 'Goal scores' : 'Final scoring'}</span>
            {i < TIDES - 1 && <span className="arrow">→</span>}
          </span>
        ))}
      </div>
      <h4>On your turn, do one of two things</h4>
      <div className="guide-choices">
        <div className="guide-choice play">
          <div className="guide-choice-head"><ReleaseGlyph size={26} /><b>Release a fish</b></div>
          <ol>
            <li>Tap a card in your hand.</li>
            <li>Pay its cost <CardGlyph /> <Egg size={10} /> <Fry size={9} /> <EatGlyph />.</li>
            <li>Tap a lit slot in your ocean where it can live.</li>
            <li>Its <ReleaseGlyph size={12} /> <i>Released</i> ability happens once, right away.</li>
          </ol>
        </div>
        <div className="guide-choice dive">
          <div className="guide-choice-head"><DiveGlyph size={26} /><b>Dive a site</b></div>
          <ol>
            <li>Tap <b>Dive ↓</b> over Kelp, Reef or Open Blue.</li>
            <li>The diver swims top to bottom, collecting each zone's bonus where you have a fish.</li>
            <li>Every fish it passes gives its <DiveGlyph size={12} /> <i>Dived</i> ability.</li>
            <li>First diver to the bottom of that site this tide takes the bottom bonus.</li>
          </ol>
        </div>
      </div>
      <p className="guide-tip"><b>The big idea:</b> early on, release fish to build your ocean. Later, dive the sites you've stacked with <i>Dived</i> abilities: each dive fires all of them at once.</p>
      <p className="muted">Hands are open in Fathom, so several people can share one device. Tap any card, anywhere, to see exactly what it does.</p>
    </>
  );
}

function OceanRules() {
  return (
    <>
      <p>Your ocean has <b>three dive sites</b> (columns) and <b>three zones</b> (two rows each). Between the zones are the bonuses a dive collects.</p>
      <div className="guide-ocean" role="img" aria-label="Diagram of the ocean: three sites, three zones, bonuses between them">
        <span />
        {Array.from({ length: COLS }, (_, c) => <span key={c} className="go-site" style={{ ['--site' as string]: SITE_COLORS[c] }}>{SITE_NAMES[c]}</span>)}
        {ZONES.map((z) => (
          <ZoneDiagram key={z} z={z} />
        ))}
        <span className="go-label">Bottom</span>
        {Array.from({ length: COLS }, (_, c) => <span key={c} className="go-bonus bottom">{BOTTOM_BONUS[c].map((e, i) => <EffectIcon key={i} e={e} />)}</span>)}
      </div>
      <h4>A dive, step by step</h4>
      <ol className="guide-steps">
        <li><DiveGlyph size={14} /> Pick a site and send a diver straight down it.</li>
        <li>At each zone, if you have <b>at least one fish in that zone of that site</b>, you collect the bonus shown above it (it lights up on your board).</li>
        <li>Every fish the diver passes fires its <span className="when dive">Dived</span> ability, top to bottom.</li>
        <li>The <b>first</b> dive to reach the bottom of each site each tide also takes that site's bottom bonus: Kelp <EffectIcon e={BOTTOM_BONUS[0][0]} />, Reef <EffectIcon e={BOTTOM_BONUS[1][0]} />, Open Blue <EffectIcon e={BOTTOM_BONUS[2][0]} /> + <EffectIcon e={BOTTOM_BONUS[2][1]} />.</li>
      </ol>
      <h4>Eggs, fry and schools</h4>
      <div className="guide-eq" aria-label="An egg hatches into a fry; three fry in one slot make a school worth 6">
        <span><Egg size={20} /><small>egg · 1 pt</small></span>
        <span className="arrow">hatch →</span>
        <span><Fry size={18} /><small>fry · 1 pt</small></span>
        <span className="arrow">×3 in one slot →</span>
        <span><School size={24} /><small>school · {SCHOOL_PTS} pts</small></span>
      </div>
      <p>Each fish can hold one egg. Fry can sit in any slot, even an empty one. A school can be moved but never broken up. Eggs can also pay for fish that cost <Egg size={10} />, and fry for fish that cost <Fry size={9} />.</p>
      <h4>Eating</h4>
      <p><EatGlyph size={14} /> A fish can be released <b>on top of a smaller fish</b>, eating it. The eaten fish stays underneath and is worth 1 point at the end; its egg and fry stay in the slot. Fish marked <EatGlyph /> in their cost <i>must</i> eat. The three printed <b>bait shoals</b> (size 1) are there to be eaten.</p>
    </>
  );
}

function ZoneDiagram({ z }: { z: Zone }) {
  const rows = z === 'sun' ? [0, 1] : z === 'twi' ? [2, 3] : [4, 5];
  return (
    <>
      <span className="go-label"><ZoneMark z={z} /> {ZONE_NAMES[z]}</span>
      {Array.from({ length: COLS }, (_, c) => <span key={c} className="go-bonus"><EffectIcon e={ZONE_BONUS[z][c]} /></span>)}
      {rows.map((r) => (
        <span key={r} style={{ display: 'contents' }}>
          <span className="go-row">{r === 0 ? 'shallows' : r === ROWS - 1 ? 'abyss' : ''}</span>
          {Array.from({ length: COLS }, (_, c) => <span key={c} className={`go-slot z-${z}`} />)}
        </span>
      ))}
    </>
  );
}

const SAMPLE = 'sheephead';
const ALL_EFFECTS: Effect[] = [
  { k: 'draw', n: 1 }, { k: 'egg', n: 1 }, { k: 'eggEach', where: { zone: 'sun' } }, { k: 'hatch', n: 1 }, { k: 'fry', n: 1 },
  { k: 'move' }, { k: 'recover' }, { k: 'cycle' }, { k: 'all', e: { k: 'draw', n: 1 } },
];

function CardsRules() {
  const d = FISH[SAMPLE];
  return (
    <>
      <div className="guide-anatomy">
        <FishCard id={SAMPLE} />
        <ol className="guide-legend">
          <li><span className="lg-pic"><CostIcons id={SAMPLE} /></span><span><b>Cost</b> (top left): {costText(d.cost)}. <CardGlyph /> discard cards, <Egg size={10} /> spend eggs, <Fry size={9} /> spend fry, <EatGlyph /> must eat a smaller fish.</span></li>
          <li><span className="lg-pic"><span className="fc-pts">{d.pts}</span></span><span><b>Points</b> (top right) it scores at the end if still on top.</span></li>
          <li><span className="lg-pic"><span className="fc-zones">{d.zones.map((z) => <ZoneMark key={z} z={z} />)}</span></span><span><b>Zones</b> it can live in: <ZoneMark z="sun" /> Sunlight, <ZoneMark z="twi" /> Twilight, <ZoneMark z="mid" /> Midnight.</span></li>
          <li><span className="lg-pic">size {d.len}</span><span><b>Size</b>, 1 to 6. Bigger fish eat smaller ones.</span></li>
          <li><span className="lg-pic fc-where">Kelp only</span><span><b>Site or edge</b> limits, if any: one site, or only the top/bottom row.</span></li>
          <li><span className="lg-pic"><span className="when-chip play"><ReleaseGlyph size={10} /></span><span className="when-chip dive"><DiveGlyph size={10} /></span><span className="when-chip end"><EndGlyph size={10} /></span></span><span><b>Abilities</b>: <i>Released</i> fires once when played, <i>Dived</i> every time you dive its site, <i>Game end</i> scores at the end.</span></li>
          <li><span className="lg-pic"><span className="tag t-predator">Predator</span></span><span><b>Tags</b> that some goals and abilities count.</span></li>
        </ol>
      </div>
      <h4>Every ability icon</h4>
      <ul className="guide-icons">
        {ALL_EFFECTS.map((e, i) => <li key={i}><span className="lg-pic"><EffectIcon e={e} scale={1.4} /></span><span>{effectText(e)}{e.k === 'eggEach' ? ' (here: Sunlight fish)' : ''}{e.k === 'recover' ? ' (or draw if it is empty)' : ''}.</span></li>)}
        <li><span className="lg-pic"><EffectIcon e={{ k: 'draw', n: 2 }} scale={1.4} /></span><span>A small number means “this many”: draw 2 cards.</span></li>
      </ul>
      <h4>Fish shapes</h4>
      <p className="muted">Pictures are drawn from each fish's size, zone and tags, so a big Midnight predator looks like one.</p>
      <div className="guide-fishes">{['sardine', 'lionfish', 'barreleye', 'bluefin'].map((f) => <span key={f}><FishArt id={f} /><small>{FISH[f].name}</small></span>)}</div>
    </>
  );
}

function GoalsRules({ goals }: { goals?: GoalId[] }) {
  return (
    <>
      <h4>Tide goals</h4>
      <p>At the end of tides 1, 2 and 3, that tide's goal scores for everyone. <b>Classic</b> games use Brood, Full rows and Schools. <b>Variable</b> games draw three of the nine below, and the leader of each tide gets <b>+3</b> more.</p>
      {goals && (
        <ol className="guide-goals this-game">
          {goals.map((g, i) => <li key={g}><GoalIcon id={g} size={28} /><span><b>Tide {i + 1}: {GOALS[g].name}</b><br />{GOALS[g].text}.</span></li>)}
        </ol>
      )}
      <ul className="guide-goals">
        {GOAL_IDS.map((g) => <li key={g} className={goals?.includes(g) ? 'used' : ''}><GoalIcon id={g} size={24} /><span><b>{GOALS[g].name}</b> · {GOALS[g].text}</span></li>)}
      </ul>
      <h4>Final scoring, after tide {TIDES}</h4>
      <ul className="guide-score">
        <li><span className="fc-pts">#</span>Printed points of every fish on top</li>
        <li><EatGlyph size={14} /> 1 per eaten fish beneath them</li>
        <li><Egg size={13} /> 1 per egg</li>
        <li><Fry size={12} /> 1 per fry</li>
        <li><School size={16} /> {SCHOOL_PTS} per school</li>
        <li><EndGlyph size={14} /> Every <i>Game end</i> ability</li>
        <li><GoalIcon id="rows" size={16} /> Points from the three tide goals</li>
      </ul>
      <p className="muted">Ties go to whoever has the most cards in hand.</p>
    </>
  );
}
