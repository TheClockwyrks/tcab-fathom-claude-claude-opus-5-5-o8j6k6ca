import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import type { Art, FathomState } from "./game";
import { renderGame } from "./render";
import { boot, stage } from "./test/harness";
import { fixture } from "./test/fixtures";
import { draft } from "./world";

/** Stand-in sheets: plain canvases of the right sizes. */
function fakeArt(): Art {
  const sheet = (n: number, size = 32) =>
    Array.from(
      { length: n },
      () => createCanvas(size, size) as unknown as ImageBitmap,
    );
  return {
    forager: sheet(8),
    lanternjaw: sheet(16),
    gloamfin: sheet(8),
    flarefish: sheet(8),
    drifter: sheet(8),
    bloom: sheet(8, 128),
    tiles: sheet(19),
  };
}

function withArt(s: Parameters<typeof draft>[0], art: Art | null): FathomState {
  return { ...draft(s), art };
}

describe("rendering", () => {
  it("draws every screen, with art and without, and leaves the state as it was", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 10, 5);
    h.engine.apply((s) => d.addPredator(s, "flarefish", 12, 5));
    h.engine.apply((s) => d.addPredator(s, "lanternjaw", 8, 5));
    h.engine.apply((s) => d.addPredator(s, "gloamfin", 10, 3));
    h.engine.apply((s) => d.spawnDrifter(s, 10, 1));
    h.engine.apply((s) => d.setPredatorMind(s, 0, false));
    await h.tap("Space");
    await h.tap("ShiftLeft");
    const canvas = createCanvas(1280, 720);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    for (const art of [null, fakeArt()]) {
      h.engine.apply((s) => withArt(s, art));
      for (const screen of [
        "title",
        "howto",
        "countdown",
        "playing",
        "paused",
        "cleared",
        "gameover",
      ] as const) {
        h.engine.apply((s) => d.setScreen(s, screen));
        const before = JSON.stringify(d.snapshot(h.engine.state));
        renderGame(h.engine.state, ctx);
        expect(JSON.stringify(d.snapshot(h.engine.state))).toBe(before);
      }
    }
    await h.engine.advance(1);
  });

  it("draws the flare beats and alert flashes", async () => {
    const h = await boot();
    const d = h.debug;
    stage(h, fixture(), 10, 8);
    h.engine.apply((s) => d.addPredator(s, "flarefish", 10, 3));
    h.engine.apply((s) => d.setPredatorTravel(s, 0, false));
    const canvas = createCanvas(1280, 720);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    for (const art of [null, fakeArt()]) {
      h.engine.apply((s) => d.reset(s));
      stage(h, fixture(), 30, 16);
      h.engine.apply((s) => withArt(s, art));
      h.engine.apply((s) => d.addPredator(s, "flarefish", 10, 3));
      h.engine.apply((s) => d.setPredatorTravel(s, 0, false));
      h.engine.apply((s) => d.setMaze(s, fixture()));
      for (let t = 0; t < 10; t++) {
        await h.seconds(0.9);
        renderGame(h.engine.state, ctx);
      }
      h.engine.apply((s) => d.setForagerTile(s, 10, 4));
      await h.engine.advance(2);
      renderGame(h.engine.state, ctx);
    }
    expect(h.cues).toContain("flare");
  });
});
