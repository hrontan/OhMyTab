import { expect, test } from "vitest";
import { compileURLRules, URL_RULE_LIMITS, urlRuleStorageBytes } from "../../src/rules/url-rules.ts";

test("nonblank count boundary ignores blank lines and retains physical line errors", () => {
  expect(compileURLRules(Array(100).fill("*").join("\n"))).toHaveLength(100);
  expect(() => compileURLRules(Array(101).fill("*").join("\n"))).toThrow("Line 101");
  expect(compileURLRules("\n\n * \n\t\r\n")).toHaveLength(1);
  expect(() => compileURLRules("\n\n[")).toThrow("Line 3");
});

test("trimmed rule length boundary uses UTF-16 units", () => {
  expect(compileURLRules("  " + "x".repeat(1024) + "  ")).toHaveLength(1);
  expect(() => compileURLRules("x".repeat(1025))).toThrow("1024 UTF-16");
  expect(compileURLRules("😀".repeat(512))).toHaveLength(1);
  expect(() => compileURLRules("😀".repeat(513))).toThrow("1024 UTF-16");
});

test("storage exact boundary counts JSON escaping, UTF-8 and the key", () => {
  const raw = " ".repeat(URL_RULE_LIMITS.storageBytes - urlRuleStorageBytes("") - 1) + "*";
  expect(urlRuleStorageBytes(raw)).toBe(8192);
  expect(compileURLRules(raw)).toHaveLength(1);
  expect(() => compileURLRules(raw + " ")).toThrow("8192 UTF-8");
  expect(urlRuleStorageBytes('é😀"\\\n')).toBe(Buffer.byteLength(JSON.stringify('é😀"\\\n'), "utf8") + "urlmatch_pattern".length);
  expect(() => compileURLRules(Array(5).fill("😀".repeat(512)).join("\n"))).toThrow("8192 UTF-8");
});

test.each([
  ["example.com/**", "https://example.com/docs/a", true],
  ["example.com/**", "https://other.test/a", false],
  ["item?", "https://site.test/item1", true],
  ["[[:digit:]]", "https://site.test/2", true],
  ["{docs,help}/**", "https://site.test/help/a", true],
  ["@(foo|bar)", "https://site.test/bar", true],
  ["+(foo|bar)", "https://site.test/foobar", true],
  ["*(a|b)", "https://site.test/abba", true],
  ["?(foo)", "https://site.test/foo", true],
  ["\\(literal\\)", "https://site.test/(literal)", true],
  ["[()]", "https://site.test/(", true],
] as const)("supported Picomatch pattern %s", (pattern, url, expected) => {
  expect(compileURLRules(pattern).some(rule => rule.test(url))).toBe(expected);
});

test.each(["[", "{a,b", "@(a", ")", "(a|aa)+", "[[:constructor:]]", "+(a|aa)", "+(*|?)", "+(+(a))", "*(+(a))", "+(+(+(a)))", "+(a|)", "+(foo|foobar)"])("unsupported syntax reports its line: %s", pattern => {
  expect(() => compileURLRules("\n" + pattern)).toThrow("Line 2");
});

test("extglob nesting boundary is explicit", () => {
  expect(compileURLRules("@(".repeat(16) + "x" + ")".repeat(16))).toHaveLength(1);
  expect(() => compileURLRules("@(".repeat(17) + "x" + ")".repeat(17))).toThrow("nesting exceeds 16");
});

test("trim/OR/dedup candidates preserve raw input", () => {
  const raw = " \n example.com/**\r\n other.test/**\nexample.com/** ";
  const rules = compileURLRules(raw);
  const urls = ["https://example.com/a", "https://other.test/b", "https://none.test/c"];
  expect(urls.filter(url => rules.some(rule => rule.test(url)))).toEqual(urls.slice(0, 2));
  expect(raw).toBe(" \n example.com/**\r\n other.test/**\nexample.com/** ");
});
