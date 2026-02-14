# Photon Breaker

A calm, minimalistic physics-based block breaker game. Launch photons to break blocks, collect power-ups, and progress through infinite levels.

## How to Play

Open `index.html` in any browser. No build tools or dependencies required.

- **Mouse:** Move to aim, click to fire
- **Touch:** Hold and drag to aim, release to fire

## Power-Ups

| Icon | Name | Type | Effect |
|------|------|------|--------|
| +1 | +1 Ball | Permanent | Extra photon each round |
| POW | Power | Permanent | +1 damage to all photons |
| FAST | Speed | Permanent | +10% photon speed |
| EYE | Hint | Permanent | +1 trajectory preview bounce |
| ZAP | Laser | One-shot | Instant red beam that destroys all blocks in its path |
| FIRE | Flame | One-shot | +1 burn damage on hit |
| BIG | Big Ball | One-shot | Larger photon radius |
| >> | Pierce | One-shot | Photons pass through blocks |

## Tech

- Plain HTML/CSS/JS, no frameworks or libraries
- Canvas 2D rendering at 360x640 virtual resolution
- Web Audio API for sound (no audio files)
- Works on desktop and mobile browsers
