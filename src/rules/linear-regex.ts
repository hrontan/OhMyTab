// Linear-time matching for the regular expressions picomatch generates.
// RegExp backtracks, so adjacent unbounded repeats such as `*a*a*b` can take
// exponential time on a crafted URL. Here every test runs a Thompson NFA over
// the input once, and each lookahead is precomputed for every position by one
// backward pass, so a test costs O(input length × pattern size). Constructs
// outside the subset picomatch emits (backreferences, lookbehind, flags) are
// rejected rather than approximated.

type Ranges = [number, number][];
type CharTest = { ranges: Ranges; negate: boolean };
type Node =
  | { type: "char"; test: CharTest }
  | { type: "seq"; items: Node[] }
  | { type: "alt"; items: Node[] }
  | { type: "repeat"; item: Node; min: number; max: number }
  | { type: "assert"; kind: "start" | "end" | "boundary" | "notBoundary" }
  | { type: "look"; negate: boolean; item: Node; index: number };

const DIGIT: Ranges = [[48, 57]];
const WORD: Ranges = [[48, 57], [65, 90], [95, 95], [97, 122]];
const SPACE: Ranges = [[9, 13], [32, 32], [0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a],
  [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff]];
const LINE: Ranges = [[10, 10], [13, 13], [0x2028, 0x2029]];
const MAX_EXPANDED_REPEAT = 100;

const inRanges = (ranges: Ranges, code: number) => {
  for (const [low, high] of ranges) if (code >= low && code <= high) return true;
  return false;
};
const matches = (test: CharTest, code: number) => inRanges(test.ranges, code) !== test.negate;
const complement = (ranges: Ranges): Ranges => {
  const result: Ranges = []; let next = 0;
  for (const [low, high] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (low > next) result.push([next, low - 1]);
    next = Math.max(next, high + 1);
  }
  if (next <= 0xffff) result.push([next, 0xffff]);
  return result;
};
const isWord = (input: string, position: number) => position >= 0 && position < input.length && inRanges(WORD, input.charCodeAt(position));

const unsupported = (source: string): never => { throw new Error("Unsupported pattern construct in " + source); };

const parse = (source: string) => {
  let position = 0, looks = 0;
  const peek = () => source[position];
  const escapeClass = (letter: string): Ranges | undefined => {
    if (letter === "d") return DIGIT; if (letter === "D") return complement(DIGIT);
    if (letter === "w") return WORD; if (letter === "W") return complement(WORD);
    if (letter === "s") return SPACE; if (letter === "S") return complement(SPACE);
    return undefined;
  };
  // Returns a code unit for an escape that denotes one character.
  const escapeCode = (inClass: boolean): number => {
    const letter = source[position++];
    if (letter === undefined) return unsupported(source);
    const controls: Record<string, number> = { t: 9, n: 10, v: 11, f: 12, r: 13, "0": 0 };
    if (inClass && letter === "b") return 8;
    if (letter === "0" && /[0-9]/.test(peek() ?? "")) return unsupported(source);
    if (letter in controls) return controls[letter]!;
    if (letter === "x" && /^[0-9a-fA-F]{2}/.test(source.slice(position))) { position += 2; return parseInt(source.slice(position - 2, position), 16); }
    if (letter === "u" && /^[0-9a-fA-F]{4}/.test(source.slice(position))) { position += 4; return parseInt(source.slice(position - 4, position), 16); }
    if (/[1-9cpPk]/.test(letter)) return unsupported(source);
    return letter.charCodeAt(0);
  };
  const parseClass = (): Node => {
    const negate = peek() === "^"; if (negate) position++;
    const ranges: Ranges = [];
    while (peek() !== "]") {
      if (position >= source.length) return unsupported(source);
      let low: number;
      if (peek() === "\\") {
        position++;
        const set = escapeClass(peek() ?? "");
        if (set) { position++; ranges.push(...set); continue; }
        low = escapeCode(true);
      } else low = source.charCodeAt(position++);
      if (peek() === "-" && source[position + 1] !== "]" && position + 1 < source.length) {
        position++;
        let high: number;
        if (peek() === "\\") {
          position++;
          if (escapeClass(peek() ?? "")) return unsupported(source);
          high = escapeCode(true);
        } else high = source.charCodeAt(position++);
        if (high < low) return unsupported(source);
        ranges.push([low, high]);
      } else ranges.push([low, low]);
    }
    position++;
    return { type: "char", test: { ranges, negate } };
  };
  const parseAtom = (): Node => {
    const character = source[position++]!;
    if (character === "(") {
      let look: boolean | undefined;
      if (source.startsWith("?:", position)) position += 2;
      else if (source.startsWith("?=", position)) { position += 2; look = false; }
      else if (source.startsWith("?!", position)) { position += 2; look = true; }
      else if (peek() === "?") return unsupported(source);
      const item = parseAlternation();
      if (source[position++] !== ")") return unsupported(source);
      return look === undefined ? item : { type: "look", negate: look, item, index: looks++ };
    }
    if (character === "[") return parseClass();
    if (character === ".") return { type: "char", test: { ranges: LINE, negate: true } };
    if (character === "^") return { type: "assert", kind: "start" };
    if (character === "$") return { type: "assert", kind: "end" };
    if (character === "\\") {
      const letter = peek();
      if (letter === "b") { position++; return { type: "assert", kind: "boundary" }; }
      if (letter === "B") { position++; return { type: "assert", kind: "notBoundary" }; }
      const set = escapeClass(letter ?? "");
      if (set) { position++; return { type: "char", test: { ranges: set, negate: false } }; }
      const code = escapeCode(false);
      return { type: "char", test: { ranges: [[code, code]], negate: false } };
    }
    if (character === ")" || character === "|" || "*+?".includes(character)) return unsupported(source);
    const code = character.charCodeAt(0);
    return { type: "char", test: { ranges: [[code, code]], negate: false } };
  };
  const parseQuantified = (): Node => {
    const atom = parseAtom();
    let min: number, max: number;
    const brace = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(position));
    if (peek() === "*") { min = 0; max = Infinity; position++; }
    else if (peek() === "+") { min = 1; max = Infinity; position++; }
    else if (peek() === "?") { min = 0; max = 1; position++; }
    else if (brace) {
      min = Number(brace[1]); max = brace[2] === undefined ? min : brace[3] ? Number(brace[3]) : Infinity;
      if (max < min || min > MAX_EXPANDED_REPEAT || (max !== Infinity && max > MAX_EXPANDED_REPEAT)) return unsupported(source);
      position += brace[0].length;
    } else return atom;
    // Laziness only changes which match is found, never whether one exists.
    if (peek() === "?") position++;
    if (atom.type === "assert" || atom.type === "look") return unsupported(source);
    return { type: "repeat", item: atom, min, max };
  };
  const parseSequence = (): Node => {
    const items: Node[] = [];
    while (position < source.length && peek() !== "|" && peek() !== ")") items.push(parseQuantified());
    return { type: "seq", items };
  };
  const parseAlternation = (): Node => {
    const items = [parseSequence()];
    while (peek() === "|") { position++; items.push(parseSequence()); }
    return items.length === 1 ? items[0]! : { type: "alt", items };
  };
  const root = parseAlternation();
  if (position !== source.length) unsupported(source);
  return { root, looks };
};

