// How to play the expansions: a short rules guide per expansion, written to match how this
// engine plays them. Party and colony details are read from the engine data so they stay in sync.
import { useState } from 'react';
import { EXPANSIONS, PARTIES, type Expansion, type Expansions } from '../engine/types';
import { PARTY_DEFS, DELEGATES_PER_PLAYER, DELEGATE_COST } from '../engine/turmoil';
import { COLONIES } from '../engine/colonies';
import { EXPANSION_LABEL } from './format';
import { Dialog } from './Dialog';

const ORDER = 'Research → actions → production → World Government Terraforming (Venus Next) → colony tracks rise (Colonies) → Turmoil phase (Turmoil) → next generation.';

function Prelude() {
  return (
    <>
      <p className="htp-lede">A head start: two free cards each that kick your engine off before the first generation.</p>
      <h3>Setup</h3>
      <ul>
        <li>Along with your corporations and 10 project cards, you’re dealt <b>4 preludes</b>. Keep <b>2</b>; they’re free.</li>
        <li>Prelude also adds new corporations and project cards (marked <i>Prelude</i>).</li>
      </ul>
      <h3>Playing preludes</h3>
      <ul>
        <li>Once everyone has picked a corporation, players play <b>both</b> preludes in turn order, before anyone takes a normal action.</li>
        <li>Preludes have no cost and no requirements; their effects happen right away (production, resources, tiles, raising parameters…).</li>
        <li>If a prelude can’t be played in full, it’s discarded and you get <b>15 M€</b> instead.</li>
        <li>A few project cards let you draw preludes later in the game.</li>
      </ul>
      <h3>Tips</h3>
      <ul>
        <li>Pick preludes that fit your corporation: production pays back every generation, so take it early.</li>
        <li>With extra production on the table, games tend to finish a generation or so sooner. Plan your end-game a little earlier.</li>
      </ul>
    </>
  );
}

function Venus() {
  return (
    <>
      <p className="htp-lede">A fourth global parameter, floaters, and a World Government that terraforms a little every generation.</p>
      <h3>The Venus track</h3>
      <ul>
        <li>Venus runs from <b>0% to 30%</b> in 2% steps. Each step you raise is <b>+1 TR</b>, like the other parameters. It sits beside temperature and oxygen on the gauges.</li>
        <li>The player who raises it to <b>8%</b> draws a card; to <b>16%</b> gains an extra TR.</li>
        <li>Venus does <b>not</b> have to be finished for the game to end: that’s still temperature, oxygen and oceans.</li>
        <li><b>Air Scrapping</b> is a new standard project: 15 M€ to raise Venus one step.</li>
        <li>Some cards need Venus at a certain level, shown under <i>Needs</i>.</li>
      </ul>
      <h3>World Government Terraforming</h3>
      <ul>
        <li>After production every generation, the <b>first player</b> raises one unfinished parameter: temperature, oxygen, an ocean or Venus.</li>
        <li>Nobody gains TR or placement bonuses for it. It just speeds the game along, so pick what hurts your rivals or helps your plans.</li>
      </ul>
      <h3>Floaters and new cards</h3>
      <ul>
        <li><b>Floaters</b> are a new card resource. Cards collect them and spend them for effects, often to raise Venus.</li>
        <li>New Venus tags, corporations and cards, including cities on named spaces off Mars (shown with the map).</li>
        <li><b>Hoverlord</b> (milestone, 7 floaters on your cards) and <b>Venuphile</b> (award, most Venus tags) can be drawn when Venus Next is on.</li>
      </ul>
    </>
  );
}

