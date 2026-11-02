// Game setup: map choice and the milestone/award picker (the map's own set, a balanced random
// draw, or any mix with the players' own picks locked in).
import { useMemo } from 'react';
import { BOARD_IDS, BOARDS, type BoardId } from '../engine/board';
import { AWARDS, MILESTONES, availability, boardMA, drawMA, maDef, selectionIssues, type MADef, type MASelection } from '../engine/ma';

export interface MAState {
  sel: MASelection;
  /** ids the players picked or locked; shuffles keep them */
  locked: string[];
  /** 'board': follow the map's own set when the map changes */
  mode: 'board' | 'custom';
}

export const initialMA = (board: BoardId): MAState => ({ sel: boardMA(board, Math.random), locked: [], mode: 'board' });

/** Called when the map changes: the map's own set, or the current picks minus any the new map can't use. */
export function maForBoard(st: MAState, board: BoardId): MAState {
  if (st.mode === 'board') return initialMA(board);
  const keep = (xs: string[]) => xs.map((id) => (availability(board, id) ? null : id));
  const sel = drawMA(board, { milestones: keep(st.sel.milestones), awards: keep(st.sel.awards) }, Math.random);
  return { ...st, sel, locked: st.locked.filter((id) => !availability(board, id)) };
}

export function BoardPicker({ board, onChange }: { board: BoardId; onChange: (b: BoardId) => void }) {
  const def = BOARDS[board];
  return (
    <div className="board-pick">
      <div className="board-grid" role="radiogroup" aria-label="Map">
        {BOARD_IDS.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={id === board} className={`board-opt ${id === board ? 'on' : ''}`} onClick={() => onChange(id)}>
            <b>{BOARDS[id].name}</b>
            <span>{BOARDS[id].from}</span>
          </button>
        ))}
      </div>
      <p className="board-blurb">{def.blurb}</p>
      <ul className="board-rules">{def.rules.map((r) => <li key={r}>{r}</li>)}</ul>
    </div>
  );
}

const Lock = ({ on }: { on: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor" />
    <path d={on ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 5.6-1.5'} fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

function Slot({ kind, i, id, board, st, set }: { kind: 'milestones' | 'awards'; i: number; id: string; board: BoardId; st: MAState; set: (s: MAState) => void }) {
  const def = maDef(id)!;
  const pool: MADef[] = kind === 'milestones' ? MILESTONES : AWARDS;
  const taken = new Set(st.sel[kind]);
  const locked = st.locked.includes(id);
  const pick = (next: string) => {
    const xs = [...st.sel[kind]];
    xs[i] = next;
    set({ sel: { ...st.sel, [kind]: xs }, locked: [...st.locked.filter((x) => x !== id), next], mode: 'custom' });
  };
  const toggle = () => set({ ...st, locked: locked ? st.locked.filter((x) => x !== id) : [...st.locked, id], mode: 'custom' });
  const label = kind === 'milestones' ? `Milestone ${i + 1}` : `Award ${i + 1}`;
  return (
    <li className={`ma-slot ${locked ? 'locked' : ''}`}>
      <button type="button" className="icon-btn ma-lock" aria-pressed={locked} aria-label={`${locked ? 'Unlock' : 'Lock'} ${def.name}`} title={locked ? 'Locked: shuffles keep it' : 'Lock to keep it when shuffling'} onClick={toggle}><Lock on={locked} /></button>
      <div className="ma-body">
        <label className="sr-only" htmlFor={`${kind}-${i}`}>{label}</label>
        <select id={`${kind}-${i}`} value={id} onChange={(e) => pick(e.target.value)}>
          {BOARD_IDS.map((b) => {
            const group = pool.filter((d) => d.boards.includes(b));
            if (!group.length) return null;
            return (
              <optgroup key={b} label={BOARDS[b].name}>
                {group.map((d) => {
                  const why = availability(board, d.id);
                  return <option key={d.id} value={d.id} disabled={(d.id !== id && taken.has(d.id)) || !!why}>{d.name}{why ? ' (no volcanoes here)' : ''}</option>;
                })}
              </optgroup>
            );
          })}
        </select>
        <span className="ma-text">{def.text}</span>
      </div>
    </li>
  );
}

export function MAPicker({ board, st, set }: { board: BoardId; st: MAState; set: (s: MAState) => void }) {
  const issues = useMemo(() => selectionIssues(st.sel), [st.sel]);
  const shuffle = () => {
    const keep = (xs: string[]) => xs.map((id) => (st.locked.includes(id) ? id : null));
    set({ ...st, sel: drawMA(board, { milestones: keep(st.sel.milestones), awards: keep(st.sel.awards) }, Math.random), mode: 'custom' });
  };
  const own = BOARDS[board];
  const isOwn = st.mode === 'board';
  const name = (id: string) => maDef(id)!.name;
  return (
    <div className="ma-pick">
      <div className="ma-tools">
        <button type="button" className="btn small ghost" aria-pressed={isOwn} onClick={() => set(initialMA(board))}>{own.name}’s own</button>
        <button type="button" className="btn small" onClick={shuffle}>{st.locked.length ? `Shuffle the other ${10 - st.locked.length}` : 'Shuffle all 10'}</button>
        {st.locked.length > 0 && <button type="button" className="btn small ghost" onClick={() => set({ ...st, locked: [] })}>Unlock all</button>}
      </div>
      <p className="muted small-print">Shuffles draw from every map’s milestones and awards and keep look-alikes apart (no Gardener with Cultivator, no Builder with Contractor), with a spread of tiles, tags, cards, production and resources. Pick any slot yourself to lock it in.</p>
      <div className="ma-cols">
        <div>
          <h3>Milestones <span className="muted">8 M€, first 3 claimed</span></h3>
          <ol className="ma-list">{st.sel.milestones.map((id, i) => <Slot key={`m${i}`} kind="milestones" i={i} id={id} board={board} st={st} set={set} />)}</ol>
        </div>
        <div>
          <h3>Awards <span className="muted">8/14/20 M€, 3 funded</span></h3>
          <ol className="ma-list">{st.sel.awards.map((id, i) => <Slot key={`a${i}`} kind="awards" i={i} id={id} board={board} st={st} set={set} />)}</ol>
        </div>
      </div>
      {!isOwn && issues.pairs.length > 0 && (
        <p className="warn" role="status">
          Close overlap: {issues.pairs.map(([a, b]) => `${name(a)} and ${name(b)}`).join('; ')}. Players who chase one will often get the other too.
        </p>
      )}
    </div>
  );
}
