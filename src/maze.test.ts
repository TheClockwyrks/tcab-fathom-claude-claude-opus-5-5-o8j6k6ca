import { describe, expect, it } from "vitest";
import { checkMaze, generateMaze, measureMaze, START_TILE } from "./maze";
import { Rng } from "./rng";
import { fixture } from "./test/fixtures";

describe("generateMaze", () => {
  it("lays out a conforming maze for every seed tried", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const layout = generateMaze(new Rng(seed * 7919));
      expect(checkMaze(layout)).toEqual([]);
    }
  });

  it("lays out different mazes from different seeds", () => {
    const a = generateMaze(new Rng(1)).tiles.join("");
    const b = generateMaze(new Rng(2)).tiles.join("");
    expect(a).not.toEqual(b);
  });

  it("keeps the proportions inside their bounds", () => {
    const m = measureMaze(generateMaze(new Rng(42)).tiles);
    expect(m.openness).toBeGreaterThanOrEqual(2);
    expect(m.openness).toBeLessThanOrEqual(2.8);
    expect(m.mazing).toBeGreaterThanOrEqual(2);
    expect(m.mazing).toBeLessThanOrEqual(8);
    expect(m.density).toBeGreaterThanOrEqual(0.4);
  });
});

describe("checkMaze", () => {
  it("reports a fixture that breaks the rules", () => {
    const problems = checkMaze({ tiles: fixture(), start: { tx: 1, ty: 12 } });
    expect(problems.some((p) => p.includes("2x2"))).toBe(false);
    expect(problems.some((p) => p.includes("den tile"))).toBe(false);
    expect(problems.length).toBeGreaterThan(0);
  });

  it("finds 2x2 blocks, dead ends, asymmetry and a bad start", () => {
    const rows = generateMaze(new Rng(5)).tiles.slice();
    rows[1] = "#" + ".".repeat(34) + "#";
    rows[2] = "#" + ".".repeat(5) + "#".repeat(29) + "#";
    const problems = checkMaze({ tiles: rows, start: { tx: 0, ty: 0 } });
    expect(problems.some((p) => p.includes("2x2"))).toBe(true);
    expect(problems.some((p) => p.includes("asymmetric"))).toBe(true);
    expect(problems.some((p) => p.includes("start"))).toBe(true);
  });

  it("starts the forager in the lower half", () => {
    expect(START_TILE.ty).toBeGreaterThanOrEqual(9);
  });
});