function Colonies() {
  return (
    <>
      <p className="htp-lede">Colony tiles around the solar system that you settle for a bonus and trade with for income.</p>
      <h3>Setup</h3>
      <ul>
        <li>The game uses <b>players + 2</b> colony tiles (5 with two players). The rest stay in the box; some cards bring one into play.</li>
        <li>Everyone starts with <b>1 trade fleet</b>. Cards can give you more.</li>
        <li>Enceladus, Miranda and Titan start <b>closed</b>. They open as soon as anyone plays a card that holds microbes, animals or floaters respectively.</li>
      </ul>
      <h3>Building a colony</h3>
      <ul>
        <li>Use the <b>Build Colony</b> standard project (17 M€) or a card that places a colony.</li>
        <li>Each tile holds <b>3 colonies</b>, and normally only one of them can be yours.</li>
        <li>You get the tile’s <b>build bonus</b> at once (production, resources, cards or an ocean).</li>
        <li>A tile’s trade marker can never sit below the number of colonies on it, so building also pushes it up.</li>
      </ul>
      <h3>Trading (an action)</h3>
      <ol>
        <li>Send a free fleet to an open tile that no one has traded with yet this generation.</li>
        <li>Pay <b>9 M€, 3 energy or 3 titanium</b> (some cards make this cheaper).</li>
        <li>Collect the trade income shown at the tile’s marker. Some cards move the marker up first.</li>
        <li>Every colony on that tile then pays its owner the <b>colony bonus</b>, whoever traded.</li>
        <li>The marker drops back to the number of colonies on the tile.</li>
      </ol>
      <h3>End of each generation</h3>
      <ul>
        <li>Fleets come home, and every open tile’s marker moves <b>up one step</b>. The longer a tile waits, the richer the trade.</li>
      </ul>
      <h3>Tips</h3>
      <ul>
        <li>Colonies on busy tiles earn you income on other people’s turns.</li>
        <li>The <b>Pioneer</b> milestone (4 colonies) can be drawn when Colonies is on.</li>
      </ul>
      <details className="htp-more">
        <summary>The colony tiles</summary>
        <ul className="htp-tiles">
          {COLONIES.map((c) => (
            <li key={c.id}><b>{c.name}</b>: build {c.buildText}; trade {c.tradeText} ({c.steps.join(' / ')}); colony bonus {c.bonusText}.{c.resource ? ` Opens with a ${c.resource} card.` : ''}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

function Turmoil() {
  return (
    <>
      <p className="htp-lede">Earth’s politics: six parties, your delegates, a chairman, and global events you can see coming.</p>
      <h3>Delegates</h3>
      <ul>
        <li>You have <b>{DELEGATES_PER_PLAYER} delegates</b> in reserve. As an action, send one to any party: the <b>first each generation is free</b> (lobbying); after that each costs <b>{DELEGATE_COST} M€</b>.</li>
        <li>Whoever has the most delegates in a party is its <b>leader</b> (ties stay with the current leader).</li>
        <li>The party with the most delegates is <b>dominant</b>. It will rule next generation.</li>
        <li>Neutral delegates are placed by global events, so parties are never empty for long.</li>
      </ul>
      <h3>The Turmoil phase (end of every generation)</h3>
      <ol>
        <li>Everyone loses <b>1 TR</b>.</li>
        <li>The <b>current global event</b> resolves for everyone.</li>
        <li>The dominant party takes power. Its leader becomes <b>chairman</b> and gains <b>1 TR</b>; the party’s other delegates go back to their owners’ reserves.</li>
        <li>Everyone gets the new ruling party’s <b>bonus</b>, and its <b>policy</b> applies all next generation.</li>
        <li>The events move along: <i>coming</i> becomes <i>current</i>, <i>distant</i> becomes <i>coming</i>, and a new distant event is drawn.</li>
      </ol>
      <h3>Influence and global events</h3>
      <ul>
        <li>Events reward or punish things like tags, cities or production. <b>Influence</b> improves your result: more of a good event, less of a bad one.</li>
        <li>You get +1 influence for being chairman, +1 for leading the dominant party, +1 for having another delegate there, plus any from cards.</li>
        <li>You can see each event two generations ahead in the Turmoil panel. Steer the dominant party and your influence before it lands.</li>
      </ul>
      <h3>The parties</h3>
      <table className="htp-parties">
        <thead><tr><th>Party</th><th>Bonus when it takes power</th><th>Policy while ruling</th></tr></thead>
        <tbody>
          {PARTIES.map((id) => {
            const d = PARTY_DEFS[id];
            return (
              <tr key={id}>
                <th scope="row"><span className="htp-dot" style={{ background: d.color }} aria-hidden="true" />{d.name}</th>
                <td>{d.bonusText}.</td>
                <td>{d.policyText}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3>Also</h3>
      <ul>
        <li>Some cards need a party: it must be ruling, or you must have 2 delegates in it.</li>
        <li>The game starts with the Greens ruling and a neutral chairman.</li>
        <li>The <b>Lobbyist</b> milestone (all {DELEGATES_PER_PLAYER} delegates out of your reserve) can be drawn when Turmoil is on.</li>
      </ul>
    </>
  );
}

const BODY: Record<Expansion, () => React.ReactNode> = { prelude: Prelude, venus: Venus, colonies: Colonies, turmoil: Turmoil };

/** The expansions guide. `inGame` marks which expansions this game uses and opens on the first of them. */
export function HowToPlay({ onClose, inGame }: { onClose: () => void; inGame?: Expansions }) {
  const [tab, setTab] = useState<Expansion>(() => EXPANSIONS.find((e) => inGame?.[e]) ?? EXPANSIONS[0]);
  const Body = BODY[tab];
  return (
    <Dialog title="How to play the expansions" wide onClose={onClose}>
      <div className="htp">
        <div className="htp-tabs" role="tablist" aria-label="Expansion">
          {EXPANSIONS.map((e) => (
            <button key={e} type="button" role="tab" id={`htp-tab-${e}`} aria-selected={tab === e} aria-controls="htp-panel"
              className={`htp-tab ${tab === e ? 'on' : ''}`} onClick={() => setTab(e)}>
              {EXPANSION_LABEL[e]}{inGame?.[e] ? <small> in this game</small> : null}
            </button>
          ))}
        </div>
        <div className="htp-panel" id="htp-panel" role="tabpanel" aria-labelledby={`htp-tab-${tab}`}>
          <Body />
          <p className="muted small-print htp-order"><b>A generation with expansions:</b> {ORDER}</p>
        </div>
      </div>
    </Dialog>
  );
}
