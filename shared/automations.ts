import type { PropertyFilter, PropertyFilterGroup } from "./imago";
export type AutomationAction =
  | { kind: "set"; columnId: string; value: string | null; overwrite: boolean }
  | {
      kind: "copy";
      columnId: string;
      sourceColumnId: string;
      overwrite: boolean;
    }
  | { kind: "analyze"; columnIds: string[] };
export interface AutomationRule {
  id: string;
  databaseId: string;
  name: string;
  enabled: boolean;
  trigger: "created" | "changed" | "manual" | "schedule";
  watchColumnId: string | null;
  intervalMinutes: number;
  filters: PropertyFilter[];
  filterGroups?: PropertyFilterGroup[];
  filterLogic?: "and" | "or";
  actions: AutomationAction[];
}
export interface AutomationRun {
  id: number;
  ruleId: string;
  rowId: string;
  state: "completed" | "skipped" | "failed";
  message: string;
  createdAt: string;
}
