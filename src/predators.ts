// The three hunters: the release from the den, each kind's sense and states,
// and how each one routes through the maze (specs/predators.md and the files
// under specs/predators/).

import {
  ALERT_TIME,
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_CORNER_SPEED,
  GLOAMFIN_GIVEUP,
  GLOAMFIN_HEAR,
  GLOAMFIN_PING_INTERVAL,
  GLOAMFIN_PING_MIN_GAP,
  GLOAMFIN_PING_RANGE,
  GLOAMFIN_RAMP_TIME,
  GLOAMFIN_SEARCH_DELAY,
  GLOAMFIN_SEARCH_ROAM,
  LINGER_TIME,
  TICK_DT,
  CUES,
  type CueName,
} from "./constants";
import type { Dir, FathomState, Predator, PulseTint, TilePos } from "./game";
import {
  CORRIDOR,
  DEN,
  DIRS,
  GATE,
  OPPOSITE,
  ROCK,
  crossesRock,
  distances,
  index,
  neighbor,
  perpendicular,
  segmentDistance,
  tileAt,
  tileOfX,
  tileOfY,
  tunnelRow,
} from "./grid";
import { opens, travel, type Route } from "./motion";
import type { Rng } from "./rng";
import { hasDen, speedFor } from "./world";

/** How long the bloom art's fade plays after a bloom ends. */
export const FADE_TIME = 0.3;

const EPS = 1e-9;

const isCorridor = (ch: string): boolean => ch === CORRIDOR;
const isOpenWater = (ch: string): boolean => ch !== ROCK;

/** What a tick's hunters hand back to the simulation. */
export interface HuntEvents {
  readonly cues: Set<CueName>;
}

// ---- Shared senses ----------------------------------------------------------------

/** Whether an ink cloud blinds a seeing hunter at `p` looking at the forager. */
export function inkBlinds(w: FathomState, p: Predator): boolean {
  const f = w.forager;
  return w.inkClouds.some(
    (c) =>
      Math.hypot(p.x - c.x, p.y - c.y) <= c.radius ||
      segmentDistance(c.x, c.y, p.x, p.y, f.x, f.y) <= c.radius,
  );
}

/** The light sense the Lanternjaw and the Flarefish share, ink aside. */
function seesLight(w: FathomState, p: Predator): boolean {
  const f = w.forager;
  const range = p.detectRange ?? 0;
  if (Math.hypot(p.x - f.x, p.y - f.y) > range) return false;
  return !crossesRock(w.tiles, p.x, p.y, f.x, f.y);
}

function foragerTile(w: FathomState): TilePos {
  return { tx: w.forager.tx, ty: w.forager.ty };
}

// ---- Routes -----------------------------------------------------------------------

function corridorRoute(
  w: FathomState,
  choose: (tx: number, ty: number, dir: Dir) => Dir | null,
): Route {
  return {
    tunnel: tunnelRow(w.tiles),
    canEnter: (tx, ty) => tileAt(w.tiles, tx, ty) === CORRIDOR,
    choose,
  };
}

/** The open headings out of a center other than the reverse, or the reverse alone. */
export function wanderChoices(
  route: Route,
  tx: number,
  ty: number,
  dir: Dir,
): Dir[] {
  const ahead = DIRS.filter(
    (d) => d !== OPPOSITE[dir] && opens(route, tx, ty, d),
  );
  if (ahead.length > 0) return ahead;
  return opens(route, tx, ty, OPPOSITE[dir]) ? [OPPOSITE[dir]] : [];
}

/** A wander route: uniformly random at each junction, never reversing by choice. */
export function wanderRoute(
  w: FathomState,
  rng: Rng,
  enterGate = false,
): Route {
  const route: Route = {
    tunnel: tunnelRow(w.tiles),
    canEnter: (tx, ty) => {
      const ch = tileAt(w.tiles, tx, ty);
      return ch === CORRIDOR || (enterGate && ch === GATE);
    },
    choose: (tx, ty, dir) => {
      const options = wanderChoices(corridorOnly, tx, ty, dir);
      return options.length > 0 ? rng.pick(options) : null;
    },
  };
  const corridorOnly = corridorRoute(w, () => null);
  return route;
}

