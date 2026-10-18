// One fixed TICK_DT step of the simulation, on whichever screen is showing
// (specs/ui.md, "What advances on each screen"). Every function here mutates the
// draft it is handed; frame.ts makes that draft from the read-only state.

import {
  BRIGHT_HALFLIFE,
  BRIGHT_HOLD,
  BRIGHT_PER_EAT,
  CUES,
  DRIFTER_INTERVAL,
  DRIFTER_MAX,
  DRIFTER_SPEED,
  FORAGER_SPEED,
  INK_COOLDOWN,
  INK_LIFE,
  INK_RADIUS,
  SCORE_CLEAR,
  SCORE_DRIFTER,
  SCORE_PLANKTON,
  SONAR_COOLDOWN,
  SONAR_MARK_TIME,
  SONAR_WAVE_SPEED,
  TICK_DT,
  type CueName,
} from "./constants";
import type { Dir, FathomState } from "./game";
import {
  CORRIDOR,
  ROCK,
  distances,
  index,
  setChar,
  tileAt,
  tileOfX,
  tileOfY,
  tunnelRow,
} from "./grid";
import { travel, type Route, opens } from "./motion";
import { acquire, stepPredator, wanderRoute } from "./predators";
import type { Rng } from "./rng";
import { inPlay, sense } from "./sensing";
import {
  clearMaze,
  countPlankton,
  derive,
  descend,
  gameOver,
  gateTile,
  makeDrifter,
  retryMaze,
  sonarRange,
  goTo,
} from "./world";

const EPS = 1e-9;

/** What one tick hands back: the cues it raised, each at most once. */
export interface TickContext {
  readonly rng: Rng;
  /** The movement actions held this frame. */
  readonly held: readonly Dir[];
  readonly cues: Set<CueName>;
}

// ---- The forager's actions -------------------------------------------------------

/** Emits a sonar pulse from the forager's tile when the cooldown allows. */
export function emitSonar(w: FathomState, cues: Set<CueName>): void {
  if (w.sonar.cooldown > 0) return;
  const { tx, ty } = w.forager;
  w.pulses.push({
    source: "forager",
    tint: "cyan",
    ox: tx,
    oy: ty,
    front: 0,
    range: sonarRange(w.depth),
    dist: Array.from(distances(w.tiles, [{ tx, ty }], (ch) => ch !== ROCK)),
    owner: null,
    caught: false,
    reached: [],
  });
  w.sonar.cooldown = SONAR_COOLDOWN;
  w.sonar.ready = false;
  cues.add(CUES.sonar);
}

/** Releases an ink cloud on the forager when the cooldown allows. */
export function releaseInk(w: FathomState, cues: Set<CueName>): void {
  if (w.ink.cooldown > 0) return;
  w.inkClouds.push({
    x: w.forager.x,
    y: w.forager.y,
    radius: INK_RADIUS,
    remaining: INK_LIFE,
  });
  w.ink.cooldown = INK_COOLDOWN;
  w.ink.ready = false;
  cues.add(CUES.ink);
}

// ---- Steps ---------------------------------------------------------------------

function stepTimers(w: FathomState, dt: number): void {
  w.sonar.cooldown = Math.max(0, w.sonar.cooldown - dt);
  if (w.sonar.cooldown < EPS) w.sonar.cooldown = 0;
  w.ink.cooldown = Math.max(0, w.ink.cooldown - dt);
  if (w.ink.cooldown < EPS) w.ink.cooldown = 0;
  if (w.brightHold > 0) {
    w.brightHold = Math.max(0, w.brightHold - dt);
    if (w.brightHold < EPS) w.brightHold = 0;
  } else {
    w.brightness *= Math.pow(0.5, dt / BRIGHT_HALFLIFE);
  }
  w.inkClouds = w.inkClouds
    .map((c) => ({ ...c, remaining: Math.max(0, c.remaining - dt) }))
    .filter((c) => c.remaining > EPS);
}

function foragerRoute(w: FathomState): Route {
  const desired = w.forager.desired;
  const route: Route = {
    tunnel: tunnelRow(w.tiles),
    canEnter: (tx, ty) => tileAt(w.tiles, tx, ty) === CORRIDOR,
    choose: (tx, ty, dir) => {
      if (desired !== null && opens(route, tx, ty, desired)) return desired;
      return opens(route, tx, ty, dir) ? dir : null;
    },
  };
  return route;
}

const REVERSE: Readonly<Record<Dir, Dir>> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

function stepForager(w: FathomState, held: readonly Dir[], dt: number): void {
  const f = w.forager;
  if (held.length === 0) {
    f.moving = false;
    return;
  }
  // A key held since before live play began sets the way without an edge.
  if (f.desired === null) f.desired = held[0];
  if (f.desired === REVERSE[f.dir]) f.dir = f.desired;
  const moved = travel(f, FORAGER_SPEED * dt, foragerRoute(w));
  f.x = moved.x;
  f.y = moved.y;
  f.dir = moved.dir;
  f.moving = moved.moving;
  f.tx = tileOfX(f.x);
  f.ty = tileOfY(f.y);
}

