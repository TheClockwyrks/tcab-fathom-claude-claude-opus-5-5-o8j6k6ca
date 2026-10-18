// Building the state: a fresh maze, a dive, an attempt at a maze, a roster, and
// the readings derived from the world as it stands.

import type { DeepReadonly } from "ts-essentials";
import {
  DEN_ORDER,
  DEN_RELEASE_GAP,
  DRIFTER_INTERVAL,
  DRIFTER_SPEED,
  FLARE_INTERVAL,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_HEAR,
  GLOAMFIN_PING_INTERVAL,
  GLOAMFIN_PING_MIN_GAP,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  KINDLE_VISION_GAIN,
  KINDLE_VISION_MIN,
  LANTERN_RANGE_BASE,
  LANTERN_RANGE_GAIN,
  PREDATOR_SPEED,
  ROSTER_ADD_ORDER,
  ROSTER_CAP,
  SONAR_RANGE_BASE,
  SONAR_RANGE_MIN,
  START_LIVES,
  TILE,
  VISION_GAIN,
  VISION_MIN,
  type PredatorKind,
} from "./constants";
import type {
  Art,
  Drifter,
  FathomState,
  Predator,
  PredatorState,
  Screen,
  TilePos,
} from "./game";
import {
  CORRIDOR,
  DEN,
  GATE,
  centerX,
  centerY,
  filledRows,
  tileOfX,
  tileOfY,
} from "./grid";
import { generateMaze } from "./maze";
import { Rng } from "./rng";

/** How long the dive countdown and the cleared interstitial hold. */
export const COUNTDOWN_TIME = 2;
export const CLEARED_TIME = 2;

/** The den tiles predators are laid out on, in slot order. */
const DEN_SLOTS: readonly TilePos[] = [
  { tx: 17, ty: 8 },
  { tx: 18, ty: 8 },
  { tx: 16, ty: 8 },
  { tx: 19, ty: 8 },
  { tx: 17, ty: 9 },
  { tx: 18, ty: 9 },
  { tx: 16, ty: 9 },
  { tx: 19, ty: 9 },
  { tx: 17, ty: 7 },
  { tx: 18, ty: 7 },
  { tx: 16, ty: 7 },
  { tx: 19, ty: 7 },
];

// ---- Copying ----------------------------------------------------------------

/**
 * A fresh, writable copy of the state. Every object a frame or a pose may change
 * is copied; strings and the pulses' distance tables are immutable and shared.
 */
