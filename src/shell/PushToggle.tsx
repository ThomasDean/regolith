// Turn alerts for this device, shared by every game's online panel.
import { useState } from 'react';
import { disablePush, enablePush, usePushState } from '../pwa';

/** Turn alerts for this device: a push (and the app badge) when it becomes your move. */
export function PushToggle() {
  const [state, refresh] = usePushState();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!state || state === 'unavailable') return null;
  const run = async (f: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); refresh(); }
  };
  return (
    <div className="push-toggle">
      {state === 'install' && (
        <p className="muted small-print">
          <b>Turn alerts:</b> to get a notification (and a badge on the icon) when it’s your move, tap Share in Safari, choose <b>Add to Home Screen</b>, then open the app from there and sign in again.
        </p>
      )}
      {state === 'blocked' && <p className="muted small-print"><b>Turn alerts</b> are blocked. Allow notifications for this site in your device’s Settings, then come back.</p>}
      {state === 'off' && (
        <div className="cloud-row">
          <button type="button" className="btn small" disabled={busy} onClick={() => run(enablePush)}>Alert me on this device when it’s my move</button>
        </div>
      )}
      {state === 'on' && (
        <div className="cloud-row">
          <span className="muted small-print">Turn alerts are on for this device.</span>
          <button type="button" className="link" disabled={busy} onClick={() => run(disablePush)}>Turn off</button>
        </div>
      )}
      {err && <p className="warn">{err}</p>}
    </div>
  );
}

