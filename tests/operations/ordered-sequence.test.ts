import { expect, test } from "vitest";
import { OrderedSequence } from "../../src/operations/ordered-sequence.ts";

type Node = { value: number; left?: Node; right?: Node; parent?: Node; height: number; size: number };
function inspect(order: OrderedSequence<number>) {
  const root = (order as unknown as { root?: Node }).root;
  function visit(node?: Node, parent?: Node): { size: number; height: number } {
    if (!node) return { size: 0, height: 0 };
    expect(node.parent).toBe(parent);
    const left = visit(node.left, node);
    const right = visit(node.right, node);
    expect(node.size).toBe(left.size + right.size + 1);
    expect(node.height).toBe(Math.max(left.height, right.height) + 1);
    expect(Math.abs(left.height - right.height)).toBeLessThanOrEqual(1);
    return { size: node.size, height: node.height };
  }
  const result = visit(root);
  expect(result.size).toBe(order.length);
  expect(result.height).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(order.length + 1)));
}

test("rank and selection follow deterministic mixed moves and retain AVL invariants", () => {
  const reference = Array.from({ length: 257 }, (_, i) => i * 17 - 100);
  const order = new OrderedSequence(reference);
  for (let step = 0; step < 3000; step++) {
    const from = step * 73 % reference.length;
    const to = step % 3 === 0 ? 0 : step % 3 === 1 ? reference.length - 1 : step * 37 % reference.length;
    const value = reference[from]!;
    order.move(value, to);
    reference.splice(to, 0, reference.splice(from, 1)[0]!);
    if (step % 31 === 0) {
      inspect(order);
      for (let i = 0; i < reference.length; i++) {
        expect(order.at(i)).toBe(reference[i]);
        expect(order.rank(reference[i]!)).toBe(i);
      }
    }
  }
  inspect(order);
});

test("large adversarial moves keep bounded height without rereading the source", () => {
  let reads = 0;
  const count = 16384;
  const source = new Proxy(Array.from({ length: count }, (_, i) => i), {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  const order = new OrderedSequence(source);
  expect(reads).toBe(count);
  let accesses = 0;
  function track(node?: Node) {
    if (!node) return;
    track(node.left);
    track(node.right);
    for (const key of ["left", "right", "parent", "height", "size"] as const) {
      let value = node[key];
      Object.defineProperty(node, key, {
        get() { accesses++; return value; },
        set(next: typeof value) { value = next; },
      });
    }
  }
  track((order as unknown as { root?: Node }).root);
  for (let i = count - 1; i >= 0; i--) order.move(i, count - 1);
  // Count tree field accesses rather than relying on wall-clock timing.
  expect(accesses).toBeLessThan(count * Math.ceil(Math.log2(count + 1)) * 96);
  inspect(order);
  for (let i = 0; i < count; i++) {
    expect(order.at(i)).toBe(count - i - 1);
    expect(order.rank(count - i - 1)).toBe(i);
  }
  expect(reads).toBe(count);
});

test("missing values and invalid ranks never mutate the sequence", () => {
  const order = new OrderedSequence([3, 1, 2]);
  expect(order.rank(99)).toBe(-1);
  for (const index of [-1, 3, 0.5, NaN]) {
    expect(order.at(index)).toBeUndefined();
    expect(() => order.move(1, index)).toThrow("Invalid sequence move");
  }
  expect(() => order.move(99, 0)).toThrow("Invalid sequence move");
  expect(() => new OrderedSequence([1, 1])).toThrow("unique");
  expect([order.at(0), order.at(1), order.at(2)]).toEqual([3, 1, 2]);
  inspect(order);
});
