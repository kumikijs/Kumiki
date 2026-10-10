import type { RemovedNames } from "./mutate/verbs.ts";

export { viewHash } from "./mutate/hash.ts";
export { patchRevert, viewHistory } from "./mutate/history.ts";
export { lockDef, unlockDef } from "./mutate/locks.ts";
export { type DefSpec, newId, type OpLogEntry, readOpLog } from "./mutate/op-log.ts";
export {
  addDef,
  CASCADE_HELP,
  editDef,
  patchApplyFile,
  type RemovedNames,
  type RemoveResult,
  type ReplaceResult,
  removeDef,
  renameDef,
  replaceDef,
} from "./mutate/verbs.ts";

export type EditReport =
  | { op: "add" | "edit"; qname: string; opId: string }
  | { op: "replace"; qname: string; opId: string; dropped?: readonly string[] }
  | { op: "rename"; qname: string; newName: string; opId: string }
  | { op: "remove"; qname: string; opId: string; removed: RemovedNames };

export function describeEdit(report: EditReport): string {
  const opIdSuffix = `  (${report.opId})`;
  switch (report.op) {
    case "add":
      return `added ${report.qname}${opIdSuffix}`;
    case "replace":
      return [
        `replaced ${report.qname}${opIdSuffix}`,
        ...(report.dropped ?? []).map((item) => `  dropped ${item}`),
      ].join("\n");
    case "edit":
      return `edited ${report.qname}${opIdSuffix}`;
    case "rename":
      return `renamed ${report.qname} -> ${report.newName}${opIdSuffix}`;
    case "remove": {
      const [, ...cascaded] = report.removed;
      return [
        `removed ${report.qname}${opIdSuffix}`,
        ...cascaded.map((q) => `  cascaded ${q}`),
      ].join("\n");
    }
  }
}

export function episodeLogPathFor(path: string): string {
  return `${path}.kumiki-episodes.jsonl`;
}
