import type { WorkflowDraft } from "../../src/workflows/workflow-types";
export const ruleId = "11111111-1111-4111-8111-111111111111";
export const draft = (): WorkflowDraft => ({ name: "Test", scope: "win" as const, rules: [{ id: ruleId, name: "Example", enabled: true, condition: { kind: "host" as const, value: "example.com", includeSubdomains: true } }], operations: { glue: false, depclean: false, sorttab: false, sortkey: "url" as const, refresh: false, comclose: false, rxclose: false, closelocal: false, grouping: false, grouping_min: 4 } });
