// Custom cards: make your own project cards and sort them into groups you can add to a game.
import { useMemo, useState } from 'react';
import type { CardRes, Res, Tag } from '../engine/types';
import { RESOURCES, TAGS } from '../engine/types';
import { BLOCK_KINDS, CARD_RES, TRIGGERS, blockRange, finishCustom, registerCustom, triggerText, type Block, type CustomCard, type Trigger } from '../engine/custom';
import { Card } from './Card';
import { RES_LABEL } from './format';
import { newId, putCard, useLibrary, type Library } from './customLib';

const CARD_TAGS = TAGS.filter((t) => t !== 'event' && t !== 'wild');
const BLOCK_LABEL: Record<Block['k'], string> = {
  res: 'Gain or lose resources', prod: 'Change production', tr: 'Raise TR', temp: 'Raise temperature', oxy: 'Raise oxygen', venus: 'Raise Venus (Venus Next)',
  ocean: 'Place an ocean', city: 'Place a city', greenery: 'Place a greenery', draw: 'Draw cards', addRes: 'Add resources to this card',
  removeAny: 'Remove resources from any player', decProd: 'Lower any player’s production',
};
const TRIGGER_LABEL: Record<Trigger, string> = {
  playTag: 'You play a tag…', anyPlayTag: 'Anyone plays a tag…', placeCity: 'You place a city', anyCity: 'Anyone places a city', placeGreenery: 'You place a greenery', anyOcean: 'Anyone places an ocean',
};
const withRes = (k: Block['k']) => k === 'res' || k === 'prod' || k === 'removeAny' || k === 'decProd';

/** What the form edits: like a custom card, but anything may still be half-filled. */
type Draft = Omit<CustomCard, 'id'> & { id?: string };

const blank = (): Draft => ({ name: '', type: 'automated', cost: 10, tags: [], play: [{ k: 'prod', r: 'mc', n: 1 }] });

function defaultBlock(k: Block['k']): Block {
  if (withRes(k)) return { k, r: k === 'decProd' ? 'energy' : 'mc', n: k === 'res' ? 2 : 1 } as Block;
  const range = blockRange(k);
  return (range ? { k, n: Math.max(1, range[0]) } : { k }) as Block;
}

function BlockList({ blocks, set, label, holds }: { blocks: Block[]; set: (b: Block[]) => void; label: string; holds: boolean }) {
  const upd = (i: number, b: Block) => set(blocks.map((x, j) => (j === i ? b : x)));
  return (
    <div className="cc-blocks">
      {blocks.map((b, i) => {
        const range = blockRange(b.k);
        return (
          <div key={i} className="cc-block">
            <select aria-label={`${label} effect ${i + 1}`} value={b.k} onChange={(e) => upd(i, defaultBlock(e.target.value as Block['k']))}>
              {BLOCK_KINDS.filter((k) => k !== 'addRes' || holds || b.k === 'addRes').map((k) => <option key={k} value={k}>{BLOCK_LABEL[k]}</option>)}
            </select>
            {withRes(b.k) && (
              <select aria-label="Resource" value={(b as { r: Res }).r} onChange={(e) => upd(i, { ...b, r: e.target.value as Res } as Block)}>
                {RESOURCES.map((r) => <option key={r} value={r}>{RES_LABEL[r]}</option>)}
              </select>
            )}
            {range && (
              <input type="number" aria-label="Amount" min={range[0]} max={range[1]} value={(b as { n: number }).n}
                onChange={(e) => upd(i, { ...b, n: Number(e.target.value) } as Block)} />
            )}
            <button type="button" className="icon-btn" aria-label="Remove effect" onClick={() => set(blocks.filter((_, j) => j !== i))}>×</button>
          </div>
        );
      })}
      {blocks.length < 6 && <button type="button" className="btn small ghost" onClick={() => set([...blocks, defaultBlock('res')])}>+ Add effect</button>}
    </div>
  );
}

