// Original card illustrations, generated from each card's id, tags and name. Every card gets a
// scene (an impact, a reactor, a kelp bed…) picked from its subject, and a seeded variation of
// palette, horizon, layout and props, so no two cards look alike. Style: limited-palette
// screen-print poster with a halftone wash. No publisher artwork is used or imitated.
import { memo, useId } from 'react';
import type { CardDef } from '../engine/cards';

export const ART_W = 160;
export const ART_H = 84;
const HZ = 58; // default horizon line

// ---------- seeded randomness ----------
export function hashStr(t: string): number {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface G {
  r: () => number;
  /** float in [a, b) */
  f: (a: number, b: number) => number;
  /** integer in [a, b] */
  i: (a: number, b: number) => number;
  pick: <T>(xs: T[]) => T;
  u: string;
  c: CardDef;
  words: string;
}

// ---------- palettes ----------
interface Sky { top: string; bot: string; sun: string; dark: boolean }
const SKY = {
  dusk: { top: '#2a1f48', bot: '#e0915c', sun: '#ffd9a0', dark: true },
  dawn: { top: '#f3c99a', bot: '#d8744a', sun: '#fff1cf', dark: false },
  night: { top: '#0b1230', bot: '#3b3570', sun: '#d9dcff', dark: true },
  dust: { top: '#c98a5a', bot: '#e9be8c', sun: '#fff4dc', dark: false },
  blue: { top: '#4f86c0', bot: '#cfe1ea', sun: '#fffbe8', dark: false },
  teal: { top: '#123a4a', bot: '#4fa3a0', sun: '#e8fff6', dark: true },
  ember: { top: '#3a0f12', bot: '#e2603a', sun: '#ffcf7a', dark: true },
} satisfies Record<string, Sky>;
const GROUND = {
  rust: ['#8c3a24', '#6b2a1b', '#4a1c14'],
  sand: ['#b0683c', '#8a4c2c', '#5e3220'],
  green: ['#5f9d50', '#3f7a3a', '#2a5428'],
  moss: ['#7a9a4a', '#56763a', '#36502a'],
  grey: ['#6a6f80', '#4a4e60', '#30333f'],
  ice: ['#cfe3ee', '#9cc0d6', '#6c93b0'],
};

// ---------- geometry helpers ----------
function ridge(g: G, y: number, amp: number, seg = 7, bottom = ART_H): string {
  const pts: [number, number][] = [];
  for (let k = 0; k <= seg; k++) pts.push([(k / seg) * ART_W, y + g.f(-amp, amp)]);
  let d = `M0,${bottom} L0,${pts[0][1].toFixed(1)}`;
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, y0] = pts[k];
    const [x1, y1] = pts[k + 1];
    d += ` Q${x0 + (x1 - x0) / 2},${(Math.min(y0, y1) - amp * 0.4).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return `${d} L${ART_W},${bottom} Z`;
}
function blob(cx: number, cy: number, r: number, g: G, n = 9): string {
  const pts = Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2;
    const rr = r * g.f(0.72, 1.12);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
  return `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' L')} Z`;
}

// ---------- shared layers ----------
function Backdrop({ g, sky, sun = true, stars }: { g: G; sky: Sky; sun?: boolean; stars?: boolean }) {
  const sx = g.f(18, 142);
  const sy = g.f(10, 34);
  const sr = g.f(5, 11);
  const showStars = stars ?? sky.dark;
  return (
    <>
      <defs>
        <linearGradient id={`${g.u}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky.top} />
          <stop offset="1" stopColor={sky.bot} />
        </linearGradient>
        <radialGradient id={`${g.u}sun`}>
          <stop offset="0" stopColor={sky.sun} stopOpacity="0.9" />
          <stop offset="1" stopColor={sky.sun} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={ART_W} height={ART_H} fill={`url(#${g.u}sky)`} />
      {showStars && Array.from({ length: g.i(14, 26) }, (_, k) => (
        <circle key={k} cx={g.f(0, ART_W)} cy={g.f(0, HZ - 8)} r={g.f(0.3, 0.95)} fill="#fff" opacity={g.f(0.35, 0.95)} />
      ))}
      {sun && (
        <g>
          <circle cx={sx} cy={sy} r={sr * 3.2} fill={`url(#${g.u}sun)`} />
          <circle cx={sx} cy={sy} r={sr} fill={sky.sun} />
        </g>
      )}
    </>
  );
}
function Ground({ g, tones, y = HZ, amp = 4 }: { g: G; tones: string[]; y?: number; amp?: number }) {
  return (
    <>
      <path d={ridge(g, y - 6, amp * 1.6, 5)} fill={tones[1]} opacity="0.75" />
      <path d={ridge(g, y, amp, 8)} fill={tones[0]} />
      <path d={ridge(g, y + 14, amp * 0.6, 6)} fill={tones[2]} opacity="0.85" />
    </>
  );
}
function Finish({ g }: { g: G }) {
  return (
    <>
      <defs>
        <pattern id={`${g.u}ht`} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
          <circle cx="1.5" cy="1.5" r="0.62" fill="#000" />
        </pattern>
        <radialGradient id={`${g.u}vig`} cx="50%" cy="45%" r="75%">
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </radialGradient>
      </defs>
      <rect width={ART_W} height={ART_H} fill={`url(#${g.u}ht)`} opacity="0.13" />
      <rect width={ART_W} height={ART_H} fill={`url(#${g.u}vig)`} />
    </>
  );
}

// ---------- scenes ----------
type Scene = (g: G) => React.ReactNode;

