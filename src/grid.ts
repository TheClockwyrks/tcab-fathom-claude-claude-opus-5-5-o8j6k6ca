// The tile grid: coordinates, neighbors (with the wrap tunnel), breadth-first
// distances, and straight-line traversal. Everything here is a pure function of
// the layout rows, so the simulation, the sensing and the renderer share one
// reading of the maze.

import {
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  TILE,
} from "./constants";
import type { Dir, TilePos } from "./game";

export const TILE_COUNT = GRID_COLS * GRID_ROWS;

/** The width of the maze region, which a wrap crossing carries a body across. */
export const MAZE_W = GRID_COLS * TILE;

export const ROCK = "#";
export const CORRIDOR = ".";
export const DEN = "d";
export const GATE = "g";

/** The four headings, in the order every deterministic tie-break uses. */
export const DIRS: readonly Dir[] = ["up", "left", "down", "right"];

export const DX: Readonly<Record<Dir, number>> = {
  up: 0,
  down: 0,
  left: -1,
  right: 1,
};
export const DY: Readonly<Record<Dir, number>> = {
  up: -1,
  down: 1,
  left: 0,
  right: 0,
};
export const OPPOSITE: Readonly<Record<Dir, Dir>> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export function isDir(value: unknown): value is Dir {
  return (
    value === "up" || value === "down" || value === "left" || value === "right"
  );
}

export function horizontal(dir: Dir): boolean {
  return dir === "left" || dir === "right";
}

export function perpendicular(a: Dir, b: Dir): boolean {
  return horizontal(a) !== horizontal(b);
}

export function index(tx: number, ty: number): number {
  return ty * GRID_COLS + tx;
}

export function inGrid(tx: number, ty: number): boolean {
  return tx >= 0 && tx < GRID_COLS && ty >= 0 && ty < GRID_ROWS;
}

/** The tile character at `(tx, ty)`, with everything off the grid read as rock. */
export function tileAt(
  tiles: readonly string[],
  tx: number,
  ty: number,
): string {
  if (!inGrid(tx, ty)) return ROCK;
  return tiles[ty][tx];
}

export function centerX(tx: number): number {
  return GRID_ORIGIN_X + tx * TILE + TILE / 2;
}

export function centerY(ty: number): number {
  return GRID_ORIGIN_Y + ty * TILE + TILE / 2;
}

/** The column whose bounds contain `x`, wrapped onto the grid. */
export function tileOfX(x: number): number {
  const c = Math.floor((x - GRID_ORIGIN_X) / TILE);
  return ((c % GRID_COLS) + GRID_COLS) % GRID_COLS;
}

/** The row whose bounds contain `y`, clamped onto the grid. */
export function tileOfY(y: number): number {
  const r = Math.floor((y - GRID_ORIGIN_Y) / TILE);
  return Math.min(GRID_ROWS - 1, Math.max(0, r));
}

/** Folds an x carried past either border back into the maze region. */
export function wrapX(x: number): number {
  if (x < GRID_ORIGIN_X) return x + MAZE_W;
  if (x >= GRID_ORIGIN_X + MAZE_W) return x - MAZE_W;
  return x;
}

/**
 * The wrap tunnel's row: the first row whose column `0` and column `35` tiles
 * are both open, or `null` when no row is pierced.
 */
export function tunnelRow(tiles: readonly string[]): number | null {
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    if (tiles[ty][0] !== ROCK && tiles[ty][GRID_COLS - 1] !== ROCK) return ty;
  }
  return null;
}

/**
 * The neighbor of `(tx, ty)` toward `dir`, crossing the wrap tunnel between its
 * two mouths, or `null` when that way leaves the grid.
 */
export function neighbor(
  tx: number,
  ty: number,
  dir: Dir,
  tunnel: number | null,
): TilePos | null {
  let nx = tx + DX[dir];
  const ny = ty + DY[dir];
  if (ny < 0 || ny >= GRID_ROWS) return null;
  if (nx < 0 || nx >= GRID_COLS) {
    if (tunnel !== ty) return null;
    nx = (nx + GRID_COLS) % GRID_COLS;
  }
  return { tx: nx, ty: ny };
}

