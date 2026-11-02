// End-of-game analytics: how the race unfolded (VP, TR or income turn by turn or per
// generation), where each player's points came from, and a table of game stats.
import { useMemo, useRef, useState } from 'react';
import type { GameState, HistoryPoint } from '../engine/types';
import { CARDS } from '../engine/cards';
import { score } from '../engine/queries';
import { cities, eventsPlayed, greeneries, marsTiles } from '../engine/helpers';

type Metric = 'vp' | 'tr' | 'income';
type Axis = 'turn' | 'gen';
const METRIC_LABEL: Record<Metric, string> = { vp: 'Victory points', tr: 'Terraform rating', income: 'Income (TR + M€ production)' };

// a second, non-colour cue per seat so lines stay distinct for colour-blind readers
const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross'] as const;
function Marker({ i, x, y, color, r = 4.5 }: { i: number; x: number; y: number; color: string; r?: number }) {
  const shape = SHAPES[i % SHAPES.length];
  const ring = { stroke: 'var(--panel)', strokeWidth: 2, paintOrder: 'stroke' as const };
  if (shape === 'circle') return <circle cx={x} cy={y} r={r} fill={color} {...ring} />;
  if (shape === 'square') return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1} fill={color} {...ring} />;
  if (shape === 'triangle') return <path d={`M${x},${y - r * 1.2} L${x + r * 1.15},${y + r * 0.9} L${x - r * 1.15},${y + r * 0.9}Z`} fill={color} {...ring} />;
  if (shape === 'diamond') return <path d={`M${x},${y - r * 1.3} L${x + r * 1.3},${y} L${x},${y + r * 1.3} L${x - r * 1.3},${y}Z`} fill={color} {...ring} />;
  return <path d={`M${x - r},${y - r} L${x + r},${y + r} M${x + r},${y - r} L${x - r},${y + r}`} stroke={color} strokeWidth={3} strokeLinecap="round" />;
}

interface Pt { key: string; label: string; gen: number; vals: number[]; pid: number | null }

function series(h: HistoryPoint[], metric: Metric, axis: Axis): Pt[] {
  const pick = (p: HistoryPoint) => (metric === 'vp' ? p.vp : metric === 'tr' ? p.tr : p.income);
  if (axis === 'turn') return h.map((p, i) => ({ key: `t${i}`, label: p.pid === null ? (i === 0 ? 'Start' : `End of generation ${p.gen}`) : `Turn ${p.turn}`, gen: p.gen, vals: pick(p), pid: p.pid }));
  // one point per generation: the last sample taken in it (after production; the final one for the last)
  const out: Pt[] = [];
  if (h.length) out.push({ key: 'start', label: 'Start', gen: 0, vals: pick(h[0]), pid: null });
  for (let i = 1; i < h.length; i++) {
    if (i + 1 < h.length && h[i + 1].gen === h[i].gen) continue;
    out.push({ key: `g${h[i].gen}`, label: `Generation ${h[i].gen}`, gen: h[i].gen, vals: pick(h[i]), pid: null });
  }
  return out;
}

const niceStep = (span: number) => {
  const raw = span / 4;
  const p = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  return [1, 2, 5, 10].map((m) => m * p).find((m) => m >= raw) ?? p * 10;
};

