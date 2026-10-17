# Regolith

A pass-and-play (hotseat) implementation of the Terraforming Mars base game plus Corporate Era, for 2–5 players at one device, with CPU opponents at three difficulty levels. Mix humans and CPUs freely.

It runs entirely in the browser as a static site, so it deploys to Netlify or Vercel with no server.

This is a private, non-commercial project for playing with friends. Game rules can be implemented freely, but the Terraforming Mars name, artwork and card text belong to their publisher (FryxGames), so the app uses its own name, its own visual design and its own effect wording. Keep deployments access-restricted and don't add the publisher's art or branding.

## Run it

```bash
npm install
npm run dev          # local dev server
npm test             # rules tests, 160+ simulated full games, CPU games, synergy checks
npm run build        # static site in dist/
npm run build:single # one self-contained dist-single/index.html
```

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

Without the two variables above, Regolith is local-only: games autosave in the browser. With them, the menu shows **Cloud saves**: sign in with an emailed link, and every game you play while signed in syncs to Supabase a couple of seconds after each move, so you can pick it up on another device.

- Data lives in the `regolith` schema of the Breakthrough Music dev project (free plan, no separate project). Migrations are in `supabase/migrations/`.
- The `regolith.saves` table can't be read or written directly. The app goes through four functions (`list_saves`, `get_save`, `put_save`, `delete_save`), each limited to the signed-in user's own saves.
- One-time Supabase settings (dashboard):
  1. **Settings → Data API → Exposed schemas:** add `regolith`.
  2. **Authentication → URL Configuration:** set Site URL to your Vercel URL and add it (plus `http://localhost:5173`) under Redirect URLs, so sign-in links come back to Regolith.
  3. Optional: **Authentication → Emails → Magic Link** template, add `{{ .Token }}` if you'd like a 6-digit code in the email too; the app accepts either.
- Supabase's built-in email sender only delivers to your organization's own team members and is rate-limited. To let friends sign in, set up custom SMTP under Authentication → Emails.

For local development, `.env.development.local` holds the same two variables (`.env.example` shows the format).

## How it's built

```
src/engine/       Pure TypeScript rules engine (no DOM, no network)
  types.ts        Game state, actions, effect ops, prompts
  board.ts        The 61-hex map, placement bonuses, Ganymede/Phobos spaces
  cards.ts        All 208 project cards and 12 corporations as data + effect functions
  game.ts         createGame + applyAction: every rule is enforced here
  queries.ts      Requirements, costs, payment, legal placements, milestones, awards, scoring
  moves.ts        Legal-move enumeration
  bot.ts          Random-move agent used to fuzz whole games in tests
  ai/value.ts     Engine-aware valuation (production, TR, VP, tags, discounts, triggers)
  ai/cpu.ts       CPU players: simulate each move, evaluate the result, pick the best
src/ui/           React UI: SVG map, gauges, player boards, hand, dialogs, cloud-save panel
src/cloud.ts      Supabase client: sign-in, save, list, load, delete (no-op when unconfigured)
supabase/         Database migrations for cloud saves
tests/            Vitest suites
```

The engine is a reducer: `applyAction(state, action) -> state`. Card effects compile to a queue of small ops (gain, raise temperature, place tile, add a microbe…); any op that needs a decision opens a prompt that the next action answers. Randomness comes from a seeded generator stored in the state, so any game replays exactly from its seed and action list. The same engine can later run server-side for online play (a Supabase Edge Function, say) without changes.

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

Difficulty changes the weights:

| | Easy | Normal | Hard |
|---|---|---|---|
| Tag synergies | No | Yes | Yes |
| Weighs opponents' gains | No | A little | Strongly (targets the leader, award denial) |
| Judgement noise | High, some random moves | Low | None |
| Tempo (push to end when ahead) | No | No | Yes |
| Looks ahead to its second action | No | No | Yes |
| Samples per card-draw outcome | 1 | 1 | 3 |

In 80 seat-rotated 3-player games (Easy vs Normal vs Hard, ties count for each), Hard won 46, Normal 27 and Easy 7, averaging 85, 81 and 72 VP. CPU games run about 12–14 generations. Re-run with `npx tsx scripts/batch.ts easy,normal,hard 1 20`, or try a different Hard setting with `HARD='{"samples":2}' npx tsx scripts/tune.ts 1 20`.

## Rules implemented

- Tharsis map with placement bonuses, ocean areas, Noctis City, volcanoes, Ganymede and Phobos off-world cities.
- Generation flow: corporation and starting-card choice, research (4 cards, 3 M€ each), 1–2 actions per turn until everyone passes, production (energy becomes heat; M€ = TR + production).
- Global parameters with their bonuses (heat production at −24 and −20 °C, an ocean at 0 °C, a temperature step at 8 % oxygen), TR for every step.
- Tile rules: ocean adjacency pays 2 M€, greeneries go next to your tiles when possible, cities can't touch cities, special tiles and their placement rules.
- Standard projects, plant and heat conversion, milestones (3 max) and awards (3 max, 8/14/20 M€; no second place with two players).
- Steel, titanium and Helion heat as payment; Advanced Alloys and PhoboLog values; card discounts; requirement bonuses (Inventrix, Adaptation Technology, Special Design); Indentured Workers.
- All 208 project cards and all 12 corporations, including every action, trigger and protection (Pets, Protected Habitats).
- Final greenery round, scoring with tiebreak on M€.
- Corporate Era can be turned off (base cards only, everyone starts with 1 of each production).

### Simplifications in this version

- No drafting variant, solo mode or other boards yet.
- Helion's heat can pay for cards, standard projects, milestones and awards, but not for blue-card action costs.
- When several of your own effects trigger at once, they resolve in a fixed order rather than one you choose.

## Roadmap

- **M2** Draft variant, solo mode (neutral player, generation limit), Hellas and Elysium maps.
- **M3** Animations, rules help, better phone layout for the hand.
- **M4** Online rooms on Supabase (building on the cloud-save tables) with server-side move validation and private hands; CPUs can fill empty seats.
- **M5** Prelude and other expansions; stronger Hard CPU via deeper search.
