// A small seeded generator (mulberry32). Its whole state is one 32-bit number,
// which the game keeps in `FathomState.rng`, so every random draw the simulation
// makes is reproducible from the state alone.

export class Rng {
  constructor(public seed: number) {
    this.seed = seed >>> 0;
  }

  /** A float in `[0, 1)`. */
  next(): number {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A whole number in `[0, n)`. */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** One entry of a non-empty list, drawn uniformly. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** The list in a uniformly random order, as a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}