/** The heading of the first step of a shortest corridor route toward `dist` 0. */
function downhill(
  route: Route,
  dist: Int16Array,
  tx: number,
  ty: number,
  dir: Dir,
): Dir | null {
  const here = dist[index(tx, ty)];
  let best: Dir | null = null;
  let bestD = here < 0 ? Infinity : here;
  // Prefer carrying straight on among equally short routes.
  const order = [dir, ...DIRS.filter((d) => d !== dir)];
  for (const d of order) {
    const n = neighbor(tx, ty, d, route.tunnel);
    if (n === null || !route.canEnter(n.tx, n.ty)) continue;
    const nd = dist[index(n.tx, n.ty)];
    if (nd >= 0 && nd < bestD) {
      best = d;
      bestD = nd;
    }
  }
  return best;
}

function fixDistances(w: FathomState, fix: TilePos): Int16Array {
  return distances(w.tiles, [fix], isCorridor);
}

/**
 * The tile the body is heading for along its heading, and the one behind it,
 * so a hunter can tell whether reversing shortens its route.
 */
function aheadAndBehind(
  w: FathomState,
  p: Predator,
): [TilePos, TilePos] | null {
  const tunnel = tunnelRow(w.tiles);
  const tx = tileOfX(p.x);
  const ty = tileOfY(p.y);
  const here = { tx, ty };
  const next = neighbor(tx, ty, p.dir, tunnel);
  const back = neighbor(tx, ty, OPPOSITE[p.dir], tunnel);
  const cx = w.grid.originX + tx * w.grid.tile + w.grid.tile / 2;
  const cy = w.grid.originY + ty * w.grid.tile + w.grid.tile / 2;
  const along =
    p.dir === "left" || p.dir === "right"
      ? (p.x - cx) * (p.dir === "right" ? 1 : -1)
      : (p.y - cy) * (p.dir === "down" ? 1 : -1);
  if (Math.abs(along) < 1e-6) return null;
  if (along < 0) return back === null ? null : [here, back];
  return next === null ? null : [next, here];
}

/** On taking a fix, turns about when the way behind is the shorter. */
function reverseTowardFix(w: FathomState, p: Predator): void {
  if (p.fix === null || !p.travel) return;
  const pair = aheadAndBehind(w, p);
  if (pair === null) return;
  const dist = fixDistances(w, p.fix);
  const [ahead, behind] = pair;
  const da = dist[index(ahead.tx, ahead.ty)];
  const db = dist[index(behind.tx, behind.ty)];
  if (db >= 0 && (da < 0 || db < da)) p.dir = OPPOSITE[p.dir];
}

// ---- State changes ----------------------------------------------------------------

function toWander(p: Predator): void {
  p.state = "wander";
  p.fix = null;
  p.linger = null;
  if (p.kind === "flarefish") p.flareTimer = FLARE_INTERVAL;
}

/** Ends a Flarefish's flare where it stands; the fade plays if it was blooming. */
export function endFlare(p: Predator): void {
  if (p.kind !== "flarefish") return;
  if (p.flarePhase === "bloom") p.fadeLeft = FADE_TIME;
  p.flarePhase = "idle";
  p.flareLeft = 0;
  p.flareCharging = false;
  p.flaring = false;
  p.flareRadius = 0;
}

/**
 * A fix on `tile`. Taking one from outside a chase is an acquisition, which fires
 * the alert for the kinds that carry one and opens the Gloamfin's chase at its cap;
 * a fix taken while already chasing only refreshes the tile.
 */
export function acquire(w: FathomState, p: Predator, tile: TilePos): void {
  const fresh = p.state !== "chase";
  p.fix = { tx: tile.tx, ty: tile.ty };
  p.linger = null;
  if (!fresh) return;
  p.state = "chase";
  if (p.kind !== "lanternjaw") p.alertLeft = ALERT_TIME;
  if (p.kind === "gloamfin") p.chaseSpeed = GLOAMFIN_CHASE_SPEED;
  if (p.kind === "flarefish") {
    endFlare(p);
    p.flareTimer = FLARE_INTERVAL;
  }
  reverseTowardFix(w, p);
}

/** A predator out of the den chamber begins to patrol. */
export function leaveDen(p: Predator): void {
  toWander(p);
  p.pingTimer = GLOAMFIN_PING_INTERVAL;
  p.sincePing = GLOAMFIN_PING_MIN_GAP;
  p.flareTimer = FLARE_INTERVAL;
}

/** A Gloamfin ping, flooding out from its tile. */
function castPing(
  w: FathomState,
  i: number,
  tint: PulseTint,
  events: HuntEvents,
): void {
  const p = w.predators[i];
  w.pulses.push({
    source: "gloamfin",
    tint,
    ox: p.tx,
    oy: p.ty,
    front: 0,
    range: GLOAMFIN_PING_RANGE,
    dist: Array.from(distances(w.tiles, [{ tx: p.tx, ty: p.ty }], isOpenWater)),
    owner: i,
    caught: false,
    reached: [],
  });
  p.pingTimer = GLOAMFIN_PING_INTERVAL;
  p.sincePing = 0;
  events.cues.add(CUES.predatorPing);
}

