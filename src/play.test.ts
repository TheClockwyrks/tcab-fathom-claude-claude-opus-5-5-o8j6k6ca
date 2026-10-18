import { describe, expect, it } from "vitest";
import {
  BRIGHT_HALFLIFE,
  DRIFTER_INTERVAL,
  FORAGER_SPEED,
  INK_COOLDOWN,
  SONAR_COOLDOWN,
  TICK_DT,
} from "./constants";
import { centerX, centerY } from "./grid";
import { boot, snap, stage } from "./test/harness";
import { denless, fixture } from "./test/fixtures";

describe("the forager's travel", () => {
  it("travels at its speed while a key is held and rests when released", async () => {
    const h = await boot();
    stage(h, fixture(), 5, 12);
    h.key("ArrowRight", true);
    await h.engine.advance(60);
    let f = snap(h).forager;
    expect(f.x).toBeCloseTo(centerX(5) + FORAGER_SPEED * 60 * TICK_DT, 5);
    expect(f.moving).toBe(true);
    expect(f.dir).toBe("right");
    h.key("ArrowRight", false);
    await h.engine.advance(2);
    f = snap(h).forager;
    expect(f.moving).toBe(false);
    const x = f.x;
    await h.engine.advance(30);
    expect(snap(h).forager.x).toBe(x);
  });

  it("reverses at once and buffers a turn to the next center", async () => {
    const h = await boot();
    stage(h, fixture(), 7, 12);
    h.key("ArrowRight", true);
    await h.engine.advance(20);
    h.key("ArrowRight", false);
    h.key("ArrowLeft", true);
    await h.engine.advance(1);
    expect(snap(h).forager.dir).toBe("left");
    h.key("ArrowLeft", false);
    // Toward (10, 12), where column 10 runs up: press up early.
    h.engine.apply((s) => h.debug.setForagerTile(s, 8, 12));
    h.key("ArrowRight", true);
    await h.engine.advance(10);
    h.key("ArrowUp", true);
    await h.engine.advance(1);
    h.key("ArrowUp", false);
    expect(snap(h).forager.dir).toBe("right");
    await h.engine.advance(80);
    const f = snap(h).forager;
    expect(f.tx).toBe(10);
    expect(f.dir).toBe("up");
    expect(f.ty).toBeLessThan(12);
    h.key("ArrowRight", false);
  });

  it("stops at a wall and never enters rock or the den", async () => {
    const h = await boot();
    stage(h, fixture(), 3, 12);
    h.engine.apply((s) => h.debug.setForagerDir(s, "up"));
    h.key("ArrowUp", true);
    await h.engine.advance(60);
    const f = snap(h).forager;
    expect(f.ty).toBe(12);
    expect(f.moving).toBe(false);
    h.key("ArrowUp", false);
    h.engine.apply((s) => h.debug.setForagerTile(s, 17, 5));
    h.key("ArrowDown", true);
    await h.engine.advance(60);
    expect(snap(h).forager.ty).toBe(5);
    h.key("ArrowDown", false);
  });

  it("crosses the wrap tunnel as one step", async () => {
    const h = await boot();
    stage(h, fixture(), 0, 5);
    h.key("ArrowLeft", true);
    await h.engine.advance(20);
    let f = snap(h).forager;
    expect(f.tx).toBe(35);
    expect(f.x).toBeCloseTo(
      centerX(0) - FORAGER_SPEED * 20 * TICK_DT + 1152,
      4,
    );
    expect(f.x).toBeLessThanOrEqual(1216);
    await h.engine.advance(30);
    f = snap(h).forager;
    expect(f.tx).toBe(34);
    h.key("ArrowLeft", false);
  });
});

describe("grazing and brightness", () => {
  it("eats the plankton on its tile, scores, and brightens with a hold", async () => {
    const h = await boot();
    stage(h, fixture(), 5, 12);
    h.engine.apply((s) => h.debug.setPlankton(s, 6, 12, true));
    h.engine.apply((s) => h.debug.setPlankton(s, 20, 12, true));
    h.key("ArrowRight", true);
    await h.engine.advance(16);
    let s = snap(h);
    expect(s.score).toBe(10);
    expect(s.planktonRemaining).toBe(1);
    expect(s.brightness).toBeCloseTo(0.34);
    expect(s.brightHold).toBeGreaterThan(0.9);
    expect(s.visionRadius).toBeCloseTo(96 + 64 * 0.34);
    expect(s.windowRadius).toBeCloseTo(192 + 128 * 0.34);
    expect(h.cues).toContain("eat");
    h.key("ArrowRight", false);
    await h.seconds(1);
    s = snap(h);
    expect(s.brightHold).toBe(0);
    const g = s.brightness;
    await h.seconds(BRIGHT_HALFLIFE);
    expect(snap(h).brightness).toBeCloseTo(g / 2, 3);
  });

  it("clamps brightness at one", async () => {
    const h = await boot();
    stage(h, fixture(), 2, 12);
    for (let x = 3; x <= 8; x++)
      h.engine.apply((s) => h.debug.setPlankton(s, x, 12, true));
    h.key("ArrowRight", true);
    await h.seconds(1.6);
    expect(snap(h).brightness).toBe(1);
    h.key("ArrowRight", false);
  });
});

