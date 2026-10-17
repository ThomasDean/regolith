// Small original glyphs for tags and resources, drawn on a 16×16 grid.
import type { Res, Tag } from '../engine/types';
import { TAG_COLOR } from './format';

const TAG_GLYPH: Record<Tag, React.ReactNode> = {
  // girder truss
  building: <path d="M2 12h12M2 4h12M3 4l3 8 3-8 3 8 2-8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />,
  // four-point star
  space: <path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z" fill="currentColor" />,
  // atom
  science: (
    <g fill="none" stroke="currentColor" strokeWidth="1.2">
      <ellipse cx="8" cy="8" rx="6.2" ry="2.4" />
      <ellipse cx="8" cy="8" rx="6.2" ry="2.4" transform="rotate(60 8 8)" />
      <ellipse cx="8" cy="8" rx="6.2" ry="2.4" transform="rotate(-60 8 8)" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </g>
  ),
  power: <path d="M9.5 1 3.5 9h4l-1 6 6-8.2h-4.2Z" fill="currentColor" />,
  // globe
  earth: (
    <g fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c-2.6 3-2.6 9 0 12M8 2c2.6 3 2.6 9 0 12" />
    </g>
  ),
  // banded giant
  jovian: (
    <g>
      <circle cx="8" cy="8" r="6.3" fill="currentColor" />
      <path d="M2.3 6h11.4M1.8 8.6h12.4M2.6 11h10.8" stroke="var(--glyph-bg, #1d2840)" strokeWidth="1" opacity="0.6" />
    </g>
  ),
  plant: <path d="M3 13C3 6 8 2.5 13.5 2.5 13.5 8.5 10 13 3 13Zm0 0 6-6" fill="currentColor" stroke="var(--glyph-bg, #1d2840)" strokeWidth="0.9" />,
  microbe: (
    <g fill="currentColor">
      <path d="M8 2.5c3 0 5.5 2 5.5 5.2S11.2 13.5 8 13.5 2.5 11 2.5 7.8 5 2.5 8 2.5Z" opacity="0.9" />
      <circle cx="6.3" cy="7" r="1.2" fill="var(--glyph-bg, #1d2840)" />
      <circle cx="9.6" cy="9.4" r="0.9" fill="var(--glyph-bg, #1d2840)" />
    </g>
  ),
  // paw
  animal: (
    <g fill="currentColor">
      <ellipse cx="8" cy="10.6" rx="3.3" ry="2.7" />
      <circle cx="3.6" cy="7" r="1.5" /><circle cx="6.2" cy="4.2" r="1.5" /><circle cx="9.8" cy="4.2" r="1.5" /><circle cx="12.4" cy="7" r="1.5" />
    </g>
  ),
  city: <path d="M1.5 14V8h3V5h3v9-6h3V2h3v12Z" fill="currentColor" />,
  // impact burst
  event: <path d="M8 1 9.6 5.4 14 4 11.2 7.8 15 10.2 10.4 10.4 10 15 7.6 11.2 4 14 4.8 9.8 1 7.4 5.6 6.4Z" fill="currentColor" />,
};

/** Tag badge: a round coloured disc with the tag's glyph. */
export function TagIcon({ tag, size = 18, title }: { tag: Tag; size?: number; title?: string }) {
  const bg = TAG_COLOR[tag];
  const light = tag === 'science' || tag === 'microbe' || tag === 'city';
  const fg = light ? '#1d2840' : '#f6efe1';
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className="tag-icon" role="img" aria-label={title ?? `${tag} tag`}
      style={{ ['--glyph-bg' as string]: bg }}>
      <circle cx="10" cy="10" r="9.4" fill={bg} stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
      <g transform="translate(2 2)" color={fg}>{TAG_GLYPH[tag]}</g>
    </svg>
  );
}

const RES_GLYPH: Record<Res, React.ReactNode> = {
  mc: (
    <g>
      <circle cx="8" cy="8" r="7" fill="#e3b341" stroke="#7a5a10" strokeWidth="1" />
      <circle cx="8" cy="8" r="5.2" fill="none" stroke="#a37a1c" strokeWidth="0.8" />
      <path d="M5 10.6V5.6l3 3.2 3-3.2v5" fill="none" stroke="#5a3f08" strokeWidth="1.5" strokeLinejoin="round" />
    </g>
  ),
  steel: (
    <g>
      <path d="M1.5 11.5 4 5h8l2.5 6.5Z" fill="#a8805c" stroke="#3f2a19" strokeWidth="1" strokeLinejoin="round" />
      <path d="M4 5h8l-1 2H5Z" fill="#cfa77d" />
    </g>
  ),
  titanium: (
    <g>
      <path d="M8 1.5 14 8 8 14.5 2 8Z" fill="#d9dce6" stroke="#4b4f66" strokeWidth="1" />
      <path d="M8 1.5 10.5 8 8 14.5 5.5 8Z" fill="#f4f6fb" opacity="0.85" />
    </g>
  ),
  plants: <path d="M2.5 13.5C2.5 6.5 7.5 2.5 13.5 2.5c0 6.5-4 11-11 11Zm0 0 6.5-6.5" fill="#6fb45b" stroke="#24451c" strokeWidth="1" />,
  energy: <path d="M9.6 1 3.4 9.2h4.2l-1.1 5.8 6.1-8.4H8.3Z" fill="#a487e0" stroke="#3b2a66" strokeWidth="0.9" strokeLinejoin="round" />,
  heat: (
    <g>
      <path d="M8 1.2c1 3 4.8 4.6 4.8 8.6A4.8 4.8 0 0 1 3.2 9.8C3.2 7.4 5 6.6 5.4 4.4 6.8 5.6 7.6 3.6 8 1.2Z" fill="#e2733c" stroke="#6a2a10" strokeWidth="0.9" />
      <path d="M8 7.4c.6 1.6 2.4 2.4 2.4 4.2a2.4 2.4 0 0 1-4.8 0c0-1.4 1.6-2 2.4-4.2Z" fill="#f6c25a" />
    </g>
  ),
};

export function ResIcon({ r, size = 16 }: { r: Res; size?: number }) {
  return <svg viewBox="0 0 16 16" width={size} height={size} className="res-icon" aria-hidden="true">{RES_GLYPH[r]}</svg>;
}

/** Raw glyph group, for embedding inside another SVG (board bonuses). */
export function resGlyph(r: Res) { return RES_GLYPH[r]; }

export function TrIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" className="res-icon">
      <path d="M8 1 14.5 4.75v6.5L8 15 1.5 11.25v-6.5Z" fill="#c4472f" stroke="#5a1c10" strokeWidth="1" />
      <path d="M4.5 9.5 8 5l3.5 4.5" fill="none" stroke="#f6e8cf" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
