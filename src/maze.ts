// Laying out a maze, and checking one against every rule of specs/maze.md.
//
// The generator carves a braided maze on a lattice. Junction cells sit on even
// columns and odd rows of the left half, passages join neighboring cells, and
// the right half is the mirror image. Because the tile at every odd column and
// even row is rock, no 2 x 2 block of corridor can form, so every corridor is
// one tile wide by construction. Cells left with fewer than two passages are
// braided into a neighbor so the maze has no dead ends, and a few extra loops
// open it up. A candidate that misses any proportion is thrown away and the
// next one is drawn.

import {
  GRID_COLS,
  GRID_ROWS,
  MAZE_DENSITY_MAX,
  MAZE_DENSITY_MIN,
  MAZE_MAZING_MAX,
  MAZE_MAZING_MIN,
  MAZE_OPENNESS_MAX,
  MAZE_OPENNESS_MIN,
} from "./constants";
import type { TilePos } from "./game";
import {
  CORRIDOR,
  DEN,
  DIRS,
  GATE,
  ROCK,
  TILE_COUNT,
  distances,
  index,
  neighbor,
  tileAt,
  tunnelRow,
} from "./grid";
import type { Rng } from "./rng";

/** The den chamber's bounds, inclusive, and its gate. */
export const DEN_LEFT = 16;
export const DEN_RIGHT = 19;
export const DEN_TOP = 7;
export const DEN_BOTTOM = 9;
export const GATE_TILE: TilePos = { tx: 17, ty: 6 };

/** The forager's start tile in every generated maze. */
export const START_TILE: TilePos = { tx: 16, ty: 13 };

const CELL_COLS = [2, 4, 6, 8, 10, 12, 14, 16];
const CELL_ROWS = [1, 3, 5, 7, 9, 11, 13, 15];
const TUNNEL_ROWS = [1, 3, 5, 11, 13, 15];
/** Rows whose center passage may open; row 5 always does, under the gate. */
const CENTER_ROWS = [1, 3, 11, 13, 15];

export interface Layout {
  readonly tiles: readonly string[];
  readonly start: TilePos;
}

interface Edge {
  readonly a: number;
  readonly b: number;
  /** The tiles the passage carves, in the left half. */
  readonly carve: readonly TilePos[];
}

function isDenCell(c: number, r: number): boolean {
  return c === DEN_LEFT && (r === DEN_TOP || r === DEN_BOTTOM);
}

/** Lays out a fresh maze that satisfies every rule in specs/maze.md. */
export function generateMaze(rng: Rng): Layout {
  for (let attempt = 0; attempt < 500; attempt++) {
    const tiles = candidate(rng);
    const layout = { tiles, start: START_TILE };
    if (checkMaze(layout).length === 0) return layout;
  }
  throw new Error("Fathom: could not lay out a conforming maze");
}

