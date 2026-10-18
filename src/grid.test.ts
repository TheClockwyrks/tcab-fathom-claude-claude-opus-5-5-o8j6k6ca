import { describe, expect, it } from "vitest";
import {
  crossesRock,
  distances,
  index,
  neighbor,
  centerX,
  centerY,
  tileOfX,
  traverse,
  tunnelRow,
  wrapX,
  segmentDistance,
} from "./grid";
import { Rng } from "./rng";
import { fixture } from "./test/fixtures";

describe("the grid", () => {
  it("finds the tunnel and wraps across it", () => {
    const rows = fixture();
    expect(tunnelRow(rows)).toBe(5);
    expect(neighbor(0, 5, "left", 5)).toEqual({ tx: 35, ty: 5 });
    expect(neighbor(35, 5, "right", 5)).toEqual({ tx: 0, ty: 5 });
    expect(neighbor(0, 4, "left", 5)).toBeNull();
    expect(neighbor(3, 0, "up", 5)).toBeNull();
  });

  it("wraps x and maps it to a column", () => {
    expect(wrapX(63)).toBe(63 + 1152);
    expect(wrapX(1216)).toBe(64);
    expect(tileOfX(64)).toBe(0);
    expect(tileOfX(1215)).toBe(35);
  });

  it("measures path distances through the wrap", () => {
    const rows = fixture();
    const d = distances(rows, [{ tx: 0, ty: 5 }], (ch) => ch === ".");
    expect(d[index(35, 5)]).toBe(1);
    expect(d[index(2, 5)]).toBe(2);
    expect(d[index(0, 0)]).toBe(-1);
  });

  it("traverses corners on both sides", () => {
    const seen: string[] = [];
    traverse(centerX(1), centerY(1), centerX(3), centerY(3), (tx, ty) => {
      seen.push(`${tx},${ty}`);
      return false;
    });
    expect(seen).toContain("2,1");
    expect(seen).toContain("1,2");
    expect(seen[seen.length - 1]).toBe("3,3");
  });

  it("stops a segment at rock", () => {
    const rows = fixture();
    expect(
      crossesRock(rows, centerX(2), centerY(12), centerX(8), centerY(12)),
    ).toBe(false);
    expect(
      crossesRock(rows, centerX(5), centerY(12), centerX(5), centerY(10)),
    ).toBe(true);
    expect(
      crossesRock(rows, centerX(5), centerY(12), centerX(5), centerY(11), true),
    ).toBe(false);
  });

  it("measures point-to-segment distances", () => {
    expect(segmentDistance(5, 5, 0, 0, 10, 0)).toBe(5);
    expect(segmentDistance(-3, 4, 0, 0, 10, 0)).toBe(5);
    expect(segmentDistance(1, 1, 0, 0, 0, 0)).toBeCloseTo(Math.SQRT2);
  });
});

describe("Rng", () => {
  it("is reproducible from its seed", () => {
    const a = new Rng(99);
    const b = new Rng(99);
    expect([a.next(), a.int(10), a.pick([1, 2, 3])]).toEqual([
      b.next(),
      b.int(10),
      b.pick([1, 2, 3]),
    ]);
    expect(a.shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });
});
