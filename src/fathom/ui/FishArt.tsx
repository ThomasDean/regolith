// Every fish's picture, drawn in code from its id, size, zone and tags. The same fish always
// looks the same; no artwork from the published game is used.
import { memo } from 'react';
import { BAIT, fishDef } from '../engine/cards';
import type { FishDef } from '../engine/types';

function seeded(id: string) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

type Shape = 'fish' | 'eel' | 'ray' | 'shark' | 'horse' | 'round' | 'angler';
function shapeOf(d: FishDef): Shape {
  const n = d.name.toLowerCase();
  if (/seahorse/.test(n)) return 'horse';
  if (/ray|torpedo|manta|angelshark|stargazer/.test(n) && !/stingray/.test(n)) return /stargazer/.test(n) ? 'round' : 'ray';
  if (/shark|thresher|mako|hammerhead/.test(n)) return 'shark';
  if (/eel|moray|hagfish|oarfish|pipefish|lancet|wolffish|frilled|sawtail|snailfish/.test(n)) return 'eel';
  if (/angler|frogfish|sargassum|stonefish|blobfish|swallower|fangtooth|sunfish|dory|blob/.test(n)) return /sunfish|dory/.test(n) ? 'round' : 'angler';
  return 'fish';
}

const PALETTES: Record<string, string[][]> = {
  sun: [['#f6c445', '#f08a3e'], ['#3fb6e0', '#1f6fb0'], ['#f26d6d', '#fbd36a'], ['#7ad3b4', '#2f8f7a'], ['#c9a7f2', '#6f4cc4'], ['#f7f1e3', '#e8853d']],
  twi: [['#9fb3c8', '#4d6680'], ['#c7605a', '#5c2a33'], ['#7fa6c9', '#2c4a6e'], ['#b6b0a0', '#5d584c'], ['#d98f62', '#6b3a2a']],
  mid: [['#3a3f58', '#151827'], ['#5a2f45', '#1c0d18'], ['#2d4a52', '#0d1b20'], ['#463a5c', '#160f22']],
};