const impact: Scene = (g) => {
  const icy = /ice|comet|ammonia|nitrogen|hydrogen|europa/.test(g.words);
  const big = /big|giant|deimos/.test(g.words);
  const x = g.f(70, 120), y = g.f(18, 34), r = big ? g.f(9, 12) : g.f(5, 8);
  const ang = g.f(-30, -12);
  const rock = icy ? '#e3f2fa' : '#7a5a48';
  const tail = icy ? '#9fe2ff' : '#ffb35c';
  return (
    <>
      <Backdrop g={g} sky={g.pick([SKY.night, SKY.dusk, SKY.ember])} sun={false} stars />
      <defs>
        <linearGradient id={`${g.u}tail`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor={tail} stopOpacity="0" />
          <stop offset="1" stopColor={tail} stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <g transform={`rotate(${ang} ${x} ${y})`}>
        <path d={`M${x},${y - r * 0.9} L${x - 95},${y - r * 0.15} L${x - 95},${y + r * 0.15} L${x},${y + r * 0.9}Z`} fill={`url(#${g.u}tail)`} transform={`scale(-1 1) translate(${-2 * x} 0)`} />
      </g>
      <path d={blob(x, y, r, g)} fill={rock} stroke="#2a1a14" strokeWidth="0.8" />
      <circle cx={x - r * 0.3} cy={y - r * 0.3} r={r * 0.25} fill="#000" opacity="0.18" />
      {Array.from({ length: g.i(2, 5) }, (_, k) => {
        const dx = g.f(-30, 30), dy = g.f(-10, 14);
        return <path key={k} d={blob(x + dx + 18, y + dy, g.f(1, 2.4), g)} fill={rock} opacity="0.85" />;
      })}
      <Ground g={g} tones={GROUND.rust} />
      <ellipse cx={g.f(30, 130)} cy={HZ + 12} rx={g.f(14, 24)} ry={3.6} fill="#000" opacity="0.28" />
      <ellipse cx={g.f(20, 140)} cy={HZ + 20} rx={g.f(6, 12)} ry={2} fill="#000" opacity="0.22" />
    </>
  );
};

const ice: Scene = (g) => {
  const dam = /dam/.test(g.words);
  const wave = /wave/.test(g.words);
  const sky = g.pick([SKY.blue, SKY.dawn, SKY.dusk]);
  const wy = HZ - 2;
  return (
    <>
      <Backdrop g={g} sky={sky} />
      <path d={ridge(g, HZ - 10, 6, 5)} fill="#8a4c2c" opacity="0.8" />
      <defs>
        <linearGradient id={`${g.u}sea`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b9fd4" />
          <stop offset="1" stopColor="#1d3f72" />
        </linearGradient>
      </defs>
      <rect x="0" y={wy} width={ART_W} height={ART_H - wy} fill={`url(#${g.u}sea)`} />
      <rect x={g.f(40, 110)} y={wy} width="5" height={ART_H - wy} fill="#fff" opacity="0.25" />
      {(wave ? [0, 1, 2, 3] : [0, 1]).map((k) => (
        <path key={k} d={`M0,${wy + 6 + k * 6} q 10,-${wave ? 4 : 2} 20,0 t 20,0 t 20,0 t 20,0 t 20,0 t 20,0 t 20,0 t 20,0`} fill="none" stroke="#cfe8f8" strokeWidth={wave ? 1.4 : 0.9} opacity="0.7" />
      ))}
      {!dam && Array.from({ length: g.i(2, 5) }, (_, k) => {
        const x = g.f(8, 150), y = g.f(wy + 3, ART_H - 6), w = g.f(8, 20);
        return <path key={k} d={`M${x},${y} l${w * 0.3},-2.5 l${w * 0.5},0.5 l${w * 0.2},2 l-${w * 0.4},1.6Z`} fill="#eef7fb" stroke="#9cc0d6" strokeWidth="0.5" />;
      })}
      {dam && (
        <g>
          <path d={`M30,${wy - 14} Q80,${wy - 4} 130,${wy - 14} L130,${ART_H} L30,${ART_H}Z`} fill="#9aa0ae" stroke="#4a4e60" strokeWidth="1" />
          {[0, 1, 2, 3].map((k) => <rect key={k} x={48 + k * 18} y={wy - 6} width="7" height="22" fill="#cfe8f8" opacity="0.85" />)}
        </g>
      )}
      {/permafrost|polar|cap/.test(g.words) && <path d={ridge(g, HZ - 6, 3, 6, HZ + 2)} fill="#eef5fa" opacity="0.9" />}
    </>
  );
};

function tree(g: G, x: number, y: number, s: number, k: number) {
  const kind = g.i(0, 2);
  const leaf = g.pick(['#3f7a3a', '#5f9d50', '#2f6a3c', '#7aa64a']);
  if (kind === 0) {
    return (
      <g key={k}>
        <rect x={x - 0.8} y={y - 3 * s} width="1.6" height={3 * s} fill="#4a2e1c" />
        <path d={`M${x},${y - 14 * s} l${5 * s},${8 * s} h-${2.2 * s} l${3.4 * s},${5 * s} h-${12.4 * s} l${3.4 * s},-${5 * s} h-${2.2 * s}Z`} fill={leaf} />
      </g>
    );
  }
  return (
    <g key={k}>
      <rect x={x - 0.9} y={y - 5 * s} width="1.8" height={5 * s} fill="#4a2e1c" />
      <circle cx={x} cy={y - 8 * s} r={4.6 * s} fill={leaf} />
      <circle cx={x - 1.6 * s} cy={y - 9.4 * s} r={1.6 * s} fill="#fff" opacity="0.14" />
    </g>
  );
}

const flora: Scene = (g) => {
  const under = /kelp|algae/.test(g.words);
  const glass = /greenhouse|farm|plantation|food/.test(g.words);
  const low = /moss|lichen|grass|heather|tundra|bush|fungus/.test(g.words);
  if (under) {
    return (
      <>
        <defs>
          <linearGradient id={`${g.u}deep`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2c7fa8" />
            <stop offset="1" stopColor="#0d2a44" />
          </linearGradient>
        </defs>
        <rect width={ART_W} height={ART_H} fill={`url(#${g.u}deep)`} />
        {Array.from({ length: 5 }, (_, k) => (
          <path key={`ray${k}`} d={`M${20 + k * 30},0 l${12},0 l${-22},${ART_H} l-8,0Z`} fill="#bfe9ff" opacity="0.07" />
        ))}
        {Array.from({ length: g.i(6, 10) }, (_, k) => {
          const x = g.f(4, 156), h = g.f(30, 70);
          const col = g.pick(['#5f9d50', '#7aa64a', '#3f7a3a', '#9cc35a']);
          return <path key={k} d={`M${x},${ART_H} q ${g.f(-8, 8)},-${h / 3} 0,-${h / 2} t 0,-${h / 2}`} fill="none" stroke={col} strokeWidth={g.f(1.6, 3)} strokeLinecap="round" />;
        })}
        {Array.from({ length: 8 }, (_, k) => <circle key={`b${k}`} cx={g.f(0, 160)} cy={g.f(0, 70)} r={g.f(0.6, 1.6)} fill="none" stroke="#dff4ff" strokeWidth="0.5" opacity="0.7" />)}
        <path d={ridge(g, ART_H - 6, 3, 6)} fill="#3a2a22" />
      </>
    );
  }
  const sky = g.pick([SKY.blue, SKY.dawn, SKY.dust, SKY.dusk]);
  return (
    <>
      <Backdrop g={g} sky={sky} />
      <path d={ridge(g, HZ - 8, 7, 5)} fill="#8a4c2c" opacity="0.7" />
      <Ground g={g} tones={g.pick([GROUND.green, GROUND.moss])} />
      {glass && (
        <g>
          {[0, 1, 2].map((k) => {
            const x = 22 + k * 42 + g.f(-4, 4);
            return (
              <g key={k}>
                <path d={`M${x - 16},${HZ + 4} a16,13 0 0 1 32,0Z`} fill="#bfe9ff" opacity="0.45" stroke="#e8f8ff" strokeWidth="0.8" />
                {[-8, 0, 8].map((dx) => <line key={dx} x1={x + dx} y1={HZ + 4} x2={x + dx * 0.6} y2={HZ - 8} stroke="#e8f8ff" strokeWidth="0.5" opacity="0.8" />)}
                <path d={`M${x - 11},${HZ + 3} q4,-6 7,0 q4,-7 8,0 q3,-5 7,0`} fill="#5f9d50" />
              </g>
            );
          })}
          {[0, 1, 2, 3, 4].map((k) => <line key={k} x1={80} y1={HZ + 8} x2={k * 40} y2={ART_H} stroke="#2a5428" strokeWidth="1.2" />)}
        </g>
      )}
      {!glass && !low && Array.from({ length: g.i(4, 9) }, (_, k) => tree(g, g.f(6, 154), g.f(HZ + 4, ART_H - 2), g.f(0.7, 1.25), k))}
      {low && Array.from({ length: g.i(14, 26) }, (_, k) => {
        const x = g.f(0, 160), y = g.f(HZ - 2, ART_H), s = g.f(1.5, 4);
        return <circle key={k} cx={x} cy={y} r={s} fill={g.pick(['#7aa64a', '#9cc35a', '#c1d36a', '#a65f8a', '#5f9d50'])} opacity="0.92" />;
      })}
    </>
  );
};

function beast(g: G, x: number, y: number, s: number, k: number, col: string) {
  const neck = g.f(0.6, 1.4);
  return (
    <g key={k} fill={col}>
      <ellipse cx={x} cy={y - 6 * s} rx={7 * s} ry={3.6 * s} />
      <path d={`M${x + 5 * s},${y - 7 * s} l${3 * s},-${5 * s * neck} l${3 * s},0.5 l-${1.6 * s},${3 * s} Z`} />
      <circle cx={x + 8.6 * s} cy={y - 7.6 * s - 5 * s * neck + 2.4 * s} r={2 * s} />
      {[-5, -2, 2, 5].map((dx) => <rect key={dx} x={x + dx * s - 0.6 * s} y={y - 4 * s} width={1.3 * s} height={4.2 * s} />)}
      <path d={`M${x - 7 * s},${y - 7 * s} q-3,1 -3,4`} fill="none" stroke={col} strokeWidth={s} />
    </g>
  );
}

const fauna: Scene = (g) => {
  const birds = /bird/.test(g.words);
  const fish = /fish/.test(g.words);
  if (fish) {
    return (
      <>
        <defs>
          <linearGradient id={`${g.u}deep`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4aa0c8" />
            <stop offset="1" stopColor="#0f2c4a" />
          </linearGradient>
        </defs>
        <rect width={ART_W} height={ART_H} fill={`url(#${g.u}deep)`} />
        {Array.from({ length: g.i(5, 9) }, (_, k) => {
          const x = g.f(10, 150), y = g.f(12, 70), s = g.f(0.7, 1.4), dir = g.r() > 0.5 ? 1 : -1;
          const col = g.pick(['#f2a04a', '#e8d27a', '#cfe8f8', '#e46a5a']);
          return (
            <g key={k} transform={`translate(${x} ${y}) scale(${dir * s} ${s})`}>
              <path d="M-7,0 q7,-6 14,0 q-7,6 -14,0Z M-7,0 l-5,-4 v8Z" fill={col} />
              <circle cx="4" cy="-0.8" r="0.8" fill="#14202e" />
            </g>
          );
        })}
        {Array.from({ length: 5 }, (_, k) => <path key={`k${k}`} d={`M${g.f(0, 160)},${ART_H} q4,-10 0,-20 t0,-16`} fill="none" stroke="#3f7a3a" strokeWidth="2" />)}
      </>
    );
  }
  const sky = g.pick([SKY.blue, SKY.dawn, SKY.dust]);
  const col = g.pick(['#3a2418', '#2a2a3a', '#4a2e1c']);
  return (
    <>
      <Backdrop g={g} sky={sky} />
      <path d={ridge(g, HZ - 9, 6, 5)} fill="#8a4c2c" opacity="0.65" />
      <Ground g={g} tones={g.pick([GROUND.green, GROUND.moss])} />
      {Array.from({ length: g.i(2, 4) }, (_, k) => tree(g, g.f(6, 154), g.f(HZ + 2, HZ + 8), g.f(0.6, 0.9), 100 + k))}
      {birds
        ? Array.from({ length: g.i(6, 12) }, (_, k) => {
          const x = g.f(20, 140), y = g.f(10, 44), s = g.f(1.6, 3.4);
          return <path key={k} d={`M${x - s},${y} q${s / 2},-${s / 1.4} ${s},0 q${s / 2},-${s / 1.4} ${s},0`} fill="none" stroke="#2a1a14" strokeWidth="1.1" strokeLinecap="round" />;
        })
        : Array.from({ length: /predator/.test(g.words) ? 1 : /pet/.test(g.words) ? 2 : g.i(2, 4) }, (_, k) => beast(g, g.f(25, 135), g.f(HZ + 12, ART_H - 4), /predator/.test(g.words) ? 1.6 : g.f(0.8, 1.2), k, col))}
      {/pet/.test(g.words) && <path d={`M110,${HZ + 6} a16,13 0 0 1 32,0Z`} fill="#bfe9ff" opacity="0.5" stroke="#fff" strokeWidth="0.7" />}
    </>
  );
};

const microbe: Scene = (g) => {
  const bg = g.pick([['#0f3a3a', '#2a7a6a'], ['#2a1840', '#7a3a6a'], ['#14283a', '#3a7a8a'], ['#2a2a12', '#7a7a2a']]);
  const cellCol = g.pick([['#9cc35a', '#e6f2a8'], ['#e27aa8', '#ffd0e6'], ['#6ad0c8', '#d8fff8'], ['#f2b04a', '#fff0c0']]);
  return (
    <>
      <defs>
        <radialGradient id={`${g.u}lens`} cx="45%" cy="40%" r="65%">
          <stop offset="0" stopColor={bg[1]} />
          <stop offset="1" stopColor={bg[0]} />
        </radialGradient>
      </defs>
      <rect width={ART_W} height={ART_H} fill={bg[0]} />
      <circle cx="80" cy="42" r="56" fill={`url(#${g.u}lens)`} />
      {Array.from({ length: g.i(7, 13) }, (_, k) => {
        const x = g.f(20, 140), y = g.f(8, 76), rod = g.r() > 0.55;
        if (rod) {
          const a = g.f(0, 180), l = g.f(8, 16);
          return (
            <g key={k} transform={`rotate(${a} ${x} ${y})`}>
              <rect x={x - l / 2} y={y - 2.6} width={l} height={5.2} rx="2.6" fill={cellCol[0]} opacity="0.9" />
              <path d={`M${x + l / 2},${y} q3,-3 6,0 t6,0`} fill="none" stroke={cellCol[1]} strokeWidth="0.6" />
            </g>
          );
        }
        const r = g.f(4, 9);
        return (
          <g key={k}>
            <path d={blob(x, y, r, g, 10)} fill={cellCol[0]} opacity="0.55" stroke={cellCol[1]} strokeWidth="0.7" />
            <circle cx={x + g.f(-r / 3, r / 3)} cy={y + g.f(-r / 3, r / 3)} r={r * 0.32} fill={cellCol[1]} opacity="0.9" />
          </g>
        );
      })}
      <circle cx="80" cy="42" r="56" fill="none" stroke="#000" strokeOpacity="0.55" strokeWidth="9" />
      <path d="M44,18 a46,46 0 0 1 22,-12" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" />
    </>
  );
};

const city: Scene = (g) => {
  const under = /underground|subterr/.test(g.words);
  const sky = g.pick([SKY.dusk, SKY.night, SKY.dawn, SKY.teal]);
  const lit = sky.dark ? '#ffd27a' : '#fff4c8';
  if (under) {
    return (
      <>
        <Backdrop g={g} sky={sky} />
        <rect x="0" y="30" width={ART_W} height={ART_H - 30} fill="#5e3220" />
        <path d={ridge(g, 30, 2, 8, 34)} fill="#8a4c2c" />
        {[0, 1, 2].map((k) => {
          const x = 30 + k * 50 + g.f(-6, 6);
          return (
            <g key={k}>
              <ellipse cx={x} cy="58" rx="20" ry="14" fill="#1d1420" stroke="#8a4c2c" strokeWidth="1.5" />
              {Array.from({ length: 4 }, (_, j) => <rect key={j} x={x - 12 + j * 6} y={58 - g.f(4, 10)} width="4.2" height={g.f(6, 14)} fill="#4a4e60" />)}
              {Array.from({ length: 5 }, (_, j) => <rect key={`w${j}`} x={x - 11 + j * 5} y={56 + g.f(-3, 3)} width="1.4" height="1.4" fill={lit} />)}
            </g>
          );
        })}
        {[40, 90].map((x) => <line key={x} x1={x + 15} y1="30" x2={x + 15} y2="48" stroke="#ffd27a" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="2 2" />)}
      </>
    );
  }
  const towers = Array.from({ length: g.i(5, 9) }, () => ({ x: g.f(10, 150), w: g.f(5, 10), h: g.f(12, 34) })).sort((a, b) => b.h - a.h);
  return (
    <>
      <Backdrop g={g} sky={sky} />
      <path d={ridge(g, HZ - 10, 6, 5)} fill="#5e3220" opacity="0.7" />
      {towers.map((t, k) => (
        <g key={k}>
          <rect x={t.x} y={HZ - t.h} width={t.w} height={t.h + 4} fill={k % 2 ? '#3a3f55' : '#4a4e66'} />
          <rect x={t.x} y={HZ - t.h} width={t.w * 0.3} height={t.h + 4} fill="#fff" opacity="0.08" />
          {Array.from({ length: Math.floor(t.h / 5) }, (_, j) => (g.r() > 0.35 ? <rect key={j} x={t.x + 1.5 + (j % 2) * (t.w / 2 - 1)} y={HZ - t.h + 3 + j * 4.4} width="1.6" height="1.6" fill={lit} /> : null))}
        </g>
      ))}
      {Array.from({ length: g.i(1, 3) }, (_, k) => {
        const x = g.f(20, 140), r = g.f(14, 24);
        return (
          <g key={`d${k}`}>
            <path d={`M${x - r},${HZ + 2} a${r},${r * 0.8} 0 0 1 ${2 * r},0Z`} fill="#bfe9ff" opacity="0.32" stroke="#e8f8ff" strokeWidth="0.8" />
            <path d={`M${x - r * 0.6},${HZ - r * 0.45} a${r * 0.7},${r * 0.55} 0 0 1 ${r * 0.5},-${r * 0.25}`} fill="none" stroke="#fff" strokeOpacity="0.6" strokeWidth="1" />
          </g>
        );
      })}
      <Ground g={g} tones={GROUND.sand} y={HZ + 4} amp={2} />
      {Array.from({ length: g.i(3, 6) }, (_, k) => <circle key={`l${k}`} cx={g.f(0, 160)} cy={g.f(HZ + 8, ART_H - 4)} r="0.9" fill={lit} />)}
    </>
  );
};

const power: Scene = (g) => {
  const w = g.words;
  const sky = g.pick([SKY.dawn, SKY.dusk, SKY.dust, SKY.night]);
  if (/mirror|soletta/.test(w)) {
    return (
      <>
        <Backdrop g={g} sky={SKY.night} sun={false} stars />
        <circle cx="80" cy="150" r="96" fill="#a4482c" />
        <circle cx="80" cy="150" r="99" fill="none" stroke="#ffb08a" strokeOpacity="0.45" strokeWidth="3" />
        {Array.from({ length: 7 }, (_, k) => {
          const x = 40 + k * 13 + g.f(-2, 2), y = 20 + Math.sin(k / 1.2) * 5;
          return <polygon key={k} points={`${x},${y - 6} ${x + 5},${y - 3} ${x + 5},${y + 3} ${x},${y + 6} ${x - 5},${y + 3} ${x - 5},${y - 3}`} fill="#dfe8ff" stroke="#7a86b0" strokeWidth="0.6" />;
        })}
        <path d="M60,28 L50,62 L110,62 L100,28Z" fill="#fff4c8" opacity="0.18" />
        <circle cx="150" cy="10" r="5" fill="#fff4c8" />
      </>
    );
  }
  if (/solar|lunar|beam|thorium/.test(w) && !/wind/.test(w)) {
    return (
      <>
        <Backdrop g={g} sky={g.pick([SKY.dawn, SKY.dust, SKY.blue])} />
        <Ground g={g} tones={GROUND.rust} />
        {Array.from({ length: 3 }, (_, row) => Array.from({ length: 5 - row }, (_, k) => {
          const s = 1 - row * 0.22;
          const x = 14 + k * 32 * s + row * 14, y = HZ + 6 + (2 - row) * 8;
          return (
            <g key={`${row}-${k}`}>
              <line x1={x + 9 * s} y1={y} x2={x + 9 * s} y2={y + 6 * s} stroke="#2a2a33" strokeWidth="1" />
              <path d={`M${x},${y} l${20 * s},0 l${-4 * s},${-7 * s} l${-20 * s},0Z`} fill="#2f4f8a" stroke="#9fc0ff" strokeWidth="0.5" />
              <path d={`M${x + 4 * s},${y - 2 * s} l${10 * s},0`} stroke="#cfe0ff" strokeWidth="0.4" />
            </g>
          );
        }))}
        {/beam|lunar|thorium/.test(w) && <path d={`M150,0 L88,${HZ + 4} L96,${HZ + 4}Z`} fill="#fff1b0" opacity="0.5" />}
      </>
    );
  }
  if (/wind/.test(w)) {
    return (
      <>
        <Backdrop g={g} sky={sky} />
        <Ground g={g} tones={GROUND.sand} />
        {Array.from({ length: g.i(3, 5) }, (_, k) => {
          const x = 20 + k * 32 + g.f(-6, 6), s = g.f(0.7, 1.2), top = HZ - 30 * s, a = g.f(0, 120);
          return (
            <g key={k}>
              <path d={`M${x - 1},${HZ + 6} L${x - 0.4},${top} L${x + 0.4},${top} L${x + 1},${HZ + 6}Z`} fill="#e8e3d8" />
              {[0, 120, 240].map((b) => (
                <path key={b} d={`M${x},${top} l-1.2,-${14 * s} l1.2,-1 l1.2,1Z`} fill="#f4f0e8" transform={`rotate(${a + b} ${x} ${top})`} />
              ))}
              <circle cx={x} cy={top} r="1.4" fill="#9aa0ae" />
            </g>
          );
        })}
      </>
    );
  }
  if (/nuclear|fusion|quantum|mass|reactor|peroxide/.test(w)) {
    return (
      <>
        <Backdrop g={g} sky={sky} />
        <Ground g={g} tones={GROUND.grey} />
        {[0, 1].map((k) => {
          const x = 40 + k * 46 + g.f(-6, 6), h = g.f(26, 34);
          return (
            <g key={k}>
              <path d={`M${x - 12},${HZ + 6} Q${x - 6},${HZ - h / 2} ${x - 8},${HZ - h} L${x + 8},${HZ - h} Q${x + 6},${HZ - h / 2} ${x + 12},${HZ + 6}Z`} fill="#c9cdd8" stroke="#6a6f80" strokeWidth="0.8" />
              {Array.from({ length: 4 }, (_, j) => <circle key={j} cx={x + g.f(-6, 6)} cy={HZ - h - 4 - j * 5} r={g.f(4, 7)} fill="#fff" opacity={0.7 - j * 0.14} />)}
            </g>
          );
        })}
        <path d={`M110,${HZ + 6} v-14 h20 v14Z`} fill="#4a4e60" />
        <circle cx="120" cy={HZ - 2} r="4" fill="#9ff2ff" />
        <circle cx="120" cy={HZ - 2} r="9" fill="#9ff2ff" opacity="0.25" />
      </>
    );
  }
  if (/geotherm|tectonic|deep|mohole|heat/.test(w)) {
    return (
      <>
        <Backdrop g={g} sky={SKY.ember} />
        <Ground g={g} tones={GROUND.rust} />
        {Array.from({ length: g.i(3, 5) }, (_, k) => {
          const x = g.f(15, 145), y = g.f(HZ + 6, ART_H - 6);
          return (
            <g key={k}>
              <path d={`M${x - 8},${y} l4,-1 l3,2 l4,-2 l5,1`} fill="none" stroke="#ffb35c" strokeWidth="1.4" />
              {Array.from({ length: 3 }, (_, j) => <circle key={j} cx={x + g.f(-3, 3)} cy={y - 6 - j * 6} r={3 + j * 1.6} fill="#f4e6dc" opacity={0.55 - j * 0.14} />)}
            </g>
          );
        })}
        <path d={`M0,${HZ + 14} H160`} stroke="#9aa0ae" strokeWidth="2" />
        {[30, 80, 130].map((x) => <rect key={x} x={x - 2} y={HZ + 10} width="4" height="8" fill="#6a6f80" />)}
      </>
    );
  }
  if (/lightning/.test(w)) {
    return (
      <>
        <Backdrop g={g} sky={SKY.night} sun={false} />
        {Array.from({ length: 5 }, (_, k) => <ellipse key={k} cx={k * 38 + g.f(-6, 6)} cy={g.f(10, 18)} rx="28" ry="10" fill="#3a3f55" />)}
        <path d={`M${g.f(60, 90)},18 l-8,16 h7 l-10,20 l18,-24 h-7 l8,-12Z`} fill="#fff4b0" />
        <Ground g={g} tones={GROUND.rust} />
        <path d="M120,58 l10,-30 l10,30" fill="none" stroke="#9aa0ae" strokeWidth="1.5" />
      </>
    );
  }
  // pylons and grid lines
  return (
    <>
      <Backdrop g={g} sky={sky} />
      <Ground g={g} tones={g.pick([GROUND.rust, GROUND.sand])} />
      {[24, 80, 136].map((x, k) => {
        const s = 1 - Math.abs(k - 1) * 0.15;
        const top = HZ - 30 * s;
        return (
          <g key={x} stroke="#2a2a33" strokeWidth="1" fill="none">
            <path d={`M${x - 7 * s},${HZ + 6} L${x},${top} L${x + 7 * s},${HZ + 6} M${x - 9 * s},${top + 6} H${x + 9 * s} M${x - 4 * s},${top + 16} H${x + 4 * s}`} />
          </g>
        );
      })}
      <path d={`M15,${HZ - 18} Q52,${HZ - 8} 89,${HZ - 24} Q108,${HZ - 14} 145,${HZ - 18}`} fill="none" stroke="#2a2a33" strokeWidth="0.7" />
      <path d={`M15,${HZ - 18} Q52,${HZ - 8} 89,${HZ - 24}`} fill="none" stroke="#c8b0ff" strokeWidth="1.6" opacity="0.7" />
    </>
  );
};

const industry: Scene = (g) => {
  const w = g.words;
  const sky = g.pick([SKY.dust, SKY.dusk, SKY.dawn, SKY.ember]);
  if (/mine|mining|ore|strip|mineral|excav/.test(w)) {
    return (
      <>
        <Backdrop g={g} sky={sky} />
        <Ground g={g} tones={GROUND.sand} y={HZ - 10} />
        {[0, 1, 2, 3].map((k) => <ellipse key={k} cx="80" cy={HZ + 8 + k * 4} rx={60 - k * 13} ry={14 - k * 3} fill={['#8a4c2c', '#6b3a22', '#4a2818', '#2a160e'][k]} />)}
        <g fill="#e3b341" stroke="#3a2a06" strokeWidth="0.6">
          <rect x={g.f(40, 60)} y={HZ + 2} width="14" height="6" rx="1" />
          <path d={`M${g.f(95, 110)},${HZ - 4} l10,-14 l2,1 l-8,14Z`} />
        </g>
        {Array.from({ length: 5 }, (_, k) => <path key={k} d={blob(g.f(20, 140), HZ - 6, g.f(1.5, 3), g, 6)} fill={g.pick(['#d9dce6', '#a8805c', '#cfa77d'])} />)}
      </>
    );
  }
  if (/rail|rover|catapult|elevator|toll/.test(w)) {
    return (
      <>
        <Backdrop g={g} sky={sky} />
        <Ground g={g} tones={GROUND.rust} />
        {[-1, 1].map((d) => <line key={d} x1={80 + d * 3} y1={HZ - 2} x2={80 + d * 60} y2={ART_H} stroke="#2a2a33" strokeWidth="1.4" />)}
        {Array.from({ length: 6 }, (_, k) => {
          const t = (k + 1) / 7, y = HZ - 2 + t * (ART_H - HZ + 2), hw = 3 + t * 57;
          return <line key={k} x1={80 - hw} y1={y} x2={80 + hw} y2={y} stroke="#4a2e1c" strokeWidth={0.6 + t * 1.2} />;
        })}
        <g>
          <rect x="68" y={HZ - 12} width="24" height="10" rx="2" fill="#c9cdd8" stroke="#4a4e60" strokeWidth="0.8" />
          <rect x="71" y={HZ - 10} width="18" height="3" fill="#2f4f8a" />
          <circle cx="76" cy={HZ - 7} r="1" fill="#ffd27a" /><circle cx="84" cy={HZ - 7} r="1" fill="#ffd27a" />
        </g>
      </>
    );
  }
  // factory with stacks
  return (
    <>
      <Backdrop g={g} sky={sky} />
      <Ground g={g} tones={GROUND.grey} y={HZ + 2} />
      {Array.from({ length: g.i(2, 4) }, (_, k) => {
        const x = 18 + k * 38 + g.f(-4, 4), h = g.f(10, 18), wd = g.f(22, 32);
        return (
          <g key={k}>
            <path d={`M${x},${HZ + 4} v-${h} l${wd / 3},-5 v5 l${wd / 3},-5 v5 l${wd / 3},-5 v${h + 5}Z`} fill="#4a4e60" />
            <rect x={x + wd - 6} y={HZ - h - 18} width="4" height="18" fill="#6a6f80" />
            {Array.from({ length: 4 }, (_, j) => <circle key={j} cx={x + wd - 4 + j * 3 + g.f(-1, 1)} cy={HZ - h - 22 - j * 5} r={2.4 + j * 1.3} fill={g.pick(['#d8d0c8', '#bfb6aa', '#e8e0d4'])} opacity={0.75 - j * 0.15} />)}
            {Array.from({ length: 3 }, (_, j) => <rect key={`w${j}`} x={x + 3 + j * 7} y={HZ - h / 2} width="3" height="2.4" fill="#ffd27a" />)}
          </g>
        );
      })}
    </>
  );
};

const orbit: Scene = (g) => {
  const w = g.words;
  const elevator = /elevator/.test(w);
  return (
    <>
      <Backdrop g={g} sky={SKY.night} sun={false} stars />
      <defs>
        <radialGradient id={`${g.u}pl`} cx="40%" cy="20%" r="80%">
          <stop offset="0" stopColor="#d8744a" />
          <stop offset="1" stopColor="#5e2416" />
        </radialGradient>
      </defs>
      <circle cx={g.f(50, 110)} cy={ART_H + 120} r="150" fill={`url(#${g.u}pl)`} />
      <circle cx="80" cy={ART_H + 120} r="153" fill="none" stroke="#ffb08a" strokeOpacity="0.35" strokeWidth="3" />
      {elevator && <line x1="80" y1={ART_H} x2="80" y2="14" stroke="#e8e3d8" strokeWidth="0.9" />}
      {/shuttle|ship|fleet|probe|colony|convoy|immigra|import|launch/.test(w)
        ? Array.from({ length: /fleet/.test(w) ? 3 : 1 }, (_, k) => {
          const x = g.f(30, 130), y = g.f(16, 44), a = g.f(-50, -20), s = g.f(0.9, 1.4);
          return (
            <g key={k} transform={`translate(${x} ${y}) rotate(${a}) scale(${s})`}>
              <path d="M-26,0 L-6,-1.6 L-6,1.6Z" fill="#ffb35c" opacity="0.7" />
              <path d="M-6,-3 L10,-1.4 Q14,0 10,1.4 L-6,3Z" fill="#e8e3d8" stroke="#4a4e60" strokeWidth="0.5" />
              <path d="M-4,-3 l-3,-4 l4,1Z M-4,3 l-3,4 l4,-1Z" fill="#c4472f" />
            </g>
          );
        })
        : (
          <g transform={`translate(${g.f(55, 105)} ${g.f(26, 36)}) rotate(${g.f(-20, 20)})`}>
            {g.r() > 0.5 ? (
              <>
                <ellipse rx="22" ry="7" fill="none" stroke="#c9cdd8" strokeWidth="3" />
                <ellipse rx="22" ry="7" fill="none" stroke="#4a4e60" strokeWidth="0.6" strokeDasharray="2 3" />
                <rect x="-2" y="-12" width="4" height="24" fill="#9aa0ae" />
                <circle r="4" fill="#e8e3d8" stroke="#4a4e60" strokeWidth="0.6" />
              </>
            ) : (
              <>
                <rect x="-28" y="-5" width="18" height="10" fill="#2f4f8a" stroke="#9fc0ff" strokeWidth="0.5" />
                <rect x="10" y="-5" width="18" height="10" fill="#2f4f8a" stroke="#9fc0ff" strokeWidth="0.5" />
                <line x1="-10" y1="0" x2="10" y2="0" stroke="#9aa0ae" strokeWidth="1.2" />
                <rect x="-5" y="-6" width="10" height="12" fill="#e3b341" stroke="#7a5a10" strokeWidth="0.6" />
                <path d="M0,-6 v-6 m-3,0 h6" stroke="#c9cdd8" strokeWidth="0.8" />
              </>
            )}
          </g>
        )}
    </>
  );
};

const jovian: Scene = (g) => {
  const ringed = /saturn|miranda|neptune/.test(g.words) || g.r() > 0.7;
  const cx = g.f(46, 114), cy = g.f(34, 46), r = g.f(26, 34);
  const bands = g.pick([['#e8c79a', '#c47a4a', '#f2dcb8', '#9a5a3a'], ['#d9c8a0', '#a88a5a', '#efe2c4', '#7a6a4a'], ['#cfe0e8', '#8ab0c8', '#e8f2f8', '#5a8aa8']]);
  return (
    <>
      <Backdrop g={g} sky={SKY.night} sun={false} stars />
      <defs>
        <clipPath id={`${g.u}pc`}><circle cx={cx} cy={cy} r={r} /></clipPath>
        <radialGradient id={`${g.u}sh`} cx="30%" cy="30%" r="80%">
          <stop offset="0.5" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.6" />
        </radialGradient>
      </defs>
      {ringed && <ellipse cx={cx} cy={cy} rx={r * 1.7} ry={r * 0.4} fill="none" stroke={bands[2]} strokeOpacity="0.55" strokeWidth="3" transform={`rotate(-14 ${cx} ${cy})`} />}
      <g clipPath={`url(#${g.u}pc)`}>
        <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={bands[0]} />
        {Array.from({ length: 7 }, (_, k) => (
          <path key={k} d={`M${cx - r},${cy - r + k * (r / 3.4) + 4} q ${r / 2},${g.f(-2, 2)} ${r},0 t ${r},0 v${g.f(2, 5)} q -${r / 2},${g.f(-2, 2)} -${r},0 t -${r},0Z`} fill={bands[1 + (k % 3)]} opacity="0.8" />
        ))}
        {g.r() > 0.4 && <ellipse cx={cx + g.f(-r / 2, r / 2)} cy={cy + r * 0.3} rx={r * 0.2} ry={r * 0.1} fill="#b84a2a" opacity="0.85" />}
        <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={`url(#${g.u}sh)`} />
      </g>
      {ringed && <path d={`M${cx - r * 1.7},${cy + 2} a${r * 1.7},${r * 0.4} 0 0 0 ${r * 3.4},0`} fill="none" stroke={bands[2]} strokeOpacity="0.75" strokeWidth="3" transform={`rotate(-14 ${cx} ${cy})`} />}
      {Array.from({ length: g.i(1, 3) }, (_, k) => <circle key={k} cx={g.f(8, 152)} cy={g.f(8, 70)} r={g.f(1.6, 4)} fill={g.pick(['#d9dce6', '#e8c79a', '#bfb6aa'])} />)}
      <path d={ridge(g, ART_H - 6, 3, 6)} fill="#3a3540" />
    </>
  );
};

const earth: Scene = (g) => {
  const ex = g.f(40, 120), er = g.f(16, 22);
  return (
    <>
      <Backdrop g={g} sky={g.pick([SKY.night, SKY.dusk])} sun={false} stars />
      <defs>
        <clipPath id={`${g.u}ec`}><circle cx={ex} cy={HZ - 8} r={er} /></clipPath>
      </defs>
      <circle cx={ex} cy={HZ - 8} r={er + 3} fill="#9fd0ff" opacity="0.25" />
      <g clipPath={`url(#${g.u}ec)`}>
        <rect x={ex - er} y={HZ - 8 - er} width={er * 2} height={er * 2} fill="#2f6db0" />
        {Array.from({ length: 4 }, (_, k) => <path key={k} d={blob(ex + g.f(-er, er), HZ - 8 + g.f(-er, er), g.f(4, 8), g, 7)} fill="#5f9d50" />)}
        {Array.from({ length: 3 }, (_, k) => <path key={`c${k}`} d={`M${ex - er},${HZ - 8 + g.f(-er, er)} q${er / 2},-3 ${er},0 t${er},0`} fill="none" stroke="#fff" strokeWidth="1.6" opacity="0.8" />)}
        <circle cx={ex + er * 0.5} cy={HZ - 8} r={er * 1.1} fill="#000" opacity="0.38" />
      </g>
      <Ground g={g} tones={GROUND.rust} />
      <g transform={`translate(${ex > 80 ? 32 : 128} ${HZ + 4})`}>
        <path d="M0,0 l-4,10 h8Z" fill="#9aa0ae" />
        <path d="M-12,-10 a12,12 0 0 0 20,10Z" fill="#e8e3d8" stroke="#4a4e60" strokeWidth="0.6" transform="rotate(-25)" />
        <line x1="0" y1="-2" x2={ex > 80 ? 40 : -40} y2="-34" stroke="#9fd0ff" strokeWidth="0.7" strokeDasharray="2 2" />
      </g>
    </>
  );
};

const science: Scene = (g) => {
  const lab = /lab|gene|medical|ai|physics|development|tech|design|alloy|robot|hack|media|archive/.test(g.words);
  return (
    <>
      <Backdrop g={g} sky={g.pick([SKY.night, SKY.teal, SKY.dusk])} sun={false} stars />
      <Ground g={g} tones={GROUND.grey} />
      {lab ? (
        <g>
          <rect x="44" y={HZ - 16} width="72" height="22" fill="#c9cdd8" stroke="#4a4e60" strokeWidth="0.8" />
          <rect x="44" y={HZ - 20} width="72" height="4" fill="#9aa0ae" />
          {Array.from({ length: 6 }, (_, k) => <rect key={k} x={50 + k * 11} y={HZ - 11} width="6" height="6" fill="#9ff2ff" opacity={g.f(0.5, 1)} />)}
        </g>
      ) : (
        <g>
          <path d={`M54,${HZ + 4} v-12 a26,22 0 0 1 52,0 v12Z`} fill="#e8e3d8" stroke="#4a4e60" strokeWidth="0.8" />
          <path d={`M78,${HZ - 30} h6 v22 h-6Z`} fill="#2a2a33" />
          <path d={`M81,${HZ - 26} L${g.f(110, 140)},6`} stroke="#9ff2ff" strokeWidth="1.2" opacity="0.7" />
        </g>
      )}
      <g transform={`translate(${g.f(20, 40)} ${g.f(18, 28)})`} fill="none" stroke="#9ff2ff" strokeWidth="0.8" opacity="0.85">
        <ellipse rx="10" ry="3.6" /><ellipse rx="10" ry="3.6" transform="rotate(60)" /><ellipse rx="10" ry="3.6" transform="rotate(-60)" />
        <circle r="1.8" fill="#9ff2ff" stroke="none" />
      </g>
    </>
  );
};

const atmosphere: Scene = (g) => {
  const w = g.words;
  if (/lava|volcan|mohole/.test(w)) {
    return (
      <>
        <Backdrop g={g} sky={SKY.ember} />
        <path d={`M20,${HZ + 8} L70,${HZ - 30} L90,${HZ - 30} L140,${HZ + 8}Z`} fill="#4a1c14" />
        <path d={`M70,${HZ - 30} L90,${HZ - 30} L84,${HZ - 24} L76,${HZ - 24}Z`} fill="#ffb35c" />
        <path d={`M79,${HZ - 26} q-6,18 -14,34 M81,${HZ - 26} q8,16 18,34`} fill="none" stroke="#ff8a3a" strokeWidth="2" />
        {Array.from({ length: 5 }, (_, k) => <circle key={k} cx={80 + g.f(-6, 6)} cy={HZ - 36 - k * 7} r={4 + k * 1.8} fill="#2a1a1a" opacity={0.7 - k * 0.1} />)}
        <Ground g={g} tones={GROUND.rust} y={HZ + 10} amp={2} />
      </>
    );
  }
  if (/magnet/.test(w)) {
    return (
      <>
        <Backdrop g={g} sky={SKY.night} sun={false} stars />
        {[0, 1, 2].map((k) => (
          <path key={k} d={`M-10,${30 + k * 6} q 40,-${20 + k * 4} 85,-4 t 95,${g.f(-6, 6)}`} fill="none" stroke={['#6ff0b0', '#9f8aff', '#6ad0f8'][k]} strokeWidth={6 - k * 1.5} opacity="0.45" />
        ))}
        <Ground g={g} tones={GROUND.rust} />
        <path d={`M70,${HZ + 4} v-16 h20 v16`} fill="#4a4e60" /><circle cx="80" cy={HZ - 15} r="6" fill="none" stroke="#c9cdd8" strokeWidth="2" />
      </>
    );
  }
  if (/cloud|zeppelin/.test(w)) {
    return (
      <>
        <Backdrop g={g} sky={SKY.blue} />
        {Array.from({ length: 5 }, (_, k) => {
          const x = g.f(0, 160), y = g.f(10, 40);
          return <g key={k} fill="#fff" opacity="0.85"><circle cx={x} cy={y} r="7" /><circle cx={x + 7} cy={y + 2} r="5" /><circle cx={x - 7} cy={y + 2} r="5" /></g>;
        })}
        {/zeppelin/.test(w) && (
          <g transform={`translate(${g.f(50, 110)} 30)`}>
            <ellipse rx="22" ry="7" fill="#c4472f" /><ellipse rx="22" ry="2" fill="#fff" opacity="0.3" cy="-3" />
            <rect x="-5" y="6" width="10" height="3" fill="#4a4e60" />
          </g>
        )}
        <Ground g={g} tones={GROUND.sand} />
      </>
    );
  }
  // gases, haze, dust, insulation, inert gases
  const gas = g.pick(['#e2a04a', '#c4e07a', '#e27aa8', '#9fd0ff']);
  return (
    <>
      <Backdrop g={g} sky={g.pick([SKY.dust, SKY.dawn, SKY.dusk])} />
      {Array.from({ length: 3 }, (_, k) => <path key={k} d={ridge(g, 20 + k * 10, 6, 6, 20 + k * 10 + 8)} fill={gas} opacity="0.18" />)}
      <Ground g={g} tones={/dust|black/.test(w) ? GROUND.grey : GROUND.rust} />
      {Array.from({ length: g.i(2, 4) }, (_, k) => {
        const x = 20 + k * 40 + g.f(-6, 6);
        return (
          <g key={k}>
            <rect x={x - 3} y={HZ - 18} width="6" height="22" fill="#4a4e60" />
            {Array.from({ length: 4 }, (_, j) => <circle key={j} cx={x + j * 4} cy={HZ - 22 - j * 6} r={3 + j * 1.6} fill={gas} opacity={0.75 - j * 0.15} />)}
          </g>
        );
      })}
    </>
  );
};

const ops: Scene = (g) => (
  <>
    <rect width={ART_W} height={ART_H} fill="#101a2e" />
    {Array.from({ length: 9 }, (_, k) => <line key={`v${k}`} x1={k * 20} y1="0" x2={k * 20} y2={ART_H} stroke="#2f4f6a" strokeWidth="0.5" />)}
    {Array.from({ length: 5 }, (_, k) => <line key={`h${k}`} x1="0" y1={k * 20} x2={ART_W} y2={k * 20} stroke="#2f4f6a" strokeWidth="0.5" />)}
    <path d={ridge(g, 50, 10, 6, 52)} fill="none" stroke="#c4472f" strokeWidth="1" opacity="0.6" />
    {(() => {
      const x = g.f(40, 120), y = g.f(24, 56);
      return (
        <g stroke="#ff7a5a" fill="none" strokeWidth="1.2">
          <circle cx={x} cy={y} r="12" /><circle cx={x} cy={y} r="4" />
          <path d={`M${x - 18},${y} h10 M${x + 8},${y} h10 M${x},${y - 18} v10 M${x},${y + 8} v10`} />
        </g>
      );
    })()}
    {Array.from({ length: 4 }, (_, k) => <rect key={k} x={g.f(6, 140)} y={g.f(6, 76)} width={g.f(6, 16)} height="2" fill="#6ad0f8" opacity="0.5" />)}
  </>
);

const survey: Scene = (g) => (
  <>
    <Backdrop g={g} sky={g.pick([SKY.dust, SKY.dawn, SKY.dusk])} />
    <Ground g={g} tones={GROUND.rust} />
    <g transform={`translate(${g.f(50, 110)} ${HZ + 8})`}>
      <rect x="-12" y="-9" width="24" height="7" rx="1.5" fill="#e8e3d8" stroke="#4a4e60" strokeWidth="0.6" />
      {[-9, 0, 9].map((x) => <circle key={x} cx={x} cy="0" r="2.6" fill="#2a2a33" />)}
      <line x1="8" y1="-9" x2="10" y2="-20" stroke="#4a4e60" strokeWidth="0.9" />
      <rect x="7" y="-23" width="6" height="3" fill="#4a4e60" />
    </g>
    <g transform={`translate(${g.f(16, 40)} ${HZ + 2})`}>
      <line x1="0" y1="0" x2="0" y2="-20" stroke="#e8e3d8" strokeWidth="1" />
      <path d="M0,-20 h12 l-3,4 l3,4 h-12Z" fill="#e3b341" />
    </g>
  </>
);

// corporation emblem: a crest with the house monogram
function corpEmblem(g: G): React.ReactNode {
  const hue = g.pick([['#1d2840', '#e3b341'], ['#3a1a1a', '#e2733c'], ['#123a3a', '#6ad0c8'], ['#1a2a1a', '#9cc35a'], ['#2a1a40', '#c8a8ff'], ['#3a2a10', '#f2d48a']]);
  const sides = g.i(4, 8);
  const rot = g.f(0, 60);
  const mono = g.c.name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('').slice(0, 3) || g.c.name[0];
  const poly = (r: number) => Array.from({ length: sides }, (_, k) => {
    const a = ((k / sides) * 360 + rot) * (Math.PI / 180);
    return `${80 + Math.cos(a) * r},${42 + Math.sin(a) * r}`;
  }).join(' ');
  return (
    <>
      <rect width={ART_W} height={ART_H} fill={hue[0]} />
      {Array.from({ length: 12 }, (_, k) => (
        <line key={k} x1="80" y1="42" x2={80 + Math.cos(k * 0.5236) * 140} y2={42 + Math.sin(k * 0.5236) * 140} stroke={hue[1]} strokeOpacity="0.12" strokeWidth="6" />
      ))}
      <circle cx="80" cy="42" r="34" fill="none" stroke={hue[1]} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 3" />
      <polygon points={poly(28)} fill={hue[1]} />
      <polygon points={poly(23)} fill={hue[0]} />
      <text x="80" y="42" dy="0.36em" textAnchor="middle" fill={hue[1]} fontFamily="var(--display)" fontWeight="700" fontSize={mono.length > 2 ? 15 : 19}>{mono}</text>
    </>
  );
}

// ---------- scene choice ----------
export type SceneKind = 'impact' | 'ice' | 'flora' | 'fauna' | 'microbe' | 'city' | 'power' | 'industry' | 'orbit' | 'jovian' | 'earth' | 'science' | 'atmosphere' | 'ops' | 'survey' | 'corp';

export function sceneFor(c: CardDef): SceneKind {
  if (c.type === 'corp') return 'corp';
  const w = `${c.id} ${c.name}`.toLowerCase();
  const t = new Set(c.tags);
  if (/asteroid|comet|deimos|meteor/.test(w)) return 'impact';
  if (/hack|sabotage|raider|bribe|indentured|virus|security|penal/.test(w)) return 'ops';
  if (/aquifer|lake|flood|water|permafrost|reservoir|ice-cap|polar|great-dam|wave-power|convoy|europa/.test(w)) return 'ice';
  if (t.has('animal') || /bird|fish|pets|livestock|predator|herbivore/.test(w)) return 'fauna';
  if (t.has('microbe') && !t.has('plant')) return 'microbe';
  if (t.has('plant') || /tree|grass|moss|lichen|bush|heather|mangrove|kelp|farm|greenhouse|preserve|park|valley/.test(w)) return 'flora';
  if (t.has('jovian') || /titan|io-|ganymede|callisto|miranda|saturn|vesta|neptune/.test(w)) return 'jovian';
  if (t.has('city') || /habitat|dome|resort|district|stronghold|camp|outpost/.test(w)) return 'city';
  if (/ghg|lava|volcan|mohole|magnet|cloud|zeppelin|insulation|dust|gas|carbonate|nitrogen|hydrogen|heat-trap|local-heat|release/.test(w) && !t.has('power')) return 'atmosphere';
  if (t.has('power') || /power|energy|solar|wind|nuclear|lightning|reactor/.test(w)) return 'power';
  if (/mine|mining|steel|iron|ore|titanium|factory|works|processing|industr|mill|rover|rails|catapult|building-industries|mineral|strip|detonation|alloy|toll|fuel/.test(w)) return 'industry';
  if (t.has('space')) return 'orbit';
  if (t.has('earth')) return 'earth';
  if (t.has('science')) return 'science';
  if (t.has('building')) return 'industry';
  return 'survey';
}

const SCENES: Record<SceneKind, Scene> = {
  impact, ice, flora, fauna, microbe, city, power, industry, orbit, jovian, earth, science, atmosphere, ops, survey, corp: corpEmblem,
};

export const CardArt = memo(function CardArt({ card, className }: { card: CardDef; className?: string }) {
  const raw = useId();
  const u = `a${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
  const r = rng(hashStr(card.id));
  const g: G = {
    r, u, c: card,
    f: (a, b) => a + r() * (b - a),
    i: (a, b) => a + Math.floor(r() * (b - a + 1)),
    pick: (xs) => xs[Math.floor(r() * xs.length)],
    words: `${card.id} ${card.name}`.toLowerCase(),
  };
  const kind = sceneFor(card);
  const mirror = r() < 0.5;
  return (
    <svg viewBox={`0 0 ${ART_W} ${ART_H}`} preserveAspectRatio="xMidYMid slice" className={className ?? 'card-art-svg'} aria-hidden="true" data-scene={kind}>
      {kind === 'corp' || !mirror ? SCENES[kind](g) : <g transform={`translate(${ART_W} 0) scale(-1 1)`}>{SCENES[kind](g)}</g>}
      <Finish g={g} />
    </svg>
  );
});
