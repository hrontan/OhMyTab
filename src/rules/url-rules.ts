import { makeRe } from "picomatch";

export const URL_RULE_LIMITS = { count: 100, length: 1024, storageBytes: 8192, nesting: 16 };
const posixClasses = new Set([
  "alnum", "alpha", "ascii", "blank", "cntrl", "digit", "graph", "lower",
  "print", "punct", "space", "upper", "word", "xdigit",
]);

export const urlRuleStorageBytes = (raw: string) =>
  new TextEncoder().encode(JSON.stringify(raw)).length + "urlmatch_pattern".length;

const invalid = (line: number, reason: string): never => {
  throw new Error(`URL rules — Line ${line}: ${reason}`);
};

const validateSyntax = (pattern: string, line: number) => {
  const frames: { operator: string; start: number }[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const character = pattern[i];
    if (character === "\\") { i++; continue; }
    if (character === "[") {
      let end = i + 1;
      for (; end < pattern.length; end++) {
        if (pattern[end] === "\\") { end++; continue; }
        if (pattern[end] === "[" && pattern[end + 1] === ":") {
          const close = pattern.indexOf(":]", end + 2);
          const name = pattern.slice(end + 2, close);
          if (close < 0 || !posixClasses.has(name)) invalid(line, `unsupported POSIX class ${name}`);
          end = close + 1;
          continue;
        }
        if (pattern[end] === "]") break;
      }
      if (end === pattern.length) invalid(line, "unclosed character class");
      i = end;
      continue;
    }
    if (character === "(") {
      const operator = pattern[i - 1] ?? "";
      if (!"@?!+*".includes(operator) || operator === "" || pattern[i - 2] === "\\") {
        invalid(line, "raw regular-expression parentheses are unsupported; use an extglob or escape literal parentheses");
      }
      frames.push({ operator, start: i + 1 });
      if (frames.length > URL_RULE_LIMITS.nesting) invalid(line, `extglob nesting exceeds ${URL_RULE_LIMITS.nesting}`);
    }
    if (character === ")") {
      const frame = frames.pop();
      if (!frame) return invalid(line, "unmatched closing parenthesis");
      if (frame.operator === "+" || frame.operator === "*") {
        const body = pattern.slice(frame.start, i);
        if (!/^[^\\()[\]{}*?+!@|]+(?:\|[^\\()[\]{}*?+!@|]+)*$/.test(body)) {
          invalid(line, "repeated extglobs require nonempty literal alternatives; nested repeats and wildcards are unsupported");
        }
        const branches = body.split("|");
        if (branches.some((branch, index) => branches.some((other, otherIndex) => index !== otherIndex && other.startsWith(branch)))) {
          invalid(line, "repeated extglob alternatives have overlapping prefixes; rewrite the rule");
        }
      }
    }
  }
  if (frames.length) invalid(line, "unclosed extglob");
};

export const compileURLRules = (raw: string): RegExp[] => {
  if (urlRuleStorageBytes(raw) > URL_RULE_LIMITS.storageBytes) {
    invalid(1, `stored pattern exceeds ${URL_RULE_LIMITS.storageBytes} UTF-8 bytes (JSON value plus key)`);
  }
  const rules: RegExp[] = [];
  raw.split("\n").forEach((value, index) => {
    const pattern = value.trim();
    if (!pattern) return;
    const line = index + 1;
    if (rules.length >= URL_RULE_LIMITS.count) invalid(line, `more than ${URL_RULE_LIMITS.count} nonblank rules`);
    if (pattern.length > URL_RULE_LIMITS.length) invalid(line, `pattern exceeds ${URL_RULE_LIMITS.length} UTF-16 units`);
    validateSyntax(pattern, line);
    try {
      rules.push(makeRe(pattern, { contains: true, strictBrackets: true }));
    } catch (error) {
      invalid(line, error instanceof Error ? error.message : String(error));
    }
  });
  return rules;
};