// NFA states: consume one character, branch, assert a position property, or accept.
type State =
  | { type: "char"; test: CharTest; next: number }
  | { type: "split"; next: number[] }
  | { type: "assert"; kind: "start" | "end" | "boundary" | "notBoundary"; next: number }
  | { type: "look"; index: number; negate: boolean; next: number }
  | { type: "match" };
type Machine = { states: State[]; start: number };

const build = (root: Node, reverse: boolean): Machine => {
  const states: State[] = [];
  const add = (state: State) => { states.push(state); return states.length - 1; };
  // Compiles node so that it continues to next; returns its entry state.
  const compile = (node: Node, next: number): number => {
    switch (node.type) {
      case "char": return add({ type: "char", test: node.test, next });
      case "assert": return add({ type: "assert", kind: node.kind, next });
      case "look": return add({ type: "look", index: node.index, negate: node.negate, next });
      case "seq": {
        const items = reverse ? node.items : [...node.items].reverse();
        return items.reduce((target, item) => compile(item, target), next);
      }
      case "alt": return add({ type: "split", next: node.items.map(item => compile(item, next)) });
      case "repeat": {
        let entry = next;
        if (node.max === Infinity) {
          const loop = add({ type: "split", next: [] });
          (states[loop] as { next: number[] }).next.push(compile(node.item, loop), next);
          entry = loop;
        } else {
          for (let count = node.max - node.min; count > 0; count--) entry = add({ type: "split", next: [compile(node.item, entry), next] });
        }
        for (let count = 0; count < node.min; count++) entry = compile(node.item, entry);
        return entry;
      }
    }
  };
  const start = compile(root, add({ type: "match" }));
  return { states, start };
};

// Flat form for the hot loop: kind, one successor, split targets and an ASCII table per character state.
const KIND = { char: 0, split: 1, assert: 2, look: 3, match: 4 } as const;
type Flat = { kinds: Uint8Array; next: Int32Array; targets: Int32Array[]; ascii: (Uint8Array | undefined)[]; tests: (CharTest | undefined)[]; states: State[]; start: number };
const flatten = ({ states, start }: Machine): Flat => {
  const kinds = new Uint8Array(states.length), next = new Int32Array(states.length).fill(-1);
  const targets: Int32Array[] = [], ascii: (Uint8Array | undefined)[] = [], tests: (CharTest | undefined)[] = [];
  states.forEach((state, index) => {
    kinds[index] = KIND[state.type];
    if (state.type === "split") targets[index] = Int32Array.from(state.next);
    else if (state.type !== "match") next[index] = state.next;
    if (state.type === "char") {
      const table = new Uint8Array(128);
      for (let code = 0; code < 128; code++) table[code] = matches(state.test, code) ? 1 : 0;
      ascii[index] = table; tests[index] = state.test;
    }
  });
  return { kinds, next, targets, ascii, tests, states, start };
};

