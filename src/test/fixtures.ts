// Hand-made layouts for posing scenarios with `setMaze`.

import { GRID_COLS, GRID_ROWS } from "../constants";

/**
 * A plain test maze: a ring around the border, a full-width tunnel row 5, a
 * corridor along row 12, a vertical corridor down column 10, and the den with
 * its gate at (17, 6) opening onto row 5.
 */
export function fixture(): string[] {
  const g: string[][] = Array.from({ length: GRID_ROWS }, () =>
    new Array<string>(GRID_COLS).fill("#"),
  );
  for (let x = 1; x <= 34; x++) {
    g[1][x] = ".";
    g[16][x] = ".";
    g[12][x] = ".";
  }
  for (let x = 0; x <= 35; x++) g[5][x] = ".";
  for (let y = 1; y <= 16; y++) {
    g[y][1] = ".";
    g[y][34] = ".";
    g[y][10] = ".";
  }
  for (let y = 7; y <= 9; y++) for (let x = 16; x <= 19; x++) g[y][x] = "d";
  g[6][17] = "g";
  return g.map((row) => row.join(""));
}

/** The fixture with no den and no gate. */
export function denless(): string[] {
  return fixture().map((row) => row.replace(/[dg]/g, "#"));
}