export function draft(s: DeepReadonly<FathomState>): FathomState {
  return {
    ...s,
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    grid: { ...s.grid },
    tiles: s.tiles.slice(),
    plankton: s.plankton.slice(),
    visibility: s.visibility.slice(),
    forager: { ...s.forager },
    drifters: s.drifters.map((d) => ({ ...d })),
    predators: s.predators.map((p) => ({
      ...p,
      fix: p.fix === null ? null : { ...p.fix },
    })),
    pulses: s.pulses.map((p) => ({ ...p, reached: p.reached.slice() })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    start: { ...s.start },
    press: s.press === null ? null : { ...s.press },
    art: s.art as Art | null,
  };
}

// ---- Derived readings -----------------------------------------------------------

export function visionRadius(g: number): number {
  return VISION_MIN + VISION_GAIN * g;
}

export function windowRadius(g: number): number {
  return KINDLE_VISION_MIN + KINDLE_VISION_GAIN * g;
}

export function lightRange(g: number): number {
  return LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * g;
}

export function sonarRange(depth: number): number {
  return Math.max(SONAR_RANGE_MIN, SONAR_RANGE_BASE - (depth - 1));
}

export function speedFor(p: {
  readonly kind: PredatorKind;
  readonly state: PredatorState;
  readonly chaseSpeed: number;
}): number {
  switch (p.kind) {
    case "lanternjaw":
      return p.state === "chase" ? PREDATOR_SPEED : DRIFTER_SPEED;
    case "gloamfin":
      return p.state === "chase" ? p.chaseSpeed : PREDATOR_SPEED;
    case "flarefish":
      return PREDATOR_SPEED;
  }
}

/**
 * Rewrites every stored reading that is a function of the world as it stands:
 * tiles from centers, radii from brightness, range from depth, readiness from
 * cooldowns, the plankton count, and each predator's speed and ranges. Mutates
 * and returns the draft it is handed.
 */
export function derive(w: FathomState): FathomState {
  w.forager.tx = tileOfX(w.forager.x);
  w.forager.ty = tileOfY(w.forager.y);
  for (const d of w.drifters) {
    d.tx = tileOfX(d.x);
    d.ty = tileOfY(d.y);
  }
  const range = lightRange(w.brightness);
  for (const p of w.predators) {
    p.tx = tileOfX(p.x);
    p.ty = tileOfY(p.y);
    p.speed = speedFor(p);
    p.detectRange = p.kind === "gloamfin" ? null : range;
    p.hearingRange = p.kind === "gloamfin" ? GLOAMFIN_HEAR : null;
  }
  w.visionRadius = visionRadius(w.brightness);
  w.windowRadius = windowRadius(w.brightness);
  w.sonar.range = sonarRange(w.depth);
  w.sonar.ready = w.sonar.cooldown === 0;
  w.ink.ready = w.ink.cooldown === 0;
  w.planktonRemaining = countPlankton(w.plankton);
  return w;
}

export function countPlankton(rows: readonly string[]): number {
  let n = 0;
  for (const row of rows) for (const ch of row) if (ch === "*") n++;
  return n;
}

// ---- Bodies ---------------------------------------------------------------------

export function makePredator(
  kind: PredatorKind,
  tile: TilePos,
  state: PredatorState,
  releaseAt: number | null,
): Predator {
  const p: Predator = {
    kind,
    x: centerX(tile.tx),
    y: centerY(tile.ty),
    tx: tile.tx,
    ty: tile.ty,
    dir: "up",
    state,
    released: state !== "den",
    mind: true,
    travel: true,
    speed: 0,
    alert: false,
    lit: false,
    detectRange: kind === "gloamfin" ? null : lightRange(0),
    hearingRange: kind === "gloamfin" ? GLOAMFIN_HEAR : null,
    hearingLock: kind === "gloamfin" ? false : null,
    flareCharging: kind === "flarefish" ? false : null,
    flaring: kind === "flarefish" ? false : null,
    flareRadius: kind === "flarefish" ? 0 : null,
    releaseAt,
    fix: null,
    linger: null,
    alertLeft: 0,
    markLeft: 0,
    chaseSpeed: GLOAMFIN_CHASE_SPEED,
    pingTimer: GLOAMFIN_PING_INTERVAL,
    sincePing: GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPinged: false,
    flareTimer: FLARE_INTERVAL,
    flarePhase: "idle",
    flareLeft: 0,
    fadeLeft: 0,
  };
  p.speed = speedFor(p);
  return p;
}

export function makeDrifter(tile: TilePos): Drifter {
  return {
    x: centerX(tile.tx),
    y: centerY(tile.ty),
    tx: tile.tx,
    ty: tile.ty,
    lit: false,
    mind: true,
    travel: true,
    dir: "up",
  };
}

/** The kinds a depth's roster holds, in release order. */
export function rosterKinds(depth: number): PredatorKind[] {
  const kinds = [...DEN_ORDER];
  const extra = Math.min(
    Math.max(0, depth - 1),
    ROSTER_CAP * DEN_ORDER.length - DEN_ORDER.length,
  );
  for (let i = 0; i < extra; i++) {
    kinds.push(ROSTER_ADD_ORDER[i % ROSTER_ADD_ORDER.length]);
  }
  return kinds;
}

/** The den tiles of a layout, in slot order. */
function denSlots(tiles: readonly string[]): TilePos[] {
  const slots = DEN_SLOTS.filter((t) => tiles[t.ty][t.tx] === DEN);
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (
        tiles[ty][tx] === DEN &&
        !slots.some((t) => t.tx === tx && t.ty === ty)
      ) {
        slots.push({ tx, ty });
      }
    }
  }
  return slots.length > 0 ? slots : DEN_SLOTS.slice();
}

/** The roster a depth gives, laid out in the den, every slot unreleased. */
export function makeRoster(
  tiles: readonly string[],
  depth: number,
): Predator[] {
  const slots = denSlots(tiles);
  return rosterKinds(depth).map((kind, i) =>
    makePredator(kind, slots[i % slots.length], "den", i * DEN_RELEASE_GAP),
  );
}

// ---- Mazes, attempts and dives --------------------------------------------------

/** Lays out a fresh maze: plankton on every corridor tile, fog unrevealed. */
export function layMaze(w: FathomState, rng: Rng): void {
  const layout = generateMaze(rng);
  w.tiles = layout.tiles.slice();
  w.start = { ...layout.start };
  w.plankton = w.tiles.map((row) =>
    [...row].map((ch) => (ch === CORRIDOR ? "*" : "-")).join(""),
  );
  w.visibility = filledRows("u");
}

