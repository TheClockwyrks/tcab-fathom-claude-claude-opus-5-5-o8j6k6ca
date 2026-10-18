// The debug and automation surface (specs/instrumentation.md), the snapshot
// (specs/state.md), and the overlay's diagnostic sources.
//
// Every pose copies the state into a draft, sets the one thing it names, brings
// the derived readings back into line, and returns the draft. Invalid arguments
// throw rather than being trimmed or ignored.

import type { InitApi } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import {
  BRIGHT_HOLD,
  DRIFTER_INTERVAL,
  FATHOM_DEBUG_VERSION,
  GRID_COLS,
  GRID_ROWS,
  TITLE_ITEMS,
  type PredatorKind,
} from "./constants";
import type {
  Dir,
  FathomDebugApi,
  FathomSnapshot,
  FathomState,
  Screen,
} from "./game";
import {
  CORRIDOR,
  DEN,
  GATE,
  ROCK,
  filledRows,
  setChar,
  isDir,
  tileAt,
  centerX,
  centerY,
} from "./grid";
import { menuItems, menuRect } from "./menus";
import { acquire, endFlare, leaveDen } from "./predators";
import {
  derive,
  draft,
  makeDrifter,
  makePredator,
  makeRoster,
  menuIndexOnArrival,
  titleState,
} from "./world";

type View = DeepReadonly<FathomState>;

const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "countdown",
  "playing",
  "paused",
  "cleared",
  "gameover",
];
const KINDS: readonly PredatorKind[] = ["lanternjaw", "gloamfin", "flarefish"];

function fail(message: string): never {
  throw new Error(`Fathom debug: ${message}`);
}

function wholeAtLeast(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    fail(
      `${name} must be a whole number of at least ${min}, got ${String(value)}`,
    );
  }
}

function inRange(name: string, value: number, min: number, max: number): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    fail(`${name} must be a number in [${min}, ${max}], got ${String(value)}`);
  }
}

function atLeast(name: string, value: number, min: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    fail(
      `${name} must be a finite number of at least ${min}, got ${String(value)}`,
    );
  }
}

function flag(name: string, value: boolean): void {
  if (typeof value !== "boolean")
    fail(`${name} must be a boolean, got ${String(value)}`);
}

function tile(tx: number, ty: number): void {
  if (
    !Number.isInteger(tx) ||
    !Number.isInteger(ty) ||
    tx < 0 ||
    ty < 0 ||
    tx >= GRID_COLS ||
    ty >= GRID_ROWS
  ) {
    fail(
      `(${String(tx)}, ${String(ty)}) is not a tile of the ${GRID_COLS}x${GRID_ROWS} grid`,
    );
  }
}

function corridorTile(s: View, tx: number, ty: number): void {
  tile(tx, ty);
  if (tileAt(s.tiles, tx, ty) !== CORRIDOR)
    fail(`(${tx}, ${ty}) is not an open corridor tile`);
}

function dirArg(dir: Dir): void {
  if (!isDir(dir)) fail(`${String(dir)} is not a direction`);
}

function predatorIndex(s: View, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= s.predators.length) {
    fail(`no predator at index ${String(index)}`);
  }
}

function drifterIndex(s: View, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= s.drifters.length) {
    fail(`no drifter at index ${String(index)}`);
  }
}

/** A pose: copy, change, re-derive. */
function pose(s: View, change: (w: FathomState) => void): FathomState {
  const w = draft(s);
  change(w);
  return derive(w);
}

export function snapshot(s: View): FathomSnapshot {
  const w = derive(draft(s));
  return {
    version: FATHOM_DEBUG_VERSION,
    screen: w.screen,
    menuIndex: w.menuIndex,
    titleIndex: w.titleIndex,
    depth: w.depth,
    score: w.score,
    lives: w.lives,
    muted: w.muted,
    planktonRemaining: w.planktonRemaining,
    drifterIn: w.drifterIn,
    brightness: w.brightness,
    brightHold: w.brightHold,
    visionRadius: w.visionRadius,
    windowRadius: w.windowRadius,
    sonar: { ...w.sonar },
    ink: { ...w.ink },
    grid: { ...w.grid },
    tiles: w.tiles.slice(),
    plankton: w.plankton.slice(),
    visibility: s.visibility.slice(),
    forager: {
      x: w.forager.x,
      y: w.forager.y,
      tx: w.forager.tx,
      ty: w.forager.ty,
      dir: w.forager.dir,
      moving: w.forager.moving,
    },
    drifters: w.drifters.map((d) => ({
      x: d.x,
      y: d.y,
      tx: d.tx,
      ty: d.ty,
      lit: d.lit,
      mind: d.mind,
      travel: d.travel,
    })),
    predators: w.predators.map((p) => ({
      kind: p.kind,
      x: p.x,
      y: p.y,
      tx: p.tx,
      ty: p.ty,
      dir: p.dir,
      state: p.state,
      released: p.released,
      mind: p.mind,
      travel: p.travel,
      speed: p.speed,
      alert: p.alert,
      lit: p.lit,
      detectRange: p.detectRange,
      hearingRange: p.hearingRange,
      hearingLock: p.hearingLock,
      flareCharging: p.flareCharging,
      flaring: p.flaring,
      flareRadius: p.flareRadius,
    })),
    pulses: w.pulses.map((p) => ({
      source: p.source,
      tint: p.tint,
      ox: p.ox,
      oy: p.oy,
      front: p.front,
      range: p.range,
    })),
    inkClouds: w.inkClouds.map((c) => ({ ...c })),
    simTime: w.simTime,
  };
}

