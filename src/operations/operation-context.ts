import type { TabType, WindowType } from "../browser/browser-api";
import type { TabSession } from "./tab-session";
import type { ProtectionReason } from "./tab-protection";
import type { SettingType } from "../settings/setting";
import type { WorkflowExecution } from "../workflows/workflow-types";

export type OperationOutcome = "success" | "failed" | "unknown";
export type OperationContext = {
  tabs: TabType[];
  session: TabSession;
  excluded: Map<number, ProtectionReason[]>;
  protectedGroups: Set<number>;
  keeper: "last" | "active";
  windows: WindowType[];
  window: WindowType;
  active: TabType | undefined;
  outcomes: Map<number, OperationOutcome>;
  domains: Map<string, string>;
  urls: Map<string, URL>;
  errors: number;
  planning: boolean;
  scopeWindows: Set<number>;
  planned: Map<number, Set<string>>;
  allowedIds: Set<number> | undefined;
  confirmedSnapshot: { tabs: TabType[]; setting: SettingType } | undefined;
  invalidated: boolean;
  workflow: WorkflowExecution | undefined;
};
export type OperationWork = (setting: SettingType) => Promise<void>;
export type PerformOperation = (
  ids: number[], work: () => Promise<unknown>,
  verify?: (tab: TabType | undefined, id: number) => boolean,
  reason?: string | ((id: number) => string[]),
) => Promise<void>;

export type OperationActionContext = Pick<OperationContext,
  "tabs" | "session" | "excluded" | "protectedGroups" | "keeper" | "windows" | "window" |
  "active" | "outcomes" | "domains" | "urls" | "errors" | "planning" | "scopeWindows" |
  "planned" | "allowedIds" | "workflow"
> & Readonly<Pick<OperationContext, "invalidated">>;
