import { expect, test } from "vitest";
import picomatch from "picomatch";
import { compileLinearRegex } from "../../src/rules/linear-regex.ts";
import { compileURLRules } from "../../src/rules/url-rules.ts";

// Deterministic generator so failures reproduce.
const random = (seed: number) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T>(next: () => number, items: readonly T[]) => items[Math.floor(next() * items.length)]!;
const tokens = ["a", "b", ".", "/", "*", "**", "?", "[ab]", "[!a]", "[a-c]", "[[:digit:]]", "@(a|b)", "?(a|ab)", "+(a|bc)", "*(a|b)",
  "!(a)", "!(*.b)", "{a,b}", "\\*", "1", "x/", "/.", "@(a|*b)", "+(ab)", "*(a)"] as const;
const characters = ["a", "b", "c", ".", "/", "1", "*", "x"] as const;

test("matches exactly like the picomatch RegExp across generated globs and inputs", () => {
  // LINEAR_REGEX_ROUNDS widens the comparison when investigating the matcher.
  const rounds = Number(process.env.LINEAR_REGEX_ROUNDS ?? 1500), next = random(Number(process.env.LINEAR_REGEX_SEED ?? 20261104));
  let compared = 0;
  for (let round = 0; round < rounds; round++) {
    const pattern = Array.from({ length: 1 + Math.floor(next() * 5) }, () => pick(next, tokens)).join("");
    const native = picomatch.makeRe(pattern, { contains: true, strictBrackets: true });
    const linear = compileLinearRegex(native.source);
    for (let sample = 0; sample < 12; sample++) {
      const input = Array.from({ length: Math.floor(next() * (process.env.LINEAR_REGEX_ROUNDS ? 16 : 9)) }, () => pick(next, characters)).join("");
      expect(linear.test(input), JSON.stringify({ pattern, source: native.source, input })).toBe(native.test(input));
      compared++;
    }
  }
  expect(compared).toBe(rounds * 12);
}, process.env.LINEAR_REGEX_ROUNDS ? 600_000 : undefined);

test("regular expression features picomatch emits behave like RegExp", () => {
  const cases: [string, string[]][] = [
    ["^a$", ["a", "ba", "ab", ""]], ["a\\b", ["a", "ab", "a-"]], ["\\Ba", ["ba", "a", " a"]],
    ["(?:(?!(?:^|\\/)\\.).)*?x", ["x", ".x", "a/.x", "ab/x"]], ["(?=.)a*", ["", "b"]], ["[^]", ["", "z"]], ["[]", ["", "a"]],
    ["\\é\\d\\s\\w\\W\\S\\D", ["é1 a-x!", "é1 a-xa"]], ["[\\]a-c\\-]+$", ["b]-", "d"]], ["a{2,3}b", ["ab", "aab", "aaaab"]],
    ["\\x41\\u0042\\t", ["AB\t", "AB "]], ["(?!(?:[^/]*?\\.js)$)[^/]*?$", ["a.js", "a.ts", "a.js/b"]],
  ];
  for (const [source, inputs] of cases) for (const input of inputs) {
    expect(compileLinearRegex(source).test(input), source + " " + JSON.stringify(input)).toBe(new RegExp(source).test(input));
  }
});

test("constructs outside the generated subset are rejected instead of approximated", () => {
  for (const source of ["(a)\\1", "(?<=a)b", "(?<name>a)", "\\cA", "\\01", "a{1000}", "a**"]) expect(() => compileLinearRegex(source), source).toThrow();
});

test("adjacent unbounded repeats and stacked wildcards match long crafted URLs quickly", () => {
  const url = "https://example.test/" + "a".repeat(20_000) + "c";
  for (const pattern of ["*(a)".repeat(12) + "b", "*a*a*a*a*a*b", "**a**a**a**b", "!(*a*a*b)x"]) {
    const [rule] = compileURLRules(pattern);
    const started = performance.now();
    expect(rule!.test(url)).toBe(picomatch.makeRe(pattern, { contains: true, strictBrackets: true }).test("https://example.test/aac"));
    expect(performance.now() - started, pattern).toBeLessThan(2000);
  }
});
