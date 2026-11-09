const f = Math.fround;
/** C++20 std::lerp for native UI float values. */
export function lerpFloat(a: number, b: number, t: number): number {
  if ((a <= 0 && b >= 0) || (a >= 0 && b <= 0)) return f(f(t * b) + f(f(1 - t) * a));
  if (t === 1) return b;
  const x = f(a + f(t * f(b - a)));
  return t > 1 === b > a ? Math.max(b, x) : Math.min(b, x);
}
