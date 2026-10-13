// Works out when each symbol on a reel crosses the centre line, so the
// overlay can schedule one tick per symbol on the audio clock as soon as the
// spin starts. Ticks speed up and slow down exactly with the reel, because
// both use the same easing curve. Runs in the overlay page and in the tests.

// CSS cubic-bezier for the reels: fast start, long slow stop.
export const REEL_EASING = [0.2, 0.65, 0.35, 1];

// Same maths as CSS cubic-bezier(x1, y1, x2, y2): maps time (0..1) to progress (0..1).
export function cubicBezier(x1, y1, x2, y2) {
  const curve = (a, b) => (t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const x = curve(x1, x2);
  const y = curve(y1, y2);
  return (time) => {
    if (time <= 0) return 0;
    if (time >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (x(mid) < time) lo = mid;
      else hi = mid;
    }
    return y((lo + hi) / 2);
  };
}

// Times in ms after the spin starts when symbol 1..symbols has its middle on
// the centre line. The reel moves `symbols` symbol heights in total.
export function tickTimes({ durationMs, symbols, easing = REEL_EASING }) {
  const progress = cubicBezier(...easing);
  const times = [];
  for (let k = 1; k <= symbols; k++) {
    const target = (k - 0.5) / symbols;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (progress(mid) < target) lo = mid;
      else hi = mid;
    }
    times.push(((lo + hi) / 2) * durationMs);
  }
  return times;
}
