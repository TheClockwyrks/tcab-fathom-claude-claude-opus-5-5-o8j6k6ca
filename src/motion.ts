// Continuous travel along corridor center lines. A body slides between tile
// centers at its own speed, may reverse anywhere, and chooses a new heading only
// at a center. The wrap tunnel is one ordinary step between its two mouths.

import type { Dir } from "./game";
import {
  DX,
  DY,
  OPPOSITE,
  centerX,
  centerY,
  horizontal,
  neighbor,
  tileOfX,
  tileOfY,
  wrapX,
} from "./grid";
import { TILE } from "./constants";

export interface Body {
  readonly x: number;
  readonly y: number;
  readonly dir: Dir;
}

export interface Moved {
  x: number;
  y: number;
  dir: Dir;
  /** Whether the body covered any ground. */
  moving: boolean;
}

export interface Route {
  /** The wrap tunnel's row in the current layout. */
  readonly tunnel: number | null;
  /** Whether the body may stand on tile `(tx, ty)`. */
  canEnter(tx: number, ty: number): boolean;
  /**
   * The heading to leave the center of `(tx, ty)` on, given the heading it
   * arrived with, or `null` to come to rest there.
   */
  choose(tx: number, ty: number, dir: Dir): Dir | null;
}

const EPS = 1e-6;

/** Whether the tile toward `dir` from `(tx, ty)` is open to the body. */
export function opens(route: Route, tx: number, ty: number, dir: Dir): boolean {
  const n = neighbor(tx, ty, dir, route.tunnel);
  return n !== null && route.canEnter(n.tx, n.ty);
}

/**
 * Carries a body `distance` units along its route. A body on a tile closed to
 * it holds that tile and goes nowhere.
 */
export function travel(body: Body, distance: number, route: Route): Moved {
  let { x, y, dir } = body;
  let remaining = distance;
  let moving = false;
  if (!route.canEnter(tileOfX(x), tileOfY(y))) {
    return { x, y, dir, moving };
  }
  for (let guard = 0; guard < 16 && remaining > EPS; guard++) {
    const tx = tileOfX(x);
    const ty = tileOfY(y);
    const cx = centerX(tx);
    const cy = centerY(ty);
    const offX = x - cx;
    const offY = y - cy;
    // A body knocked off the center line returns to it before anything else.
    if (horizontal(dir) ? Math.abs(offY) > EPS : Math.abs(offX) > EPS) {
      if (horizontal(dir)) dir = offY > 0 ? "up" : "down";
      else dir = offX > 0 ? "left" : "right";
    }
    let gap: number;
    if (Math.abs(offX) < EPS && Math.abs(offY) < EPS) {
      x = cx;
      y = cy;
      const next = route.choose(tx, ty, dir);
      if (next === null || !opens(route, tx, ty, next)) break;
      dir = next;
      gap = TILE;
    } else {
      const along = horizontal(dir) ? offX : offY;
      const sign = DX[dir] + DY[dir];
      if (along * sign < 0) {
        gap = Math.abs(along);
      } else if (opens(route, tx, ty, dir)) {
        gap = TILE - Math.abs(along);
      } else {
        // Past the center toward a closed tile: turn back to the center.
        dir = OPPOSITE[dir];
        gap = Math.abs(along);
      }
    }
    const step = Math.min(gap, remaining);
    x = wrapX(x + DX[dir] * step);
    y += DY[dir] * step;
    remaining -= step;
    moving = true;
    if (step === gap) {
      // Arrived: settle exactly on the center reached.
      x = centerX(tileOfX(x + DX[dir] * EPS * 10));
      y = centerY(tileOfY(y + DY[dir] * EPS * 10));
    }
  }
  return { x, y, dir, moving };
}
