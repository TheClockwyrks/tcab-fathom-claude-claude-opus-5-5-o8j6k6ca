import { describe, expect, it } from "vitest";
import { boot, snap } from "./test/harness";

describe("the screens and menus", () => {
  it("opens on the title with every field present", async () => {
    const h = await boot();
    const s = snap(h);
    expect(s.version).toBe(1);
    expect(s.screen).toBe("title");
    expect(s.menuIndex).toBe(0);
    expect(s.titleIndex).toBe(0);
    expect(s.lives).toBe(3);
    expect(s.depth).toBe(1);
    expect(s.muted).toBe(false);
    expect(s.tiles).toHaveLength(18);
    expect(s.visibility.every((r) => /^u+$/.test(r))).toBe(true);
    expect(s.predators.map((p) => p.kind)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
    ]);
    expect(s.predators.every((p) => p.state === "den" && !p.released)).toBe(
      true,
    );
    expect(s.planktonRemaining).toBe(s.plankton.join("").split("*").length - 1);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("moves the selection with wrap and leaves through how-to", async () => {
    const h = await boot();
    await h.tap("ArrowUp");
    expect(snap(h).menuIndex).toBe(1);
    await h.tap("ArrowDown");
    expect(snap(h).menuIndex).toBe(0);
    await h.tap("KeyS");
    await h.tap("Enter");
    expect(snap(h).screen).toBe("howto");
    expect(snap(h).menuIndex).toBeNull();
    expect(snap(h).titleIndex).toBe(1);
    await h.tap("Escape");
    expect(snap(h).screen).toBe("title");
    expect(snap(h).menuIndex).toBe(1);
    await h.tap("Escape");
    expect(snap(h).screen).toBe("title");
  });

  it("runs the dive countdown on simulation time", async () => {
    const h = await boot();
    await h.tap("Space");
    const s = snap(h);
    expect(s.screen).toBe("countdown");
    expect(s.score).toBe(0);
    await h.seconds(1.9);
    expect(snap(h).screen).toBe("countdown");
    expect(snap(h).predators[0].released).toBe(false);
    await h.seconds(0.2);
    expect(snap(h).screen).toBe("playing");
    expect(snap(h).predators[0].released).toBe(true);
    expect(snap(h).simTime).toBeGreaterThan(2);
  });

  it("pauses and resumes with one Escape each and P", async () => {
    const h = await boot();
    await h.tap("Enter");
    await h.seconds(2.1);
    await h.tap("Escape");
    expect(snap(h).screen).toBe("paused");
    expect(snap(h).menuIndex).toBe(0);
    const frozen = snap(h);
    await h.seconds(1);
    expect(snap(h).predators).toEqual(frozen.predators);
    await h.tap("Escape");
    expect(snap(h).screen).toBe("playing");
    await h.tap("KeyP");
    expect(snap(h).screen).toBe("paused");
    await h.tap("KeyP");
    expect(snap(h).screen).toBe("playing");
  });

  it("restarts and quits from the pause menu", async () => {
    const h = await boot();
    await h.tap("Enter");
    await h.seconds(2.1);
    h.engine.apply((s) => h.debug.setScore(s, 400));
    await h.tap("Escape");
    await h.tap("ArrowDown");
    await h.tap("Enter");
    expect(snap(h).screen).toBe("countdown");
    expect(snap(h).score).toBe(0);
    await h.seconds(2.1);
    await h.tap("Escape");
    await h.tap("ArrowUp");
    expect(snap(h).menuIndex).toBe(2);
    await h.tap("Enter");
    expect(snap(h).screen).toBe("title");
    expect(snap(h).menuIndex).toBe(0);
  });

  it("goes to game over on the last life and back to the menu", async () => {
    const h = await boot();
    const d = h.debug;
    h.engine.apply((s) => d.setScreen(s, "gameover"));
    expect(snap(h).menuIndex).toBe(0);
    await h.tap("ArrowDown");
    await h.tap("Enter");
    expect(snap(h).screen).toBe("title");
    h.engine.apply((s) => d.setScreen(s, "gameover"));
    await h.tap("Escape");
    expect(snap(h).screen).toBe("title");
    h.engine.apply((s) => d.setScreen(s, "gameover"));
    await h.tap("Enter");
    expect(snap(h).screen).toBe("countdown");
  });

  it("toggles mute from any screen", async () => {
    const h = await boot();
    await h.tap("KeyM");
    expect(snap(h).muted).toBe(true);
    await h.tap("Enter");
    await h.tap("KeyM");
    expect(snap(h).muted).toBe(false);
  });

  it("selects and confirms with the pointer and touch", async () => {
    const h = await boot();
    const r = h.debug.menuItemRect(h.engine.state, 1);
    expect(r).not.toBeNull();
    if (r === null) return;
    h.pointer("move", r.x + 10, r.y + 10);
    await h.engine.advance(1);
    expect(snap(h).menuIndex).toBe(1);
    h.pointer("down", r.x + 10, r.y + 10);
    h.pointer("up", r.x + 12, r.y + 12);
    await h.engine.advance(1);
    expect(snap(h).screen).toBe("howto");
    h.pointer("down", 50, 50, "touch");
    await h.engine.advance(1);
    h.pointer("up", 900, 600, "touch");
    await h.engine.advance(1);
    expect(snap(h).screen).toBe("title");
    expect(snap(h).menuIndex).toBe(1);
    const dive = h.debug.menuItemRect(h.engine.state, 0);
    if (dive === null) return;
    h.pointer("down", dive.x + 5, dive.y + 5, "touch");
    h.pointer("up", 5, 5, "touch");
    await h.engine.advance(1);
    expect(snap(h).screen).toBe("title");
    expect(snap(h).menuIndex).toBe(0);
    h.pointer("down", dive.x + 5, dive.y + 5, "touch");
    h.pointer("up", dive.x + 6, dive.y + 6, "touch");
    await h.engine.advance(1);
    expect(snap(h).screen).toBe("countdown");
    expect(h.debug.menuItemRect(h.engine.state, 0)).toBeNull();
  });

  it("plays the cleared interstitial and descends", async () => {
    const h = await boot();
    const d = h.debug;
    await h.tap("Enter");
    await h.seconds(2.1);
    const f = snap(h).forager;
    const before = snap(h).score;
    h.engine.apply((s) => d.clearPlankton(s));
    h.engine.apply((s) => d.setPlankton(s, f.tx, f.ty, true));
    await h.engine.advance(1);
    let s = snap(h);
    expect(s.screen).toBe("cleared");
    expect(s.score).toBe(before + 510);
    expect(h.cues).toContain("descend");
    await h.seconds(2.1);
    s = snap(h);
    expect(s.screen).toBe("countdown");
    expect(s.depth).toBe(2);
    expect(s.score).toBe(before + 510);
    expect(s.predators).toHaveLength(4);
    expect(s.sonar.range).toBe(8);
    // A fresh fog: only the forager's own light has touched it.
    expect(s.visibility.join("").replace(/u/g, "").length).toBeLessThan(40);
    expect(s.planktonRemaining).toBeGreaterThan(200);
  });
});
