const getLCSIndices = (a: number[], b: number[]): number[] => {
  if (a.length !== b.length) {
    throw new Error("Input arrays must have the same length");
  }
  const n = a.length;
  const destinations = new Map(b.map((id, index) => [id, index]));
  if (destinations.size !== n || new Set(a).size !== n) {
    throw new Error("Input arrays must contain unique IDs");
  }
  const ranks = a.map(id => {
    const rank = destinations.get(id);
    if (rank == null) throw new Error("Input arrays must contain the same IDs");
    return rank;
  });
  const tails: number[] = [];
  const tailIndices: number[] = [];
  const previous = new Int32Array(n).fill(-1);

  // Reverse both orders to retain the earlier source ID in tied subsequences,
  // matching the existing two-tab move choice. Binary search builds an LIS.
  for (let i = n - 1; i >= 0; i--) {
    const value = n - 1 - ranks[i]!;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (tails[middle]! < value) low = middle + 1;
      else high = middle;
    }
    previous[i] = low > 0 ? tailIndices[low - 1]! : -1;
    tails[low] = value;
    tailIndices[low] = i;
  }

  const indices: number[] = [];
  let index = tailIndices[tails.length - 1] ?? -1;
  while (index !== -1) {
    indices.push(index);
    index = previous[index]!;
  }
  return indices;
};

export const minMoveOperations = (
  a: number[],
  b: number[]
): { from: number; to: number; value: number }[] => {
  const result: { from: number; to: number; value: number }[] = [];
  const current = [...a];
  const stationary = new Set(getLCSIndices(a, b).map((index) => a[index]));

  // Keep one longest common subsequence stationary. Place every other ID
  // immediately before its target successor, working from right to left.
  // Later moves may shift both together without breaking their relative order.
  for (let i = b.length - 1; i >= 0; i--) {
    const expected = b[i]!;
    if (stationary.has(expected)) continue;

    const from = current.indexOf(expected);
    const successor = i + 1 < b.length ? current.indexOf(b[i + 1]!) : current.length;
    const to = successor - (from < successor ? 1 : 0);

    if (from !== to) {
      result.push({ from, to, value: expected });
      current.splice(from, 1);
      current.splice(to, 0, expected);
    }
  }

  return result;
};
