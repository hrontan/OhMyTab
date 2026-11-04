import { expect, test } from "vitest";
import { validateWorkflowDraft, compileWorkflowRules, matchingWorkflowRules } from "../../src/workflows/workflow-rules";
import { draft, ruleId } from "./fixtures";
const matches = (value: ReturnType<typeof draft>, url: string) => matchingWorkflowRules(url, compileWorkflowRules(validateWorkflowDraft(value).rules)).length;
test.each([["https://example.com/",1],["https://a.example.com/",1],["https://evil-example.com/",0],["https://evil/?example.com",0],["file://example.com/x",0],["bad",0]])("host boundary %s", (url,count) => expect(matches(draft(),url as string)).toBe(count));
test("IDNA, terminal dot and IP normalize consistently",()=>{const d=draft();d.rules[0]!.condition.value="例え.テスト.";expect(matches(d,"https://xn--r8jz45g.xn--zckzah/")).toBe(1);d.rules[0]!.condition.value="127.0.0.1";expect(matches(d,"http://127.0.0.1/")).toBe(1);d.rules[0]!.condition.value="[::1]";expect(matches(d,"http://[::1]/")).toBe(1);});
test.each(["", " ", "https://example.com", "a..example.com", "example.com:80", "[::1]:80", "a@example.com", "*.example.com", "example.com/path", "a\nb"])("reject invalid host %s",value=>{const d=draft();d.rules[0]!.condition.value=value;expect(()=>validateWorkflowDraft(d)).toThrow();});
test("contains stays literal; glob retains existing containing semantics",()=>{const d= draft() as unknown as Record<string,unknown>;const row={id:ruleId,name:"Literal",enabled:true,condition:{kind:"contains",value:"a*b"}};d.rules=[row];expect(matchingWorkflowRules("https://x/a*b",compileWorkflowRules(validateWorkflowDraft(d).rules))).toHaveLength(1);expect(matchingWorkflowRules("https://x/axb",compileWorkflowRules(validateWorkflowDraft(d).rules))).toHaveLength(0);row.condition={kind:"glob",value:"example.com"};expect(matchingWorkflowRules("https://example.com/path",compileWorkflowRules(validateWorkflowDraft(d).rules))).toHaveLength(1);row.condition.value="(bad)";expect(()=>validateWorkflowDraft(d)).toThrow();});
test("strict schemas, IDs, duplicate IDs and primitive types",()=>{for(const mutate of [(d:Record<string,unknown>)=>{d.extra=true;},(d:Record<string,unknown>)=>{d.scope="unknown";},(d:Record<string,unknown>)=>{d.rules=[draft().rules[0],draft().rules[0]];},(d:Record<string,unknown>)=>{d.operations={...draft().operations,refresh:"true"};}]){const d=draft() as unknown as Record<string,unknown>;mutate(d);expect(()=>validateWorkflowDraft(d)).toThrow();}});
test("disabled rule never matches implicitly",()=>{const d=draft();d.rules[0]!.enabled=false;expect(matches(d,"https://example.com/")).toBe(0);});


test("two named enabled disjoint rules form an OR target union", () => {
  const d = draft();
  d.rules = [
    { id: ruleId, name: "First host", enabled: true, condition: { kind: "host", value: "first.test", includeSubdomains: false } },
    { id: "22222222-2222-4222-8222-222222222222", name: "Second path", enabled: true, condition: { kind: "contains", value: "/second" } },
    { id: "33333333-3333-4333-8333-333333333333", name: "Disabled host", enabled: false, condition: { kind: "host", value: "disabled.test", includeSubdomains: false } },
  ];
  const rules = compileWorkflowRules(validateWorkflowDraft(d).rules);
  const tabs = [{ id: 11, url: "https://first.test/" }, { id: 22, url: "https://other.test/second" }, { id: 33, url: "https://disabled.test/" }, { id: 44, url: "https://unmatched.test/" }];
  expect(tabs.map(tab => matchingWorkflowRules(tab.url, rules).map(rule => [rule.id, rule.name]))).toEqual([
    [[ruleId, "First host"]], [["22222222-2222-4222-8222-222222222222", "Second path"]], [], [],
  ]);
  expect(tabs.filter(tab => matchingWorkflowRules(tab.url, rules).length > 0).map(tab => tab.id)).toEqual([11, 22]);
  expect(matchingWorkflowRules(undefined, rules)).toEqual([]);
});

test.each(["host", "contains", "glob"] as const)("%s rejects empty and whitespace conditions", kind => {
  for (const value of ["", " ", "\t "]) {
    const d = draft();
    d.rules[0]!.condition = kind === "host" ? { kind, value, includeSubdomains: false } : { kind, value };
    expect(() => validateWorkflowDraft(d)).toThrow();
  }
  const d = draft();
  d.rules[0]!.condition = kind === "host" ? { kind, value: "example.com", includeSubdomains: false } : { kind, value: "example.com" };
  expect(matchingWorkflowRules(undefined, compileWorkflowRules(validateWorkflowDraft(d).rules))).toEqual([]);
});

test.each(["contains", "glob"] as const)("%s condition accepts 1024 UTF-16 units and rejects 1025", kind => {
  const d = draft();
  const value = "😀".repeat(512);
  expect(value.length).toBe(1024);
  d.rules[0]!.condition = { kind, value };
  expect(validateWorkflowDraft(d).rules[0]!.condition.value).toBe(value);
  d.rules[0]!.condition.value += "x";
  expect(() => validateWorkflowDraft(d)).toThrow();
});

test("100 distinct rules are accepted and the 101st is rejected", () => {
  const d = draft();
  d.rules = Array.from({ length: 100 }, (_, i) => ({ ...d.rules[0]!, id: i.toString(16).padStart(8, "0") + "-1111-4111-8111-111111111111" }));
  expect(validateWorkflowDraft(d).rules.map(rule => rule.id)).toEqual(d.rules.map(rule => rule.id));
  d.rules.push({ ...d.rules[0]!, id: "ffffffff-1111-4111-8111-111111111111" });
  expect(() => validateWorkflowDraft(d)).toThrow();
});
