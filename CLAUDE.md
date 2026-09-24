# CLAUDE.md

Conquest 3D is a browser-based 3D Risk-style strategy game (three.js + Vite, plain ES modules, no framework).
Goal: the best 3D Risk game on the web: smooth, satisfying on every move, and a game that teaches you strategy.

## Commands
- `npm run dev`: dev server
- `npm test`: rules, odds, full AI games, difficulty-ladder check (must pass before committing)
- `npm run sim -- 400`: AI-vs-AI win rates per level (run after any change to `src/game/ai.js`)
- `npm run build`: production build

## Architecture (read docs/ARCHITECTURE.md first)
- `src/game/*` is the pure rules engine. It must stay free of DOM and three.js so it runs in Node.
- The model resolves actions instantly and emits events. `src/controller.js` queues the events with board snapshots and animates them. Never make game logic wait on animation.
- Every event the engine emits needs a visible (and ideally audible) effect in `Controller.animate`.
- Effects come from pools in `src/render/fx.js`. Don't allocate meshes per event.
- The HUD (`src/ui/hud.js`) renders what the controller gives it and holds no game logic.

## Conventions
- 2-space indent, semicolons, single quotes, small focused modules.
- Territories and players are referred to by integer index everywhere in the engine.
- Keep the difficulty ladder monotonic: Recruit < Soldier < General < Warlord.
- Respect `prefers-reduced-motion` (`fx.reduced`) and keep the play field clear of chrome on mobile.