/** Eats the plankton on the forager's tile. Returns whether that cleared the maze. */
function graze(w: FathomState, cues: Set<CueName>): boolean {
  const { tx, ty } = w.forager;
  if (w.plankton[ty][tx] !== "*") return false;
  w.plankton = setChar(w.plankton, tx, ty, "-");
  w.planktonRemaining = countPlankton(w.plankton);
  w.score += SCORE_PLANKTON;
  w.brightness = Math.min(1, w.brightness + BRIGHT_PER_EAT);
  w.brightHold = BRIGHT_HOLD;
  cues.add(CUES.eat);
  if (w.planktonRemaining > 0) return false;
  w.score += SCORE_CLEAR;
  cues.add(CUES.descend);
  return true;
}

function stepDrifters(w: FathomState, ctx: TickContext, dt: number): void {
  w.drifterIn = Math.max(0, w.drifterIn - dt);
  if (w.drifterIn <= EPS) {
    const gate = gateTile(w.tiles);
    if (w.planktonRemaining > 0 && w.drifters.length < DRIFTER_MAX && gate) {
      w.drifters.push(makeDrifter(gate));
    }
    w.drifterIn = DRIFTER_INTERVAL;
  }
  for (const d of w.drifters) {
    if (!d.mind || !d.travel) continue;
    const moved = travel(d, DRIFTER_SPEED * dt, wanderRoute(w, ctx.rng, true));
    d.x = moved.x;
    d.y = moved.y;
    d.dir = moved.dir;
    d.tx = tileOfX(d.x);
    d.ty = tileOfY(d.y);
  }
  const { tx, ty } = w.forager;
  const eaten = w.drifters.filter((d) => d.tx === tx && d.ty === ty);
  if (eaten.length > 0) {
    w.score += SCORE_DRIFTER * eaten.length;
    w.drifters = w.drifters.filter((d) => !eaten.includes(d));
  }
}

/** Whether a front at `front` has just reached a tile at path distance `d`. */
function arriving(d: number, front: number): boolean {
  return d >= 0 && d <= front + EPS && d >= front - 1;
}

function stepPulses(w: FathomState, dt: number): void {
  const f = w.forager;
  for (const pulse of w.pulses) {
    pulse.front += SONAR_WAVE_SPEED * dt;
    const front = Math.min(pulse.front, pulse.range);
    if (pulse.source === "forager") {
      w.predators.forEach((p, i) => {
        if (p.kind === "lanternjaw" || p.state === "den" || !inPlay(w, p))
          return;
        if (pulse.reached.includes(i)) return;
        if (!arriving(pulse.dist[index(p.tx, p.ty)], front)) return;
        pulse.reached = [...pulse.reached, i];
        p.markLeft = SONAR_MARK_TIME;
        if (p.kind === "gloamfin" && p.mind) {
          acquire(w, p, { tx: f.tx, ty: f.ty });
        }
      });
    } else if (
      !pulse.caught &&
      arriving(pulse.dist[index(f.tx, f.ty)], front)
    ) {
      pulse.caught = true;
      const owner = pulse.owner === null ? undefined : w.predators[pulse.owner];
      if (
        owner &&
        owner.kind === "gloamfin" &&
        owner.mind &&
        owner.state !== "den"
      ) {
        acquire(w, owner, { tx: f.tx, ty: f.ty });
      }
    }
  }
  w.pulses = w.pulses.filter((p) => p.front <= p.range + EPS);
}

/** Whether a predator's center lies on the forager's tile. */
function contact(w: FathomState): boolean {
  const { tx, ty } = w.forager;
  return w.predators.some((p) => p.tx === tx && p.ty === ty && inPlay(w, p));
}

function stepPlaying(w: FathomState, ctx: TickContext, dt: number): void {
  stepTimers(w, dt);
  derive(w);
  stepForager(w, ctx.held, dt);
  if (graze(w, ctx.cues)) {
    clearMaze(w);
    derive(w);
    sense(w);
    return;
  }
  derive(w);
  stepDrifters(w, ctx, dt);
  stepPulses(w, dt);
  for (let i = 0; i < w.predators.length; i++) {
    stepPredator(w, i, ctx.rng, { cues: ctx.cues }, dt);
  }
  w.playTime += dt;
  if (contact(w)) {
    ctx.cues.add(CUES.caught);
    if (w.lives > 0) retryMaze(w);
    else gameOver(w);
  }
  derive(w);
  sense(w);
}

/** One tick of whichever screen is showing. Mutates the draft. */
export function tick(w: FathomState, ctx: TickContext): void {
  const dt = TICK_DT;
  w.simTime += dt;
  switch (w.screen) {
    case "countdown":
      w.screenTimer = Math.max(0, w.screenTimer - dt);
      if (w.screenTimer <= EPS) {
        goTo(w, "playing");
        w.playTime = 0;
      }
      derive(w);
      sense(w);
      return;
    case "cleared":
      w.screenTimer = Math.max(0, w.screenTimer - dt);
      if (w.screenTimer <= EPS) {
        descend(w, ctx.rng);
        derive(w);
      }
      return;
    case "playing":
      stepPlaying(w, ctx, dt);
      return;
    default:
      return;
  }
}
