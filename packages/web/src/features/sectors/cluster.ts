/**
 * Leaf order from average-linkage clustering on distance 1 − ρ, so sectors that move together sit
 * next to each other in the heatmap. Missing pairs count as uncorrelated; sectors with no data go
 * last in their original order.
 */
export function clusterOrder(matrix: readonly (readonly (number | null)[])[]): number[] {
  const n = matrix.length;
  const live = matrix.flatMap((row, i) => (row.some((v, j) => j !== i && v != null) ? [i] : []));
  const dead = matrix.map((_, i) => i).filter((i) => !live.includes(i));
  const dist = (a: number, b: number) => 1 - (matrix[a]?.[b] ?? 0);

  let clusters = live.map((i) => [i]);
  while (clusters.length > 1) {
    let best = { a: 0, b: 1, d: Number.POSITIVE_INFINITY };
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        let sum = 0;
        for (const i of clusters[a]!) for (const j of clusters[b]!) sum += dist(i, j);
        const d = sum / (clusters[a]!.length * clusters[b]!.length);
        if (d < best.d) best = { a, b, d };
      }
    }
    const left = clusters[best.a]!;
    const right = clusters[best.b]!;
    // Join at the closest ends so neighbours across the seam are as similar as possible.
    const joins = [
      [...left, ...right],
      [...left, ...[...right].reverse()],
      [...[...left].reverse(), ...right],
    ];
    const seam = (c: number[]) => dist(c[left.length - 1]!, c[left.length]!);
    const merged = joins.reduce((x, y) => (seam(y) < seam(x) ? y : x));
    clusters = clusters.filter((_, i) => i !== best.a && i !== best.b);
    clusters.push(merged);
  }
  return n === 0 ? [] : [...(clusters[0] ?? []), ...dead];
}
