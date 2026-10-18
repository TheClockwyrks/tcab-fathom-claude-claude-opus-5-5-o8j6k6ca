// The fog of war: what the forager's light, the sonar fronts and the flares
// reveal this instant, what that leaves remembered, and which bodies are drawn.

import { FLARE_RADIUS, GRID_COLS, GRID_ROWS } from "./constants";
import type { FathomState, Predator, Pulse } from "./game";
import {
  ROCK,
  TILE_COUNT,
  centerX,
  centerY,
  crossesRock,
  index,
  tileAt,
} from "./grid";
import { hasDen } from "./world";

/**
 * The tiles the forager's own light reaches: every tile whose center lies within
 * `V` of the forager's center along a segment that crosses no rock tile but the
 * tile itself.
 */
export function lightSet(w: FathomState): Uint8Array {
  const lit = new Uint8Array(TILE_COUNT);
  const { x, y } = w.forager;
  const v = w.visionRadius;
  const reach = Math.ceil(v / w.grid.tile) + 1;
  const fx = w.forager.tx;
  const fy = w.forager.ty;
  for (
    let ty = Math.max(0, fy - reach);
    ty <= Math.min(GRID_ROWS - 1, fy + reach);
    ty++
  ) {
    for (
      let tx = Math.max(0, fx - reach);
      tx <= Math.min(GRID_COLS - 1, fx + reach);
      tx++
    ) {
      const cx = centerX(tx);
      const cy = centerY(ty);
      if (Math.hypot(cx - x, cy - y) > v) continue;
      if (!crossesRock(w.tiles, x, y, cx, cy, true)) lit[index(tx, ty)] = 1;
    }
  }
  return lit;
}

/** Whether a Flarefish's bloom is burning. */
export function blooming(p: Predator): boolean {
  return p.kind === "flarefish" && p.flarePhase === "bloom";
}

/** Whether a point lies inside a burning bloom's disc. */
export function inFlare(w: FathomState, x: number, y: number): boolean {
  return w.predators.some(
    (p) => blooming(p) && Math.hypot(p.x - x, p.y - y) <= FLARE_RADIUS,
  );
}

/** Marks every tile a forager pulse's front has flooded, and the rock bounding it. */
function floodSonar(
  pulse: Pulse,
  tiles: readonly string[],
  out: Uint8Array,
): void {
  for (let i = 0; i < TILE_COUNT; i++) {
    const d = pulse.dist[i];
    if (d < 0 || d > pulse.front) continue;
    out[i] = 1;
    const tx = i % GRID_COLS;
    const ty = (i - tx) / GRID_COLS;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = tx + ox;
        const ny = ty + oy;
        if (nx < 0 || ny < 0 || nx >= GRID_COLS || ny >= GRID_ROWS) continue;
        if (tileAt(tiles, nx, ny) === ROCK) out[index(nx, ny)] = 1;
      }
    }
  }
}

/** Whether a predator takes part in play at all on this layout. */
export function inPlay(w: FathomState, p: Predator): boolean {
  return p.state !== "den" || hasDen(w.tiles);
}

/**
 * Refreshes `visibility` and every body's `lit` from the sources holding light
 * this instant. Mutates the draft.
 */
export function sense(w: FathomState): void {
  const light = lightSet(w);
  const lit = light.slice();
  for (const pulse of w.pulses) {
    if (pulse.source === "forager") floodSonar(pulse, w.tiles, lit);
  }
  const flares = w.predators.filter(blooming);
  if (flares.length > 0) {
    for (let ty = 0; ty < GRID_ROWS; ty++) {
      for (let tx = 0; tx < GRID_COLS; tx++) {
        const cx = centerX(tx);
        const cy = centerY(ty);
        if (
          flares.some((p) => Math.hypot(p.x - cx, p.y - cy) <= FLARE_RADIUS)
        ) {
          lit[index(tx, ty)] = 1;
        }
      }
    }
  }
  const rows: string[] = [];
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    let row = "";
    const prev = w.visibility[ty];
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (lit[index(tx, ty)]) row += "l";
      else row += prev[tx] === "u" ? "u" : "r";
    }
    rows.push(row);
  }
  w.visibility = rows;

  for (const p of w.predators) {
    const waiting = p.state === "den" && !p.released;
    p.lit =
      !waiting &&
      inPlay(w, p) &&
      (light[index(p.tx, p.ty)] === 1 ||
        p.markLeft > 0 ||
        p.alertLeft > 0 ||
        inFlare(w, p.x, p.y));
  }
  for (const d of w.drifters) {
    d.lit = light[index(d.tx, d.ty)] === 1 || inFlare(w, d.x, d.y);
  }
}
