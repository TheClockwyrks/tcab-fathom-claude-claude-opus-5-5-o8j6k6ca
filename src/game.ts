// Fathom — the game.
//
// This module declares the game's state, `FathomState`, exactly as
// specs/state.md fixes it, the debug surface `FathomDebugApi` of
// specs/instrumentation.md, and the `game` the engine drives. The work itself
// lives beside it:
//
//   world.ts     building mazes, dives, attempts and rosters; derived readings
//   sim.ts       one fixed TICK_DT step of the simulation
//   predators.ts the three hunters' senses and decisions
//   sensing.ts   the forager's light, sonar, flares and the fog of war
//   frame.ts     the per-frame update: input, screens, menus, ticks and cues
//   render.ts    everything drawn
//   debug.ts     the debug surface and the snapshot
//
// The state is a value. Every frame `update` copies the parts it changes into a
// fresh draft (`draft` in world.ts), advances that, and returns it, so the
// state the engine handed over is never written.

import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { loadArt } from "./art";
import { defineCues } from "./audio";
import { ACTIONS, BINDINGS, type PredatorKind } from "./constants";
import { createDebugApi, registerDiagnostics } from "./debug";
import { advanceFrame } from "./frame";
import { renderGame } from "./render";
import { initialState } from "./world";

// ---- The state (specs/state.md) -------------------------------------------

export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";

export type Dir = "up" | "down" | "left" | "right";

export type PredatorState = "den" | "wander" | "chase" | "search";

export type PulseSource = "forager" | "gloamfin";

export type PulseTint = "cyan" | "violet" | "orange";

export interface TilePos {
  readonly tx: number;
  readonly ty: number;
}

/** The tile grid's fixed frame. */
export interface GridFrame {
  readonly cols: number;
  readonly rows: number;
  readonly tile: number;
  readonly originX: number;
  readonly originY: number;
}

export interface SonarState {
  /** `true` exactly when `cooldown` is `0`. */
  ready: boolean;
  /** Seconds until the next pulse may be emitted. */
  cooldown: number;
  /** `E`, the pulse's path range in tiles at the current depth. */
  range: number;
}

export interface InkState {
  ready: boolean;
  cooldown: number;
}

export interface Forager {
  /** Its center, in logical units. */
  x: number;
  y: number;
  /** The tile whose bounds contain its center. */
  tx: number;
  ty: number;
  /** Its facing, moving or at rest. */
  dir: Dir;
  moving: boolean;
  /** The buffered desired direction the movement actions set. */
  desired: Dir | null;
}

export interface Drifter {
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** Whether its body is drawn this instant. */
  lit: boolean;
  /** Whether it decides its own wander. */
  mind: boolean;
  /** Whether its body carries those decisions through the maze. */
  travel: boolean;
  /** Its heading along the corridor. */
  dir: Dir;
}

/** Where a Flarefish's flare stands. */
export type FlarePhase = "idle" | "charge" | "bloom";

export interface Predator {
  kind: PredatorKind;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  state: PredatorState;
  released: boolean;
  mind: boolean;
  travel: boolean;
  /** The rate it travels at in its current state. */
  speed: number;
  alert: boolean;
  lit: boolean;
  detectRange: number | null;
  hearingRange: number | null;
  hearingLock: boolean | null;
  flareCharging: boolean | null;
  flaring: boolean | null;
  flareRadius: number | null;

  /** Seconds of live play after which its den slot arrives; `null` for none. */
  releaseAt: number | null;
  /** The tile it believes the forager is on, while it holds a fix. */
  fix: TilePos | null;
  /** Seconds left on a lapsed fix's linger, or `null` while not lingering. */
  linger: number | null;
  /** Seconds left on the detection alert. */
  alertLeft: number;
  /** Seconds left on a sonar mark. */
  markLeft: number;
  /** The Gloamfin's chase speed, which corners cost it. */
  chaseSpeed: number;
  /** The Gloamfin's ping timer. */
  pingTimer: number;
  /** Seconds since the Gloamfin's last ping. */
  sincePing: number;
  /** Seconds into the Gloamfin's current search. */
  searchTime: number;
  /** Whether this search has cast its guaranteed ping. */
  searchPinged: boolean;
  /** The Flarefish's flare timer. */
  flareTimer: number;
  flarePhase: FlarePhase;
  /** Seconds left on the current charge or bloom. */
  flareLeft: number;
  /** Seconds left on the bloom art's fade, which lights nothing. */
  fadeLeft: number;
}

