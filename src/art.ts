// Loading the seeded sprite sheets through the engine's asset loader.
//
// Every frame is requested by its path under the `assets/` root, which the
// loader resolves against the page, so the build works at any base path. A
// sheet that fails to load leaves the game drawing its creatures and tiles as
// plain shapes instead (render.ts), so the game still runs and plays.

import type { InitApi } from "@clockwyrks/simple-2d";
import type { Art, FathomState } from "./game";

type Assets = InitApi<FathomState>["assets"];

/** Each sheet's folder under `assets/` and its frame count (specs/assets.md). */
const SHEETS = {
  forager: ["glimmerfin", 8],
  lanternjaw: ["lanternjaw", 16],
  gloamfin: ["gloamfin", 8],
  flarefish: ["flarefish", 8],
  drifter: ["drifter", 8],
  bloom: ["flare-bloom", 8],
  tiles: ["trench-walls", 19],
} as const satisfies Record<keyof Art, readonly [string, number]>;

function loadSheet(
  assets: Assets,
  folder: string,
  frames: number,
): Promise<ImageBitmap[]> {
  return Promise.all(
    Array.from({ length: frames }, (_, i) =>
      assets.loadImage(`${folder}/${i}.png`),
    ),
  );
}

/** Loads every sheet, or resolves to `null` when any frame is missing. */
export async function loadArt(assets: Assets): Promise<Art | null> {
  try {
    const [forager, lanternjaw, gloamfin, flarefish, drifter, bloom, tiles] =
      await Promise.all(
        Object.values(SHEETS).map(([folder, frames]) =>
          loadSheet(assets, folder, frames),
        ),
      );
    return { forager, lanternjaw, gloamfin, flarefish, drifter, bloom, tiles };
  } catch {
    return null;
  }
}