function candidate(rng: Rng): string[] {
  // Nodes are the left-half cells, numbered row-major over CELL_COLS x CELL_ROWS.
  const nodeCount = CELL_COLS.length * CELL_ROWS.length;
  const node = (ci: number, ri: number): number => ri * CELL_COLS.length + ci;
  const cellOf = (n: number): TilePos => ({
    tx: CELL_COLS[n % CELL_COLS.length],
    ty: CELL_ROWS[Math.floor(n / CELL_COLS.length)],
  });
  const live = (n: number): boolean => {
    const c = cellOf(n);
    return !isDenCell(c.tx, c.ty);
  };

  const edges: Edge[] = [];
  for (let ri = 0; ri < CELL_ROWS.length; ri++) {
    for (let ci = 0; ci < CELL_COLS.length; ci++) {
      const n = node(ci, ri);
      if (!live(n)) continue;
      const { tx, ty } = cellOf(n);
      if (ci + 1 < CELL_COLS.length && live(node(ci + 1, ri))) {
        edges.push({ a: n, b: node(ci + 1, ri), carve: [{ tx: tx + 1, ty }] });
      }
      if (ri + 1 < CELL_ROWS.length && live(node(ci, ri + 1))) {
        edges.push({ a: n, b: node(ci, ri + 1), carve: [{ tx, ty: ty + 1 }] });
      }
    }
  }

  // A random spanning tree over the left half (randomized Kruskal).
  const parent = Array.from({ length: nodeCount }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const open = new Set<Edge>();
  for (const e of rng.shuffle(edges)) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra === rb) continue;
    parent[ra] = rb;
    open.add(e);
  }

  // Degree counts every passage a cell has, including its mirror links: the
  // center passage (column 16 to 19) and the wrap tunnel (column 2 to 33).
  const degree = new Array<number>(nodeCount).fill(0);
  for (const e of open) {
    degree[e.a]++;
    degree[e.b]++;
  }
  const tunnel = rng.pick(TUNNEL_ROWS);
  const centers = new Set<number>([5]);
  for (const r of rng.shuffle(CENTER_ROWS).slice(0, 1 + rng.int(2))) {
    centers.add(r);
  }
  degree[node(0, CELL_ROWS.indexOf(tunnel))]++;
  for (const r of centers)
    degree[node(CELL_COLS.length - 1, CELL_ROWS.indexOf(r))]++;

  // Braid away every dead end, then add a few loops.
  const closed = (): Edge[] => edges.filter((e) => !open.has(e));
  for (const n of rng.shuffle([...Array(nodeCount).keys()])) {
    if (!live(n) || degree[n] >= 2) continue;
    const options = closed().filter((e) => e.a === n || e.b === n);
    if (options.length === 0) continue;
    const lonely = options.filter((e) => degree[e.a === n ? e.b : e.a] < 2);
    const e = rng.pick(lonely.length > 0 ? lonely : options);
    open.add(e);
    degree[e.a]++;
    degree[e.b]++;
  }
  const loops = 2 + rng.int(6);
  for (const e of rng.shuffle(closed()).slice(0, loops)) open.add(e);

  // Carve the left half, then mirror it.
  const grid: string[][] = Array.from({ length: GRID_ROWS }, () =>
    new Array<string>(GRID_COLS).fill(ROCK),
  );
  const carve = (tx: number, ty: number): void => {
    grid[ty][tx] = CORRIDOR;
    grid[ty][GRID_COLS - 1 - tx] = CORRIDOR;
  };
  for (let n = 0; n < nodeCount; n++) {
    if (live(n)) carve(cellOf(n).tx, cellOf(n).ty);
  }
  for (const e of open) for (const t of e.carve) carve(t.tx, t.ty);
  for (const r of centers) carve(17, r);
  carve(0, tunnel);
  carve(1, tunnel);

  for (let ty = DEN_TOP; ty <= DEN_BOTTOM; ty++) {
    for (let tx = DEN_LEFT; tx <= DEN_RIGHT; tx++) grid[ty][tx] = DEN;
  }
  grid[GATE_TILE.ty][GATE_TILE.tx] = GATE;
  return grid.map((row) => row.join(""));
}

/** The three proportions specs/maze.md fixes, over the corridor tiles alone. */
export interface MazeMeasures {
  readonly openness: number;
  readonly mazing: number;
  readonly density: number;
}

