const getLCSIndices = (a: number[], b: number[]): number[] => {
  if (a.length !== b.length) {
    throw new Error("Input arrays must have the same length");
  }

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        // @ts-expect-error
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        // @ts-expect-error
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const indices: number[] = [];
  let i = m,
    j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      indices.unshift(i - 1);
      i--;
      j--;
      // @ts-expect-error
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return indices;
};

export const minMoveOperations = (
  a: number[],
  b: number[]
): { from: number; to: number; value: number }[] => {
  const result: { from: number; to: number; value: number }[] = [];
  let current = [...a];

  const lcsIndices = getLCSIndices(a, b);
  const lcsValues = lcsIndices.map((i) => a[i]);

  let lcsPos = 0;

  for (let i = 0; i < b.length; i++) {
    const expected = b[i]!;

    if (lcsPos < lcsValues.length && lcsValues[lcsPos] === expected) {
      lcsPos++;
      continue;
    }

    const from = current.indexOf(expected);
    const to = i;

    if (from !== to) {
      result.push({ from, to, value: expected });
      current.splice(from, 1);
      current.splice(to, 0, expected);
    }
  }

  return result;
};
