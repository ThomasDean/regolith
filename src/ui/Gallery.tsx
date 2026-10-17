import { useMemo, useState } from 'react';
import { CARDS } from '../engine/cards';
import { Card } from './Card';
import { sceneFor } from './CardArt';

/** Every card in the catalogue, for browsing the artwork. Open with #gallery. */
export function Gallery({ onExit }: { onExit: () => void }) {
  const [q, setQ] = useState('');
  const all = useMemo(() => Object.values(CARDS).sort((a, b) => (a.type === 'corp' ? -1 : 0) - (b.type === 'corp' ? -1 : 0) || a.name.localeCompare(b.name)), []);
  const shown = all.filter((c) => !q || `${c.name} ${c.tags.join(' ')} ${sceneFor(c)}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="gallery">
      <header className="topbar">
        <div className="brand">Regolith</div>
        <h1 className="gallery-title">Card gallery <span className="muted">({shown.length} of {all.length})</span></h1>
        <div className="topbar-tools">
          <label className="sr-only" htmlFor="gq">Filter cards</label>
          <input id="gq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or tag" />
          <button type="button" className="btn ghost" onClick={onExit}>Menu</button>
        </div>
      </header>
      <div className="pick-grid gallery-grid">
        {shown.map((c, i) => <Card key={c.id} id={c.id} index={Math.min(i, 12)} onClick={() => {}} />)}
      </div>
    </div>
  );
}