export type LinearRegex = { readonly source: string; test(input: string): boolean };

// The longest literal every match must contain; a quick substring check
// rejects most URLs before the NFA runs.
const requiredLiteral = (root: Node) => {
  let best = "", run = "";
  const walk = (node: Node) => {
    if (node.type === "seq") { node.items.forEach(walk); return; }
    if (node.type === "assert" || node.type === "look") return;
    const [range] = node.type === "char" && !node.test.negate && node.test.ranges.length === 1 ? node.test.ranges : [];
    if (range && range[0] === range[1]) { run += String.fromCharCode(range[0]); if (run.length > best.length) best = run; return; }
    run = "";
  };
  walk(root);
  return best;
};

export const compileLinearRegex = (source: string): LinearRegex => {
  const { root, looks } = parse(source);
  const lookNodes: Extract<Node, { type: "look" }>[] = [];
  const collect = (node: Node) => {
    if (node.type === "look") { lookNodes[node.index] = node; collect(node.item); }
    else if (node.type === "seq" || node.type === "alt") node.items.forEach(collect);
    else if (node.type === "repeat") collect(node.item);
  };
  collect(root);
  const literal = requiredLiteral(root);
  const machines = [build(root, false), ...Array.from({ length: looks }, (_, index) => build(lookNodes[index]!.item, true))].map(flatten);
  // Reused buffers: each state enters a position's list at most once.
  const buffers = machines.map(({ kinds }) => ({ seen: new Int32Array(kinds.length), current: new Int32Array(kinds.length),
    next: new Int32Array(kinds.length), stack: new Int32Array(kinds.length), generation: 0 }));

  return { source, test(input: string) {
    if (literal && !input.includes(literal)) return false;
    const length = input.length;
    // Computed on first use, for every position, by one backward pass.
    const lookResults: (Uint8Array | undefined)[] = new Array(looks);
    const holds = (state: Extract<State, { type: "assert" | "look" }>, position: number): boolean => {
      if (state.type === "look") {
        let result = lookResults[state.index];
        if (!result) {
          const computed = new Uint8Array(length + 1);
          run(state.index + 1, true, computed);
          lookResults[state.index] = result = computed;
        }
        return (result[position] === 1) !== state.negate;
      }
      if (state.kind === "start") return position === 0;
      if (state.kind === "end") return position === length;
      const boundary = isWord(input, position - 1) !== isWord(input, position);
      return state.kind === "boundary" ? boundary : !boundary;
    };
    // Forward runs stop at the first accepted position; backward runs record acceptance at every position.
    const run = (machineIndex: number, backward: boolean, record?: Uint8Array): boolean => {
      const { kinds, next: successor, targets, ascii, tests, states, start } = machines[machineIndex]!, buffer = buffers[machineIndex]!;
      // A lazily computed lookahead runs its own machine, so these buffers are never shared by nested runs.
      const seen = buffer.seen, stack = buffer.stack;
      let current = buffer.current, next = buffer.next, currentCount = 0;
      for (let step = 0; step <= length; step++) {
        const position = backward ? length - step : step;
        const generation = ++buffer.generation;
        let top = 0, nextCount = 0, accepted = false;
        // A new attempt may begin at every position: matches are unanchored.
        seen[start] = generation; stack[top++] = start;
        for (let item = 0; item < currentCount; item++) {
          const index = current[item]!;
          if (seen[index] !== generation) { seen[index] = generation; stack[top++] = index; }
        }
        while (top) {
          const index = stack[--top]!, kind = kinds[index]!;
          if (kind === KIND.char) next[nextCount++] = index;
          else if (kind === KIND.split) {
            const branches = targets[index]!;
            for (let branch = 0; branch < branches.length; branch++) {
              const target = branches[branch]!;
              if (seen[target] !== generation) { seen[target] = generation; stack[top++] = target; }
            }
          } else if (kind === KIND.match) accepted = true;
          else if (holds(states[index] as Extract<State, { type: "assert" | "look" }>, position)) {
            const target = successor[index]!;
            if (seen[target] !== generation) { seen[target] = generation; stack[top++] = target; }
          }
        }
        if (record) record[position] = accepted ? 1 : 0;
        else if (accepted) return true;
        if (step === length) break;
        const code = input.charCodeAt(backward ? position - 1 : position);
        currentCount = 0;
        for (let item = 0; item < nextCount; item++) {
          const index = next[item]!;
          if (code < 128 ? ascii[index]![code] === 1 : matches(tests[index]!, code)) next[currentCount++] = successor[index]!;
        }
        const swap = current; current = next; next = swap;
      }
      return false;
    };
    return run(0, false);
  } };
};
