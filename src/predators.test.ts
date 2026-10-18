import { describe, expect, it } from "vitest";
import {
  DRIFTER_SPEED,
  FLARE_RADIUS,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_CORNER_SPEED,
  GLOAMFIN_HEAR,
  PREDATOR_SPEED,
} from "./constants";
import { centerX } from "./grid";
import { boot, snap, stage } from "./test/harness";
import { fixture } from "./test/fixtures";

describe("the den and the roster", () => {
  it("releases the roster on the staggered schedule from live play", async () => {
    const h = await boot();
    await h.tap("Enter");
    await h.seconds(2.05);
    let s = snap(h);
    expect(s.predators.map((p) => p.released)).toEqual([true, false, false]);
    await h.seconds(4.9);
    expect(snap(h).predators[1].released).toBe(false);
    await h.seconds(0.15);
    s = snap(h);
    expect(s.predators[1].released).toBe(true);
    expect(s.predators[0].state).toBe("wander");
    expect(s.predators[0].speed).toBe(DRIFTER_SPEED);
    expect(s.predators[1].state).toBe("den");
  });

  it("builds the roster each depth gives", async () => {
    const h = await boot();
    const kinds = (d: number) => {
      h.engine.apply((s) => h.debug.setDepth(s, d));
      return snap(h).predators.map((p) => p.kind);
    };
    expect(kinds(2)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
      "gloamfin",
    ]);
    expect(kinds(3)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
      "gloamfin",
      "lanternjaw",
    ]);
    expect(kinds(4)).toHaveLength(6);
    expect(kinds(9)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
      "gloamfin",
      "lanternjaw",
      "flarefish",
    ]);
    expect(snap(h).sonar.range).toBe(5);
  });

  it("turns the release flag over but holds in the den with travel off", async () => {
    const h = await boot();
    h.engine.apply((s) => h.debug.setPredatorTravel(s, 0, false));
    await h.tap("Enter");
    await h.seconds(3);
    const p = snap(h).predators[0];
    expect(p.released).toBe(true);
    expect(p.state).toBe("den");
  });
});

describe("the Lanternjaw", () => {
  it("hunts the forager's light, lingers, and gives up", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 5, 12);
    h.engine.apply((s) => d.addPredator(s, "lanternjaw", 9, 12));
    await h.engine.advance(1);
    let p = snap(h).predators[0];
    expect(p.state).toBe("chase");
    expect(p.speed).toBe(PREDATOR_SPEED);
    expect(p.alert).toBe(false);
    expect(p.detectRange).toBe(128);
    // Out of sight round the corner of column 1.
    h.engine.apply((s) => d.setForagerTile(s, 1, 3));
    await h.seconds(1.5);
    p = snap(h).predators[0];
    expect(p.state).toBe("chase");
    await h.seconds(0.6);
    p = snap(h).predators[0];
    expect(p.state).toBe("wander");
    expect(p.speed).toBe(DRIFTER_SPEED);
  });

  it("senses further when the forager is bright, and is blinded by ink", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 5, 12);
    h.engine.apply((s) => d.addPredator(s, "lanternjaw", 14, 12));
    h.engine.apply((s) => d.setPredatorTravel(s, 0, false));
    await h.engine.advance(2);
    expect(snap(h).predators[0].state).toBe("wander");
    h.engine.apply((s) => d.setBrightness(s, 1));
    h.engine.apply((s) => d.setBrightHold(s, 1));
    expect(snap(h).predators[0].detectRange).toBe(320);
    await h.engine.advance(1);
    expect(snap(h).predators[0].state).toBe("chase");
    await h.tap("ShiftLeft");
    expect(snap(h).predators[0].state).toBe("wander");
  });

  it("paths around rock to its fix", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 12, 12);
    h.engine.apply((s) => d.addPredator(s, "lanternjaw", 10, 9));
    h.engine.apply((s) => d.setPredatorState(s, 0, "chase"));
    await h.seconds(0.6);
    const p = snap(h).predators[0];
    expect(p.state).toBe("chase");
    expect(p.tx).toBe(10);
    expect(p.ty).toBe(11);
    expect(p.dir).toBe("down");
  });
});

