// Everything Fathom draws. Rendering reads the state and nothing else: it is
// handed a read-only view and the engine's context, already carrying the
// logical 1280x720 transform.
//
// The maze view is drawn in layers. The whole maze region starts as flat fog.
// Inside the vision circle (and inside any burning flare's disc) the tiles the
// fog of war has revealed are drawn, lit or dimmed, with their plankton. The
// glow, the ink, the lit bodies, the amber lights, the forager, the flares and
// the sonar crests then go over the top.

import type { DeepReadonly } from "ts-essentials";
import {
  ALERT_TIME,
  DIVE_LABEL,
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_RADIUS,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  INK_COOLDOWN,
  INK_LIFE,
  PLANKTON_DOT,
  SONAR_COOLDOWN,
  SONAR_MARK_TIME,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TILE,
  TITLE_TEXT,
  type PredatorKind,
} from "./constants";
import type {
  Art,
  Dir,
  Drifter,
  FathomState,
  Predator,
  PulseTint,
  Screen,
} from "./game";
import { CORRIDOR, DEN, GATE, ROCK, tileAt } from "./grid";
import { menuItems, menuRect } from "./menus";
import { FADE_TIME } from "./predators";

type View = DeepReadonly<FathomState>;
type Ctx = CanvasRenderingContext2D;
type Frames = DeepReadonly<ImageBitmap[]>;

const MONO =
  'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", "Courier New", monospace';

const FOG = "#03060c";
const INK_TEXT = "#d8f6ff";
const DIM_TEXT = "rgba(150, 205, 220, 0.62)";
const CYAN = "#6ff3e6";
const AMBER_CORE = "#ffd0a0";

const MAZE_W = GRID_COLS * TILE;
const MAZE_H = GRID_ROWS * TILE;

/** The tint each kind's alert flash is drawn in. */
const KIND_COLOR: Readonly<Record<PredatorKind, string>> = {
  lanternjaw: "255, 140, 60",
  gloamfin: "178, 128, 255",
  flarefish: "255, 214, 120",
};

const PULSE_COLOR: Readonly<Record<PulseTint, string>> = {
  cyan: "90, 245, 255",
  violet: "170, 110, 255",
  orange: "255, 150, 50",
};

const FACING_BASE: Readonly<Record<Dir, number>> = {
  down: 0,
  up: 2,
  left: 4,
  right: 6,
};

function font(size: number, weight = "bold"): string {
  return `${weight} ${size}px ${MONO}`;
}

function tileLeft(tx: number): number {
  return GRID_ORIGIN_X + tx * TILE;
}

function tileTop(ty: number): number {
  return GRID_ORIGIN_Y + ty * TILE;
}

/** A frame of an alternating pair or a loop, at `fps`. */
function cycle(time: number, fps: number, frames: number): number {
  return Math.floor(time * fps) % frames;
}

function drawSprite(
  ctx: Ctx,
  frames: Frames,
  i: number,
  x: number,
  y: number,
): void {
  ctx.drawImage(
    frames[i] as ImageBitmap,
    Math.round(x - TILE / 2),
    Math.round(y - TILE / 2),
    TILE,
    TILE,
  );
}

// ---- Text -----------------------------------------------------------------------