function LineChart({ s, metric, axis }: { s: GameState; metric: Metric; axis: Axis }) {
  const pts = useMemo(() => series(s.history ?? [], metric, axis), [s, metric, axis]);
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const W = 720, H = 290, L = 40, R = 104, T = 24, B = 40;
  const all = pts.flatMap((p) => p.vals);
  const step = niceStep(Math.max(...all) - Math.min(...all, 0));
  const lo = Math.max(0, Math.floor(Math.min(...all) / step) * step), hi = Math.ceil(Math.max(...all) / step) * step || step;
  const X = (i: number) => L + (pts.length < 2 ? 0 : (i / (pts.length - 1)) * (W - L - R));
  const Y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  // generation boundaries along the turn axis
  const gens = axis === 'turn' ? pts.map((p, i) => ({ p, i })).filter(({ p, i }) => i > 0 && p.gen !== pts[i - 1].gen) : [];
  const genEvery = Math.ceil(gens.length / 14) || 1;
  // end labels: drop them where they'd collide and let the legend carry identity
  const last = pts[pts.length - 1];
  const ends = s.players.map((p) => ({ i: p.id, y: Y(last.vals[p.id]) })).sort((a, b) => a.y - b.y);
  const crowded = new Set<number>();
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) { crowded.add(ends[k].i); crowded.add(ends[k - 1].i); }
  const move = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((x - L) / (W - L - R)) * (pts.length - 1));
    setHover(Math.max(0, Math.min(pts.length - 1, i)));
  };
  const hp = hover !== null ? pts[hover] : null;
  const order = hp ? [...s.players].sort((a, b) => hp.vals[b.id] - hp.vals[a.id]) : [];
  return (
    <div className="chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0}
        aria-label={`${METRIC_LABEL[metric]} by ${axis === 'turn' ? 'turn' : 'generation'}. Final: ${s.players.map((p) => `${p.name} ${last.vals[p.id]}`).join(', ')}. Use the arrow keys to step through.`}
        onPointerMove={(e) => move(e.clientX)} onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            setHover((h) => Math.max(0, Math.min(pts.length - 1, (h ?? (e.key === 'ArrowRight' ? -1 : pts.length)) + (e.key === 'ArrowRight' ? 1 : -1))));
          }
        }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="chart-grid" />
            <text x={L - 8} y={Y(v) + 4} textAnchor="end" className="chart-tick">{v}</text>
          </g>
        ))}
        {gens.map(({ p, i }, k) => (
          <g key={p.key}>
            <line x1={X(i - 0.5)} x2={X(i - 0.5)} y1={T - 6} y2={H - B} className="chart-grid faint" />
            {k % genEvery === 0 && <text x={X(i - 0.5) + 3} y={T - 10} className="chart-tick">G{p.gen}</text>}
          </g>
        ))}
        {axis === 'gen' && pts.map((p, i) => (pts.length <= 16 || i % 2 === 0) && <text key={p.key} x={X(i)} y={H - B + 18} textAnchor="middle" className="chart-tick">{p.gen === 0 ? 'Start' : p.gen}</text>)}
        <text x={L} y={H - 2} className="chart-tick">{axis === 'turn' ? `Turns (${pts.length - 1})` : 'Generation'}</text>
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="chart-axis" />
        {s.players.map((p) => (
          <path key={p.id} d={pts.map((q, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(q.vals[p.id]).toFixed(1)}`).join('')}
            fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {s.players.map((p) => <Marker key={p.id} i={p.id} x={X(pts.length - 1)} y={Y(last.vals[p.id])} color={p.color} />)}
        {s.players.map((p) => !crowded.has(p.id) && (
          <text key={p.id} x={X(pts.length - 1) + 10} y={Y(last.vals[p.id]) + 4} className="chart-end">{p.name} <tspan className="chart-end-v">{last.vals[p.id]}</tspan></text>
        ))}
        {hp && (
          <g pointerEvents="none">
            <line x1={X(hover!)} x2={X(hover!)} y1={T} y2={H - B} className="chart-cross" />
            {s.players.map((p) => <Marker key={p.id} i={p.id} x={X(hover!)} y={Y(hp.vals[p.id])} color={p.color} r={4} />)}
          </g>
        )}
      </svg>
      {hp && (
        <div className="chart-tip" style={{ left: `${(X(hover!) / W) * 100}%`, transform: `translateX(${X(hover!) > W * 0.6 ? 'calc(-100% - 12px)' : '12px'})` }}>
          <div className="chart-tip-h">{hp.label}{hp.pid !== null ? ` · ${s.players[hp.pid].name}, generation ${hp.gen}` : ''}</div>
          {order.map((p) => (
            <div key={p.id} className="chart-tip-row"><span className="key" style={{ background: p.color }} /><b>{hp.vals[p.id]}</b><span>{p.name}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend({ s, bars }: { s: GameState; bars?: boolean }) {
  return (
    <ul className="chart-legend" aria-label="Players">
      {s.players.map((p) => (
        <li key={p.id}>
          {bars
            ? <svg width="12" height="12" aria-hidden="true"><rect x="0" y="1" width="12" height="10" rx="2" fill={p.color} /></svg>
            : <svg width="26" height="12" aria-hidden="true"><line x1="1" x2="25" y1="6" y2="6" stroke={p.color} strokeWidth="2" strokeLinecap="round" /><Marker i={p.id} x={13} y={6} color={p.color} r={3.5} /></svg>}
          {p.name}
        </li>
      ))}
    </ul>
  );
}

const SOURCES = [
  { k: 'tr', label: 'Terraform rating' },
  { k: 'milestones', label: 'Milestones' },
  { k: 'awards', label: 'Awards' },
  { k: 'greeneries', label: 'Greeneries' },
  { k: 'cities', label: 'Cities (next to greeneries)' },
  { k: 'cards', label: 'Cards' },
] as const;

/** Grouped bars: one row per source of points, one bar per player (player colours, same as the lines). */
function Sources({ s }: { s: GameState }) {
  const sc = s.players.map((p) => score(s, p.id));
  const max = Math.max(1, ...sc.flatMap((x) => SOURCES.map((k) => x[k.k])));
  const n = s.players.length, bar = 10, gap = 2, rowH = n * (bar + gap) + 14;
  const W = 720, L = 190, R = 40;
  const bx = (v: number) => (Math.max(0, v) / max) * (W - L - R);
  const H = SOURCES.length * rowH;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Points by source: ${s.players.map((p, i) => `${p.name}: ${SOURCES.map((k) => `${k.label} ${sc[i][k.k]}`).join(', ')}`).join('; ')}`}>
        {SOURCES.map((k, r) => {
          const y0 = r * rowH + 4;
          return (
            <g key={k.k}>
              <text x={0} y={y0 + (n * (bar + gap)) / 2 + 4} className="chart-cat">{k.label}</text>
              <line x1={L} x2={L} y1={y0 - 2} y2={y0 + n * (bar + gap)} className="chart-axis" />
              {s.players.map((p, i) => {
                const v = sc[i][k.k], w = bx(v), y = y0 + i * (bar + gap);
                const rr = Math.min(4, w / 2);
                return (
                  <g key={p.id} className="bar">
                    <title>{`${p.name}: ${v} VP from ${k.label.toLowerCase()}`}</title>
                    <rect x={L} y={y - 1} width={W - L - R + 30} height={bar + 2} fill="transparent" />
                    {w > 0 && <path d={`M${L},${y} h${w - rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${bar - 2 * rr} a${rr},${rr} 0 0 1 ${-rr},${rr} h${-(w - rr)}Z`} fill={p.color} />}
                    <text x={L + w + 6} y={y + bar - 1} className="chart-val">{v}</text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Highlights({ s }: { s: GameState }) {
  const h = (s.history ?? []).filter((p) => p.pid !== null || p.turn === 0);
  let changes = 0, prev: number | null = null;
  const ledTurns = s.players.map(() => 0);
  let best = { gain: 0, pid: 0, gen: 0 };
  const all = s.history ?? [];
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    const top = Math.max(...p.vp);
    const leaders = p.vp.map((v, j) => (v === top ? j : -1)).filter((j) => j >= 0);
    if (leaders.length === 1) {
      if (prev !== null && leaders[0] !== prev) changes++;
      prev = leaders[0];
      ledTurns[leaders[0]]++;
    }
    if (i && p.pid !== null) {
      const gain = p.vp[p.pid] - all[i - 1].vp[p.pid];
      if (gain > best.gain) best = { gain, pid: p.pid, gen: p.gen };
    }
  }
  const total = ledTurns.reduce((a, b) => a + b, 0) || 1;
  const topLeader = ledTurns.indexOf(Math.max(...ledTurns));
  if (!h.length) return null;
  return (
    <div className="stat-tiles">
      <div className="stat"><span className="stat-label">Lead changes</span><span className="stat-value">{changes}</span></div>
      <div className="stat"><span className="stat-label">Led the most</span><span className="stat-value">{s.players[topLeader].name}</span><span className="stat-sub">{Math.round((ledTurns[topLeader] / total) * 100)}% of turns</span></div>
      {best.gain > 0 && <div className="stat"><span className="stat-label">Biggest turn</span><span className="stat-value">+{best.gain} VP</span><span className="stat-sub">{s.players[best.pid].name}, generation {best.gen}</span></div>}
      <div className="stat"><span className="stat-label">Generations</span><span className="stat-value">{s.generation}</span></div>
    </div>
  );
}

function StatsTable({ s }: { s: GameState }) {
  const rows = s.players.map((p) => {
    const tiles = marsTiles(s, p.id);
    return {
      p,
      cards: p.played.length, events: eventsPlayed(s, p.id),
      cities: cities(s, { pid: p.id }).length, greeneries: greeneries(s, p.id).length, special: tiles.filter((x) => x.tile?.kind === 'special').length,
      temp: s.raised?.[p.id]?.temp, oxy: s.raised?.[p.id]?.oxy, ocean: s.raised?.[p.id]?.ocean, venus: s.raised?.[p.id]?.venus,
      mc: p.prod.mc, ms: s.milestones.filter((m) => m.pid === p.id).length, aw: s.awards.filter((a) => a.pid === p.id).length,
      colonies: s.colonies?.reduce((a, c) => a + c.colonies.filter((o) => o === p.id).length, 0),
    };
  });
  const venus = s.venus !== undefined;
  const cols = !!s.colonies;
  const dash = (v: number | undefined) => (v === undefined ? '–' : v);
  return (
    <div className="table-scroll">
      <table className="scores stats">
        <thead>
          <tr><th>Player</th><th>Cards played</th><th>Events</th><th>Cities</th><th>Greeneries</th><th>Special tiles</th><th title="Temperature steps raised">Temp steps</th><th title="Oxygen steps raised">O₂ steps</th><th>Oceans placed</th>{venus && <th title="Venus steps raised">Venus steps</th>}{cols && <th>Colonies</th>}<th>M€ prod.</th><th>Milestones</th><th>Awards funded</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.p.id} style={{ ['--pc' as string]: r.p.color }}>
              <th scope="row"><span className="swatch" />{r.p.name}<small>{r.p.corp ? CARDS[r.p.corp].name : ''}</small></th>
              <td>{r.cards}</td><td>{r.events}</td><td>{r.cities}</td><td>{r.greeneries}</td><td>{r.special}</td>
              <td>{dash(r.temp)}</td><td>{dash(r.oxy)}</td><td>{dash(r.ocean)}</td>{venus && <td>{dash(r.venus)}</td>}{cols && <td>{dash(r.colonies)}</td>}<td>{r.mc}</td><td>{r.ms}</td><td>{r.aw}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Analytics({ s }: { s: GameState }) {
  const [metric, setMetric] = useState<Metric>('vp');
  const [axis, setAxis] = useState<Axis>('turn');
  const has = (s.history?.length ?? 0) >= 2;
  return (
    <section className="analytics" aria-label="Game analytics">
      <h3>How the game went</h3>
      {has ? (
        <>
          <Highlights s={s} />
          <div className="chart-filters" role="toolbar" aria-label="Chart options">
            <div className="seg" role="group" aria-label="Measure">
              {(['vp', 'tr', 'income'] as Metric[]).map((m) => <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}>{m === 'vp' ? 'VP' : m === 'tr' ? 'TR' : 'Income'}</button>)}
            </div>
            <div className="seg" role="group" aria-label="Steps">
              <button type="button" aria-pressed={axis === 'turn'} onClick={() => setAxis('turn')}>By turn</button>
              <button type="button" aria-pressed={axis === 'gen'} onClick={() => setAxis('gen')}>By generation</button>
            </div>
          </div>
          <div className="chart-card">
            <div className="chart-title">{METRIC_LABEL[metric]}, {axis === 'turn' ? 'turn by turn' : 'by generation'}</div>
            <Legend s={s} />
            <LineChart s={s} metric={metric} axis={axis} />
          </div>
        </>
      ) : <p className="muted">This game was saved before turn-by-turn history was recorded, so there is no progression chart.</p>}
      <div className="chart-card">
        <div className="chart-title">Where the points came from</div>
        <Legend s={s} bars />
        <Sources s={s} />
      </div>
      <StatsTable s={s} />
    </section>
  );
}