export interface Pulse {
  source: PulseSource;
  tint: PulseTint;
  /** The tile it originated from. */
  ox: number;
  oy: number;
  /** How far the front has traveled, in corridor steps. */
  front: number;
  /** The furthest it travels, in corridor steps. */
  range: number;
  /** Path distance from the origin per tile, `-1` where it cannot flow. */
  dist: readonly number[];
  /** The predator index that cast a Gloamfin ping. */
  owner: number | null;
  /** Whether this ping has already caught the forager. */
  caught: boolean;
  /** Predator indices whose tile this front has already reached. */
  reached: readonly number[];
}

export interface InkCloud {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}

/** An in-progress pointer or touch press on a menu or the how-to screen. */
export interface MenuPress {
  readonly id: number;
  readonly screen: Screen;
  readonly item: number | null;
}

/** The sprite sheets, one bitmap per frame, as specs/assets.md lays them out. */
export interface Art {
  readonly forager: readonly ImageBitmap[];
  readonly lanternjaw: readonly ImageBitmap[];
  readonly gloamfin: readonly ImageBitmap[];
  readonly flarefish: readonly ImageBitmap[];
  readonly drifter: readonly ImageBitmap[];
  readonly bloom: readonly ImageBitmap[];
  readonly tiles: readonly ImageBitmap[];
}

export interface FathomState {
  screen: Screen;
  menuIndex: number | null;
  titleIndex: number;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  planktonRemaining: number;
  drifterIn: number;
  brightness: number;
  brightHold: number;
  visionRadius: number;
  windowRadius: number;
  sonar: SonarState;
  ink: InkState;
  grid: GridFrame;
  /** The layout: `#` rock, `.` corridor, `g` gate, `d` den interior. */
  tiles: readonly string[];
  /** `*` where a plankton stands, `-` elsewhere. */
  plankton: readonly string[];
  /** `u` unrevealed, `r` remembered, `l` lit. */
  visibility: readonly string[];
  forager: Forager;
  drifters: Drifter[];
  predators: Predator[];
  pulses: Pulse[];
  inkClouds: InkCloud[];
  simTime: number;

  // Beyond the observable fields: what the simulation carries between frames.

  /** Frame time not yet consumed by a whole tick. */
  accumulator: number;
  /** Seconds left on the countdown or the cleared interstitial. */
  screenTimer: number;
  /** Seconds of live play in the current attempt: the release clock. */
  playTime: number;
  /** The forager's start tile in the current maze. */
  start: TilePos;
  /** The random generator's state. */
  rng: number;
  press: MenuPress | null;
  /** The art, or `null` where it could not be loaded. */
  art: Art | null;
}

// ---- The snapshot (specs/state.md) ----------------------------------------

export interface FathomSnapshot {
  version: number;
  screen: Screen;
  menuIndex: number | null;
  titleIndex: number;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  planktonRemaining: number;
  drifterIn: number;
  brightness: number;
  brightHold: number;
  visionRadius: number;
  windowRadius: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: {
    cols: number;
    rows: number;
    tile: number;
    originX: number;
    originY: number;
  };
  tiles: string[];
  plankton: string[];
  visibility: string[];
  forager: {
    x: number;
    y: number;
    tx: number;
    ty: number;
    dir: Dir;
    moving: boolean;
  };
  drifters: {
    x: number;
    y: number;
    tx: number;
    ty: number;
    lit: boolean;
    mind: boolean;
    travel: boolean;
  }[];
  predators: {
    kind: PredatorKind;
    x: number;
    y: number;
    tx: number;
    ty: number;
    dir: Dir;
    state: PredatorState;
    released: boolean;
    mind: boolean;
    travel: boolean;
    speed: number;
    alert: boolean;
    lit: boolean;
    detectRange: number | null;
    hearingRange: number | null;
    hearingLock: boolean | null;
    flareCharging: boolean | null;
    flaring: boolean | null;
    flareRadius: number | null;
  }[];
  pulses: {
    source: PulseSource;
    tint: PulseTint;
    ox: number;
    oy: number;
    front: number;
    range: number;
  }[];
  inkClouds: { x: number; y: number; radius: number; remaining: number }[];
  simTime: number;
}