function FishArtImpl({ id, size = 'card' }: { id: string; size?: 'card' | 'mini' }) {
  if (id === BAIT) return <BaitArt />;
  const d = fishDef(id);
  const r = seeded(id);
  const zone = d.zones[0];
  const pal = PALETTES[zone][Math.floor(r() * PALETTES[zone].length)];
  const [c1, c2] = pal;
  const shape = shapeOf(d);
  const glow = d.tags.includes('glow');
  const elec = d.tags.includes('electric');
  const venom = d.tags.includes('venomous');
  const camo = d.tags.includes('camouflage');
  const pred = d.tags.includes('predator');
  const gid = `g-${id}-${size}`;
  // body: 100×56 box, nose to the left
  const L = 46 + d.len * 7 + r() * 4; // length grows with size
  const x0 = 50 - L / 2, x1 = 50 + L / 2;
  const H = shape === 'eel' ? 7 + r() * 3 : shape === 'round' ? 18 + r() * 4 : shape === 'angler' ? 15 + r() * 3 : shape === 'shark' ? 9 + r() * 2 : 10 + r() * 4;
  const cy = 28;
  const stripes = !camo && !glow && r() < 0.45;
  const spots: [number, number, number][] = [];
  if (camo || glow) for (let i = 0; i < 6 + Math.floor(r() * 5); i++) spots.push([x0 + L * (0.2 + r() * 0.6), cy + (r() - 0.5) * H * 1.2, 0.8 + r() * (camo ? 2.4 : 1.2)]);

  let body: string;
  let tail: string;
  if (shape === 'ray') {
    body = `M${x0} ${cy} Q${50} ${cy - 22} ${x1 - 8} ${cy} Q${50} ${cy + 22} ${x0} ${cy}Z`;
    tail = `M${x1 - 10} ${cy} L${x1 + 8} ${cy - 1.2} L${x1 + 8} ${cy + 1.2}Z`;
  } else if (shape === 'horse') {
    body = `M44 10 Q56 8 56 18 Q58 30 50 38 Q46 44 52 48 Q46 52 42 46 Q38 38 46 30 Q50 24 44 20 Q36 20 34 16 Q38 11 44 10Z`;
    tail = '';
  } else {
    const nose = shape === 'shark' ? x0 - 3 : x0;
    const belly = shape === 'shark' ? H * 0.75 : H;
    body = `M${nose} ${cy} Q${x0 + L * 0.25} ${cy - H * 1.1} ${x0 + L * 0.6} ${cy - H * 0.8} Q${x1 - 6} ${cy - H * 0.35} ${x1 - 4} ${cy} Q${x1 - 6} ${cy + belly * 0.35} ${x0 + L * 0.6} ${cy + belly * 0.8} Q${x0 + L * 0.25} ${cy + belly * 1.05} ${nose} ${cy}Z`;
    const tw = shape === 'eel' ? 5 : shape === 'shark' ? 14 : 10 + r() * 4;
    tail = shape === 'shark'
      ? `M${x1 - 6} ${cy} L${x1 + 9} ${cy - tw} L${x1 + 4} ${cy} L${x1 + 7} ${cy + tw * 0.6}Z`
      : `M${x1 - 6} ${cy} L${x1 + 8} ${cy - tw} Q${x1 + 4} ${cy} ${x1 + 8} ${cy + tw}Z`;
  }
  const eyeX = shape === 'horse' ? 49 : x0 + L * (shape === 'angler' ? 0.2 : 0.14);
  const eyeY = shape === 'horse' ? 15 : cy - H * 0.3;
  const eyeR = shape === 'angler' ? 3 : d.zones.includes('mid') ? 2.6 : 2;
  const dorsalX = x0 + L * (0.35 + r() * 0.15);
  return (
    <svg viewBox="0 0 100 56" className={`fish-art ${size}`} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </linearGradient>
      </defs>
      {shape !== 'horse' && shape !== 'ray' && (
        <path d={`M${dorsalX} ${cy - H * 0.85} L${dorsalX + 8 + r() * 6} ${cy - H * 1.5 - (shape === 'shark' ? 6 : 2)} L${dorsalX + 14} ${cy - H * 0.7}Z`} fill={c2} opacity="0.9" />
      )}
      {venom && shape !== 'horse' && [0, 1, 2, 3].map((i) => (
        <path key={i} d={`M${dorsalX - 6 + i * 5} ${cy - H * 0.9} l2 -8 l2 8Z`} fill="#e04f3c" />
      ))}
      {tail && <path d={tail} fill={c2} />}
      <path d={body} fill={`url(#${gid})`} stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
      {stripes && [0.35, 0.5, 0.65].map((f, i) => <path key={i} d={`M${x0 + L * f} ${cy - H * 0.8} q-2 ${H * 0.8} 0 ${H * 1.5}`} stroke="rgba(255,255,255,0.45)" strokeWidth="2.2" fill="none" />)}
      {spots.map(([x, y, rr], i) => <circle key={i} cx={x} cy={y} r={rr} fill={glow ? '#9ff6ff' : 'rgba(30,20,10,0.35)'} opacity={glow ? 0.9 : 1} />)}
      {glow && shape === 'angler' && <><path d={`M${x0 + 6} ${cy - H} q4 -12 -6 -14`} stroke="#9ff6ff" strokeWidth="1" fill="none" /><circle cx={x0} cy={cy - H - 14} r="2.6" fill="#d8ffff" /></>}
      {elec && <path d={`M${x0 + L * 0.3} ${cy - 2} l6 -4 l-2 5 l7 -4`} stroke="#ffe45c" strokeWidth="1.6" fill="none" strokeLinejoin="round" />}
      {pred && shape !== 'horse' && <path d={`M${x0 + 2} ${cy + 1.5} l2 2 l2 -2 l2 2 l2 -2`} stroke="#fff" strokeWidth="0.9" fill="none" />}
      <circle cx={eyeX} cy={eyeY} r={eyeR} fill="#f7f7f2" />
      <circle cx={eyeX - 0.4} cy={eyeY} r={eyeR * 0.55} fill="#111" />
    </svg>
  );
}

function BaitArt() {
  return (
    <svg viewBox="0 0 100 56" className="fish-art bait" aria-hidden="true">
      {[[30, 20], [46, 30], [60, 18], [38, 38], [64, 36], [74, 26]].map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <path d="M-7 0 Q0 -4 6 0 Q0 4 -7 0Z M6 0 L10 -3 L10 3Z" fill="#cfe3e8" opacity="0.85" />
          <circle cx="-4" cy="-0.6" r="0.9" fill="#123" />
        </g>
      ))}
    </svg>
  );
}

export const FishArt = memo(FishArtImpl);
