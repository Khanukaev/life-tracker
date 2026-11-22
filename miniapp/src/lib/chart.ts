/** SVG helpers shared by charts (smoothing as in the design mockups). */

const f = (n: number) => +n.toFixed(1);

/** Catmull-Rom → cubic Bézier path through points. */
export function smooth(points: [number, number][]): string {
  if (!points.length) return "";
  let d = `M${f(points[0]![0])} ${f(points[0]![1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** Split a series with gaps (null) into continuous runs. */
export function runs<T>(xs: (T | null)[], toPoint: (v: T, i: number) => [number, number]): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  xs.forEach((v, i) => {
    if (v === null) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    } else cur.push(toPoint(v, i));
  });
  if (cur.length > 1) out.push(cur);
  return out;
}