describe("the fog of war", () => {
  it("lights a straight-line pocket and remembers it", async () => {
    const h = await boot();
    stage(h, fixture(), 5, 12);
    await h.engine.advance(1);
    let s = snap(h);
    expect(s.visibility[12][5]).toBe("l");
    expect(s.visibility[12][7]).toBe("l");
    expect(s.visibility[11][5]).toBe("l");
    expect(s.visibility[10][5]).toBe("u");
    expect(s.visibility[12][9]).toBe("u");
    h.engine.apply((st) => h.debug.setForagerTile(st, 20, 12));
    await h.engine.advance(1);
    s = snap(h);
    expect(s.visibility[12][5]).toBe("r");
    expect(s.visibility[12][20]).toBe("l");
    h.engine.apply((st) => h.debug.clearFog(st));
    h.engine.apply((st) => h.debug.reconcile(st));
    expect(snap(h).visibility.every((r) => /^u+$/.test(r))).toBe(true);
  });
});

describe("the sonar pulse", () => {
  it("floods the corridors as a front, on a cooldown", async () => {
    const h = await boot();
    stage(h, fixture(), 5, 12);
    await h.tap("Space");
    let s = snap(h);
    expect(s.pulses).toHaveLength(1);
    expect(s.pulses[0]).toMatchObject({
      source: "forager",
      tint: "cyan",
      ox: 5,
      oy: 12,
      range: 9,
    });
    expect(s.sonar.ready).toBe(false);
    expect(s.sonar.cooldown).toBeCloseTo(SONAR_COOLDOWN - TICK_DT, 6);
    expect(h.cues).toContain("sonar");
    await h.tap("Space");
    expect(snap(h).pulses).toHaveLength(1);
    await h.seconds(0.5);
    s = snap(h);
    expect(s.pulses[0].front).toBeCloseTo(14 * 0.5 + 14 * 2 * TICK_DT, 4);
    // Seven steps along row 12 and up column 10, but nothing sealed off.
    expect(s.visibility[12][12]).toBe("l");
    expect(s.visibility[10][10]).toBe("l");
    expect(s.visibility[9][10]).toBe("u");
    expect(s.visibility[11][12]).toBe("l");
    expect(s.visibility[3][3]).toBe("u");
    await h.seconds(0.3);
    expect(snap(h).pulses).toHaveLength(0);
    expect(snap(h).visibility[12][12]).toBe("r");
    await h.seconds(1);
    expect(snap(h).sonar.ready).toBe(true);
  });

  it("marks a Gloamfin and a Flarefish but never a Lanternjaw", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 3, 12);
    h.engine.apply((s) => d.addPredator(s, "flarefish", 8, 12));
    h.engine.apply((s) => d.addPredator(s, "lanternjaw", 3, 16));
    h.engine.apply((s) => d.setPredatorMind(s, 0, false));
    h.engine.apply((s) => d.setPredatorMind(s, 1, false));
    await h.tap("Space");
    await h.seconds(0.45);
    const s = snap(h);
    expect(s.predators[0].lit).toBe(true);
    expect(s.predators[1].lit).toBe(false);
  });
});

describe("ink", () => {
  it("drops a cloud on the forager that thins away", async () => {
    const h = await boot();
    stage(h, fixture(), 5, 12);
    await h.tap("ShiftLeft");
    let s = snap(h);
    expect(s.inkClouds).toHaveLength(1);
    expect(s.inkClouds[0]).toMatchObject({
      x: centerX(5),
      y: centerY(12),
      radius: 80,
    });
    expect(s.ink.cooldown).toBeCloseTo(INK_COOLDOWN - TICK_DT, 6);
    expect(h.cues).toContain("ink");
    await h.seconds(3);
    s = snap(h);
    expect(s.inkClouds).toHaveLength(0);
  });
});

