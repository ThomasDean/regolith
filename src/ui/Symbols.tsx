// Renders card symbol rows (see cardFx.ts) with Terraforming-Mars-style iconography:
// a brown production box, M€ coins with the amount inside, red frames for "any player",
// a red arrow for actions and a colon for ongoing effects.
import type { CardRes, Res, TileKind } from '../engine/types';
import type { Amt, Line, Row, Sym } from './cardFx';
import { cardRows } from './cardFx';
import { ResIcon, TagIcon, TrIcon } from './Icons';

const RES_NAME: Record<Res, string> = { mc: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plants', energy: 'energy', heat: 'heat' };
const fmt = (n: Amt) => (n === 'X' ? 'X' : n < 0 ? `−${-n}` : String(n));
const plural = (n: Amt, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 || n === -1 ? one : many}`;

// ---------- glyphs (16×16) ----------
function G({ size, children, label }: { size: number; children: React.ReactNode; label?: string }) {
  return <svg viewBox="0 0 16 16" width={size} height={size} className="fx-glyph" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>{children}</svg>;
}

export function TempGlyph({ size = 18 }: { size?: number }) {
  return (
    <G size={size}>
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#f3d9c8" stroke="#6a2a10" strokeWidth="1" />
      <rect x="6.6" y="2.6" width="2.8" height="8" rx="1.4" fill="#fff" stroke="#6a2a10" strokeWidth="0.8" />
      <circle cx="8" cy="11.4" r="2.6" fill="#c4472f" stroke="#6a2a10" strokeWidth="0.8" />
      <rect x="7.3" y="6" width="1.4" height="5" fill="#c4472f" />
    </G>
  );
}

export function OxyGlyph({ size = 18 }: { size?: number }) {
  return (
    <G size={size}>
      <circle cx="8" cy="8" r="7" fill="#d6eef2" stroke="#2d5a63" strokeWidth="1" />
      <circle cx="6.6" cy="7.6" r="3" fill="none" stroke="#2d5a63" strokeWidth="1.5" />
      <text x="12" y="12.4" textAnchor="middle" fontSize="5.4" fontWeight="700" fill="#2d5a63">2</text>
    </G>
  );
}

const hex = (r: number) => Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return `${(8 + r * Math.cos(a)).toFixed(2)},${(8 + r * Math.sin(a)).toFixed(2)}`;
}).join(' ');

export function OceanGlyph({ size = 18 }: { size?: number }) {
  return (
    <G size={size}>
      <polygon points={hex(7.6)} fill="#2f6fae" stroke="#123a66" strokeWidth="1" />
      <path d="M3.6 7.4q1.1-1.2 2.2 0t2.2 0 2.2 0 2.2 0M3.6 10.2q1.1-1.2 2.2 0t2.2 0 2.2 0 2.2 0" fill="none" stroke="#d6ecfa" strokeWidth="1.1" strokeLinecap="round" />
    </G>
  );
}

export function TileGlyph({ tile, size = 18 }: { tile: TileKind; size?: number }) {
  if (tile === 'ocean') return <OceanGlyph size={size} />;
  if (tile === 'greenery') {
    return (
      <G size={size}>
        <polygon points={hex(7.6)} fill="#5f9e45" stroke="#24451c" strokeWidth="1" />
        <path d="M4.6 11.6C4.6 7 7.6 4.4 11.6 4.4c0 4-2.6 7.2-7 7.2Zm0 0 4-4" fill="#d6efb8" stroke="#24451c" strokeWidth="0.7" />
      </G>
    );
  }
  if (tile === 'city') {
    return (
      <G size={size}>
        <polygon points={hex(7.6)} fill="#9aa3b2" stroke="#2d3245" strokeWidth="1" />
        <path d="M4 12V8h2V6h2v6-4h2V4.6h2V12Z" fill="#2d3245" />
      </G>
    );
  }
  return (
    <G size={size}>
      <polygon points={hex(7.6)} fill="#b58a5a" stroke="#4a2f17" strokeWidth="1" />
      <path d="M8 3.6l1.3 2.8h3l-2.4 1.8.9 3-2.8-1.8-2.8 1.8.9-3-2.4-1.8h3Z" fill="#f6efe1" />
    </G>
  );
}

export function VenusGlyph({ size = 18 }: { size?: number }) {
  return (
    <G size={size}>
      <circle cx="8" cy="8" r="7" fill="#e6c76a" stroke="#6a5212" strokeWidth="1" />
      <path d="M2.4 6.6c2.2-1.6 5.6-1.6 8.2.2 1.4 1 2.6 1 3.4.4M2 9.6c2.6-1.2 5.2-.6 7.6.8 1.6.9 3.2.8 4.4.2" fill="none" stroke="#8a6a1a" strokeWidth="1" strokeLinecap="round" />
    </G>
  );
}

export function CardGlyph({ size = 18, cross }: { size?: number; cross?: boolean }) {
  return (
    <G size={size}>
      <rect x="3" y="1" width="10" height="14" rx="1.6" fill="#f3ecdd" stroke="#4b4f66" strokeWidth="1" />
      <rect x="4.6" y="2.6" width="6.8" height="4.6" fill="#c4472f" />
      <path d="M5 9.4h6M5 11.4h4" stroke="#4b4f66" strokeWidth="0.9" />
      {cross && <path d="M2 14 14 2" stroke="#a3341f" strokeWidth="1.8" strokeLinecap="round" />}
    </G>
  );
}

function ColonyGlyph({ size = 18 }: { size?: number }) {
  return (
    <G size={size}>
      <circle cx="8" cy="8" r="7" fill="#f6efe1" stroke="#3b3f58" strokeWidth="1" />
      <path d="M4 11V8.6l4-3.2 4 3.2V11Z" fill="#3b3f58" />
      <circle cx="8" cy="8" r="7" fill="none" stroke="#3b3f58" strokeWidth="0.6" strokeDasharray="1.4 1.2" transform="scale(0.78) translate(2.25 2.25)" />
    </G>
  );
}

function FleetGlyph({ size = 18 }: { size?: number }) {
  return (
    <G size={size}>
      <circle cx="8" cy="8" r="7" fill="#d9dce6" stroke="#3b3f58" strokeWidth="1" />
      <path d="M3.4 10.6 13 7.4 3.4 4.4l2 3Z" fill="#3b3f58" />
    </G>
  );
}

function TradeGlyph({ size = 18 }: { size?: number }) {
  return (
    <G size={size}>
      <circle cx="8" cy="8" r="7" fill="#d9dce6" stroke="#3b3f58" strokeWidth="1" />
      <path d="M4 6h7.4m-2-2 2 2-2 2M12 10H4.6m2-2-2 2 2 2" fill="none" stroke="#3b3f58" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </G>
  );
}

function DelegateGlyph({ size = 18 }: { size?: number }) {
  return (
    <G size={size}>
      <circle cx="8" cy="4.4" r="2.6" fill="#e9e2cf" stroke="#3b3f58" strokeWidth="1" />
      <path d="M3.4 14.6c0-4 2-6.6 4.6-6.6s4.6 2.6 4.6 6.6Z" fill="#e9e2cf" stroke="#3b3f58" strokeWidth="1" />
    </G>
  );
}

const CARDRES_STYLE: Record<CardRes, { bg: string; ink: string; glyph: React.ReactNode }> = {
  microbe: { bg: '#b9d97a', ink: '#2f4a12', glyph: <><path d="M8 3.6c2.6 0 4.4 1.8 4.4 4.2S10.6 12.4 8 12.4 3.6 10.4 3.6 8 5.4 3.6 8 3.6Z" fill="currentColor" /><circle cx="6.8" cy="7.4" r="1" fill="#b9d97a" /><circle cx="9.4" cy="9.2" r="0.8" fill="#b9d97a" /></> },
  animal: { bg: '#8fbf6a', ink: '#1f3a12', glyph: <><ellipse cx="8" cy="10" rx="2.8" ry="2.3" fill="currentColor" /><circle cx="4.4" cy="7" r="1.2" fill="currentColor" /><circle cx="6.6" cy="4.8" r="1.2" fill="currentColor" /><circle cx="9.4" cy="4.8" r="1.2" fill="currentColor" /><circle cx="11.6" cy="7" r="1.2" fill="currentColor" /></> },
  science: { bg: '#ece6d4', ink: '#3b3f58', glyph: <g fill="none" stroke="currentColor" strokeWidth="1"><ellipse cx="8" cy="8" rx="5" ry="2" /><ellipse cx="8" cy="8" rx="5" ry="2" transform="rotate(60 8 8)" /><ellipse cx="8" cy="8" rx="5" ry="2" transform="rotate(-60 8 8)" /></g> },
  floater: { bg: '#e8dca8', ink: '#6a5212', glyph: <path d="M4 11.4a2.4 2.4 0 0 1 .4-4.8 3.6 3.6 0 0 1 7 .6 2.1 2.1 0 0 1 .4 4.2Z" fill="currentColor" /> },
  fighter: { bg: '#cfd4e2', ink: '#2d3245', glyph: <path d="M8 2.6 10 9.4l3 1.6v1l-3-.6-.6 1.6h-2.8L6 11.4l-3 .6v-1l3-1.6Z" fill="currentColor" /> },
  asteroid: { bg: '#cdbba4', ink: '#4a3a28', glyph: <path d="M4 6.4 6.6 3.8l4 .6 2 3-1 4-3.4 1.4-3.6-1.6Z" fill="currentColor" /> },
  camp: { bg: '#e4c99a', ink: '#5a3a14', glyph: <path d="M2.8 12.4 8 3.6l5.2 8.8ZM8 12.4l-1.6-3.4h3.2Z" fill="currentColor" fillRule="evenodd" /> },
  preservation: { bg: '#bfe0c6', ink: '#1f4a2a', glyph: <path d="M8 2.6 12.6 4.4v3.4c0 2.8-2 4.6-4.6 5.6-2.6-1-4.6-2.8-4.6-5.6V4.4Z" fill="currentColor" /> },
};

export function CardResGlyph({ rtype, size = 18 }: { rtype: CardRes | null; size?: number }) {
  if (!rtype) return <G size={size}><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="#e9e2cf" stroke="#3b3f58" strokeWidth="1" /><text x="8" y="11.4" textAnchor="middle" fontSize="9" fontWeight="700" fill="#3b3f58">?</text></G>;
  const st = CARDRES_STYLE[rtype];
  return (
    <G size={size}>
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill={st.bg} stroke={st.ink} strokeWidth="1" />
      <g color={st.ink}>{st.glyph}</g>
    </G>
  );
}

/** An M€ coin with the amount printed inside, as on the printed cards. */
export function Coin({ n, size = 20 }: { n: Amt | string; size?: number }) {
  const t = typeof n === 'string' ? n : fmt(n);
  const fs = t.length > 2 ? 6.2 : 7.6;
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className="fx-glyph" aria-hidden="true">
      <rect x="1" y="1" width="14" height="14" rx="3.4" fill="#e3b341" stroke="#7a5a10" strokeWidth="1" />
      <text x="8" y={8 + fs * 0.36} textAnchor="middle" fontSize={fs} fontWeight="800" fill="#3a2a06" fontFamily="system-ui, sans-serif">{t}</text>
    </svg>
  );
}

// ---------- one symbol ----------
function Amount({ n, children, title }: { n: Amt; children: React.ReactNode; title: string }) {
  const show = n !== 1;
  return <span className="fx-amt" title={title}>{show && <span className="fx-n">{n === -1 ? '−' : fmt(n)}</span>}{children}</span>;
}

function SymView({ x, size }: { x: Sym; size: number }) {
  switch (x.s) {
    case 'res': {
      const inner = x.r === 'mc'
        ? <span className="fx-amt" title={`${fmt(x.n)} M€`}><Coin n={x.n} size={size + 2} /></span>
        : <Amount n={x.n} title={`${fmt(x.n)} ${RES_NAME[x.r]}`}><ResIcon r={x.r} size={size} /></Amount>;
      return x.any ? <span className="fx-any" title="Any player">{inner}</span> : inner;
    }
    case 'prod':
      return <span className="fx-prod" title="Production">{x.parts.map((p, i) => <SymView key={i} x={p} size={size} />)}</span>;
    case 'tr': return <Amount n={x.n} title={plural(x.n, 'TR')}><TrIcon size={size} /></Amount>;
    case 'temp': return <Amount n={x.n} title={`Temperature ${plural(x.n, 'step')}`}><TempGlyph size={size} /></Amount>;
    case 'oxy': return <Amount n={x.n} title={`Oxygen ${plural(x.n, 'step')}`}><OxyGlyph size={size} /></Amount>;
    case 'venus': return <Amount n={x.n} title={`Venus ${plural(x.n, 'step')}`}><VenusGlyph size={size} /></Amount>;
    case 'ocean': return <Amount n={x.n} title={plural(x.n, 'ocean')}><OceanGlyph size={size} /></Amount>;
    case 'tile': return <Amount n={x.n} title={plural(x.n, x.tile === 'special' ? 'special tile' : `${x.tile} tile`)}><TileGlyph tile={x.tile} size={size} /></Amount>;
    case 'draw': return <Amount n={x.n} title={`Draw ${plural(x.n, 'card')}`}><CardGlyph size={size} /></Amount>;
    case 'discard': return <Amount n={x.n} title={`Discard ${plural(x.n, 'card')}`}><CardGlyph size={size} cross /></Amount>;
    case 'look': return <span className="fx-amt" title={`Look at ${x.n}, keep ${x.keep}`}><span className="fx-n">{fmt(x.n)}</span><CardGlyph size={size} /><span className="fx-small">keep {x.keep}</span></span>;
    case 'colony': return <Amount n={x.n} title="Colony"><ColonyGlyph size={size} /></Amount>;
    case 'fleet': return <Amount n={x.n} title="Trade fleet"><FleetGlyph size={size} /></Amount>;
    case 'trade': return <Amount n={x.n} title="Trade"><TradeGlyph size={size} /></Amount>;
    case 'delegate': return <Amount n={x.n} title={plural(x.n, 'delegate')}><DelegateGlyph size={size} /></Amount>;
    case 'cardres': {
      const name = x.rtype ?? 'resource';
      const inner = (
        <Amount n={x.n} title={`${plural(x.n, name)}${x.target === 'other' ? ' on another card' : ' on this card'}`}>
          <CardResGlyph rtype={x.rtype} size={size} />{x.target === 'other' && <span className="fx-star">*</span>}
        </Amount>
      );
      return x.any ? <span className="fx-any" title="Any player">{inner}</span> : inner;
    }
    case 'tag': return x.tag === 'any' ? <span className="fx-amt" title="Any card"><CardGlyph size={size} /></span> : <TagIcon tag={x.tag} size={size} />;
    case 'big': return <span className="fx-amt" title="A card costing 20 M€ or more"><Coin n="20+" size={size + 2} /></span>;
    case 'req': return <span className="fx-amt fx-req" title={`Global requirements ±${x.n} steps`}><span className="fx-n">±{x.n}</span><TempGlyph size={size - 4} /><OxyGlyph size={size - 4} /><OceanGlyph size={size - 4} /></span>;
    case 'paywith': return <span className="fx-amt" title={`Each ${x.rtype} pays ${x.value} M€`}><CardResGlyph rtype={x.rtype} size={size} /><span className="fx-n">=</span><Coin n={x.value} size={size + 2} /></span>;
    case 'choose': return <>{x.options.map((o, i) => <span key={i} className="fx-opt">{i > 0 && <span className="fx-or">or</span>}<LineView l={o} size={size} /></span>)}</>;
    case 'anyone': return null;
  }
}

function Syms({ list, size }: { list: Sym[]; size: number }) {
  // "anyone" frames the trigger that follows it
  if (list[0]?.s === 'anyone') {
    return <span className="fx-any" title="When any player does this">{list.slice(1).map((x, i) => <SymView key={i} x={x} size={size} />)}</span>;
  }
  return <>{list.map((x, i) => <SymView key={i} x={x} size={size} />)}</>;
}

export function LineView({ l, size = 18, colon }: { l: Line; size?: number; colon?: boolean }) {
  return (
    <>
      {l.left.length > 0 && <Syms list={l.left} size={size} />}
      {l.left.length > 0 && !colon && <span className="fx-arrow" aria-label="gives">➜</span>}
      {colon && <span className="fx-colon">:</span>}
      <Syms list={l.right} size={size} />
    </>
  );
}

const LABEL = { play: null, first: 'First action', action: 'Action', effect: 'Effect' } as const;

function RowView({ r, size }: { r: Row; size: number }) {
  const label = LABEL[r.kind];
  const body = (
    <span className="fx-line">
      {r.kind === 'action' && !r.left.length && r.right[0]?.s !== 'choose' && <span className="fx-arrow" aria-hidden="true">➜</span>}
      <LineView l={r} size={size} colon={r.kind === 'effect' && r.left.length > 0} />
    </span>
  );
  if (!label) return <div className="fx-row">{body}</div>;
  return <div className={`fx-row fx-boxed fx-${r.kind}`}><span className="fx-label">{label}</span>{body}</div>;
}

/** All of a card's symbols, or nothing if it has none. */
export function CardFx({ id, size = 18 }: { id: string; size?: number }) {
  const rows = cardRows(id);
  if (!rows.length) return null;
  return <div className="card-fx">{rows.map((r, i) => <RowView key={i} r={r} size={size} />)}</div>;
}

/** A single line of symbols (action bar). */
export function FxLine({ l, size = 16 }: { l: Line; size?: number }) {
  return <span className="fx-line fx-inline"><LineView l={l} size={size} /></span>;
}

// ---------- requirements ----------
const deg = (t: number) => `${t > 0 ? '+' : t < 0 ? '−' : ''}${Math.abs(t)}°`;

/** Requirement as icons ("max 9% O₂", three science tags…). */
export function ReqFx({ req, size = 15 }: { req: import('../engine/cards').Req; size?: number }) {
  const items: React.ReactNode[] = [];
  const v = (max: boolean, t: string, icon: React.ReactNode, key: string) =>
    items.push(<span key={key} className="fx-amt">{max && <span className="fx-small">max</span>}<span className="fx-n">{t}</span>{icon}</span>);
  if (req.temp !== undefined) v(false, deg(req.temp), <TempGlyph size={size} />, 't');
  if (req.tempMax !== undefined) v(true, deg(req.tempMax), <TempGlyph size={size} />, 'T');
  if (req.oxy !== undefined) v(false, `${req.oxy}%`, <OxyGlyph size={size} />, 'o');
  if (req.oxyMax !== undefined) v(true, `${req.oxyMax}%`, <OxyGlyph size={size} />, 'O');
  if (req.oceans !== undefined) v(false, String(req.oceans), <OceanGlyph size={size} />, 'w');
  if (req.oceansMax !== undefined) v(true, String(req.oceansMax), <OceanGlyph size={size} />, 'W');
  if (req.venus !== undefined) v(false, `${req.venus}%`, <VenusGlyph size={size} />, 'v');
  if (req.venusMax !== undefined) v(true, `${req.venusMax}%`, <VenusGlyph size={size} />, 'V');
  for (const [tag, n] of Object.entries(req.tags ?? {})) {
    items.push(<span key={`tag-${tag}`} className="fx-amt">{(n ?? 1) > 3 ? <><span className="fx-n">{n}</span><TagIcon tag={tag as never} size={size} /></> : Array.from({ length: n ?? 1 }, (_, i) => <TagIcon key={i} tag={tag as never} size={size} />)}</span>);
  }
  if (req.greeneries !== undefined) v(false, String(req.greeneries), <TileGlyph tile="greenery" size={size} />, 'g');
  if (req.cities !== undefined) v(false, String(req.cities), <TileGlyph tile="city" size={size} />, 'c');
  if (req.citiesAll !== undefined) v(false, String(req.citiesAll), <span className="fx-any"><TileGlyph tile="city" size={size} /></span>, 'C');
  if (req.tr !== undefined) v(false, String(req.tr), <TrIcon size={size} />, 'r');
  if (req.colonies !== undefined) v(false, String(req.colonies), <ColonyGlyph size={size} />, 'k');
  return <span className="fx-reqline">{items}</span>;
}