function Editor({ start, onSave, onCancel }: { start: Draft; onSave: (c: CustomCard) => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(start);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const holds = d.type === 'active' && !!d.resource;
  // the card as it stands, or why it can't be saved yet
  const checked = useMemo(() => {
    try { const c = finishCustom(d); registerCustom([c]); return { c, err: null }; } catch (e) { return { c: null, err: (e as Error).message }; }
  }, [d]);
  const vpKind = !d.vp ? 'none' : 'perRes' in d.vp ? 'per' : 'fixed';
  return (
    <div className="cc-editor">
      <form className="cc-form" onSubmit={(e) => { e.preventDefault(); if (checked.c) onSave(checked.c); }}>
        <label className="cc-field">Name <input value={d.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="Algae Vats" /></label>
        <div className="cc-row">
          <div className="seg" role="group" aria-label="Card type">
            {(['automated', 'active', 'event'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={d.type === t} onClick={() => set(t === 'active' ? { type: t } : { type: t, resource: undefined, action: undefined, effect: undefined, vp: d.vp && 'perRes' in d.vp ? undefined : d.vp })}>
                {t === 'automated' ? 'Automated' : t === 'active' ? 'Active' : 'Event'}
              </button>
            ))}
          </div>
          <label className="cc-field inline">Cost <input type="number" min={0} max={60} value={d.cost} onChange={(e) => set({ cost: Number(e.target.value) })} /> M€</label>
        </div>
        <fieldset className="cc-field">
          <legend>Tags <span className="muted">up to 3</span></legend>
          <div className="cc-tags">
            {CARD_TAGS.map((t) => {
              const on = d.tags.includes(t);
              return <button key={t} type="button" className={`cc-tag ${on ? 'on' : ''}`} aria-pressed={on} disabled={!on && d.tags.length >= 3} onClick={() => set({ tags: on ? d.tags.filter((x) => x !== t) : [...d.tags, t] })}>{t}</button>;
            })}
          </div>
        </fieldset>
        <fieldset className="cc-field">
          <legend>Requirement</legend>
          <div className="cc-row">
            <select aria-label="Global requirement" value={d.req?.param ?? ''} onChange={(e) => {
              const param = (e.target.value || undefined) as NonNullable<Draft['req']>['param'];
              set({ req: param ? { ...d.req, param, min: param === 'temp' ? -10 : 3, max: undefined } : d.req?.tag ? { tag: d.req.tag, tagCount: d.req.tagCount } : undefined });
            }}>
              <option value="">No global requirement</option>
              <option value="temp">Temperature (°C)</option>
              <option value="oxy">Oxygen (%)</option>
              <option value="oceans">Oceans</option>
              <option value="venus">Venus (%)</option>
            </select>
            {d.req?.param && (
              <>
                <select aria-label="At least or at most" value={d.req.max !== undefined ? 'max' : 'min'} onChange={(e) => {
                  const v = d.req!.min ?? d.req!.max;
                  set({ req: { ...d.req, min: e.target.value === 'min' ? v : undefined, max: e.target.value === 'max' ? v : undefined } });
                }}>
                  <option value="min">at least</option>
                  <option value="max">at most</option>
                </select>
                <input type="number" aria-label="Requirement value" value={d.req.min ?? d.req.max ?? 0}
                  onChange={(e) => set({ req: { ...d.req, [d.req!.max !== undefined ? 'max' : 'min']: Number(e.target.value) } })} />
              </>
            )}
          </div>
          <div className="cc-row">
            <select aria-label="Tag requirement" value={d.req?.tag ?? ''} onChange={(e) => {
              const tag = (e.target.value || undefined) as Tag | undefined;
              set({ req: tag ? { ...d.req, tag, tagCount: d.req?.tagCount ?? 2 } : d.req?.param ? { param: d.req.param, min: d.req.min, max: d.req.max } : undefined });
            }}>
              <option value="">No tag requirement</option>
              {CARD_TAGS.map((t) => <option key={t} value={t}>{t} tags</option>)}
            </select>
            {d.req?.tag && <input type="number" aria-label="Tags needed" min={1} max={6} value={d.req.tagCount ?? 1} onChange={(e) => set({ req: { ...d.req, tagCount: Number(e.target.value) } })} />}
          </div>
        </fieldset>
        {d.type === 'active' && (
          <label className="cc-field inline">Holds
            <select value={d.resource ?? ''} onChange={(e) => {
              const resource = (e.target.value || undefined) as CardRes | undefined;
              set({ resource, ...(resource ? {} : { vp: d.vp && 'perRes' in d.vp ? undefined : d.vp, play: d.play.filter((b) => b.k !== 'addRes') }) });
            }}>
              <option value="">no resources</option>
              {CARD_RES.map((r) => <option key={r} value={r}>{r}s</option>)}
            </select>
          </label>
        )}
        <fieldset className="cc-field">
          <legend>Victory points</legend>
          <div className="cc-row">
            <select aria-label="Victory points" value={vpKind} onChange={(e) => set({ vp: e.target.value === 'fixed' ? { n: 1 } : e.target.value === 'per' ? { perRes: 2 } : undefined })}>
              <option value="none">None</option>
              <option value="fixed">Fixed</option>
              {holds && <option value="per">1 VP per resources here</option>}
            </select>
            {d.vp && 'n' in d.vp && <input type="number" aria-label="VP" min={-3} max={5} value={d.vp.n} onChange={(e) => set({ vp: { n: Number(e.target.value) } })} />}
            {d.vp && 'perRes' in d.vp && <label className="inline">every <input type="number" aria-label="Resources per VP" min={1} max={4} value={d.vp.perRes} onChange={(e) => set({ vp: { perRes: Number(e.target.value) } })} /> {d.resource}s</label>}
          </div>
        </fieldset>
        <fieldset className="cc-field">
          <legend>When played</legend>
          <BlockList blocks={d.play} set={(play) => set({ play })} label="When played" holds={holds} />
        </fieldset>
        {d.type === 'active' && (
          <>
            <fieldset className="cc-field">
              <legend><label><input type="checkbox" checked={!!d.action} onChange={(e) => set({ action: e.target.checked ? { gain: [{ k: 'res', r: 'mc', n: 2 }] } : undefined })} /> Action <span className="muted">once per generation</span></label></legend>
              {d.action && (
                <>
                  <div className="cc-row">
                    <span className="muted">Pay</span>
                    <label className="inline"><input type="number" aria-label="M€ cost" min={0} max={30} value={d.action.costMC ?? 0} onChange={(e) => set({ action: { ...d.action!, costMC: Number(e.target.value) || undefined } })} /> M€</label>
                    <select aria-label="Resource cost" value={d.action.costRes?.r ?? ''} onChange={(e) => set({ action: { ...d.action!, costRes: e.target.value ? { r: e.target.value as Res, n: d.action!.costRes?.n ?? 1 } : undefined } })}>
                      <option value="">no other resource</option>
                      {RESOURCES.filter((r) => r !== 'mc').map((r) => <option key={r} value={r}>{RES_LABEL[r]}</option>)}
                    </select>
                    {d.action.costRes && <input type="number" aria-label="Resource cost amount" min={1} max={10} value={d.action.costRes.n} onChange={(e) => set({ action: { ...d.action!, costRes: { ...d.action!.costRes!, n: Number(e.target.value) } } })} />}
                    {holds && <label className="inline"><input type="number" aria-label={`${d.resource}s spent from this card`} min={0} max={5} value={d.action.spendHere ?? 0} onChange={(e) => set({ action: { ...d.action!, spendHere: Number(e.target.value) || undefined } })} /> {d.resource}s from here</label>}
                  </div>
                  <span className="muted">to get</span>
                  <BlockList blocks={d.action.gain} set={(gain) => set({ action: { ...d.action!, gain } })} label="Action" holds={holds} />
                </>
              )}
            </fieldset>
            <fieldset className="cc-field">
              <legend><label><input type="checkbox" checked={!!d.effect} onChange={(e) => set({ effect: e.target.checked ? { when: 'playTag', tag: 'science', gain: [{ k: 'res', r: 'mc', n: 1 }] } : undefined })} /> Ongoing effect</label></legend>
              {d.effect && (
                <>
                  <div className="cc-row">
                    <span className="muted">When</span>
                    <select aria-label="Trigger" value={d.effect.when} onChange={(e) => set({ effect: { ...d.effect!, when: e.target.value as Trigger } })}>
                      {TRIGGERS.map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}
                    </select>
                    {(d.effect.when === 'playTag' || d.effect.when === 'anyPlayTag') && (
                      <select aria-label="Trigger tag" value={d.effect.tag ?? 'science'} onChange={(e) => set({ effect: { ...d.effect!, tag: e.target.value as Tag } })}>
                        {CARD_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    )}
                  </div>
                  <span className="muted">{triggerText(d.effect)}, you get</span>
                  <BlockList blocks={d.effect.gain} set={(gain) => set({ effect: { ...d.effect!, gain } })} label="Effect" holds={holds} />
                </>
              )}
            </fieldset>
          </>
        )}
        <div className="cc-actions">
          {checked.err && <span className="warn" role="status">{checked.err}</span>}
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn" disabled={!checked.c}>Save card</button>
        </div>
      </form>
      <div className="cc-preview" aria-label="Preview">
        {checked.c ? <Card id={checked.c.id} still /> : <div className="cc-empty muted">{checked.err}</div>}
      </div>
    </div>
  );
}

function Groups({ lib, set }: { lib: Library; set: (l: Library) => void }) {
  const [name, setName] = useState('');
  const add = () => { if (!name.trim()) return; set({ ...lib, groups: [...lib.groups, { id: newId(), name: name.trim().slice(0, 40), cards: [] }] }); setName(''); };
  return (
    <section className="cc-groups" aria-label="Groups">
      <h2>Groups</h2>
      <p className="muted">Groups are what you add to a game. A card can be in several.</p>
      <ul>
        {lib.groups.map((g) => (
          <li key={g.id}>
            <input aria-label="Group name" value={g.name} maxLength={40} onChange={(e) => set({ ...lib, groups: lib.groups.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)) })} />
            <span className="muted">{g.cards.length} card{g.cards.length === 1 ? '' : 's'}</span>
            <button type="button" className="icon-btn" aria-label={`Delete group ${g.name}`} onClick={() => { if (confirm(`Delete the group “${g.name}”? Its cards stay in your library.`)) set({ ...lib, groups: lib.groups.filter((x) => x.id !== g.id) }); }}>×</button>
          </li>
        ))}
      </ul>
      <form className="cc-row" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input aria-label="New group name" placeholder="New group" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn small" disabled={!name.trim()}>Add group</button>
      </form>
    </section>
  );
}

export function CustomCards({ onExit }: { onExit: () => void }) {
  const { lib, set, cloud } = useLibrary();
  const [editing, setEditing] = useState<{ draft: Draft; replacing?: string } | null>(null);
  registerCustom(lib.cards);
  if (editing) {
    return (
      <div className="cc-screen">
        <header className="cc-head"><h1>{editing.replacing ? 'Edit card' : 'New card'}</h1></header>
        <Editor start={editing.draft} onCancel={() => setEditing(null)}
          onSave={(c) => {
            let next = putCard(lib, c, editing.replacing);
            // a new card goes into the only group, if there's just one
            if (!editing.replacing && next.groups.length === 1) next = { ...next, groups: [{ ...next.groups[0], cards: [...next.groups[0].cards, c.id] }] };
            set(next);
            setEditing(null);
          }} />
      </div>
    );
  }
  const toggle = (gid: string, cid: string) => set({ ...lib, groups: lib.groups.map((g) => (g.id !== gid ? g : { ...g, cards: g.cards.includes(cid) ? g.cards.filter((x) => x !== cid) : [...g.cards, cid] })) });
  return (
    <div className="cc-screen">
      <header className="cc-head">
        <h1>Custom cards</h1>
        <span className="muted cc-cloud">{cloud === 'off' ? 'Saved on this device. Sign in to keep them in your account.' : cloud === 'syncing' ? 'Saving…' : cloud === 'saved' ? 'Saved to your account' : 'Couldn’t reach your account; saved on this device'}</span>
        <button type="button" className="btn ghost" onClick={onExit}>Back</button>
      </header>
      <p className="muted">Design your own project cards. Put them in groups, then tick the groups when you set up a game: their cards are shuffled into the deck for everyone, CPUs included. Online, the cards go with the game, so friends don’t need them.</p>
      <div className="cc-layout">
        <section aria-label="Your cards">
          <div className="cc-row">
            <h2>Your cards <span className="muted">({lib.cards.length})</span></h2>
            <button type="button" className="btn" onClick={() => setEditing({ draft: blank() })}>New card</button>
          </div>
          {!lib.cards.length && <p className="muted">No cards yet.</p>}
          <div className="cc-cards">
            {lib.cards.map((c) => (
              <div key={c.id} className="cc-card">
                <Card id={c.id} compact still />
                <div className="cc-card-tools">
                  <button type="button" className="btn small ghost" onClick={() => setEditing({ draft: c, replacing: c.id })}>Edit</button>
                  <button type="button" className="btn small ghost" onClick={() => setEditing({ draft: { ...c, name: `${c.name} 2`.slice(0, 40) } })}>Copy</button>
                  <button type="button" className="icon-btn" aria-label={`Delete ${c.name}`} onClick={() => { if (confirm(`Delete “${c.name}”?`)) set({ cards: lib.cards.filter((x) => x.id !== c.id), groups: lib.groups.map((g) => ({ ...g, cards: g.cards.filter((x) => x !== c.id) })) }); }}>×</button>
                </div>
                {lib.groups.length > 0 && (
                  <div className="cc-in-groups" role="group" aria-label={`Groups for ${c.name}`}>
                    {lib.groups.map((g) => (
                      <label key={g.id} className={`cc-tag ${g.cards.includes(c.id) ? 'on' : ''}`}>
                        <input type="checkbox" checked={g.cards.includes(c.id)} onChange={() => toggle(g.id, c.id)} /> {g.name || 'Untitled'}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
        <Groups lib={lib} set={set} />
      </div>
    </div>
  );
}
