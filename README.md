# Board games: Regolith and Fathom

The site is a small hub of board games. `/` is the game picker with **Your games**: every game you have going, online games waiting on you first, then games saved on this device. Each game has its own path:

- **`/regolith`** — Terraforming Mars (below).
- **`/fathom`** — Fathom, a game that plays like Finspan, hotseat or online (see [Fathom](#fathom)).

In any game, **Next game** in the top bar jumps to the next game waiting on you (online games before hotseat ones, longest-waiting first). In an online game it also pops up as soon as your move is in. **Forfeit** gives up a game: a Normal CPU plays your seat out so the others can finish, you rank last, and the game ends at once if only one player, or no human, is left. Online, a forfeited seat can't be handed back, and the game drops off your list.

Hotseat games are saved in the browser, any number at once (older single saves are moved over automatically). Old links (`/?join=CODE`, `/?room=ID`) still work: they forward to `/regolith`. Vercel and Netlify serve `index.html` for every path (`vercel.json`, `netlify.toml`), and the service worker keeps the hub and both games' paths available offline.

# Regolith

An implementation of the Terraforming Mars base game plus Corporate Era for 2–5 players, with the Prelude, Venus Next, Colonies and Turmoil expansions, on seven maps, with CPU opponents at three difficulty levels. Play pass-and-play at one device, or online with friends on their own devices. Mix humans and CPUs freely.

Hotseat play runs entirely in the browser as a static site, so it deploys to Netlify or Vercel with no server. Online play adds a small Supabase backend (below).

This is a private, non-commercial project for playing with friends. Game rules can be implemented freely, but the Terraforming Mars name, artwork and card text belong to their publisher (FryxGames), so the app uses its own name, its own visual design and its own effect wording. Keep deployments access-restricted and don't add the publisher's art or branding.

## Run it

```bash
npm install
npm run dev          # local dev server
npm test             # rules tests, 160+ simulated full games, CPU games, synergy checks
npm run build        # static site in dist/
npm run build:single # one self-contained dist-single/index.html
npm run build:edge   # bundle the online referee for Supabase
```

To try the online screens without Supabase, open the dev server at `http://localhost:5173/#online-sim`: it runs the real referee in the tab with two human seats (switch between them at the bottom) and a CPU.

## Deploy

**Vercel (recommended):** import this repo at vercel.com/new. The framework preset is Vite and the build settings come from `vercel.json`. Add two environment variables, both for Production and Preview:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://hisostfnkralrabcvqxc.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_pmpTChAB0rdE_4OeOK9LrA_MKLeOYpT` |

Both are safe to ship in the browser; access is enforced in the database. Then turn on Deployment Protection if you want the site private. Every push to `main` redeploys.

**Netlify:** connect the repo (settings come from `netlify.toml`), add the same two variables, and turn on password protection.

Both configs send `X-Robots-Tag: noindex` so the site stays out of search engines.

## Cloud saves (Supabase)

Without the two variables above, Regolith is local-only: games autosave in the browser. With them, the menu shows **Cloud saves**: sign in with Google (or an emailed link), and every game you play while signed in syncs to Supabase a couple of seconds after each move, so you can pick it up on another device.

- Data lives in the `regolith` schema of the Breakthrough Music dev project (free plan, no separate project). Migrations are in `supabase/migrations/`.
- The `regolith.saves` table can't be read or written directly. The app goes through four functions (`list_saves`, `get_save`, `put_save`, `delete_save`), each limited to the signed-in user's own saves.
- One-time Supabase settings (dashboard):
  1. **Settings → Data API → Exposed schemas:** add `regolith`.
  2. **Authentication → URL Configuration:** set Site URL to your Vercel URL and add it (plus `http://localhost:5173`) under Redirect URLs, so sign-in links come back to Regolith.
  3. **Google sign-in** (see below).
  4. Optional: **Authentication → Emails → Magic Link** template, add `{{ .Token }}` if you'd like a 6-digit code in the email too; the app accepts either.
- Supabase's built-in email sender only delivers to your organization's own team members and is rate-limited, so email sign-in is mainly for you. Friends use Google, or play as guests.

### Google sign-in

**Sign in with Google** is the main way in. A guest who signs in with Google is upgraded in place (`linkIdentity`), so they keep the same user and with it their cloud saves and online games. If that Google account already has its own Regolith user, Supabase refuses the link; the panel explains and offers to switch to that account instead (the guest's games stay with the guest on that device).

One-time setup:

1. **Google Cloud** (project `regolith-513420`, Google Auth Platform): audience **External**, published to production. Branding lists `https://playboardgames.vercel.app` as the home page, `/privacy.html` (in `public/`) as the privacy policy, and `playboardgames.vercel.app` and `hisostfnkralrabcvqxc.supabase.co` as authorized domains (basic `email`/`profile`/`openid` scopes need no Google verification). One OAuth client of type **Web application** with authorized redirect URI `https://hisostfnkralrabcvqxc.supabase.co/auth/v1/callback`.
2. **Supabase → Authentication → Sign In / Providers → Google:** on, with that client's ID and secret.
3. **Supabase → Authentication → Sign In / Providers:** turn on **Allow manual linking** (needed for the guest upgrade).
4. **Supabase → Authentication → URL Configuration → Redirect URLs:** Regolith's Vercel URLs (production `https://playboardgames.vercel.app/**` and `https://playboardgames-*.vercel.app/**` for previews) and `http://localhost:5173/**`. The Site URL belongs to Breakthrough Music, which shares the project, so leave it; Regolith always passes its own `redirectTo`.

Google's consent screen names `hisostfnkralrabcvqxc.supabase.co` as the site you're continuing to. Showing a custom domain there needs Supabase's paid custom-domain add-on.

For local development, `.env.development.local` holds the same two variables (`.env.example` shows the format).

## Online play

The menu's **Host online** button opens a game from the player list: the first seat is you, other Human seats become open seats, and CPU seats stay CPUs. You get a six-letter code and an invite link (`?join=CODE`). Friends enter the code and a name under **Play online** and land in the lobby, which updates live; the host can switch seats between open and the CPU levels, then starts once every seat is filled. Friends don't need an account: they join as guests on their device. Signing in with Google (which keeps a guest's games) lets you pick a game up on any device.

- **The server referees.** Every move goes to the `regolith-play` Edge Function, which loads the full game, checks it's your seat's decision, applies it with the same engine, saves, and returns your own view. Other players' hands, the deck order and the random seed never leave the server.
- **Corporation and research picks happen at the same time.** Make your choice whenever you like; it's applied when your turn in the order comes round, and the top bar shows who the game is still waiting on.
- **CPU seats** are played on the server one decision at a time. The host's screen asks for each step at its CPU speed, so CPU moves show up paced and animated as in hotseat play; if the host is away, anyone else's screen takes over after a few seconds.
- **Dropping out.** In a game, the host's **Seats** button hands any seat to an Easy, Normal or Hard CPU, and back to its player later. Any player can **Forfeit** for good (the `forfeit` request): a Normal CPU takes the seat, it ranks last, and the game ends if one player or no human is left. Forfeiting needs the referee redeployed (the workflow does it on push to `main` when the token is set); no database change.
- **Async friendly.** Games live on the server, so players can close the tab and come back; **Play online** lists your games and marks the ones waiting on you. Realtime pushes each change, with a slow poll as a fallback.
- Undo isn't available online.

### Setting it up (once)

1. **Database:** run `supabase/migrations/20261019000000_regolith_online_rooms.sql`, then `20261101000000_regolith_room_settings.sql` (map and milestone/award choice) and `20261102120000_regolith_room_expansions.sql` (expansions) on the Breakthrough Music dev project (SQL editor, or ask Claude to apply it). It adds `regolith.rooms` (members can read their own rooms; realtime is on) and `regolith.room_states` (server only), plus the lobby functions.
2. **Edge Function:** either add a `SUPABASE_ACCESS_TOKEN` repository secret (supabase.com → Account → Access Tokens) so `.github/workflows/deploy-edge.yml` deploys on every engine change, or run `npx supabase login` then `npm run deploy:edge` locally. It deploys with JWT verification off because it checks the caller's sign-in itself.
3. **Guests:** Authentication → Sign In / Providers → turn on **Allow anonymous sign-ins**. Without it, everyone has to sign in with Google first.

Tests: `tests/online.test.ts` plays whole online games through the referee from redacted views; `tests/sql.test.ts` runs the migrations in PGlite and checks the lobby functions and permissions; `node scripts/edge-smoke.mjs` plays a game through the built bundle; `node scripts/edge-push-smoke.mjs` checks that bundle sends a push to the right player's devices; `node scripts/online-sim-check.mjs` clicks through `#online-sim` in a browser.

## Install on a phone, and turn alerts

Regolith is an installable app (PWA): it works offline for hotseat games, opens full screen with its own icon, and can send a notification, with a number on the icon, when it's your move in an online game.

**On iPhone or iPad (iOS 16.4 or later):**
1. Open the site in Safari, tap **Share**, then **Add to Home Screen**. Web push on iOS only works from the installed app, not from a Safari tab.
2. Open Regolith from the Home Screen and sign in again. The installed app keeps its own storage, so it doesn't share Safari's sign-in or guest session.
3. In **Play online**, tap **Alert me on this device when it's my move** and allow notifications.

Android and desktop Chrome work the same way, with or without installing.

What triggers a push: the game starts and you must choose a corporation; a research round opens; it becomes your turn; the game ends. You are never notified about your own move. The badge is the number of games waiting on you, set by the server with each push and recounted whenever the app opens or you finish a move. Each game has one notification, which a newer one replaces.

Limits to know about: iOS requires every push to show a notification, so there are no silent updates; a Focus mode or notification setting on the phone can still hold them back; removing the app from the Home Screen drops the subscription (the server forgets it on the next push).

### Setting it up (once)

1. **Database:** apply `supabase/migrations/20261102000000_regolith_push.sql` (adds `regolith.push_subscriptions` and its functions; nothing is readable except through them).
2. **VAPID keys:** `node scripts/vapid-keys.mjs` prints a key pair that identifies your server to Apple's and Google's push services. Add the three values as Edge Function secrets (Supabase dashboard → Edge Functions → Secrets, or `npx supabase secrets set --project-ref hisostfnkralrabcvqxc VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=https://playboardgames.vercel.app`). The private key is secret; keep it out of Git and out of any `VITE_` variable. `VAPID_SUBJECT` must be an `https:` or `mailto:` contact. Keep these keys: changing them makes every device re-subscribe.
3. **Redeploy the Edge Function** (`npm run deploy:edge`, or push to `main` with the token set up above). Without the secrets the game works exactly as before and the alerts button reports that alerts aren't set up.

How it works: the browser fetches the public key from `regolith-play` (`op: "push-key"`), subscribes, and stores the subscription with `save_push_subscription`. After each saved move the referee works out who the game has just started waiting on (`noticesFor` in `src/online/referee.ts`), and the Edge Function encrypts and sends the push (`server/push.ts`: RFC 8291 encryption and VAPID on WebCrypto, no dependencies; checked against the RFC's own test message in `tests/push.test.ts`). Dead devices (404/410) are deleted. Sending runs in the background, so a slow push service never delays a move, and a failure never fails one.

Icons: `node scripts/make-icons.mjs` regenerates `public/icons/` from the hex mark. `public/sw.js` is the service worker; hosts must serve it uncached, which `vercel.json` and `netlify.toml` already do.

## Maps, milestones and awards

Pick the map in setup. Each comes from a published box and plays by its own rules:

| Map | From | What's different |
|---|---|---|
| Tharsis | Base game | Noctis City's reserved space; Lava Flows on the four volcanoes |
| Hellas | Hellas & Elysium | South Pole: 6 M€ to place a tile there, and you place an ocean; heat bonuses; no volcanoes (Lava Flows anywhere) |
| Elysium | Hellas & Elysium | Oceans in the north; four volcanoes (Hecates Tholus, Elysium Mons, Olympus Mons, Arsia Mons) |
| Utopia Planitia | Utopia & Cimmeria | Energy bonuses and two rich landing sites; no volcanoes |
| Terra Cimmeria | Utopia & Cimmeria | Oceans along the south edge, metal everywhere; four volcanic areas |
| Vastitas Borealis | Amazonis & Vastitas | North Pole: 4 M€ to place a tile on the frozen CO₂, which raises the temperature; heat bonuses |
| Amazonis Planitia | Amazonis & Vastitas | 91 spaces; temperature to +14 °C, oxygen to 18 %, 11 oceans; extra track bonuses (plant production at −12 °C, a card at 7 % oxygen, a temperature step at 11 %); wild resource bonuses |

Everywhere but Tharsis, Noctis City is placed like any other city. Bonuses that need expansions Regolith doesn't have (Turmoil delegates, the Cimmeria colony space) are left off.

**Milestones and awards** (`src/engine/ma.ts`): every map brings its own five and five: 32 milestones and 35 awards in all. Setup shows ten slots. *Map's own* uses the map's set; when one of them needs a missing expansion (Pioneer, Planetologist, Lobbyist) a balanced draw fills that slot. *Shuffle* draws from the whole pool. Pick any slot from the dropdown, or lock it, and shuffles work around it.

Shuffles keep look-alikes apart. Each milestone and award describes what it rewards as a small profile (tiles, greeneries, building tags, steel production, events…), and two of them conflict as much as their profiles overlap, on a 0–9 scale: Gardener and Cultivator are 9, Mayor and Landlord 5, Builder and Scientist 0. A draw keeps every pair at 4 or below, the total across all pairs at 22 or below, and at most three of one kind of play among the ten (two per side). Your own picks are kept even when they clash, with a note in setup. `tests/boards.test.ts` checks 300 draws against the rules.

CPUs value whatever is in play: tag races for any tag milestone or award, the forecast model for every award (spreads fitted per award with `scripts/award-drift-boards.ts`), and the map's bonuses, costs and track lengths. `npx tsx scripts/boards.ts normal,normal,normal 3 [1]` plays CPU games on every map (the `1` uses drawn sets).

## Expansions

Tick any mix of the four in setup (the menu remembers your choice; online, the host picks them in the lobby). Each adds its cards and corporations to the deck and its own rules:

| Expansion | Cards | What it adds |
|---|---|---|
| **Prelude** | 35 preludes, 7 projects, 5 corporations | Four preludes dealt with your corporation; keep two. Everyone plays both, in turn order, before the first action. A prelude that can't be played in full is swapped for 15 M€. Wild tags count as any one tag for requirements. |
| **Venus Next** | 49 projects, 5 corporations | The Venus track (0–30 %, 2 % a step, TR per step, a card at 8 %, a TR at 16 %; not needed to end the game). Floaters, the Air Scrapping project (15 M€), four city spaces off Mars, and World Government Terraforming: after production the first player raises one unfinished parameter a step, with no TR or bonuses. Hoverlord milestone and Venuphile award join the pool. |
| **Colonies** | 49 projects, 5 corporations | Colony tiles (players + 2; 5 with two players) with build bonuses, trade tracks and colony bonuses. Microbe, animal and floater tiles open once a card holding that resource is played. One trade fleet each (more from cards); trading costs 9 M€, 3 energy or 3 titanium, pays the track, gives every colony owner their bonus, and drops the marker to the colony count. Fleets come home and tracks rise each generation. Build Colony project (17 M€). Pioneer milestone; Constructor counts colonies. |
| **Turmoil** | 17 projects, 5 corporations | Six parties, 7 delegates each (first one each generation free, then 5 M€), party leaders, the dominant party and the chairman. After production (and World Government, and colony tracks): everyone loses 1 TR, the current global event resolves with each player's influence, the dominant party takes power, its leader becomes chairman (+1 TR), its ruling bonus pays out and its policy holds for a generation (Reds tax TR raised in actions at 3 M€ a step; Scientists and Kelvinists offer an action). 36 global events, those for Venus or Colonies only with them. Amazonis Planitia's delegate bonuses apply; Lobbyist milestone. |

Card numbers follow the published game; card text is Regolith's own wording. Milestones that need a missing expansion (Pioneer on Utopia Planitia, Planetologist on Terra Cimmeria, Lobbyist on Amazonis Planitia) are filled by a balanced draw, as before.

The rules live in `src/engine/game.ts` (prelude phase, the steps after production, the new ops), `src/engine/colonies.ts` and `src/engine/turmoil.ts` (tiles, parties and events), and the card lists in `src/engine/cards-prelude.ts`, `cards-venus.ts`, `cards-colonies.ts` and `cards-turmoil.ts`. CPUs value Venus steps, card resources that convert (floaters to Venus or TR, microbes to M€…), colonies by their bonuses and expected trades, trade fleets by the trades still to come, and delegates by the chairman's TR and influence; choices like which tile, which party or what World Government raises are simulated move by move. A leading CPU prefers World Government raises that end the game sooner, a trailing one prefers Venus.

`tests/expansions.test.ts` covers each expansion's rules; `tests/coverage.test.ts` also plays 60 random games with all four on; `npx tsx scripts/fuzz-expansions.ts 8` plays random games over all 15 combinations of expansions and maps, checking resources, oceans and delegate counts; `npx tsx scripts/expansions.ts hard,normal,easy 12 [prelude,venus,colonies,turmoil] [map]` plays CPU games.

## End-of-game analytics

The final screen adds:
- **Progression chart:** VP, TR or income (TR + M€ production), turn by turn or by generation, with generation markers, a hover/keyboard readout of every player at that point, and end labels. Each player has a marker shape as well as a colour.
- **Where the points came from:** TR, milestones, awards, greeneries, cities and cards per player.
- **Highlights:** lead changes, who led the most, the biggest single turn.
- **Game stats:** cards and events played, tiles, the temperature/oxygen/ocean steps each player raised, final M€ production, milestones and awards.

The engine samples the scoreboard after every turn and every production phase (`history` in the game state, a few kB per game). CPUs leave it out of their simulation copies. Games saved before this change show the table without the chart.

## How it's built

```
src/engine/       Pure TypeScript rules engine (no DOM, no network)
  types.ts        Game state, actions, effect ops, prompts
  board.ts        The seven maps: layouts, bonuses, special spaces, track lengths and bonuses
  ma.ts           Milestones and awards: catalogue, metrics, conflict scores, balanced draws
  cards.ts        All 208 base/Corporate Era project cards and 12 corporations as data + effect functions;
                  the card index over every set (cardInGame decides which are in a game)
  cards-*.ts      Prelude, Venus Next, Colonies and Turmoil cards and corporations
  colonies.ts     Colony tiles, trade costs and tracks
  turmoil.ts      Parties, ruling bonuses and policies, global events, delegates and influence
  ops.ts          Shorthands for building card effects
  game.ts         createGame + applyAction: every rule is enforced here
  queries.ts      Requirements, costs, payment, legal placements, milestones, awards, scoring
  moves.ts        Legal-move enumeration
  bot.ts          Random-move agent used to fuzz whole games in tests
  ai/value.ts     Engine-aware valuation (production, TR, VP, tags, discounts, triggers)
  ai/cpu.ts       CPU players: simulate each move, evaluate the result, pick the best
src/ui/           React UI: SVG map, gauges, player boards, hand, dialogs, cloud-save panel
  Setup.tsx       Expansion toggles, map picker and milestone/award slots (menu and online lobby)
  Expansions.tsx  Colonies panel (tracks, colonies, fleets, trading) and Turmoil panel (parties, government, events)
  Analytics.tsx   End-of-game charts and stats
  CardArt.tsx     Generated illustration for every card (scene from its subject, seeded variation)
  Icons.tsx       Tag and resource glyphs
  Fx.tsx          Effects: card-play showcase, animated numbers, toasts, banners, confetti
  Gallery.tsx     Every card's artwork (menu link, or open the site with #gallery)
src/cloud.ts      Supabase client: sign-in, save, list, load, delete (no-op when unconfigured)
src/online/       Online play: protocol types, the referee (server rules + redacted views), browser client
src/ui/Online.tsx Play-online panel, lobby, and the online game screen
server/edge.ts    Edge Function wrapper around the referee (bundled to supabase/functions/regolith-play)
server/push.ts    Web Push sender: payload encryption and VAPID signing on WebCrypto
src/pwa.ts        Service worker registration, alerts on/off, Home Screen badge, notification links
public/sw.js      Service worker: offline shell, push and badge handlers
supabase/         Database migrations (cloud saves, online rooms) and the Edge Function config
tests/            Vitest suites
```

The engine is a reducer: `applyAction(state, action) -> state`. Card effects compile to a queue of small ops (gain, raise temperature, place tile, add a microbe…); any op that needs a decision opens a prompt that the next action answers. Randomness comes from a seeded generator stored in the state, so any game replays exactly from its seed and action list. The same engine can later run server-side for online play (a Supabase Edge Function, say) without changes.

## Artwork and effects

All artwork is original and drawn in code; none of the publisher's art is used. Each card gets an illustration generated from its id, tags and name: the subject picks a scene (an impact, a kelp bed, a reactor, a gas giant, a microscope view…) and a seeded random generator varies the palette, horizon, layout and props, so every card looks different but the same card always looks the same. Corporations get a crest with their monogram. The map sits on an illustrated planet that turns greener as the parameters rise, and tiles are drawn as small vignettes.

During play: a played card swells to the middle of the screen and flies to its owner's panel, tiles drop onto the map (oceans flood in, greeneries sprout, cities rise), numbers count up with a floating +/−, the planet flashes when a global parameter moves, and banners mark each generation and your turn. Milestones and awards get a trophy toast and the winner gets confetti. CPUs pause briefly after a showcase so you can read the card. Turn effects off with the **Effects** switch in the top bar; they also start off when your system asks for reduced motion.

Hotseat games autosave to the browser's local storage and resume from the menu. Undo steps back through your own moves until a card is drawn or revealed.

## CPU players

Each turn a CPU copies the game, reshuffles the deck in its copy (so it can't peek at upcoming cards), tries every legal action, answers any follow-up choices, and scores the resulting position. The score is in M€-equivalents and depends on how many generations are likely left:

- **Production and income** are worth more early; **victory points** dominate late. Late in the game M€ is only worth the terraforming it can buy, so CPUs spend down rather than hoard.
- **Engine synergy:** a card's value includes the tags it adds. A tag is worth more when the CPU holds cards that scale with it (Cartel, Satellites, Power Grid, Medical Lab, Terraforming Ganymede…), when it unlocks a requirement for a card in hand (science for AI Central), when Jovian VP cards are in play, or when it advances a contested milestone.
- **Discounts and triggers** (Earth Office, Space Station, Mars University, Decomposers, Optimal Aerobraking, Arctic Algae, Rover Construction…) are valued by how many matching cards or events the CPU expects for the rest of the game.
- **Blocked cards** that need energy production the CPU doesn't have yet count for less, so building power becomes attractive when it unlocks cities and factories.
- **Resource cards** (animals, microbes, fighters, science) are valued per resource for their VP or conversion (Regolith Eaters, Nitrite Reducing Bacteria), and feeders like Symbiotic Fungus aim at the best target.
- **Pairs across the hand:** when planning (research, starting cards, what a hand is worth), a feeder counts targets it's still holding (Large Convoy with Birds in hand), an accumulator counts the feeders that will fill it (Tardigrades with Symbiotic Fungus in play), and consumers in hand raise the value of what they consume: Steelworks or Ironworks make energy production worth more, Space Elevator makes steel worth more, Caretaker Contract makes heat worth more. Each pair is split between its two cards so it isn't counted twice.
- **Sequencing** falls out of the simulation: playing Earth Office before the Earth cards, or the animal card before the event that feeds it, scores higher than the reverse.
- **Research** buys a card only if it adds more to the hand than its 3 M€, given how much money the CPU can expect to spend on cards.
- **Awards** are forecast, not banked. For each award the CPU projects every player's final metric (tiles and M€ production compound; heat and steel/titanium churn as they're spent) with a spread that grows with the generations left, both fitted on seeded CPU games (`scripts/award-data.ts`). A funded award counts as the expected 5/2 points it will pay, minus what it hands the rivals in the same race. An open award slot keeps an *option* value: the CPU could still fund it later once the race has settled, at the higher 14/20 M€ price and if the slot is still there. So funding pays only when the lead is wide enough, and the game far enough along, that locking it in beats waiting. Milestones are cheap and can't flip, so CPUs claim them as soon as they qualify.
- **Heat** in stock is worth temperature steps only while steps remain, so the last conversion isn't avoided.
- **Play styles:** each CPU seat gets a personality from the game seed (balanced, engine builder, terraformer or settler), a few percent of extra weight on production, terraforming, tiles or cards. Two CPUs in the same game lean different ways, but a game replays identically from its seed.
- **Determinism:** CPU choices never use `Math.random`. When no random source is passed, `cpuAction` derives one from the game state, so the same state always gets the same move (replays and server-side referees agree).

Difficulty changes the weights:

| | Easy | Normal | Hard |
|---|---|---|---|
| Tag synergies | No | Yes | Yes |
| Weighs opponents' gains | No | A little | Strongly (targets the leader) |
| Award timing | Forecast | Forecast | Forecast + denial (counts a rival's chance to fund a race they lead) |
| Play style | Pronounced | Moderate | Slight |
| Judgement noise | High, some random moves (never a random award) | Low | None |
| Tempo (push to end when ahead) | No | No | Yes |
| Looks ahead to its second action | No | No | Yes |
| Samples per card-draw outcome | 1 | 1 | 3 |

In 30 seat-rotated 3-player games (Easy vs Normal vs Hard, seeds 1–30, ties count for each), Hard won 13, Normal 14 and Easy 5, averaging 4.3, 1.9 and −6.2 VP against the table average. Against the previous evaluator, the new Normal scores 84.5 to the old Normal's 74.3 (one old vs two new) and 86.7 to 80.4 (one new vs two old). The new Hard scores 81.1 to 75.5 and 85.9 to 80.1. Head to head, Hard and Normal are close (within 1 VP), as they were before. CPU games run about 12–14 generations, and an action takes about 45 ms on average for Hard.

What changed in behaviour (90 player-games per level, before → after): Normal funded awards on average in generation 4.3 (63% in generations 1–5) and won 57% of the awards it funded; now it funds in generation 9.1 (9% in generations 1–5) and wins 79%, finishing second in the rest. Easy went from generation 2.1 (88% early, 39% won) to 9.4 (6% early, 83% won), and Hard from 5.1 (51% early, 58% won) to 8.6 (20% early, 77% won).

Scripts:
- `npx tsx scripts/batch.ts easy,normal,hard 1 20` runs a tournament. Agents `old-easy`, `old-normal` and `old-hard` play the frozen previous evaluator (`scripts/baseline/`), for example `normal,old-normal,old-normal`.
- `npx tsx scripts/habits.ts normal,normal,normal 1 30` prints a behaviour profile: award and milestone timing and who wins them, standard projects and conversions by generation, plays, research buys and income per generation, M€ left at pass, VP breakdown, corporation picks and results, and first actions.
- `scripts/verify.sh <outdir> 30` runs the full before/after suite.
- `why-award.ts`, `inspect.ts`, `trace.ts`, `corps.ts`, `horizon-check.ts`, `award-data.ts` and `award-drift.ts` are diagnostics.
- Try a different Hard setting with `HARD='{"samples":2}' AGENTS=hard,normal,normal npx tsx scripts/tune.ts 1 20`.

## Rules implemented

- Seven maps (above) with placement bonuses, ocean areas, Noctis City, volcanoes, Ganymede and Phobos off-world cities.
- Generation flow: corporation and starting-card choice, research (4 cards, 3 M€ each), 1–2 actions per turn until everyone passes, production (energy becomes heat; M€ = TR + production).
- Global parameters with their bonuses (heat production at −24 and −20 °C, an ocean at 0 °C, a temperature step at 8 % oxygen), TR for every step.
- Tile rules: ocean adjacency pays 2 M€, greeneries go next to your tiles when possible, cities can't touch cities, special tiles and their placement rules.
- Standard projects, plant and heat conversion, milestones (3 max) and awards (3 max, 8/14/20 M€; no second place with two players), from any map's set.
- Steel, titanium and Helion heat as payment; Advanced Alloys and PhoboLog values; card discounts; requirement bonuses (Inventrix, Adaptation Technology, Special Design); Indentured Workers.
- All 208 project cards and all 12 corporations, including every action, trigger and protection (Pets, Protected Habitats).
- Final greenery round, scoring with tiebreak on M€.
- Corporate Era can be turned off (base cards only, everyone starts with 1 of each production).

### Simplifications in this version

- No drafting variant or solo mode yet.
- The Hellas and Vastitas pole spaces only charge while their bonus still applies (oceans or temperature not yet maxed).
- Helion's heat can pay for cards, standard projects, milestones and awards, but not for blue-card action costs.
- When several of your own effects trigger at once, they resolve in a fixed order rather than one you choose.

## Roadmap

- **M2** Draft variant, solo mode (neutral player, generation limit). ✓ Maps from Hellas & Elysium, Utopia & Cimmeria and Amazonis & Vastitas; custom and balanced-random milestones and awards; end-of-game analytics.
- **M3** Animations, rules help, better phone layout for the hand.
- **M4** ✓ Online rooms on Supabase with server-side move validation and private hands; CPUs can fill empty seats. Next: chat, turn notifications, rematch.
- **M5** Prelude and other expansions; stronger Hard CPU via deeper search.

# Fathom

Fathom plays like Finspan: 1–5 players, hotseat or online, with Easy, Normal and Hard CPUs. Species are real fish; every number, ability, goal and picture is Fathom's own (art is drawn in code), and nothing from the published game is used.

**Rules.** Four tides, six divers each. A turn places one diver to either **release a fish** (pay its cost: discard cards, spend eggs or fry, or eat a smaller fish; put it in a zone and site its card allows; resolve its *Released* ability) or **dive** one of three sites (Kelp, Reef, Open Blue). A dive runs top to bottom: each zone of that site with a fish pays the zone's bonus, every fish passed gives its *Dived* ability, and the first dive to reach the bottom of a site each tide takes its bottom bonus. Eggs (one per fish) hatch into fry; three fry in a slot make a school worth 6. Tides 1–3 end with a goal (classic: Brood, Full rows, Schools; or three drawn from nine, with +3 to each tide's leader). Final score: fish points, 1 per eaten fish, egg and fry, 6 per school, *Game end* abilities and goals; ties go to the most cards in hand. Hands are open, so several humans can share a device.

**Online.** Fathom's menu has the same **Host online** button and **Play online** panel as Regolith (join by code or `/fathom?join=CODE`, sign in with Google or play as a guest, turn alerts). The host sets seats and Classic or Variable goals in the lobby, can hand a seat to a CPU mid-game, and anyone can forfeit. Hands are open in Fathom, so the server only hides the deck order and the seed. Rooms live in their own `fathom` schema (`supabase/migrations/20261104120000_fathom_online.sql`) with the same functions as Regolith's; seat checks are shared with Regolith, game codes are unique across both games, and the app badge counts both. Moves go to the `fathom-play` Edge Function (`server/fathom-edge.ts` around `src/fathom/online/referee.ts`), which reuses Regolith's push devices. Try it without Supabase at `http://localhost:5173/fathom#online-sim` (two humans and a CPU in one tab).

Setting it up (once):
1. Apply `20261104120000_fathom_online.sql` to the Breakthrough Music dev project (after the Regolith migrations).
2. **Settings → Data API → Exposed schemas:** add `fathom`.
3. Deploy the Edge Function: `npm run deploy:edge` now deploys both `regolith-play` and `fathom-play`, and the GitHub workflow does the same on every push to `main` that touches either engine or referee.

**Code.** `src/fathom/engine/` is pure TypeScript: `types.ts`, `cards.ts` (94 fish), `game.ts` (createGame/applyAction, scoring, goals, forfeit), `cpu.ts`, `text.ts` (card wording). `src/fathom/ui/` has the menu and game screen, the ocean grid, cards and the fish illustrations.

**CPUs** try every action on a copy of the game, answer their own follow-up choices the same way, and score the result: points now, plus what each site would yield on the dives still to come, plus the best few cards in hand, fry one short of a school and progress on the tide goals. Easy is noisy and sometimes random; Hard also looks one of its own turns ahead and watches the leader. In 16 two-player games Hard beat Normal 11–5 (148.8 vs 135.0 average); a decision takes about 15 ms.

Tests: `tests/fathom.test.ts` (rules, random full games, CPU games, forfeit), `tests/fathom-online.test.ts` (the referee: whole games from players' views, privacy, seats, forfeit, notices), the Fathom section of `tests/sql.test.ts`, `node scripts/fathom-edge-smoke.mjs` (the built bundle) and `node scripts/fathom-online-sim-check.mjs` (the online screens in a browser, against the dev server). `npx tsx scripts/fathom-sim.ts easy,normal,hard 10 [variable]` plays CPU games; `node scripts/hub-check.mjs http://localhost:4173 <outdir>` clicks through the hub, a Fathom game, next game and forfeit in a browser.
