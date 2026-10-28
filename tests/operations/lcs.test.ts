import { expect, test } from "vitest";
import { minMoveOperations } from "../../src/operations/lcs.ts";

function applyMoves(source: number[], target: number[]) {
  const sourceBefore = [...source];
  const targetBefore = [...target];
  const current = [...source];
  const operations = minMoveOperations(source, target);
  const ids = [...source].sort((a, b) => a - b);
  const context = JSON.stringify({ source, target, operations });
  for (const { from, to, value } of operations) {
    expect(Number.isInteger(from), context).toBe(true);
    expect(Number.isInteger(to), context).toBe(true);
    expect(from, context).toBeGreaterThanOrEqual(0);
    expect(from, context).toBeLessThan(current.length);
    expect(to, context).toBeGreaterThanOrEqual(0);
    expect(to, context).toBeLessThan(current.length);
    expect(from, context).not.toBe(to);
    expect(current[from], context).toBe(value);
    const [removed] = current.splice(from, 1);
    expect(removed, context).toBe(value);
    current.splice(to, 0, value);
    expect([...current].sort((a, b) => a - b), context).toEqual(ids);
    expect(new Set(current).size, context).toBe(source.length);
  }
  expect(source, context).toEqual(sourceBefore);
  expect(target, context).toEqual(targetBefore);
  expect(current, context).toEqual(target);
  return operations;
}

// Independent oracle: enumerate every source subsequence rather than reproduce
// the production dynamic-programming recurrence or its chosen tie-breaks.
function longestCommonSubsequenceLength(source: number[], target: number[]) {
  let best = 0;
  for (let mask = 0; mask < 2 ** source.length; mask++) {
    let lastIndex = -1;
    let length = 0;
    for (let index = 0; index < source.length; index++) {
      if ((mask & (1 << index)) === 0) continue;
      const nextIndex = target.indexOf(source[index]!);
      if (nextIndex <= lastIndex) {
        length = -1;
        break;
      }
      lastIndex = nextIndex;
      length++;
    }
    best = Math.max(best, length);
  }
  return best;
}

function* permutations(values: number[]): Generator<number[]> {
  if (values.length === 0) {
    yield [];
    return;
  }
  for (let i = 0; i < values.length; i++) {
    const rest = [...values.slice(0, i), ...values.slice(i + 1)];
    for (const suffix of permutations(rest)) yield [values[i]!, ...suffix];
  }
}

test("regression: sequential moves reach [1,3,2,0] with exactly two moves", () => {
  expect(applyMoves([0, 1, 2, 3], [1, 3, 2, 0])).toHaveLength(2);
});

test("all 5913 permutations of 1 through 7 IDs preserve indices, IDs and minimality", () => {
  let checked = 0;
  for (let size = 1; size <= 7; size++) {
    const source = Array.from({ length: size }, (_, index) => index);
    for (const target of permutations(source)) {
      const moves = applyMoves(source, target);
      expect(moves.length, JSON.stringify({ source, target })).toBe(
        size - longestCommonSubsequenceLength(source, target),
      );
      checked++;
    }
  }
  expect(checked).toBe(5913);
}, 15000);

test("empty and already sorted inputs need no moves", () => {
  expect(applyMoves([], [])).toEqual([]);
  expect(applyMoves([42], [42])).toEqual([]);
  expect(applyMoves([8, 3, 91], [8, 3, 91])).toEqual([]);
});

test("IDs need not be consecutive or ordered by numeric value", () => {
  expect(applyMoves([90, -2, 140, 8], [-2, 8, 140, 90])).toHaveLength(2);
});

test("different lengths retain the existing error contract", () => {
  expect(() => minMoveOperations([1], [])).toThrow("Input arrays must have the same length");
});

test("two-tab LIS tie preserves the established move of the second ID", () => {
  expect(minMoveOperations([1, 2], [2, 1])).toEqual([{ from: 1, to: 0, value: 2 }]);
});

test("unique-ID ordering rejects repeated or different ID sets", () => {
  expect(() => minMoveOperations([1, 1], [1, 2])).toThrow("unique IDs");
  expect(() => minMoveOperations([1, 2], [1, 1])).toThrow("unique IDs");
  expect(() => minMoveOperations([1, 2], [1, 3])).toThrow("same IDs");
});

test.each(["reverse", "rotate"])("5000 IDs preserve sequential indices and closed-form minimality: %s", kind => {
  const source = Array.from({ length: 5000 }, (_, index) => index * 17 + 3);
  const target = kind === "reverse" ? [...source].reverse() : [...source.slice(137), ...source.slice(0, 137)];
  const current = [...source];
  const moves = minMoveOperations(source, target);
  expect(moves).toHaveLength(kind === "reverse" ? 4999 : 137);
  for (const { from, to, value } of moves) {
    if (from < 0 || from >= current.length || to < 0 || to >= current.length || from === to || current[from] !== value) {
      throw new Error("Invalid sequential move at large input");
    }
    current.splice(to, 0, current.splice(from, 1)[0]!);
  }
  expect(current).toEqual(target);
  expect(source).toEqual(Array.from({ length: 5000 }, (_, index) => index * 17 + 3));
});
