// One frame of the game: the controls each screen reads (specs/movement.md,
// "Where each action is read"), the menus and their pointer input, then as many
// whole TICK_DT ticks as the frame's delta completes, with the remainder carried
// into the next frame.

import type { UpdateApi } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { TICK_DT, type CueName } from "./constants";
import type { FathomState } from "./game";
import { DIRS } from "./grid";
import { menuHit, menuItems } from "./menus";
import { Rng } from "./rng";
import { emitSonar, releaseInk, tick } from "./sim";
import { beginDive, derive, draft, goTo, returnToTitle } from "./world";

const EPS = 1e-9;

/** Takes the selected item of the menu on screen. */
export function confirmItem(w: FathomState, rng: Rng): void {
  const item = w.menuIndex ?? 0;
  switch (w.screen) {
    case "title":
      w.titleIndex = item;
      if (item === 0) beginDive(w, rng);
      else goTo(w, "howto");
      return;
    case "paused":
      if (item === 0) goTo(w, "playing");
      else if (item === 1) beginDive(w, rng);
      else returnToTitle(w, rng);
      return;
    case "gameover":
      if (item === 0) beginDive(w, rng);
      else returnToTitle(w, rng);
      return;
    default:
      return;
  }
}

function moveSelection(w: FathomState, api: UpdateApi): void {
  const items = menuItems(w.screen);
  if (items === null) return;
  const n = items.length;
  const at = w.menuIndex ?? 0;
  if (api.input.pressed("up")) w.menuIndex = (at - 1 + n) % n;
  else if (api.input.pressed("down")) w.menuIndex = (at + 1) % n;
}

/**
 * The pointer and touch on a menu or the how-to screen. A hover selects, a press
 * selects, and a press and release inside one item's region confirms it. Returns
 * whether the screen changed.
 */
function pointerInput(w: FathomState, api: UpdateApi, rng: Rng): boolean {
  for (const sample of api.input.pointerSamples()) {
    const screen = w.screen;
    const item = menuHit(screen, sample.x, sample.y);
    if (sample.type === "move") {
      if (sample.device !== "touch" && item !== null) w.menuIndex = item;
    } else if (sample.type === "down") {
      w.press = { id: sample.id, screen, item };
      if (item !== null) w.menuIndex = item;
    } else {
      const press = w.press;
      w.press = null;
      if (press === null || press.id !== sample.id || press.screen !== screen) {
        continue;
      }
      if (screen === "howto") {
        returnToTitle(w, rng);
        return true;
      }
      if (item !== null && item === press.item) {
        w.menuIndex = item;
        confirmItem(w, rng);
        return true;
      }
    }
  }
  return false;
}

function screenInput(
  w: FathomState,
  api: UpdateApi,
  rng: Rng,
  cues: Set<CueName>,
): void {
  const input = api.input;
  switch (w.screen) {
    case "title":
    case "gameover":
      moveSelection(w, api);
      if (input.pressed("confirm")) confirmItem(w, rng);
      else if (input.pressed("back")) {
        if (w.screen === "gameover") returnToTitle(w, rng);
      } else pointerInput(w, api, rng);
      return;
    case "paused": {
      const pause = input.pressed("pause");
      const back = input.pressed("back");
      if (pause || back) {
        goTo(w, "playing");
        return;
      }
      moveSelection(w, api);
      if (input.pressed("confirm")) confirmItem(w, rng);
      else pointerInput(w, api, rng);
      return;
    }
    case "howto":
      if (input.pressed("confirm") || input.pressed("back")) {
        returnToTitle(w, rng);
      } else pointerInput(w, api, rng);
      return;
    case "playing": {
      if (input.pressed("pause")) {
        goTo(w, "paused");
        return;
      }
      const f = w.forager;
      for (const dir of DIRS) if (input.pressed(dir)) f.desired = dir;
      if (f.desired === null) {
        const held = DIRS.find((d) => input.value(d) > 0);
        if (held) f.desired = held;
      }
      if (input.pressed("a")) emitSonar(w, cues);
      if (input.pressed("b")) releaseInk(w, cues);
      return;
    }
    default:
      return;
  }
}

function play(api: UpdateApi, cues: Set<CueName>): void {
  for (const cue of cues) api.audio.play(cue);
  cues.clear();
}

/** The next state, from the current one and this frame's input and delta. */
export function advanceFrame(
  state: DeepReadonly<FathomState>,
  api: UpdateApi,
  dt: number,
): FathomState {
  const w = draft(state);
  const rng = new Rng(w.rng);
  const cues = new Set<CueName>();

  if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
  screenInput(w, api, rng, cues);
  derive(w);
  play(api, cues);

  const held = DIRS.filter((d) => api.input.value(d) > 0);
  w.accumulator += Number.isFinite(dt) && dt > 0 ? dt : 0;
  while (w.accumulator >= TICK_DT - EPS) {
    w.accumulator -= TICK_DT;
    tick(w, { rng, held, cues });
    play(api, cues);
  }
  if (w.accumulator < 0) w.accumulator = 0;

  w.muted = api.audio.muted();
  w.rng = rng.seed;
  return derive(w);
}
