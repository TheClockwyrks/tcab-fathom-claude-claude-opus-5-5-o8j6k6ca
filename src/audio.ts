// The seven cues of specs/progression.md, each synthesized from its
// declaration, so the build ships no audio files. Each has its own shape so the
// events are told apart by ear.

import type { CueSpec, InitApi } from "@clockwyrks/simple-2d";
import { CUES, type CueName } from "./constants";
import type { FathomState } from "./game";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  // A bright, tiny blip.
  [CUES.eat]: {
    wave: "sine",
    freq: 900,
    freqTo: 1400,
    gain: 0.1,
    durationMs: 55,
  },
  // A long falling ping.
  [CUES.sonar]: {
    wave: "sine",
    freq: 1500,
    freqTo: 380,
    gain: 0.18,
    durationMs: 480,
  },
  // A low murky puff.
  [CUES.ink]: {
    wave: "sawtooth",
    freq: 140,
    freqTo: 55,
    gain: 0.12,
    durationMs: 320,
  },
  // A hollow rising chirp, the hunter's own sonar.
  [CUES.predatorPing]: {
    wave: "triangle",
    freq: 420,
    freqTo: 820,
    gain: 0.12,
    durationMs: 260,
  },
  // A harsh swelling buzz.
  [CUES.flare]: {
    wave: "square",
    freq: 180,
    freqTo: 720,
    gain: 0.08,
    durationMs: 380,
  },
  // A heavy falling crunch.
  [CUES.caught]: {
    wave: "sawtooth",
    freq: 520,
    freqTo: 70,
    gain: 0.2,
    durationMs: 650,
  },
  // A long rising chime.
  [CUES.descend]: {
    wave: "triangle",
    freq: 330,
    freqTo: 1320,
    gain: 0.18,
    durationMs: 900,
  },
};

export function defineCues(audio: InitApi<FathomState>["audio"]): void {
  for (const [name, spec] of Object.entries(CUE_SPECS)) {
    audio.define(name, spec);
  }
}