/**
 * Breadth-first path distances, in steps, from every source tile over the tiles
 * `passable` admits. Unreached tiles read `-1`. The sources are always distance
 * `0`, passable or not.
 */
export function distances(
  tiles: readonly string[],
  sources: readonly TilePos[],
  passable: (ch: string) => boolean,
): Int16Array {
  const tunnel = tunnelRow(tiles);
  const dist = new Int16Array(TILE_COUNT).fill(-1);
  const queue: number[] = [];
  for (const s of sources) {
    const i = index(s.tx, s.ty);
    if (dist[i] === -1) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const tx = i % GRID_COLS;
    const ty = (i - tx) / GRID_COLS;
    for (const dir of DIRS) {
      const n = neighbor(tx, ty, dir, tunnel);
      if (n === null) continue;
      const j = index(n.tx, n.ty);
      if (dist[j] !== -1 || !passable(tiles[n.ty][n.tx])) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return dist;
}

/**
 * Calls `visit` for every tile the straight segment between two points passes
 * through, in order, stopping early when `visit` returns `true`. A segment that
 * runs exactly through a tile corner visits both tiles beside the corner, so
 * light never slips between two diagonal rocks. Returns whether it stopped.
 */
export function traverse(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (tx: number, ty: number) => boolean,
): boolean {
  const gx0 = (x0 - GRID_ORIGIN_X) / TILE;
  const gy0 = (y0 - GRID_ORIGIN_Y) / TILE;
  const gx1 = (x1 - GRID_ORIGIN_X) / TILE;
  const gy1 = (y1 - GRID_ORIGIN_Y) / TILE;
  let cx = Math.floor(gx0);
  let cy = Math.floor(gy0);
  const ex = Math.floor(gx1);
  const ey = Math.floor(gy1);
  const dx = gx1 - gx0;
  const dy = gy1 - gy0;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const tDeltaX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
  const tDeltaY = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
  let tMaxX =
    dx > 0 ? (cx + 1 - gx0) / dx : dx < 0 ? (gx0 - cx) / -dx : Infinity;
  let tMaxY =
    dy > 0 ? (cy + 1 - gy0) / dy : dy < 0 ? (gy0 - cy) / -dy : Infinity;
  if (visit(cx, cy)) return true;
  let guard = 0;
  while ((cx !== ex || cy !== ey) && guard++ < 256) {
    if (Math.abs(tMaxX - tMaxY) < 1e-9) {
      if (tMaxX > 1) break;
      if (visit(cx + stepX, cy) || visit(cx, cy + stepY)) return true;
      cx += stepX;
      cy += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      if (tMaxX > 1) break;
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      if (tMaxY > 1) break;
      cy += stepY;
      tMaxY += tDeltaY;
    }
    if (visit(cx, cy)) return true;
  }
  return false;
}

/**
 * Whether the straight segment between two points crosses a rock tile, leaving
 * out the tile at the far end when `exceptEnd` is set.
 */
export function crossesRock(
  tiles: readonly string[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  exceptEnd = false,
): boolean {
  const endX = tileOfXUnwrapped(x1);
  const endY = Math.floor((y1 - GRID_ORIGIN_Y) / TILE);
  return traverse(x0, y0, x1, y1, (tx, ty) => {
    if (exceptEnd && tx === endX && ty === endY) return false;
    return tileAt(tiles, tx, ty) === ROCK;
  });
}

function tileOfXUnwrapped(x: number): number {
  return Math.floor((x - GRID_ORIGIN_X) / TILE);
}

/** The distance from point `(px, py)` to the segment `(x0, y0)`–`(x1, y1)`. */
export function segmentDistance(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** Replaces one character of one row, returning the new rows. */
export function setChar(
  rows: readonly string[],
  tx: number,
  ty: number,
  ch: string,
): string[] {
  const out = rows.slice();
  const row = out[ty];
  out[ty] = row.slice(0, tx) + ch + row.slice(tx + 1);
  return out;
}

/** `GRID_ROWS` rows of `GRID_COLS` copies of `ch`. */
export function filledRows(ch: string): string[] {
  return Array.from({ length: GRID_ROWS }, () => ch.repeat(GRID_COLS));
}