/** A menu item's hit region, in logical units. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---- The debug surface (specs/instrumentation.md) -------------------------

type View = DeepReadonly<FathomState>;

export interface FathomDebugApi {
  readonly version: number;
  reset(state: View): FathomState;
  snapshot(state: View): FathomSnapshot;
  reconcile(state: View): FathomState;
  setScreen(state: View, s: Screen): FathomState;
  setMenuIndex(state: View, index: number): FathomState;
  setTitleIndex(state: View, index: number): FathomState;
  menuItemRect(state: View, index: number): Rect | null;
  setScore(state: View, points: number): FathomState;
  setLives(state: View, n: number): FathomState;
  setDepth(state: View, d: number): FathomState;
  setMaze(state: View, rows: readonly string[]): FathomState;
  setPlankton(
    state: View,
    tx: number,
    ty: number,
    present: boolean,
  ): FathomState;
  clearPlankton(state: View): FathomState;
  clearFog(state: View): FathomState;
  setForagerTile(state: View, tx: number, ty: number): FathomState;
  setForagerDir(state: View, dir: Dir): FathomState;
  setBrightness(state: View, g: number): FathomState;
  setBrightHold(state: View, seconds: number): FathomState;
  clearPredators(state: View): FathomState;
  addPredator(
    state: View,
    kind: PredatorKind,
    tx: number,
    ty: number,
  ): FathomState;
  setPredatorTile(
    state: View,
    index: number,
    tx: number,
    ty: number,
  ): FathomState;
  setPredatorDir(state: View, index: number, dir: Dir): FathomState;
  setPredatorState(
    state: View,
    index: number,
    value: "den" | "wander" | "chase",
  ): FathomState;
  setPredatorReleased(
    state: View,
    index: number,
    released: boolean,
  ): FathomState;
  setPredatorMind(state: View, index: number, enabled: boolean): FathomState;
  setPredatorTravel(state: View, index: number, enabled: boolean): FathomState;
  spawnDrifter(state: View, tx: number, ty: number): FathomState;
  clearDrifters(state: View): FathomState;
  setDrifterMind(state: View, index: number, enabled: boolean): FathomState;
  setDrifterTravel(state: View, index: number, enabled: boolean): FathomState;
  setDrifterIn(state: View, seconds: number): FathomState;
  setSonarCooldown(state: View, seconds: number): FathomState;
  setInkCooldown(state: View, seconds: number): FathomState;
}

// ---- The game ---------------------------------------------------------------

/**
 * The stage background: the abyss itself, matched to the unrevealed fog tile so
 * the letterbox bars, the fog and the water read as one darkness.
 */
export const BACKGROUND = "#03060c";

export const game: Game<FathomState, FathomDebugApi> = {
  async initialize(
    api: InitApi<FathomState>,
  ): Promise<[FathomState, FathomDebugApi]> {
    for (const name of ACTIONS) {
      api.input.register(name, { keys: [...BINDINGS[name]] });
    }
    defineCues(api.audio);
    registerDiagnostics(api.diagnostics);
    const art = await loadArt(api.assets);
    const seed = Math.floor(Math.random() * 0x100000000);
    return [initialState(seed, art), createDebugApi()];
  },

  update(
    state: DeepReadonly<FathomState>,
    api: UpdateApi,
    dt: number,
  ): FathomState {
    return advanceFrame(state, api, dt);
  },

  render(state: DeepReadonly<FathomState>, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
