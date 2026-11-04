// "Next game": a top-bar button in every game that jumps to the next game waiting on you, and a
// prompt that offers it as soon as your turn in an online game is done.
import { useEffect, useState } from 'react';
import { useSession } from '../cloud';
import { nextGame, useActiveGames } from './active';
import { GAME_INFO } from './gameInfo';
import { navigate } from './route';

export function NextGameButton({ current, turnDone = false }: { current: string | null; turnDone?: boolean }) {
  const session = useSession();
  const { games } = useActiveGames(session?.user.id, turnDone);
  const next = nextGame(games, current);
  const waiting = games.filter((g) => g.yourMove && !g.lobby && g.key !== current).length;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { if (!turnDone) setDismissed(false); }, [turnDone]);
  const label = next ? `Next game: ${GAME_INFO[next.game].name}, ${next.title} (${next.players})` : 'No other game is waiting on you';
  const go = () => { if (next) navigate(next.href); };
  return (
    <>
      <button type="button" className="btn ghost next-game" disabled={!next} onClick={go} title={label} aria-label={label}>
        Next game{waiting > 0 && <span className="count" aria-hidden="true">{waiting}</span>} <span aria-hidden="true">›</span>
      </button>
      {turnDone && next && !dismissed && (
        <div className="turn-done" role="status">
          <p><b>Your move is in.</b> {waiting === 1 ? 'Another game is' : `${waiting} other games are`} waiting on you.</p>
          <p className="muted">{GAME_INFO[next.game].name} · {next.title} · {next.players}</p>
          <div className="turn-done-actions">
            <button type="button" className="btn" onClick={go}>Go to next game</button>
            <button type="button" className="btn ghost" onClick={() => setDismissed(true)}>Stay here</button>
          </div>
        </div>
      )}
    </>
  );
}
