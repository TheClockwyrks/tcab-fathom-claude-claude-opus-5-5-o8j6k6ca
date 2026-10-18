import { describe, expect, it } from "vitest";
import { BRIGHT_HOLD, DRIFTER_INTERVAL } from "./constants";
import { boot, snap, stage } from "./test/harness";
import { fixture } from "./test/fixtures";

describe("the debug surface", () => {
  it("carries its version and refuses invalid arguments loudly", async () => {
    const h = await boot();
    const d = h.debug;
    const s = h.engine.state;
    expect(d.version).toBe(1);
    expect(() => d.setScreen(s, "nowhere" as never)).toThrow();
    expect(() => d.setMenuIndex(s, 2)).toThrow();
    expect(() => d.setTitleIndex(s, -1)).toThrow();
    expect(() => d.setScore(s, 1.5)).toThrow();
    expect(() => d.setLives(s, -1)).toThrow();
    expect(() => d.setDepth(s, 0)).toThrow();
    expect(() => d.setMaze(s, ["#"])).toThrow();
    expect(() =>
      d.setMaze(
        s,
        fixture().map((r) => r.replace("g", "d")),
      ),
    ).toThrow();
    expect(() =>
      d.setMaze(
        s,
        fixture().map((r, i) => (i === 1 ? "x" + r.slice(1) : r)),
      ),
    ).toThrow();
    expect(() => d.setPlankton(s, 0, 0, true)).toThrow();
    expect(() => d.setForagerTile(s, 99, 0)).toThrow();
    expect(() => d.setForagerDir(s, "north" as never)).toThrow();
    expect(() => d.setBrightness(s, 1.2)).toThrow();
    expect(() => d.setBrightHold(s, BRIGHT_HOLD + 1)).toThrow();
    expect(() => d.addPredator(s, "shark" as never, 1, 1)).toThrow();
    expect(() => d.setPredatorTile(s, 9, 1, 1)).toThrow();
    expect(() => d.setPredatorTile(s, 0, 0, 0)).toThrow();
    expect(() => d.setPredatorDir(s, 0, "x" as never)).toThrow();
    expect(() => d.setPredatorState(s, 0, "wander")).toThrow();
    expect(() => d.setPredatorState(s, 0, "search" as never)).toThrow();
    expect(() => d.setPredatorReleased(s, 0, "yes" as never)).toThrow();
    expect(() => d.setPredatorMind(s, 5, true)).toThrow();
    expect(() => d.setDrifterMind(s, 0, true)).toThrow();
    expect(() => d.setDrifterTravel(s, 0, true)).toThrow();
    expect(() => d.setDrifterIn(s, DRIFTER_INTERVAL + 1)).toThrow();
    expect(() => d.setSonarCooldown(s, -1)).toThrow();
    expect(() => d.setInkCooldown(s, Number.NaN)).toThrow();
    expect(() => d.spawnDrifter(s, 0, 0)).toThrow();
  });

  it("poses one thing at a time and leaves the handed state alone", async () => {
    const h = await boot();
    const d = h.debug;
    const before = h.engine.state;
    const copy = JSON.stringify(d.snapshot(before));
    h.engine.apply((s) => d.setScore(s, 1200));
    h.engine.apply((s) => d.setLives(s, 0));
    h.engine.apply((s) => d.setTitleIndex(s, 1));
    expect(JSON.stringify(d.snapshot(before))).toBe(copy);
    const s = snap(h);
    expect(s.score).toBe(1200);
    expect(s.lives).toBe(0);
    expect(s.titleIndex).toBe(1);
    expect(s.menuIndex).toBe(0);
    h.engine.apply((st) => d.setMenuIndex(st, 1));
    expect(snap(h).menuIndex).toBe(1);
  });

  it("follows the screen with the menu selection", async () => {
    const h = await boot();
    const d = h.debug;
    h.engine.apply((s) => d.setTitleIndex(s, 1));
    for (const [screen, index] of [
      ["paused", 0],
      ["gameover", 0],
      ["playing", null],
      ["howto", null],
      ["cleared", null],
      ["countdown", null],
      ["title", 1],
    ] as const) {
      h.engine.apply((s) => d.setScreen(s, screen));
      expect(snap(h).menuIndex).toBe(index);
    }
    expect(d.menuItemRect(h.engine.state, 1)).toMatchObject({ w: 380, h: 52 });
    expect(d.menuItemRect(h.engine.state, 2)).toBeNull();
  });

  it("resets to the title values, keeping mute", async () => {
    const h = await boot();
    const d = h.debug;
    await h.tap("KeyM");
    await h.tap("Enter");
    await h.seconds(3);
    h.engine.apply((s) => d.setScore(s, 50));
    h.engine.apply((s) => d.reset(s));
    const s = snap(h);
    expect(s).toMatchObject({
      screen: "title",
      menuIndex: 0,
      titleIndex: 0,
      score: 0,
      lives: 3,
      depth: 1,
      muted: true,
      brightness: 0,
      brightHold: 0,
      drifterIn: DRIFTER_INTERVAL,
      simTime: 0,
      pulses: [],
      inkClouds: [],
      drifters: [],
    });
    expect(
      s.predators.every(
        (p) => p.state === "den" && !p.released && p.mind && p.travel,
      ),
    ).toBe(true);
  });

  it("reconciles derived readings without advancing anything", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 5, 12);
    h.engine.apply((s) => d.addPredator(s, "gloamfin", 9, 12));
    h.engine.apply((s) => d.setPredatorState(s, 0, "chase"));
    h.engine.apply((s) => d.setDepth(s, 3));
    const once = h.engine.apply((s) => d.reconcile(s));
    const twice = h.engine.apply((s) => d.reconcile(s));
    expect(d.snapshot(twice)).toEqual(d.snapshot(once));
    const s = snap(h);
    expect(s.sonar.range).toBe(7);
    expect(s.predators).toHaveLength(5);
    expect(s.simTime).toBe(0);
  });

  it("poses predators: chase speed, den, release, direction and travel", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 5, 12);
    h.engine.apply((s) => d.addPredator(s, "lanternjaw", 20, 12));
    expect(snap(h).predators[0]).toMatchObject({
      state: "wander",
      released: true,
      dir: "up",
      mind: true,
      travel: true,
    });
    h.engine.apply((s) => d.setPredatorState(s, 0, "chase"));
    expect(snap(h).predators[0].speed).toBe(116);
    h.engine.apply((s) => d.setPredatorTile(s, 0, 17, 8));
    h.engine.apply((s) => d.setPredatorState(s, 0, "den"));
    h.engine.apply((s) => d.setPredatorReleased(s, 0, false));
    h.engine.apply((s) => d.setPredatorDir(s, 0, "left"));
    const p = snap(h).predators[0];
    expect(p).toMatchObject({
      state: "den",
      released: false,
      dir: "left",
      tx: 17,
      ty: 8,
      lit: false,
    });
    h.engine.apply((s) => d.setPredatorReleased(s, 0, true));
    await h.seconds(1.5);
    const out = snap(h).predators[0];
    expect(out.state).toBe("wander");
    expect(out.ty).toBeLessThanOrEqual(5);
  });

  it("keeps a posed fixture and its plankton as given", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 5, 12);
    expect(snap(h).tiles).toEqual(fixture());
    h.engine.apply((s) => d.setPlankton(s, 7, 12, true));
    expect(snap(h).planktonRemaining).toBe(1);
    h.engine.apply((s) => d.setPlankton(s, 7, 12, false));
    expect(snap(h).planktonRemaining).toBe(0);
    expect(snap(h).score).toBe(0);
    await h.seconds(1);
    expect(snap(h).screen).toBe("playing");
  });

  it("registers the overlay's diagnostic sources", async () => {
    const h = await boot();
    const readings = h.engine.diagnostics();
    const names = readings.map((r) => r.name);
    for (const name of [
      "screen",
      "depth",
      "score",
      "lives",
      "G",
      "V",
      "R",
      "sonar cd",
      "ink cd",
      "plankton",
      "forager",
      "predator 0",
    ]) {
      expect(names).toContain(name);
    }
    expect(readings.every((r) => r.error === undefined)).toBe(true);
    expect(readings.find((r) => r.name === "predator 5")?.value).toBe("-");
  });
});