function checkLayout(rows: readonly string[]): void {
  if (!Array.isArray(rows) || rows.length !== GRID_ROWS) {
    fail(`a layout is ${GRID_ROWS} rows`);
  }
  let gates = 0;
  let den = 0;
  for (const row of rows) {
    if (typeof row !== "string" || row.length !== GRID_COLS) {
      fail(`every layout row is ${GRID_COLS} characters`);
    }
    for (const ch of row) {
      if (ch !== ROCK && ch !== CORRIDOR && ch !== DEN && ch !== GATE) {
        fail(`"${ch}" is not a tile character`);
      }
      if (ch === GATE) gates++;
      if (ch === DEN) den++;
    }
  }
  if ((gates > 0 || den > 0) && gates !== 1) {
    fail("a layout with a den carries exactly one gate");
  }
}

export function createDebugApi(): FathomDebugApi {
  return {
    version: FATHOM_DEBUG_VERSION,

    reset: (s) => titleState(s.rng, draft(s).art, s.muted),

    snapshot,

    reconcile: (s) => derive(draft(s)),

    setScreen: (s, screen) => {
      if (!SCREENS.includes(screen)) fail(`${String(screen)} is not a screen`);
      return pose(s, (w) => {
        if (
          screen === "playing" &&
          w.screen !== "playing" &&
          w.screen !== "paused"
        ) {
          w.playTime = 0;
        }
        if (screen === "countdown" || screen === "cleared") w.screenTimer = 2;
        w.screen = screen;
        w.menuIndex = menuIndexOnArrival(w, screen);
      });
    },

    setMenuIndex: (s, index) => {
      const items = menuItems(s.screen);
      if (items === null) fail(`the ${s.screen} screen shows no menu`);
      if (!Number.isInteger(index) || index < 0 || index >= items.length) {
        fail(`the ${s.screen} menu has no item ${String(index)}`);
      }
      return pose(s, (w) => {
        w.menuIndex = index;
      });
    },

    setTitleIndex: (s, index) => {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= TITLE_ITEMS.length
      ) {
        fail(`the title menu has no item ${String(index)}`);
      }
      return pose(s, (w) => {
        w.titleIndex = index;
      });
    },

    menuItemRect: (s, index) => menuRect(s.screen, index),

    setScore: (s, points) => {
      wholeAtLeast("points", points, 0);
      return pose(s, (w) => {
        w.score = points;
      });
    },

    setLives: (s, n) => {
      wholeAtLeast("lives", n, 0);
      return pose(s, (w) => {
        w.lives = n;
      });
    },

    setDepth: (s, d) => {
      wholeAtLeast("depth", d, 1);
      return pose(s, (w) => {
        w.depth = d;
        w.predators = makeRoster(w.tiles, d);
        w.playTime = 0;
      });
    },

    setMaze: (s, rows) => {
      checkLayout(rows);
      return pose(s, (w) => {
        w.tiles = rows.slice();
      });
    },

    setPlankton: (s, tx, ty, present) => {
      corridorTile(s, tx, ty);
      flag("present", present);
      return pose(s, (w) => {
        w.plankton = setChar(w.plankton, tx, ty, present ? "*" : "-");
      });
    },

    clearPlankton: (s) =>
      pose(s, (w) => {
        w.plankton = filledRows("-");
      }),

    clearFog: (s) =>
      pose(s, (w) => {
        w.visibility = filledRows("u");
      }),

    setForagerTile: (s, tx, ty) => {
      corridorTile(s, tx, ty);
      return pose(s, (w) => {
        w.forager.x = centerX(tx);
        w.forager.y = centerY(ty);
        w.forager.moving = false;
        w.forager.desired = null;
      });
    },

    setForagerDir: (s, dir) => {
      dirArg(dir);
      return pose(s, (w) => {
        w.forager.dir = dir;
        w.forager.moving = false;
      });
    },

    setBrightness: (s, g) => {
      inRange("brightness", g, 0, 1);
      return pose(s, (w) => {
        w.brightness = g;
      });
    },

    setBrightHold: (s, seconds) => {
      inRange("brightHold", seconds, 0, BRIGHT_HOLD);
      return pose(s, (w) => {
        w.brightHold = seconds;
      });
    },

    clearPredators: (s) =>
      pose(s, (w) => {
        w.predators = [];
      }),

    addPredator: (s, kind, tx, ty) => {
      if (!KINDS.includes(kind)) fail(`${String(kind)} is not a predator kind`);
      corridorTile(s, tx, ty);
      return pose(s, (w) => {
        const p = makePredator(kind, { tx, ty }, "wander", null);
        leaveDen(p);
        w.predators.push(p);
      });
    },

    setPredatorTile: (s, index, tx, ty) => {
      predatorIndex(s, index);
      tile(tx, ty);
      const ch = tileAt(s.tiles, tx, ty);
      if (ch === ROCK) fail(`(${tx}, ${ty}) is rock`);
      return pose(s, (w) => {
        const p = w.predators[index];
        p.x = centerX(tx);
        p.y = centerY(ty);
      });
    },

    setPredatorDir: (s, index, dir) => {
      predatorIndex(s, index);
      dirArg(dir);
      return pose(s, (w) => {
        w.predators[index].dir = dir;
      });
    },

    setPredatorState: (s, index, value) => {
      predatorIndex(s, index);
      const p0 = s.predators[index];
      const ch = tileAt(s.tiles, p0.tx, p0.ty);
      if (value === "den") {
        if (ch !== DEN && ch !== GATE)
          fail(
            "a predator posed into the den stands on a den tile or the gate",
          );
      } else if (value === "wander" || value === "chase") {
        if (ch !== CORRIDOR)
          fail(
            `a predator posed into ${value} stands on an open corridor tile`,
          );
      } else {
        fail(`${String(value)} is not a state a predator is posed into`);
      }
      return pose(s, (w) => {
        const p = w.predators[index];
        endFlare(p);
        p.alertLeft = 0;
        p.linger = null;
        p.searchTime = 0;
        p.searchPinged = false;
        if (value === "chase") {
          p.state = "wander";
          acquire(w, p, { tx: w.forager.tx, ty: w.forager.ty });
          p.alertLeft = 0;
        } else {
          p.state = value;
          p.fix = null;
        }
      });
    },

    setPredatorReleased: (s, index, released) => {
      predatorIndex(s, index);
      flag("released", released);
      return pose(s, (w) => {
        w.predators[index].released = released;
      });
    },

    setPredatorMind: (s, index, enabled) => {
      predatorIndex(s, index);
      flag("enabled", enabled);
      return pose(s, (w) => {
        w.predators[index].mind = enabled;
      });
    },

    setPredatorTravel: (s, index, enabled) => {
      predatorIndex(s, index);
      flag("enabled", enabled);
      return pose(s, (w) => {
        w.predators[index].travel = enabled;
      });
    },

    spawnDrifter: (s, tx, ty) => {
      corridorTile(s, tx, ty);
      return pose(s, (w) => {
        w.drifters.push(makeDrifter({ tx, ty }));
      });
    },

    clearDrifters: (s) =>
      pose(s, (w) => {
        w.drifters = [];
      }),

    setDrifterMind: (s, index, enabled) => {
      drifterIndex(s, index);
      flag("enabled", enabled);
      return pose(s, (w) => {
        w.drifters[index].mind = enabled;
      });
    },

    setDrifterTravel: (s, index, enabled) => {
      drifterIndex(s, index);
      flag("enabled", enabled);
      return pose(s, (w) => {
        w.drifters[index].travel = enabled;
      });
    },

    setDrifterIn: (s, seconds) => {
      inRange("drifterIn", seconds, 0, DRIFTER_INTERVAL);
      return pose(s, (w) => {
        w.drifterIn = seconds;
      });
    },

    setSonarCooldown: (s, seconds) => {
      atLeast("sonar cooldown", seconds, 0);
      return pose(s, (w) => {
        w.sonar.cooldown = seconds;
      });
    },

    setInkCooldown: (s, seconds) => {
      atLeast("ink cooldown", seconds, 0);
      return pose(s, (w) => {
        w.ink.cooldown = seconds;
      });
    },
  };
}