describe("the Gloamfin", () => {
  it("hears the forager close by, through rock, and opens its chase at the cap", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 5, 12);
    h.engine.apply((s) => d.addPredator(s, "gloamfin", 5, 16));
    h.engine.apply((s) => d.setPredatorTravel(s, 0, false));
    await h.engine.advance(1);
    expect(snap(h).predators[0].state).toBe("wander");
    h.engine.apply((s) => d.setForagerTile(s, 10, 11));
    h.engine.apply((s) => d.setPredatorTile(s, 0, 11, 12));
    await h.engine.advance(1);
    const p = snap(h).predators[0];
    expect(p.hearingRange).toBe(GLOAMFIN_HEAR);
    expect(p.hearingLock).toBe(true);
    expect(p.state).toBe("chase");
    expect(p.alert).toBe(true);
    expect(p.lit).toBe(true);
    expect(p.speed).toBe(GLOAMFIN_CHASE_SPEED);
    await h.seconds(0.6);
    expect(snap(h).predators[0].alert).toBe(false);
  });

  it("pings on its timer and catches the forager with the front", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 3, 12);
    h.engine.apply((s) => d.addPredator(s, "gloamfin", 9, 12));
    h.engine.apply((s) => d.setPredatorTravel(s, 0, false));
    await h.seconds(4);
    let s = snap(h);
    expect(s.pulses).toHaveLength(1);
    expect(s.pulses[0]).toMatchObject({
      source: "gloamfin",
      tint: "violet",
      ox: 9,
      oy: 12,
      range: 9,
    });
    expect(h.cues).toContain("predator-ping");
    expect(s.predators[0].state).toBe("wander");
    await h.seconds(0.5);
    s = snap(h);
    expect(s.predators[0].state).toBe("chase");
    // A ping reveals nothing.
    expect(s.visibility[12][9]).toBe("u");
  });

  it("searches an empty fixed tile, pings orange, then gives up", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 20, 12);
    h.engine.apply((s) => d.addPredator(s, "gloamfin", 24, 12));
    h.engine.apply((s) => d.setPredatorState(s, 0, "chase"));
    h.engine.apply((s) => d.setForagerTile(s, 1, 1));
    await h.seconds(1.2);
    let p = snap(h).predators[0];
    expect(p.state).toBe("search");
    expect(p.speed).toBe(PREDATOR_SPEED);
    await h.seconds(1.3);
    const orange = snap(h).pulses.find((x) => x.tint === "orange");
    expect(orange).toBeDefined();
    await h.seconds(1.5);
    p = snap(h).predators[0];
    expect(p.state).toBe("search");
    expect(Math.abs(p.tx - 20) + Math.abs(p.ty - 12)).toBeLessThanOrEqual(2);
    await h.seconds(2.5);
    p = snap(h).predators[0];
    expect(p.state).toBe("wander");
    expect(Math.abs(p.tx - 20) + Math.abs(p.ty - 12)).toBeLessThanOrEqual(4);
  });

  it("takes a fix from the forager's pulse and loses speed on corners", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 5, 12);
    h.engine.apply((s) => d.addPredator(s, "gloamfin", 10, 8));
    h.engine.apply((s) => d.setPredatorTravel(s, 0, false));
    await h.tap("Space");
    await h.seconds(0.6);
    expect(snap(h).predators[0].state).toBe("wander");
    await h.seconds(0.1);
    let p = snap(h).predators[0];
    expect(p.state).toBe("chase");
    expect(p.lit).toBe(true);
    h.engine.apply((s) => d.setPredatorTravel(s, 0, true));
    await h.seconds(1.2);
    p = snap(h).predators[0];
    expect(p.speed).toBeLessThan(GLOAMFIN_CHASE_SPEED);
    expect(p.speed).toBeGreaterThanOrEqual(GLOAMFIN_CORNER_SPEED);
  });
});

describe("the Flarefish", () => {
  it("charges, blooms, reveals through rock, and re-arms", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 30, 16);
    h.engine.apply((s) => d.addPredator(s, "flarefish", 10, 3));
    h.engine.apply((s) => d.setPredatorTravel(s, 0, false));
    await h.seconds(7.05);
    let p = snap(h).predators[0];
    expect(p.flareCharging).toBe(true);
    expect(p.flaring).toBe(false);
    await h.seconds(0.5);
    let s = snap(h);
    p = s.predators[0];
    expect(p.flaring).toBe(true);
    expect(p.flareRadius).toBe(FLARE_RADIUS);
    expect(p.lit).toBe(true);
    expect(h.cues).toContain("flare");
    expect(s.visibility[3][8]).toBe("l");
    expect(s.visibility[3][12]).toBe("l");
    await h.seconds(1);
    s = snap(h);
    p = s.predators[0];
    expect(p.flaring).toBe(false);
    expect(p.flareRadius).toBe(0);
    expect(p.state).toBe("wander");
    expect(s.visibility[3][8]).toBe("r");
  });

  it("locks on with its bloom and fires the alert", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 10, 8);
    h.engine.apply((s) => d.addPredator(s, "flarefish", 10, 3));
    h.engine.apply((s) => d.setPredatorTravel(s, 0, false));
    h.engine.apply((s) => d.setForagerTile(s, 12, 1));
    await h.seconds(7.6);
    const p = snap(h).predators[0];
    expect(p.state).toBe("chase");
    expect(p.alert).toBe(true);
    expect(p.flaring).toBe(false);
  });

  it("senses light like the Lanternjaw, with an alert", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 5, 12);
    h.engine.apply((s) => d.addPredator(s, "flarefish", 8, 12));
    await h.engine.advance(1);
    const p = snap(h).predators[0];
    expect(p.state).toBe("chase");
    expect(p.alert).toBe(true);
    expect(p.hearingRange).toBeNull();
    expect(p.hearingLock).toBeNull();
    expect(p.x).toBeLessThan(centerX(8));
  });
});
