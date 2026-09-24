# Conquest 3D

A 3D, browser-based game of world domination, inspired by the classic board game *Risk*.
Built with three.js and Vite. No other runtime dependencies, and every model and sound is generated in code.

**Goal of the project:** the best 3D Risk-style game on the web: smooth, readable, satisfying on every move, and a game that teaches you to play better.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (deploy anywhere)
npm test           # rules, odds, AI games, difficulty ladder
npm run sim        # AI-vs-AI balance report (npm run sim -- 400)
```

## What's in it

- **Classic rules**: 42 territories, 6 continents, reinforcements (territories ÷ 3 plus continent bonuses), 3-vs-2 dice, blitz attacks, occupation, fortify, card sets with escalating trade-ins, eliminations that transfer cards.
- **2 to 4 players**, any mix of hot-seat humans and AI.
- **4 AI levels**: Recruit, Soldier, General, Warlord. A test checks that each level beats the one below it.
- **Two modes**: World Domination (all 42 territories) and Quick Conquest (28 territories).
- **Learning tools**:
  - live battle forecast (exact win %, expected losses) before every attack
  - an advisor with situational tips
  - "Suggest a move" (the Warlord AI's choice, explained)
  - a graded debrief after each turn
  - dice-luck and efficiency lessons at the end
- **Game feel**:
  - projectile volleys and particle explosions
  - conquest ripples that flip a territory tile by tile
  - hit-stop, screen shake, camera punch and bloom on big moments
  - a pitch ladder on conquest streaks
  - continent fanfares
  - fully synthesized audio and music

Controls: drag to pan, scroll/pinch to zoom, right-drag to tilt. `Space` next step · `B` blitz · `R` single roll · `H` hint · `1`/`5`/`A` placement amount · `Esc` cancel.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together and the roadmap.