function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "center",
  weight = "bold",
): void {
  ctx.font = font(size, weight);
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillText(value, x + 2, y + 2);
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

function glowText(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  glow: string,
): void {
  ctx.save();
  ctx.font = font(size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = glow;
  ctx.shadowBlur = size / 3;
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
  ctx.restore();
}

function panel(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = "rgba(4, 12, 24, 0.92)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(111, 243, 230, 0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function drawMenu(ctx: Ctx, screen: Screen, selected: number | null): void {
  const items = menuItems(screen);
  if (items === null) return;
  items.forEach((label, i) => {
    const r = menuRect(screen, i);
    if (r === null) return;
    const on = i === selected;
    ctx.fillStyle = on ? "rgba(111, 243, 230, 0.92)" : "rgba(6, 18, 32, 0.88)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = on ? "#c9fffa" : "rgba(111, 243, 230, 0.4)";
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    const label2 = on ? `> ${label} <` : label;
    ctx.font = font(24);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = on ? "#031016" : INK_TEXT;
    ctx.fillText(label2, r.x + r.w / 2, r.y + r.h / 2 + 1);
  });
}

// ---- The maze --------------------------------------------------------------------

/** The wall autotile frame: one bit per orthogonal rock neighbor. */
function wallFrame(tiles: readonly string[], tx: number, ty: number): number {
  let bits = 0;
  if (tileAt(tiles, tx, ty - 1) === ROCK) bits |= 1;
  if (tileAt(tiles, tx + 1, ty) === ROCK) bits |= 2;
  if (tileAt(tiles, tx, ty + 1) === ROCK) bits |= 4;
  if (tileAt(tiles, tx - 1, ty) === ROCK) bits |= 8;
  return bits;
}

function drawTile(
  ctx: Ctx,
  art: DeepReadonly<Art> | null,
  tiles: readonly string[],
  tx: number,
  ty: number,
): void {
  const ch = tiles[ty][tx];
  const x = tileLeft(tx);
  const y = tileTop(ty);
  if (art !== null) {
    const frame =
      ch === ROCK ? wallFrame(tiles, tx, ty) : ch === GATE ? 18 : 16;
    ctx.drawImage(art.tiles[frame] as ImageBitmap, x, y, TILE, TILE);
    if (ch === DEN) {
      ctx.fillStyle = "rgba(60, 10, 30, 0.25)";
      ctx.fillRect(x, y, TILE, TILE);
    }
    return;
  }
  ctx.fillStyle =
    ch === ROCK ? "#1d3954" : ch === CORRIDOR ? "#0a1422" : "#101c2c";
  ctx.fillRect(x, y, TILE, TILE);
  if (ch === GATE) {
    ctx.fillStyle = "#5a7a96";
    for (let i = 4; i < TILE; i += 8) ctx.fillRect(x + i, y + 12, 3, 8);
  }
}

/** Traces the vision circle and every burning flare's disc as one region. */
function maskPath(ctx: Ctx, s: View): void {
  ctx.beginPath();
  ctx.arc(s.forager.x, s.forager.y, s.windowRadius, 0, Math.PI * 2);
  for (const p of s.predators) {
    if (p.kind === "flarefish" && p.flarePhase === "bloom") {
      ctx.moveTo(p.x + FLARE_RADIUS, p.y);
      ctx.arc(p.x, p.y, FLARE_RADIUS, 0, Math.PI * 2);
    }
  }
}

function clipToMaze(ctx: Ctx): void {
  ctx.beginPath();
  ctx.rect(GRID_ORIGIN_X, GRID_ORIGIN_Y, MAZE_W, MAZE_H);
  ctx.clip();
}

function drawTerrain(ctx: Ctx, s: View): void {
  const art = s.art;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const vis = s.visibility[ty][tx];
      if (vis === "u") {
        if (art !== null)
          ctx.drawImage(
            art.tiles[17] as ImageBitmap,
            tileLeft(tx),
            tileTop(ty),
            TILE,
            TILE,
          );
        continue;
      }
      drawTile(ctx, art, s.tiles, tx, ty);
      if (vis === "r") {
        ctx.fillStyle = "rgba(1, 3, 9, 0.52)";
        ctx.fillRect(tileLeft(tx), tileTop(ty), TILE, TILE);
      }
    }
  }
  // Plankton: bright motes where lit, faint ones where remembered.
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (s.plankton[ty][tx] !== "*") continue;
      const vis = s.visibility[ty][tx];
      if (vis === "u") continue;
      const cx = tileLeft(tx) + TILE / 2;
      const cy = tileTop(ty) + TILE / 2;
      if (vis === "l") {
        const g = ctx.createRadialGradient(
          cx,
          cy,
          0,
          cx,
          cy,
          PLANKTON_DOT * 1.6,
        );
        g.addColorStop(0, "rgba(190, 255, 236, 0.75)");
        g.addColorStop(1, "rgba(120, 255, 220, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(
          cx - PLANKTON_DOT * 2,
          cy - PLANKTON_DOT * 2,
          PLANKTON_DOT * 4,
          PLANKTON_DOT * 4,
        );
        ctx.fillStyle = "#eafff8";
        ctx.beginPath();
        ctx.arc(cx, cy, PLANKTON_DOT / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "rgba(120, 210, 196, 0.38)";
        ctx.beginPath();
        ctx.arc(cx, cy, PLANKTON_DOT / 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawGlow(ctx: Ctx, s: View): void {
  const { x, y } = s.forager;
  const r = s.windowRadius;
  const outer = ctx.createRadialGradient(x, y, 0, x, y, r);
  outer.addColorStop(0, "rgba(80, 230, 220, 0.12)");
  outer.addColorStop(0.7, "rgba(60, 200, 210, 0.05)");
  outer.addColorStop(1, "rgba(40, 160, 200, 0)");
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  const v = s.visionRadius;
  const pocket = ctx.createRadialGradient(x, y, 0, x, y, v);
  pocket.addColorStop(0, `rgba(140, 255, 240, ${0.2 + 0.12 * s.brightness})`);
  pocket.addColorStop(1, "rgba(100, 240, 230, 0)");
  ctx.fillStyle = pocket;
  ctx.beginPath();
  ctx.arc(x, y, v, 0, Math.PI * 2);
  ctx.fill();
}

function drawInk(ctx: Ctx, s: View): void {
  for (const c of s.inkClouds) {
    const fade = Math.min(
      1,
      c.remaining / 0.5,
      (INK_LIFE - c.remaining + 0.15) / 0.3,
    );
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.radius);
    g.addColorStop(0, `rgba(2, 0, 6, ${0.92 * fade})`);
    g.addColorStop(0.75, `rgba(4, 0, 10, ${0.82 * fade})`);
    g.addColorStop(1, `rgba(10, 2, 20, ${0.25 * fade})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(90, 60, 140, ${0.35 * fade})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

/** The amber bulb-light the drifter and the Lanternjaw share, drawn identically. */
function amberLight(ctx: Ctx, x: number, y: number, time: number): void {
  const pulse = 0.85 + 0.15 * Math.sin(time * 3.1);
  const g = ctx.createRadialGradient(x, y - 4, 0, x, y - 4, 16);
  g.addColorStop(0, `rgba(255, 160, 80, ${0.95 * pulse})`);
  g.addColorStop(0.35, `rgba(255, 105, 40, ${0.5 * pulse})`);
  g.addColorStop(1, "rgba(255, 80, 20, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - 16, y - 20, 32, 32);
  ctx.fillStyle = AMBER_CORE;
  ctx.beginPath();
  ctx.arc(x, y - 4, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function waitingInDen(s: View, p: DeepReadonly<Predator>): boolean {
  if (p.state !== "den") return false;
  return !p.released || !s.tiles.some((row) => row.includes(DEN));
}

function predatorFrame(s: View, p: DeepReadonly<Predator>): number {
  if (p.kind === "lanternjaw" && p.state !== "chase")
    return 8 + cycle(s.simTime, 8, 8);
  return FACING_BASE[p.dir] + cycle(s.simTime, 7, 2);
}

function drawPredator(ctx: Ctx, s: View, p: DeepReadonly<Predator>): void {
  if (!p.lit) return;
  const fullyLit =
    p.alertLeft > 0 ||
    (s.visibility[p.ty][p.tx] === "l" &&
      Math.hypot(p.x - s.forager.x, p.y - s.forager.y) <=
        s.visionRadius + TILE) ||
    s.predators.some(
      (f) =>
        f.kind === "flarefish" &&
        f.flarePhase === "bloom" &&
        Math.hypot(f.x - p.x, f.y - p.y) <= FLARE_RADIUS,
    );
  const alpha = fullyLit
    ? 1
    : 0.3 + 0.7 * Math.min(1, p.markLeft / SONAR_MARK_TIME);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (s.art !== null) {
    drawSprite(ctx, s.art[p.kind], predatorFrame(s, p), p.x, p.y);
  } else {
    ctx.fillStyle = `rgb(${KIND_COLOR[p.kind]})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!fullyLit) {
    ctx.strokeStyle = "rgba(90, 245, 255, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDrifter(ctx: Ctx, s: View, d: DeepReadonly<Drifter>): void {
  if (!d.lit) return;
  if (s.art !== null)
    drawSprite(ctx, s.art.drifter, cycle(s.simTime, 8, 8), d.x, d.y);
}

function drawAlert(ctx: Ctx, p: DeepReadonly<Predator>): void {
  if (p.alertLeft <= 0) return;
  const t = 1 - p.alertLeft / ALERT_TIME;
  const color = KIND_COLOR[p.kind];
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const r = 14 + 46 * t;
  ctx.strokeStyle = `rgba(${color}, ${1 - t})`;
  ctx.lineWidth = 4 * (1 - t) + 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    ctx.moveTo(p.x + Math.cos(a) * r * 0.55, p.y + Math.sin(a) * r * 0.55);
    ctx.lineTo(p.x + Math.cos(a) * r * 1.15, p.y + Math.sin(a) * r * 1.15);
  }
  ctx.stroke();
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 30);
  g.addColorStop(0, `rgba(${color}, ${0.6 * (1 - t)})`);
  g.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(p.x - 30, p.y - 30, 60, 60);
  ctx.restore();
}

/** The flare-bloom sheet frame showing now, or `null` outside a flare. */
function bloomFrame(p: DeepReadonly<Predator>): number | null {
  if (p.kind !== "flarefish") return null;
  if (p.flarePhase === "charge")
    return Math.min(2, Math.floor((1 - p.flareLeft / FLARE_CHARGE) * 3));
  if (p.flarePhase === "bloom")
    return 3 + Math.min(2, Math.floor((1 - p.flareLeft / FLARE_BLOOM) * 3));
  if (p.fadeLeft > 0)
    return 6 + Math.min(1, Math.floor((1 - p.fadeLeft / FADE_TIME) * 2));
  return null;
}

function drawFlare(ctx: Ctx, s: View, p: DeepReadonly<Predator>): void {
  const frame = bloomFrame(p);
  if (frame === null) return;
  // Frame 5's lit radius is half the 128-pixel frame, scaled to the flare radius.
  const size = FLARE_RADIUS * 2;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (s.art !== null) {
    ctx.globalAlpha = frame >= 3 && frame <= 5 ? 0.85 : 0.7;
    ctx.drawImage(
      s.art.bloom[frame] as ImageBitmap,
      p.x - size / 2,
      p.y - size / 2,
      size,
      size,
    );
  } else {
    const r = frame <= 2 ? 20 + frame * 15 : frame <= 5 ? FLARE_RADIUS : 60;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, "rgba(255, 250, 220, 0.8)");
    g.addColorStop(1, "rgba(255, 160, 60, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  }
  ctx.restore();
}

function drawForager(ctx: Ctx, s: View): void {
  const f = s.forager;
  const g = ctx.createRadialGradient(
    f.x,
    f.y,
    0,
    f.x,
    f.y,
    26 + 10 * s.brightness,
  );
  g.addColorStop(0, `rgba(150, 255, 240, ${0.5 + 0.3 * s.brightness})`);
  g.addColorStop(1, "rgba(80, 240, 230, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(f.x - 40, f.y - 40, 80, 80);
  if (s.art !== null) {
    const frame = FACING_BASE[f.dir] + (f.moving ? cycle(s.simTime, 9, 2) : 0);
    drawSprite(ctx, s.art.forager, frame, f.x, f.y);
  } else {
    ctx.fillStyle = CYAN;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 10, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPulses(ctx: Ctx, s: View): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const pulse of s.pulses) {
    const color = PULSE_COLOR[pulse.tint];
    const fade = 1 - 0.5 * (pulse.front / Math.max(1, pulse.range));
    for (let i = 0; i < pulse.dist.length; i++) {
      const d = pulse.dist[i];
      if (d < 0 || d > pulse.front) continue;
      const lag = pulse.front - d;
      if (lag > 2.2) continue;
      const a = (1 - lag / 2.2) * fade;
      const tx = i % GRID_COLS;
      const ty = (i - tx) / GRID_COLS;
      const x = tileLeft(tx);
      const y = tileTop(ty);
      ctx.fillStyle = `rgba(${color}, ${0.16 * a})`;
      ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      if (lag < 1) {
        // The crest itself: a bright bead on every tile the front is crossing.
        const cx = x + TILE / 2;
        const cy = y + TILE / 2;
        const crest = 1 - lag;
        ctx.fillStyle = `rgba(${color}, ${0.35 * crest * fade})`;
        ctx.beginPath();
        ctx.arc(cx, cy, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${color}, ${0.85 * crest * fade})`;
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawMazeView(ctx: Ctx, s: View): void {
  ctx.save();
  clipToMaze(ctx);
  ctx.fillStyle = FOG;
  ctx.fillRect(GRID_ORIGIN_X, GRID_ORIGIN_Y, MAZE_W, MAZE_H);

  // Terrain and plankton, inside the vision circle and the flare discs alone.
  ctx.save();
  maskPath(ctx, s);
  ctx.clip();
  drawTerrain(ctx, s);
  ctx.restore();

  drawGlow(ctx, s);
  drawInk(ctx, s);
  for (const d of s.drifters) drawDrifter(ctx, s, d);
  for (const p of s.predators) if (!waitingInDen(s, p)) drawPredator(ctx, s, p);

  // The amber lights, clipped to the same region, whatever the fog says.
  ctx.save();
  maskPath(ctx, s);
  ctx.clip();
  for (const d of s.drifters) amberLight(ctx, d.x, d.y, s.simTime);
  for (const p of s.predators) {
    if (p.kind === "lanternjaw" && !waitingInDen(s, p))
      amberLight(ctx, p.x, p.y, s.simTime);
  }
  ctx.restore();

  drawForager(ctx, s);
  for (const p of s.predators) drawFlare(ctx, s, p);
  for (const p of s.predators) drawAlert(ctx, p);
  drawPulses(ctx, s);
  ctx.restore();
}

// ---- The HUD ---------------------------------------------------------------------

function gauge(
  ctx: Ctx,
  x: number,
  y: number,
  label: string,
  fill: number,
  color: string,
): void {
  const w = 150;
  const h = 14;
  text(ctx, label, x, y - 12, 14, fill >= 1 ? INK_TEXT : DIM_TEXT, "left");
  ctx.fillStyle = "rgba(10, 30, 46, 0.95)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill >= 1 ? color : "rgba(120, 150, 170, 0.75)";
  ctx.fillRect(x + 2, y + 2, (w - 4) * Math.max(0, Math.min(1, fill)), h - 4);
  ctx.strokeStyle = "rgba(150, 220, 230, 0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawHud(ctx: Ctx, s: View): void {
  // Top strip.
  ctx.fillStyle = "#050c18";
  ctx.fillRect(0, 0, STAGE_W, GRID_ORIGIN_Y);
  ctx.fillRect(
    0,
    GRID_ORIGIN_Y + MAZE_H,
    STAGE_W,
    STAGE_H - GRID_ORIGIN_Y - MAZE_H,
  );
  ctx.fillStyle = "rgba(111, 243, 230, 0.25)";
  ctx.fillRect(0, GRID_ORIGIN_Y - 2, STAGE_W, 1);
  ctx.fillRect(0, GRID_ORIGIN_Y + MAZE_H + 1, STAGE_W, 1);

  text(
    ctx,
    String(s.score).padStart(6, "0"),
    GRID_ORIGIN_X,
    42,
    64,
    INK_TEXT,
    "left",
  );
  text(ctx, TITLE_TEXT, STAGE_W / 2, 40, 22, "rgba(111, 243, 230, 0.75)");
  text(
    ctx,
    DIVE_LABEL,
    STAGE_W - GRID_ORIGIN_X,
    40,
    16,
    DIM_TEXT,
    "right",
    "normal",
  );

  // Bottom strip.
  const base = GRID_ORIGIN_Y + MAZE_H;
  text(ctx, "LIVES", GRID_ORIGIN_X, base + 32, 14, DIM_TEXT, "left");
  for (let i = 0; i < s.lives; i++) {
    const x = GRID_ORIGIN_X + 76 + i * 30;
    if (s.art !== null) {
      ctx.drawImage(s.art.forager[6] as ImageBitmap, x, base + 18, 28, 28);
    } else {
      ctx.fillStyle = CYAN;
      ctx.beginPath();
      ctx.arc(x + 14, base + 32, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  text(ctx, `DEPTH ${s.depth}`, 470, base + 32, 26, INK_TEXT, "left");
  const sonarFill =
    s.sonar.cooldown <= 0 ? 1 : 1 - s.sonar.cooldown / SONAR_COOLDOWN;
  const inkFill = s.ink.cooldown <= 0 ? 1 : 1 - s.ink.cooldown / INK_COOLDOWN;
  gauge(ctx, 820, base + 30, "SONAR  [SPACE]", sonarFill, "rgb(90, 245, 255)");
  gauge(
    ctx,
    1000 + 16,
    base + 30,
    "INK  [SHIFT]",
    inkFill,
    "rgb(180, 140, 255)",
  );
}

// ---- The screens -----------------------------------------------------------------

function dim(ctx: Ctx, alpha: number): void {
  ctx.fillStyle = `rgba(1, 3, 8, ${alpha})`;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

/** A dim slice of the maze behind the title, every tile at memory brightness. */
function drawBackdrop(ctx: Ctx, s: View): void {
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++)
      drawTile(ctx, s.art, s.tiles, tx, ty);
  }
  dim(ctx, 0.8);
  const g = ctx.createRadialGradient(640, 330, 40, 640, 330, 700);
  g.addColorStop(0, "rgba(40, 140, 160, 0.12)");
  g.addColorStop(1, "rgba(1, 3, 8, 0.85)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function drawTitle(ctx: Ctx, s: View): void {
  drawBackdrop(ctx, s);
  for (let i = 0; i < 18; i++) {
    const x = (i * 211 + 37) % STAGE_W;
    const y =
      (STAGE_H - ((s.simTime * (8 + (i % 5) * 3) + i * 97) % STAGE_H)) %
      STAGE_H;
    ctx.fillStyle =
      i % 4 === 0 ? "rgba(255, 150, 80, 0.55)" : "rgba(140, 255, 240, 0.45)";
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  glowText(
    ctx,
    TITLE_TEXT,
    STAGE_W / 2,
    230,
    128,
    "#bffcf6",
    "rgba(111, 243, 230, 0.9)",
  );
  text(ctx, TAGLINE_TEXT, STAGE_W / 2, 330, 28, "#ffb27a");
  drawMenu(ctx, "title", s.menuIndex);
  text(
    ctx,
    "ARROWS / WASD SWIM    SPACE SONAR    SHIFT INK    P PAUSE    M MUTE",
    STAGE_W / 2,
    650,
    16,
    DIM_TEXT,
    "center",
    "normal",
  );
  if (s.muted) text(ctx, "MUTED", STAGE_W - 40, 30, 14, DIM_TEXT, "right");
}

const HOWTO: readonly (readonly [string, string])[] = [
  ["SWIM", "Arrow keys or WASD. Graze every plankton mote to clear the maze."],
  [
    "",
    "Each bite makes you glow brighter for a moment: you see further, but so do they.",
  ],
  [
    "SONAR",
    "Space. A ping floods the corridors around you and shows who is lurking there.",
  ],
  [
    "INK",
    "Shift. A black cloud that blinds the hunters that see while you slip away.",
  ],
  [
    "PAUSE",
    "Esc or P.      MUTE  M.      MENUS  Enter or Space, arrows to choose.",
  ],
];

const HUNTERS: readonly (readonly [PredatorKind, string, string])[] = [
  [
    "lanternjaw",
    "LANTERNJAW",
    "Hunts your light. Its amber bulb looks just like a harmless drifter's.",
  ],
  [
    "gloamfin",
    "GLOAMFIN",
    "Eyeless. Hears you up close, hears your sonar, and pings for you itself.",
  ],
  [
    "flarefish",
    "FLAREFISH",
    "Invisible until it flares. A flare lights everything, and it locks on.",
  ],
];

function drawHowto(ctx: Ctx, s: View): void {
  drawBackdrop(ctx, s);
  panel(ctx, 90, 40, 1100, 640);
  glowText(
    ctx,
    "HOW TO PLAY",
    STAGE_W / 2,
    84,
    40,
    "#bffcf6",
    "rgba(111, 243, 230, 0.8)",
  );
  HOWTO.forEach(([head, body], i) => {
    const y = 140 + i * 36;
    if (head) text(ctx, head, 130, y, 18, CYAN, "left");
    text(ctx, body, 240, y, 17, INK_TEXT, "left", "normal");
  });
  text(ctx, "THE HUNTERS", 130, 340, 20, "#ffb27a", "left");
  HUNTERS.forEach(([kind, name, body], i) => {
    const y = 388 + i * 52;
    if (s.art !== null)
      ctx.drawImage(
        s.art[kind][kind === "lanternjaw" ? 0 : 6] as ImageBitmap,
        130,
        y - 18,
        36,
        36,
      );
    text(ctx, name, 186, y, 18, `rgb(${KIND_COLOR[kind]})`, "left");
    text(ctx, body, 340, y, 16, INK_TEXT, "left", "normal");
  });
  text(ctx, "READING THE DARK", 130, 552, 20, "#ffb27a", "left");
  text(
    ctx,
    "Your glow lights a small pocket; beyond your circle even explored water goes black.",
    130,
    586,
    16,
    INK_TEXT,
    "left",
    "normal",
  );
  text(
    ctx,
    "Sonar maps the corridors ahead and marks the Gloamfin and Flarefish, but wakes the Gloamfin.",
    130,
    614,
    16,
    INK_TEXT,
    "left",
    "normal",
  );
  text(ctx, "PRESS ENTER OR CLICK TO RETURN", STAGE_W / 2, 655, 16, DIM_TEXT);
}

function drawCountdown(ctx: Ctx, s: View): void {
  ctx.fillStyle = "rgba(2, 6, 14, 0.55)";
  ctx.fillRect(0, 270, STAGE_W, 150);
  glowText(
    ctx,
    "DIVE",
    STAGE_W / 2,
    318,
    64,
    "#bffcf6",
    "rgba(111, 243, 230, 0.9)",
  );
  text(
    ctx,
    String(Math.max(1, Math.ceil(s.screenTimer))),
    STAGE_W / 2,
    382,
    36,
    "#ffb27a",
  );
}

function drawPaused(ctx: Ctx, s: View): void {
  dim(ctx, 0.55);
  panel(ctx, 400, 190, 480, 330);
  glowText(
    ctx,
    "PAUSED",
    STAGE_W / 2,
    250,
    48,
    "#bffcf6",
    "rgba(111, 243, 230, 0.8)",
  );
  drawMenu(ctx, "paused", s.menuIndex);
}

function drawCleared(ctx: Ctx, s: View): void {
  ctx.fillStyle = "rgba(2, 6, 14, 0.7)";
  ctx.fillRect(0, 260, STAGE_W, 170);
  glowText(
    ctx,
    `DEPTH ${s.depth} CLEARED`,
    STAGE_W / 2,
    320,
    56,
    "#bffcf6",
    "rgba(111, 243, 230, 0.9)",
  );
  text(ctx, "DESCENDING...", STAGE_W / 2, 385, 22, "#ffb27a");
}

function drawGameover(ctx: Ctx, s: View): void {
  dim(ctx, 0.72);
  panel(ctx, 340, 150, 600, 470);
  glowText(
    ctx,
    "GAME OVER",
    STAGE_W / 2,
    220,
    64,
    "#ffc9a0",
    "rgba(255, 120, 60, 0.8)",
  );
  text(ctx, `SCORE ${s.score}`, STAGE_W / 2, 310, 34, INK_TEXT);
  text(ctx, `REACHED DEPTH ${s.depth}`, STAGE_W / 2, 365, 24, DIM_TEXT);
  drawMenu(ctx, "gameover", s.menuIndex);
}

/** Draws the whole frame for the screen the state is showing. */
export function renderGame(s: View, ctx: Ctx): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = FOG;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  switch (s.screen) {
    case "title":
      drawTitle(ctx, s);
      return;
    case "howto":
      drawHowto(ctx, s);
      return;
    default:
      break;
  }
  drawMazeView(ctx, s);
  drawHud(ctx, s);
  if (s.screen === "countdown") drawCountdown(ctx, s);
  else if (s.screen === "paused") drawPaused(ctx, s);
  else if (s.screen === "cleared") drawCleared(ctx, s);
  else if (s.screen === "gameover") drawGameover(ctx, s);
  if (s.muted)
    text(ctx, "MUTED", STAGE_W - GRID_ORIGIN_X, 64, 12, DIM_TEXT, "right");
}