/**
 * Sets the maze up for an attempt: the forager at rest on its start tile with
 * its brightness spent, the depth's roster in the den, no drifters, pulses or
 * ink, both cooldowns ready, and the release clock at its origin.
 */
export function setUpAttempt(w: FathomState): void {
  w.forager = {
    x: centerX(w.start.tx),
    y: centerY(w.start.ty),
    tx: w.start.tx,
    ty: w.start.ty,
    dir: "left",
    moving: false,
    desired: null,
  };
  w.brightness = 0;
  w.brightHold = 0;
  w.predators = makeRoster(w.tiles, w.depth);
  w.drifters = [];
  w.drifterIn = DRIFTER_INTERVAL;
  w.pulses = [];
  w.inkClouds = [];
  w.sonar.cooldown = 0;
  w.ink.cooldown = 0;
  w.playTime = 0;
}

function enter(w: FathomState, screen: Screen): void {
  w.screen = screen;
  w.menuIndex = menuIndexOnArrival(w, screen);
  if (screen === "countdown") w.screenTimer = COUNTDOWN_TIME;
  if (screen === "cleared") w.screenTimer = CLEARED_TIME;
}

/** The menu selection an arrival at `screen` opens on. */
export function menuIndexOnArrival(
  w: { readonly titleIndex: number },
  screen: Screen,
): number | null {
  switch (screen) {
    case "title":
      return w.titleIndex;
    case "paused":
    case "gameover":
      return 0;
    default:
      return null;
  }
}

/** The run's opening values, over a freshly laid out maze. */
function freshRun(w: FathomState, rng: Rng): void {
  w.score = 0;
  w.lives = START_LIVES;
  w.depth = 1;
  layMaze(w, rng);
  setUpAttempt(w);
}

/** `DIVE`, `RESTART` and `PLAY AGAIN`: a fresh dive, on its countdown. */
export function beginDive(w: FathomState, rng: Rng): void {
  freshRun(w, rng);
  enter(w, "countdown");
}

/** Every return to the title: the run's opening values, `titleIndex` kept. */
export function returnToTitle(w: FathomState, rng: Rng): void {
  freshRun(w, rng);
  enter(w, "title");
}

/** Another attempt at the same maze after a lost life. */
export function retryMaze(w: FathomState): void {
  w.lives -= 1;
  setUpAttempt(w);
  enter(w, "countdown");
}

/** The descent: the next depth's fresh maze, on its countdown. */
export function descend(w: FathomState, rng: Rng): void {
  w.depth += 1;
  layMaze(w, rng);
  setUpAttempt(w);
  enter(w, "countdown");
}

export function gameOver(w: FathomState): void {
  enter(w, "gameover");
}

export function clearMaze(w: FathomState): void {
  enter(w, "cleared");
}

export function goTo(w: FathomState, screen: Screen): void {
  enter(w, screen);
}

/** Every observable field at its title-screen value, `muted` as given. */
export function titleState(
  seed: number,
  art: Art | null,
  muted: boolean,
): FathomState {
  const rng = new Rng(seed);
  const w: FathomState = {
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: START_LIVES,
    muted,
    planktonRemaining: 0,
    drifterIn: DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: visionRadius(0),
    windowRadius: windowRadius(0),
    sonar: { ready: true, cooldown: 0, range: sonarRange(1) },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: GRID_COLS,
      rows: GRID_ROWS,
      tile: TILE,
      originX: GRID_ORIGIN_X,
      originY: GRID_ORIGIN_Y,
    },
    tiles: filledRows("#"),
    plankton: filledRows("-"),
    visibility: filledRows("u"),
    forager: {
      x: 0,
      y: 0,
      tx: 0,
      ty: 0,
      dir: "left",
      moving: false,
      desired: null,
    },
    drifters: [],
    predators: [],
    pulses: [],
    inkClouds: [],
    simTime: 0,
    accumulator: 0,
    screenTimer: 0,
    playTime: 0,
    start: { tx: 0, ty: 0 },
    rng: 0,
    press: null,
    art,
  };
  freshRun(w, rng);
  w.rng = rng.seed;
  return derive(w);
}

export function initialState(seed: number, art: Art | null): FathomState {
  return titleState(seed, art, false);
}

/** Whether a layout has a den gate to admit drifters from. */
export function gateTile(tiles: readonly string[]): TilePos | null {
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    const tx = tiles[ty].indexOf(GATE);
    if (tx >= 0) return { tx, ty };
  }
  return null;
}

/** Whether a layout has a den chamber at all. */
export function hasDen(tiles: readonly string[]): boolean {
  return tiles.some((row) => row.includes(DEN));
}
