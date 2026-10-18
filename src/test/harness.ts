// A headless Fathom for the unit tests: the real engine over an
// `@napi-rs/canvas` canvas, a surface of the test's own, and a constant clock of
// one tick per frame, so `advance(n)` runs exactly `n` simulation ticks.

import { createCanvas } from "@napi-rs/canvas";
import { ConstantClock, createEngine } from "@clockwyrks/simple-2d";
import type { Engine } from "@clockwyrks/simple-2d";
import { LAYOUT, TICK_HZ } from "../constants";
import { game, type FathomDebugApi, type FathomState } from "../game";

export interface Harness {
  readonly engine: Engine<FathomState, FathomDebugApi>;
  readonly debug: FathomDebugApi;
  readonly target: EventTarget;
  /** Every cue played since boot, in order. */
  readonly cues: string[];
  key(code: string, down: boolean): void;
  /** Presses and releases a key across one frame. */
  tap(code: string): Promise<void>;
  pointer(
    type: "down" | "up" | "move",
    x: number,
    y: number,
    kind?: string,
  ): void;
  seconds(s: number): Promise<void>;
}

export async function boot(): Promise<Harness> {
  const canvas = createCanvas(1280, 720);
  const target = new EventTarget();
  const engine = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: 1280,
    height: 720,
    game,
    layout: LAYOUT,
    clock: new ConstantClock(1000 / TICK_HZ),
    surface: {
      cssWidth: () => 1280,
      cssHeight: () => 720,
      dpr: () => 1,
      events: () => target,
    },
  });
  const cues: string[] = [];
  engine.events.on("cue:played", (e) => cues.push(e.cue));
  await engine.initialize();
  const key = (code: string, down: boolean): void => {
    const event = new Event(down ? "keydown" : "keyup");
    Object.assign(event, { code, repeat: false, key: code });
    target.dispatchEvent(event);
  };
  return {
    engine,
    debug: engine.debug,
    target,
    cues,
    key,
    async tap(code) {
      key(code, true);
      await engine.advance(1);
      key(code, false);
    },
    pointer(type, x, y, kind = "mouse") {
      const event = new Event(`pointer${type}`);
      Object.assign(event, {
        clientX: x,
        clientY: y,
        pointerId: kind === "touch" ? 7 : 1,
        pointerType: kind,
        isPrimary: true,
        button: type === "move" ? -1 : 0,
        buttons: type === "up" ? 0 : type === "down" ? 1 : 0,
      });
      target.dispatchEvent(event);
    },
    async seconds(s) {
      await engine.advance(Math.round(s * TICK_HZ));
    },
  };
}

/**
 * A quiet live-play scenario on the test fixture: no predators, no plankton,
 * the fog cleared, the forager at rest on `(tx, ty)`.
 */
export function stage(
  h: Harness,
  rows: readonly string[],
  tx: number,
  ty: number,
): void {
  const d = h.debug;
  h.engine.apply((s) => d.reset(s));
  h.engine.apply((s) => d.setMaze(s, rows));
  h.engine.apply((s) => d.clearPredators(s));
  h.engine.apply((s) => d.clearPlankton(s));
  h.engine.apply((s) => d.clearFog(s));
  h.engine.apply((s) => d.setForagerTile(s, tx, ty));
  h.engine.apply((s) => d.setScreen(s, "playing"));
}

export function snap(h: Harness) {
  return h.debug.snapshot(h.engine.state);
}
