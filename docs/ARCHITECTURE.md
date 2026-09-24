# Architecture

```
src/
  data/map.js         territories, continents, adjacency (index-based lookups)
  game/               pure JS, no DOM. Runs in Node for tests and sims
    game.js           rules engine: state, legal actions, events
    dice.js           dice resolution + exact battle odds (memoised Markov chain)
    ai.js             AI levels; nextAction(game) returns ONE action at a time
    advisor.js        forecast, tips, suggest, per-turn debrief, end-game lessons
    rng.js            seeded PRNG (games and tests are reproducible)
  render/             three.js
    hexmap.js         procedural hex world (pure data, testable)
    board.js          ocean shader, instanced hex tiles, tokens, highlights, ripples
    fx.js             pooled particles, rings, projectiles, flashes, shake, hit-stop
    stage.js          renderer, camera/controls, bloom, frame loop helpers
  ui/
    hud.js            DOM chrome; renders what the controller gives it
    labels.js         army counts + popups pinned to 3D positions
  controller.js       glue: input -> game, game events -> animation queue, AI loop
  audio.js            WebAudio synth: all SFX + ambient music
  main.js             menu, match setup, frame loop
scripts/sim.js        headless AI-vs-AI simulator (also used by tests)
test/                 node --test suites
```

## The one rule: the model resolves, the view catches up

1. Input (a human click or `ai.nextAction`) calls a `Game` method. The method validates the action, mutates state **immediately**, and `emit`s events such as `place`, `battle`, `conquer`, `continent`, `eliminate`, `move`, `trade`, `card`, `turn`, `phase`, `endTurn` and `gameover`.
2. `Controller.onEvent` captures a **snapshot** of owners and armies with each event and pushes it onto a queue.
3. `Controller.play` animates the queue in order. The board only shows a territory's new owner or armies when that event plays, so numbers never jump ahead of the explosions.
4. Human input is never blocked by animation. A long queue (for example a blitz) speeds itself up.
5. AI turns loop `nextAction → applyAction → await drain()`, so the AI waits for the view but the rules never do.

Never drive game state from an animation callback. Never make the model wait on the view.

## Adding things

- **A new rule or option**: put it in `game.js`, emit an event if players need to *see* it, handle that event in `Controller.animate`, and add a test. Every emitted event must have a visible effect.
- **A new AI behaviour**: edit `ai.js`, then run `npm run sim -- 400`. The ladder must stay monotonic. `test/rules.test.js` enforces it with fixed seeds.
- **A new effect**: use the pools in `fx.js`. Don't allocate meshes per event. Keep shake at or below 0.9 world units and hit-stop at or below 110 ms, and respect `fx.reduced` (prefers-reduced-motion).
- **A new map**: `data/map.js` holds territories with `seeds` on a 100×60 board. `hexmap.js` grows land from the seeds. It floods tiles where non-adjacent territories would touch and draws sea lanes for adjacencies across water, so the map always agrees with the rules.

## Debugging

`window.__conquest = { game, controller, board, stage }` is exposed in the browser.
Headless browser checks work with Playwright + SwiftShader (`--use-angle=swiftshader`). Expect about 4 fps there, so wait on game state, not on time.

## Roadmap (highest felt value first)

1. **Online multiplayer**: the engine is already deterministic and action-based. Send actions, not state; seed the RNG from the server. Rooms plus a lobby.
2. **Save/resume**: serialise `Game` (it's plain data plus the RNG state). Autosave each turn to localStorage.
3. **Richer 3D armies**: replace disc stacks with instanced soldier, cavalry and cannon models (GLTF made in Blender, or procedural). Add troop-march animation along paths when fortifying.
4. **Threat overlay** (a key toggle): colour your borders by enemy pressure. `Board.setTint` already exists.
5. **Tutorial campaign**: scripted scenarios such as "Hold Australia" or "Break the bonus", using the advisor text.
6. **Game options**: secret missions, capitals mode, fixed vs escalating card values, neutral armies in 2-player games, fog of war.
7. **Stats screen**: territory-over-time chart from `game.history`, battle log, and a replay using the seeded RNG.
8. **AI personalities**: aggressive, turtle and opportunist variants on top of the levels. Monte-Carlo lookahead for Warlord.
9. **Performance on low-end mobile**: a quality toggle (shadows off, bloom off, DPR 1).
10. **Accessibility**: colour-blind palette plus patterns on tiles, a full keyboard territory cursor, screen-reader announcements for battle results.