describe("bonus drifters", () => {
  it("admits drifters at the gate on the cadence up to the ceiling", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 2, 16);
    h.engine.apply((s) => d.setPlankton(s, 30, 16, true));
    h.engine.apply((s) => d.setDrifterIn(s, 0.05));
    await h.seconds(0.1);
    let s = snap(h);
    expect(s.drifters).toHaveLength(1);
    expect(s.drifters[0]).toMatchObject({
      tx: 17,
      ty: 6,
      mind: true,
      travel: true,
    });
    expect(s.drifterIn).toBeGreaterThan(DRIFTER_INTERVAL - 0.1);
    await h.seconds(2);
    expect(snap(h).drifters[0].ty).toBeLessThanOrEqual(5);
    h.engine.apply((st) => d.spawnDrifter(st, 3, 16));
    h.engine.apply((st) => d.spawnDrifter(st, 4, 16));
    h.engine.apply((st) => d.setDrifterIn(st, 0.01));
    await h.engine.advance(3);
    s = snap(h);
    expect(s.drifters).toHaveLength(3);
  });

  it("is eaten for the bonus and holds still with its travel off", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 2, 16);
    h.engine.apply((s) => d.spawnDrifter(s, 4, 16));
    h.engine.apply((s) => d.setDrifterTravel(s, 0, false));
    await h.seconds(1);
    expect(snap(h).drifters[0].x).toBe(centerX(4));
    h.key("ArrowRight", true);
    await h.seconds(0.6);
    h.key("ArrowRight", false);
    const s = snap(h);
    expect(s.drifters).toHaveLength(0);
    expect(s.score).toBe(200);
  });

  it("wanders through the corridors with its mind on", async () => {
    const h = await boot();
    stage(h, fixture(), 2, 16);
    h.engine.apply((s) => h.debug.spawnDrifter(s, 20, 12));
    await h.seconds(1);
    const s = snap(h);
    expect(
      Math.abs(s.drifters[0].x - centerX(20)) +
        Math.abs(s.drifters[0].y - centerY(12)),
    ).toBeCloseTo(64, 0);
  });

  it("admits none without plankton or a gate", async () => {
    const h = await boot();
    stage(h, denless(), 2, 16);
    h.engine.apply((s) => h.debug.setPlankton(s, 30, 16, true));
    h.engine.apply((s) => h.debug.setDrifterIn(s, 0));
    await h.engine.advance(2);
    expect(snap(h).drifters).toHaveLength(0);
  });
});

describe("contact", () => {
  it("costs a life and resets the attempt, keeping what was revealed", async () => {
    const h = await boot();
    const d = h.debug;
    await h.tap("Enter");
    await h.seconds(2.1);
    const before = snap(h);
    const { tx, ty } = before.forager;
    h.engine.apply((s) => d.setLives(s, 2));
    h.engine.apply((s) => d.setPredatorTile(s, 0, tx, ty));
    h.engine.apply((s) => d.setPredatorState(s, 0, "wander"));
    h.engine.apply((s) => d.setSonarCooldown(s, 1));
    await h.engine.advance(1);
    const s = snap(h);
    expect(h.cues).toContain("caught");
    expect(s.screen).toBe("countdown");
    expect(s.lives).toBe(1);
    expect(s.predators.every((p) => p.state === "den" && !p.released)).toBe(
      true,
    );
    expect(s.sonar.ready).toBe(true);
    expect(s.visibility[ty][tx]).not.toBe("u");
    expect(s.planktonRemaining).toBe(before.planktonRemaining);
  });

  it("ends the dive with no life in reserve", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 5, 12);
    h.engine.apply((s) => d.setLives(s, 0));
    h.engine.apply((s) => d.addPredator(s, "lanternjaw", 5, 12));
    await h.engine.advance(1);
    expect(snap(h).screen).toBe("gameover");
    expect(snap(h).menuIndex).toBe(0);
  });

  it("holds a den predator out of play on a layout with no den", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, denless(), 5, 12);
    h.engine.apply((s) => d.setDepth(s, 1));
    h.engine.apply((s) => d.setPredatorTile(s, 0, 5, 12));
    await h.seconds(1);
    const s = snap(h);
    expect(s.screen).toBe("playing");
    expect(s.predators[0]).toMatchObject({
      state: "den",
      released: true,
      tx: 5,
      ty: 12,
      lit: false,
    });
  });
});