// ---- Each kind's mind -------------------------------------------------------------

function thinkLanternjaw(w: FathomState, p: Predator, dt: number): void {
  if (inkBlinds(w, p)) {
    if (p.state === "chase") toWander(p);
    return;
  }
  if (seesLight(w, p)) {
    acquire(w, p, foragerTile(w));
    return;
  }
  lapse(p, dt);
}

/** A seeing hunter's fix lapsing: it holds the last tile for the linger. */
function lapse(p: Predator, dt: number): void {
  if (p.state !== "chase") return;
  if (p.linger === null) {
    p.linger = LINGER_TIME;
    return;
  }
  p.linger = Math.max(0, p.linger - dt);
  if (p.linger <= EPS) toWander(p);
}

function thinkFlarefish(
  w: FathomState,
  p: Predator,
  dt: number,
  events: HuntEvents,
): void {
  const blind = inkBlinds(w, p);
  if (blind) {
    if (p.state === "chase") toWander(p);
  } else if (seesLight(w, p)) {
    acquire(w, p, foragerTile(w));
    return;
  } else {
    lapse(p, dt);
  }
  if (p.state !== "wander") return;

  switch (p.flarePhase) {
    case "idle":
      p.flareTimer = Math.max(0, p.flareTimer - dt);
      if (p.flareTimer <= EPS) {
        p.flarePhase = "charge";
        p.flareLeft = FLARE_CHARGE;
        p.flareCharging = true;
      }
      return;
    case "charge":
      p.flareLeft -= dt;
      if (p.flareLeft <= EPS) {
        p.flarePhase = "bloom";
        p.flareLeft = FLARE_BLOOM;
        p.flareCharging = false;
        p.flaring = true;
        p.flareRadius = FLARE_RADIUS;
        events.cues.add(CUES.flare);
        bloomLock(w, p, blind);
      }
      return;
    case "bloom":
      if (bloomLock(w, p, blind)) return;
      p.flareLeft -= dt;
      if (p.flareLeft <= EPS) {
        endFlare(p);
        p.flareTimer = FLARE_INTERVAL;
      }
      return;
  }
}

/** The bloom's lock: the forager within the flare radius and clear of ink. */
function bloomLock(w: FathomState, p: Predator, blind: boolean): boolean {
  const f = w.forager;
  if (blind || Math.hypot(p.x - f.x, p.y - f.y) > FLARE_RADIUS) return false;
  acquire(w, p, foragerTile(w));
  return true;
}

function thinkGloamfin(
  w: FathomState,
  i: number,
  dt: number,
  events: HuntEvents,
): void {
  const p = w.predators[i];
  const f = w.forager;
  p.pingTimer = Math.max(0, p.pingTimer - dt);
  p.sincePing += dt;
  const hearing = Math.hypot(p.x - f.x, p.y - f.y) <= GLOAMFIN_HEAR;
  p.hearingLock = hearing;
  if (hearing) acquire(w, p, foragerTile(w));

  if (
    p.state === "chase" &&
    p.fix !== null &&
    p.tx === p.fix.tx &&
    p.ty === p.fix.ty &&
    (f.tx !== p.fix.tx || f.ty !== p.fix.ty)
  ) {
    p.state = "search";
    p.searchTime = 0;
    p.searchPinged = false;
  }
  if (p.state === "chase") {
    const rate =
      (GLOAMFIN_CHASE_SPEED - GLOAMFIN_CORNER_SPEED) / GLOAMFIN_RAMP_TIME;
    p.chaseSpeed = Math.min(GLOAMFIN_CHASE_SPEED, p.chaseSpeed + rate * dt);
  }
  const canPing = p.sincePing >= GLOAMFIN_PING_MIN_GAP - EPS && !p.hearingLock;
  if (p.state === "search") {
    p.searchTime += dt;
    if (p.searchTime >= GLOAMFIN_GIVEUP - EPS) {
      toWander(p);
    } else if (
      !p.searchPinged &&
      p.searchTime >= GLOAMFIN_SEARCH_DELAY - EPS &&
      canPing
    ) {
      p.searchPinged = true;
      castPing(w, i, "orange", events);
      return;
    }
  }
  if (p.pingTimer <= EPS && canPing) castPing(w, i, "violet", events);
}

