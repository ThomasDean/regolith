# Regolith – Claude guidance

See `README.md` for what the project is, how to run it, and deploy/auth setup.

## Multiple board games

The site is now a hub with two games: Regolith (`/regolith`, code in `src/engine`, `src/ui`, `src/online`) and Fathom (`/fathom`, `src/fathom/engine` + `src/fathom/ui`). Shared pieces live in `src/shell/`: path routing (`route.ts`), online rooms for any game (`rooms.ts`: list, join, leave, follow, call the game's Edge Function), referee basics (`referee.ts`), turn alerts (`PushToggle.tsx`), the hub (`Home.tsx`), local saves for any game (`localSaves.ts`), the cross-game "your games" list and next-game logic (`active.ts`, `NextGame.tsx`), the forfeit dialog (`Forfeit.tsx`) and the game list (`gameInfo.ts`). Each game is lazy-loaded from `Root.tsx`. To add a game: an engine folder, a UI with its own app component, a `localStore` for saves, an entry in `gameInfo.ts`, `Root.tsx`, `active.ts` (`LOCAL`, `allRooms`) and the service worker's app paths. For online play: a schema like `fathom`'s (copy its migration), a referee, an entry in `server/` (using `server/common.ts`) and `scripts/build-edge.mjs`, and add its rooms to `regolith.turns_waiting` for the badge.

Both games play online. Regolith's and Fathom's referees are still separate code; settle a shared referee interface before adding the third game.

### One domain, many games
- Prefer **path-based routing** on a single domain (`/regolith`, `/cities-knights`) over subdomains. One origin means one sign-in, one PWA install, one set of push subscriptions and shared cloud saves across every game.
- Subdomains are separate origins: separate sessions, PWA installs and push subscriptions, and each needs its own Supabase redirect URL. Avoid unless there is a strong reason.
- Changing the domain later resets origin-bound state (sign-in, PWA install, push subscriptions). Supabase Redirect URLs need updating. The Google OAuth redirect URI points at Supabase, so it doesn't change. Remember the Supabase Site URL belongs to Breakthrough Music (shared project): leave it alone and keep passing Regolith's own `redirectTo`. If a vanity domain is wanted without disruption, redirect the new domain to the existing one.

### Code structure
- **Monorepo with shared packages**, one folder/package per game plus shared infrastructure: auth, Supabase client, cloud saves, lobby/online play, push notifications, PWA, UI components. A new game should only add its own rules and UI.
- **Engine separate from UI.** Game rules and state transitions are pure logic (no React, no DOM). That keeps them testable, lets CPU opponents and the online referee reuse the same engine, and supports server-side move validation.
- **Never hardwire game logic into shared components.** Shared code talks to games through a small common interface (new game, apply move, legal moves, serialize/deserialize state, CPU turn). Settle this interface before adding the third game.
- **Code-split per game** with route-level lazy loading, so players only download the game they open and the initial bundle stays small.
- A single repo is fine at this scale. If build times grow, add task caching (e.g. Turborepo).

### Backend (Supabase)
- One Supabase project, **one schema per game** (as `regolith` is today) plus a **shared schema** for profiles, friends and push subscriptions.
- Keep access through functions with per-user limits, as `regolith.saves` does today. Don't expose tables directly.
- Watch free-tier limits (database size, Realtime connections, Edge Function invocations); they will be hit before code size matters.