const NONE = "-";

/** The overlay's sources: the same facts the snapshot reports, one per line. */
export function registerDiagnostics(
  diagnostics: InitApi<FathomState>["diagnostics"],
): void {
  diagnostics.register("screen", (s) => s.screen);
  diagnostics.register("depth", (s) => s.depth);
  diagnostics.register("score", (s) => s.score);
  diagnostics.register("lives", (s) => s.lives);
  diagnostics.register("G", (s) => s.brightness);
  diagnostics.register("V", (s) => s.visionRadius);
  diagnostics.register("R", (s) => s.windowRadius);
  diagnostics.register("sonar cd", (s) => s.sonar.cooldown);
  diagnostics.register("ink cd", (s) => s.ink.cooldown);
  diagnostics.register("plankton", (s) => s.planktonRemaining);
  diagnostics.register(
    "forager",
    (s) => `(${s.forager.tx}, ${s.forager.ty}) ${s.forager.dir}`,
  );
  diagnostics.register("predators", (s) => s.predators.length);
  for (let i = 0; i < 6; i++) {
    diagnostics.register(`predator ${i}`, (s) => {
      const p = s.predators[i];
      if (p === undefined) return NONE;
      const alert = p.alert ? " ALERT" : "";
      return `${p.kind} ${p.state} (${p.tx}, ${p.ty}) ${p.speed.toFixed(0)}${alert}`;
    });
  }
}