// ---- Moving -------------------------------------------------------------------------

function denRoute(w: FathomState): Route {
  const tunnel = tunnelRow(w.tiles);
  const exits: TilePos[] = [];
  for (let ty = 0; ty < w.tiles.length; ty++) {
    for (let tx = 0; tx < w.tiles[ty].length; tx++) {
      if (w.tiles[ty][tx] !== GATE) continue;
      for (const d of DIRS) {
        const n = neighbor(tx, ty, d, tunnel);
        if (n !== null && tileAt(w.tiles, n.tx, n.ty) === CORRIDOR)
          exits.push(n);
      }
    }
  }
  const dist = distances(w.tiles, exits, (ch) => ch === DEN || ch === GATE);
  const route: Route = {
    tunnel,
    canEnter: (tx, ty) => {
      const ch = tileAt(w.tiles, tx, ty);
      return ch === DEN || ch === GATE || ch === CORRIDOR;
    },
    choose: (tx, ty, dir) => downhill(route, dist, tx, ty, dir),
  };
  return route;
}

function chaseRoute(w: FathomState, p: Predator, rng: Rng): Route {
  const fix = p.fix;
  const dist = fix === null ? null : fixDistances(w, fix);
  const wander = wanderRoute(w, rng);
  const route = corridorRoute(w, (tx, ty, dir) => {
    if (dist === null || fix === null) return wander.choose(tx, ty, dir);
    if (tx === fix.tx && ty === fix.ty) return null;
    const next = downhill(route, dist, tx, ty, dir);
    const chosen = next ?? wander.choose(tx, ty, dir);
    if (
      chosen !== null &&
      p.kind === "gloamfin" &&
      perpendicular(chosen, dir)
    ) {
      p.chaseSpeed = GLOAMFIN_CORNER_SPEED;
    }
    return chosen;
  });
  return route;
}

function searchRoute(w: FathomState, p: Predator, rng: Rng): Route {
  const fix = p.fix ?? { tx: p.tx, ty: p.ty };
  const dist = fixDistances(w, fix);
  const route = corridorRoute(w, (tx, ty, dir) => {
    const near = wanderChoices(route, tx, ty, dir).filter((d) => {
      const n = neighbor(tx, ty, d, route.tunnel);
      if (n === null) return false;
      const nd = dist[index(n.tx, n.ty)];
      return nd >= 0 && nd <= GLOAMFIN_SEARCH_ROAM;
    });
    if (near.length > 0) return rng.pick(near);
    return (
      downhill(route, dist, tx, ty, dir) ??
      wanderChoices(route, tx, ty, dir)[0] ??
      null
    );
  });
  return route;
}

function move(p: Predator, route: Route, dt: number): void {
  const moved = travel(p, p.speed * dt, route);
  p.x = moved.x;
  p.y = moved.y;
  p.dir = moved.dir;
  p.tx = tileOfX(p.x);
  p.ty = tileOfY(p.y);
}

/**
 * One tick of one predator: the release clock, its own mind, and its travel.
 * Mutates the draft.
 */
export function stepPredator(
  w: FathomState,
  i: number,
  rng: Rng,
  events: HuntEvents,
  dt: number = TICK_DT,
): void {
  const p = w.predators[i];
  p.alertLeft = Math.max(0, p.alertLeft - dt);
  p.markLeft = Math.max(0, p.markLeft - dt);
  p.fadeLeft = Math.max(0, p.fadeLeft - dt);

  if (p.state === "den") {
    if (
      !p.released &&
      p.releaseAt !== null &&
      w.playTime >= p.releaseAt - EPS
    ) {
      p.released = true;
    }
    if (p.released && p.mind && hasDen(w.tiles)) {
      if (p.travel) move(p, denRoute(w), dt);
      if (tileAt(w.tiles, p.tx, p.ty) === CORRIDOR) leaveDen(p);
    }
  } else {
    if (p.mind) {
      if (p.kind === "lanternjaw") thinkLanternjaw(w, p, dt);
      else if (p.kind === "flarefish") thinkFlarefish(w, p, dt, events);
      else thinkGloamfin(w, i, dt, events);
    }
    p.speed = speedFor(p);
    if (p.mind && p.travel) {
      const route =
        p.state === "chase"
          ? chaseRoute(w, p, rng)
          : p.state === "search"
            ? searchRoute(w, p, rng)
            : wanderRoute(w, rng);
      move(p, route, dt);
    }
  }
  p.speed = speedFor(p);
  p.alert = p.alertLeft > 0;
}
