type OrderNode<T> = {
  value: T;
  left: OrderNode<T> | undefined;
  right: OrderNode<T> | undefined;
  parent: OrderNode<T> | undefined;
  height: number;
  size: number;
};

const height = <T>(node: OrderNode<T> | undefined) => node?.height ?? 0;
const size = <T>(node: OrderNode<T> | undefined) => node?.size ?? 0;

// AVL height and subtree sizes bound rank, selection and moves by O(log n).
// Nodes retain identity through rotations so value lookup never needs a scan.
export class OrderedSequence<T> {
  private root: OrderNode<T> | undefined;
  private readonly nodes = new Map<T, OrderNode<T>>();

  constructor(values: readonly T[]) {
    const build = (start: number, end: number, parent?: OrderNode<T>): OrderNode<T> | undefined => {
      if (start === end) return undefined;
      const middle = Math.floor((start + end) / 2);
      const value = values[middle]!;
      if (this.nodes.has(value)) throw new Error("Sequence values must be unique");
      const node: OrderNode<T> = { value, left: undefined, right: undefined, parent, height: 1, size: 1 };
      this.nodes.set(value, node);
      node.left = build(start, middle, node);
      node.right = build(middle + 1, end, node);
      return this.update(node);
    };
    this.root = build(0, values.length);
  }

  get length() { return size(this.root); }

  rank(value: T): number {
    let node = this.nodes.get(value);
    if (!node) return -1;
    let result = size(node.left);
    while (node.parent) {
      if (node === node.parent.right) result += size(node.parent.left) + 1;
      node = node.parent;
    }
    return result;
  }

  at(index: number): T | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) return undefined;
    let node = this.root;
    while (node) {
      const left = size(node.left);
      if (index === left) return node.value;
      if (index < left) node = node.left;
      else { index -= left + 1; node = node.right; }
    }
    return undefined;
  }

  move(value: T, to: number): void {
    const node = this.nodes.get(value);
    const from = this.rank(value);
    if (!node || !Number.isInteger(to) || to < 0 || to >= this.length) throw new Error("Invalid sequence move");
    if (from === to) return;
    this.root = this.remove(this.root!, from);
    if (this.root) this.root.parent = undefined;
    node.left = undefined;
    node.right = undefined;
    node.parent = undefined;
    this.update(node);
    this.root = this.insert(this.root, node, to);
    this.root.parent = undefined;
  }

  private update(node: OrderNode<T>): OrderNode<T> {
    node.height = Math.max(height(node.left), height(node.right)) + 1;
    node.size = size(node.left) + size(node.right) + 1;
    if (node.left) node.left.parent = node;
    if (node.right) node.right.parent = node;
    return node;
  }

  private rotate(node: OrderNode<T>, left: boolean): OrderNode<T> {
    const next = (left ? node.right : node.left)!;
    next.parent = node.parent;
    if (left) { node.right = next.left; next.left = this.update(node); }
    else { node.left = next.right; next.right = this.update(node); }
    return this.update(next);
  }

  private balance(node: OrderNode<T>): OrderNode<T> {
    this.update(node);
    const difference = height(node.left) - height(node.right);
    if (difference > 1) {
      if (height(node.left!.left) < height(node.left!.right)) node.left = this.rotate(node.left!, true);
      return this.rotate(node, false);
    }
    if (difference < -1) {
      if (height(node.right!.right) < height(node.right!.left)) node.right = this.rotate(node.right!, false);
      return this.rotate(node, true);
    }
    return node;
  }

  private insert(root: OrderNode<T> | undefined, node: OrderNode<T>, index: number): OrderNode<T> {
    if (!root) return node;
    const left = size(root.left);
    if (index <= left) root.left = this.insert(root.left, node, index);
    else root.right = this.insert(root.right, node, index - left - 1);
    return this.balance(root);
  }

  private detachFirst(node: OrderNode<T>): [OrderNode<T> | undefined, OrderNode<T>] {
    if (!node.left) return [node.right, node];
    const [left, first] = this.detachFirst(node.left);
    node.left = left;
    return [this.balance(node), first];
  }

  private remove(node: OrderNode<T>, index: number): OrderNode<T> | undefined {
    const left = size(node.left);
    if (index < left) node.left = this.remove(node.left!, index);
    else if (index > left) node.right = this.remove(node.right!, index - left - 1);
    else {
      if (!node.left) return node.right;
      if (!node.right) return node.left;
      const [right, successor] = this.detachFirst(node.right);
      successor.left = node.left;
      successor.right = right;
      successor.parent = node.parent;
      return this.balance(successor);
    }
    return this.balance(node);
  }
}
