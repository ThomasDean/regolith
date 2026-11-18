import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Props {
  title: string;
  /** short line shown in the header, open or collapsed (what's chosen, what it costs) */
  summary?: React.ReactNode;
  /** confirm buttons, always in reach in the header */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * A card picker docked to the bottom of the screen. Unlike a dialog it leaves the board, the
 * players, milestones and awards visible and scrollable, and it collapses to its header so you
 * can look at everything before choosing.
 */
export function Sheet({ title, summary, actions, children }: Props) {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLElement>(null);
  // tell the page how much room the sheet takes, so content can scroll clear of it
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--sheet-h', `${el.offsetHeight}px`);
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); root.style.removeProperty('--sheet-h'); };
  }, []);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <section className={`sheet ${open ? 'open' : 'collapsed'}`} ref={ref} tabIndex={-1} aria-label={title}>
      <header className="sheet-head">
        <button type="button" className="sheet-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          title={open ? 'Collapse to see the board' : 'Show the cards'}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={open ? 'M3 6l5 5 5-5' : 'M3 10l5-5 5 5'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="sheet-title">{title}</span>
        </button>
        {summary && <span className="sheet-summary">{summary}</span>}
        <span className="sheet-actions">{actions}</span>
      </header>
      {open && <div className="sheet-body">{children}</div>}
    </section>
  );
}
