import { useMemo, useState } from 'react';
import type { GameState, Level } from '../engine/types';
import { createGame } from '../engine/game';
import { Board } from './Board';
import { clearSave, Game, loadGame, saveGame } from './Game';
import { CloudPanel } from './Cloud';
import { startNewCloudId } from '../cloud';
import { PLAYER_COLORS, PLAYER_COLOR_NAMES } from './format';

type Seat = { name: string; kind: 'human' | Level; color: string };

const DEFAULT_SEATS: Seat[] = [
  { name: 'You', kind: 'human', color: PLAYER_COLORS[0] },
  { name: 'Vesta', kind: 'normal', color: PLAYER_COLORS[1] },
  { name: 'Ceres', kind: 'normal', color: PLAYER_COLORS[2] },
];
const CPU_NAMES = ['Vesta', 'Ceres', 'Pallas', 'Hygiea', 'Juno'];

export function App() {
  const [game, setGame] = useState<GameState | null>(null);
  const saved = useMemo(() => (game ? null : loadGame()), [game]);
  if (game) return <Game key={game.options.seed} initial={game} onExit={() => setGame(null)} />;
  return <Menu saved={saved && saved.phase !== 'over' ? saved : null} onStart={setGame} />;
}

function Menu({ saved, onStart }: { saved: GameState | null; onStart: (s: GameState) => void }) {
  const [seats, setSeats] = useState<Seat[]>(DEFAULT_SEATS);
  const [corporateEra, setCorporateEra] = useState(true);
  const [seed, setSeed] = useState('');
  const preview = useMemo(() => createGame([{ name: 'a', color: '#000', cpu: null }, { name: 'b', color: '#000', cpu: null }], { seed: 1 }), []);
  const update = (i: number, patch: Partial<Seat>) => setSeats((x) => x.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addSeat = () => setSeats((x) => {
    const color = PLAYER_COLORS.find((c) => !x.some((s) => s.color === c))!;
    const name = CPU_NAMES.find((n) => !x.some((s) => s.name === n)) ?? `Player ${x.length + 1}`;
    return [...x, { name, kind: 'normal', color }];
  });
  const names = seats.map((s) => s.name.trim());
  const valid = names.every(Boolean) && new Set(names).size === names.length;
  const start = () => {
    clearSave();
    startNewCloudId();
    onStart(createGame(seats.map((s) => ({ name: s.name.trim(), color: s.color, cpu: s.kind === 'human' ? null : s.kind })), {
      corporateEra, seed: seed.trim() ? Number(seed) || hash(seed) : undefined,
    }));
  };
  return (
    <div className="menu">
      <div className="menu-map" aria-hidden="true"><Board s={preview} /></div>
      <div className="menu-panel">
        <h1>Regolith</h1>
        <p className="lede">Terraform Mars against friends on one device, or against CPU rivals that build engines of their own.</p>

        {saved && (
          <div className="resume">
            <span>Game in progress: generation {saved.generation}, {saved.players.map((p) => p.name).join(', ')}.</span>
            <button type="button" className="btn" onClick={() => onStart(saved)}>Resume</button>
          </div>
        )}

        <CloudPanel onResume={(g) => { saveGame(g); onStart(g); }} />

        <h2>Players</h2>
        <ol className="seats">
          {seats.map((s, i) => (
            <li key={i} className="seat" style={{ ['--pc' as string]: s.color }}>
              <label className="sr-only" htmlFor={`name-${i}`}>Player {i + 1} name</label>
              <input id={`name-${i}`} value={s.name} maxLength={16} onChange={(e) => update(i, { name: e.target.value })} />
              <label className="sr-only" htmlFor={`kind-${i}`}>Player {i + 1} controller</label>
              <select id={`kind-${i}`} value={s.kind} onChange={(e) => update(i, { kind: e.target.value as Seat['kind'] })}>
                <option value="human">Human</option>
                <option value="easy">Easy CPU</option>
                <option value="normal">Normal CPU</option>
                <option value="hard">Hard CPU</option>
              </select>
              <label className="sr-only" htmlFor={`color-${i}`}>Player {i + 1} color</label>
              <select id={`color-${i}`} value={s.color} onChange={(e) => update(i, { color: e.target.value })} className="color-select">
                {PLAYER_COLORS.map((c, j) => <option key={c} value={c} disabled={seats.some((o, k) => k !== i && o.color === c)}>{PLAYER_COLOR_NAMES[j]}</option>)}
              </select>
              <button type="button" className="icon-btn" aria-label={`Remove ${s.name}`} disabled={seats.length <= 2} onClick={() => setSeats((x) => x.filter((_, j) => j !== i))}>×</button>
            </li>
          ))}
        </ol>
        <button type="button" className="btn ghost small" disabled={seats.length >= 5} onClick={addSeat}>Add player</button>

        <div className="cpu-notes">
          <p><b>Easy</b> plays loosely and ignores you. <b>Normal</b> builds around its tags and discounts. <b>Hard</b> also watches the leader, races milestones and awards, and plans two actions ahead.</p>
        </div>

        <h2>Options</h2>
        <label className="check"><input type="checkbox" checked={corporateEra} onChange={(e) => setCorporateEra(e.target.checked)} /> Corporate Era cards and corporations (recommended)</label>
        <details className="seed">
          <summary>Seed</summary>
          <label>Use a seed to replay the same deal <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="Random" /></label>
        </details>

        <button type="button" className="btn big" disabled={!valid} onClick={start}>Start game</button>
        {!valid && <p className="warn">Give every player a different name.</p>}
      </div>
    </div>
  );
}

const hash = (t: string) => [...t].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;