export function measureMaze(tiles: readonly string[]): MazeMeasures {
  const tunnel = tunnelRow(tiles);
  const corridorNeighbors = (tx: number, ty: number): TilePos[] => {
    const out: TilePos[] = [];
    for (const dir of DIRS) {
      const n = neighbor(tx, ty, dir, tunnel);
      if (n !== null && tileAt(tiles, n.tx, n.ty) === CORRIDOR) out.push(n);
    }
    return out;
  };
  let corridors = 0;
  let neighborSum = 0;
  const twoWay = new Uint8Array(TILE_COUNT);
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (tiles[ty][tx] !== CORRIDOR) continue;
      const count = corridorNeighbors(tx, ty).length;
      corridors++;
      neighborSum += count;
      if (count === 2) twoWay[index(tx, ty)] = 1;
    }
  }
  // Corridor runs: connected groups of tiles with exactly two corridor neighbors.
  const seen = new Uint8Array(TILE_COUNT);
  let runs = 0;
  let runTiles = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    if (!twoWay[i] || seen[i]) continue;
    runs++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length > 0) {
      const j = stack.pop() as number;
      runTiles++;
      const tx = j % GRID_COLS;
      const ty = (j - tx) / GRID_COLS;
      for (const n of corridorNeighbors(tx, ty)) {
        const k = index(n.tx, n.ty);
        if (twoWay[k] && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
  }
  return {
    openness: corridors > 0 ? neighborSum / corridors : 0,
    mazing: runs > 0 ? runTiles / runs : 0,
    density: corridors / ((GRID_COLS - 2) * (GRID_ROWS - 2)),
  };
}

/**
 * Every rule of specs/maze.md the layout breaks, as readable messages. An empty
 * list is a conforming maze.
 */
export function checkMaze(layout: Layout): string[] {
  const { tiles, start } = layout;
  const problems: string[] = [];
  const tunnel = tunnelRow(tiles);
  const at = (tx: number, ty: number): string => tileAt(tiles, tx, ty);

  // Corridor width.
  for (let ty = 0; ty + 1 < GRID_ROWS; ty++) {
    for (let tx = 0; tx + 1 < GRID_COLS; tx++) {
      if (
        at(tx, ty) === CORRIDOR &&
        at(tx + 1, ty) === CORRIDOR &&
        at(tx, ty + 1) === CORRIDOR &&
        at(tx + 1, ty + 1) === CORRIDOR
      ) {
        problems.push(`2x2 corridor block at (${tx}, ${ty})`);
      }
    }
  }
  // Mirror symmetry.
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS / 2; tx++) {
      const a = at(tx, ty);
      const b = at(GRID_COLS - 1 - tx, ty);
      if (a === DEN || a === GATE || b === DEN || b === GATE) continue;
      if ((a === ROCK) !== (b === ROCK)) {
        problems.push(`asymmetric pair at (${tx}, ${ty})`);
      }
    }
  }
  // Border and wrap tunnel.
  const pierced: number[] = [];
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    const l = at(0, ty);
    const r = at(GRID_COLS - 1, ty);
    if (l === CORRIDOR && r === CORRIDOR) pierced.push(ty);
    else if (l !== ROCK || r !== ROCK)
      problems.push(`open border in row ${ty}`);
  }
  if (pierced.length !== 1) problems.push("exactly one row must be pierced");
  for (let tx = 0; tx < GRID_COLS; tx++) {
    if (at(tx, 0) !== ROCK || at(tx, GRID_ROWS - 1) !== ROCK) {
      problems.push(`open border in column ${tx}`);
    }
  }
  if (tunnel !== null && tiles[tunnel].includes(DEN)) {
    problems.push("the tunnel row carries den tiles");
  }
  if (tunnel !== null && tiles[tunnel].includes(GATE)) {
    problems.push("the tunnel row carries the gate");
  }
  // No dead ends, and one connected region.
  const corridorTiles: TilePos[] = [];
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (at(tx, ty) !== CORRIDOR) continue;
      corridorTiles.push({ tx, ty });
      let count = 0;
      for (const dir of DIRS) {
        const n = neighbor(tx, ty, dir, tunnel);
        if (n !== null && at(n.tx, n.ty) === CORRIDOR) count++;
      }
      if (count < 2) problems.push(`dead end at (${tx}, ${ty})`);
    }
  }
  if (at(start.tx, start.ty) !== CORRIDOR) {
    problems.push("the start tile is not a corridor");
  }
  if (start.ty < 9 || start.ty > 16) {
    problems.push("the start tile is outside rows 9 to 16");
  }
  const reach = distances(tiles, [start], (ch) => ch === CORRIDOR);
  if (corridorTiles.some((t) => reach[index(t.tx, t.ty)] < 0)) {
    problems.push("the corridors are not one connected region");
  }
  // The den.
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const inside =
        tx >= DEN_LEFT && tx <= DEN_RIGHT && ty >= DEN_TOP && ty <= DEN_BOTTOM;
      if (inside !== (at(tx, ty) === DEN)) {
        problems.push(`den tile mismatch at (${tx}, ${ty})`);
      }
    }
  }
  const gates: TilePos[] = [];
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (at(tx, ty) === GATE) gates.push({ tx, ty });
    }
  }
  if (
    gates.length !== 1 ||
    gates[0].ty !== DEN_TOP - 1 ||
    gates[0].tx < DEN_LEFT ||
    gates[0].tx > DEN_RIGHT
  ) {
    problems.push("the den needs exactly one gate above its top row");
  }
  for (let ty = DEN_TOP; ty <= DEN_BOTTOM; ty++) {
    for (let tx = DEN_LEFT; tx <= DEN_RIGHT; tx++) {
      for (const dir of DIRS) {
        const n = neighbor(tx, ty, dir, tunnel);
        if (n !== null && at(n.tx, n.ty) === CORRIDOR) {
          problems.push(`den tile (${tx}, ${ty}) opens onto a corridor`);
        }
      }
    }
  }
  const denReach = distances(tiles, [start], (ch) => ch !== ROCK);
  for (let ty = DEN_TOP; ty <= DEN_BOTTOM; ty++) {
    for (let tx = DEN_LEFT; tx <= DEN_RIGHT; tx++) {
      if (denReach[index(tx, ty)] < 0) {
        problems.push(`den tile (${tx}, ${ty}) cannot reach the start`);
      }
    }
  }
  // Proportions.
  const m = measureMaze(tiles);
  if (m.openness < MAZE_OPENNESS_MIN || m.openness > MAZE_OPENNESS_MAX) {
    problems.push(`openness ${m.openness.toFixed(3)} out of bounds`);
  }
  if (m.mazing < MAZE_MAZING_MIN || m.mazing > MAZE_MAZING_MAX) {
    problems.push(`corridor run ${m.mazing.toFixed(3)} out of bounds`);
  }
  if (m.density < MAZE_DENSITY_MIN || m.density > MAZE_DENSITY_MAX) {
    problems.push(`density ${m.density.toFixed(3)} out of bounds`);
  }
  return problems;
}
