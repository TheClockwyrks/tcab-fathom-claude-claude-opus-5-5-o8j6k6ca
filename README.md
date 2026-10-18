# Fathom

A bioluminescent deep-sea maze chase that runs entirely in the browser. This
build is the **Kindle** dive: you see the maze only through a circular window
around the forager that grows as you eat, and beyond it even explored ground
goes dark.

You are a small glowing forager in a pitch-dark trench. Graze every plankton
mote to clear the maze and descend to a deeper one, while three predators hunt
you by different senses:

- **Lanternjaw** hunts your light. Its amber bulb looks just like the harmless
  bonus drifter's.
- **Gloamfin** is eyeless and hunts by sound: close hearing, your sonar, and
  pings of its own.
- **Flarefish** is invisible until it flares; the flare lights everything around
  it and locks on to you if you are inside it.

Eating brightens you, widening your light and your vision circle, but it also
lets the light-hunters see you from further away. A sonar pulse maps the
corridors around you and marks the Gloamfin and Flarefish, and an ink cloud
blinds the hunters that see.

## Controls

| Key                     | Action                                   |
| ----------------------- | ---------------------------------------- |
| Arrow keys / WASD       | Swim; move the menu selection            |
| Space                   | Sonar pulse (in play); confirm (menus)   |
| Shift                   | Release ink                              |
| Enter                   | Confirm a menu item                      |
| Esc                     | Pause and resume; back out of a menu     |
| P                       | Pause and resume                         |
| M                       | Mute / unmute                            |
| Backquote (`` ` ``)     | Toggle the debug overlay                 |

Menus also take the mouse and touch, and a touchscreen gets an on-screen pad.

## Install

Requires Node.js 20 or later.

```sh
npm ci
```

## Run in development

```sh
npm run dev
```

Then open the URL Vite prints (by default <http://localhost:5173/>).

## Production build

```sh
npm run build
```

This type-checks and emits a self-contained static site into `dist/`, with
`index.html` at its root. Every URL it requests is relative to the page, so the
directory can be served as-is from the root of any static host or from a
sub-path. `npm run preview` serves the built site locally.

## Checks

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
npm run format      # Prettier, check mode
npm test            # Vitest, with coverage over src/
```

## How the code is laid out

The game runs on the Simple 2D engine (documented under `engine/`), which owns
the frame loop, input, audio, asset loading and the debug overlay. The game is
in `src/`:

| File            | What it holds                                                    |
| --------------- | ---------------------------------------------------------------- |
| `game.ts`       | The state and debug-surface types, and the `game` itself         |
| `frame.ts`      | Per-frame input, screens, menus, and the fixed-step tick loop    |
| `sim.ts`        | One 1/120 s simulation tick                                      |
| `predators.ts`  | The three hunters' senses, states and routing                    |
| `sensing.ts`    | The forager's light, sonar and flare reveals, and the fog of war |
| `motion.ts`     | Continuous travel along corridor center lines                    |
| `maze.ts`       | The maze generator and the checker for every layout rule         |
| `world.ts`      | Building dives, attempts, rosters, and derived readings          |
| `render.ts`     | All drawing                                                      |
| `debug.ts`      | The debug and automation surface, snapshot, and diagnostics      |

The specification lives in `specs/`, and `showcase/` holds the store-page
description and captured media.
