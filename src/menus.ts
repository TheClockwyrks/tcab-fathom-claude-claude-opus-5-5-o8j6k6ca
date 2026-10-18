// The menus of specs/ui.md: each screen's items and where they are laid out.

import { GAMEOVER_ITEMS, PAUSE_ITEMS, STAGE_W, TITLE_ITEMS } from "./constants";
import type { Rect, Screen } from "./game";

const ITEM_W = 380;
const ITEM_H = 52;
const ITEM_GAP = 64;

/** The items of the menu `screen` shows, or `null` where it shows none. */
export function menuItems(screen: Screen): readonly string[] | null {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "paused":
      return PAUSE_ITEMS;
    case "gameover":
      return GAMEOVER_ITEMS;
    default:
      return null;
  }
}

function menuTop(screen: Screen): number {
  switch (screen) {
    case "title":
      return 440;
    case "paused":
      return 310;
    default:
      return 470;
  }
}

/** Item `index`'s hit region on `screen`'s menu, or `null` for no such item. */
export function menuRect(screen: Screen, index: number): Rect | null {
  const items = menuItems(screen);
  if (items === null || !Number.isInteger(index)) return null;
  if (index < 0 || index >= items.length) return null;
  return {
    x: STAGE_W / 2 - ITEM_W / 2,
    y: menuTop(screen) + index * ITEM_GAP,
    w: ITEM_W,
    h: ITEM_H,
  };
}

/** The item whose region holds the point, or `null` for none. */
export function menuHit(screen: Screen, x: number, y: number): number | null {
  const items = menuItems(screen);
  if (items === null) return null;
  for (let i = 0; i < items.length; i++) {
    const r = menuRect(screen, i);
    if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      return i;
    }
  }
  return null;
}
