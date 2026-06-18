// Public API of @kumikijs/cli — the programmatic surface behind the `kumiki` command.

export {
  type AutoPatch,
  type FixFromTestOutcome,
  fixCmd,
  fixFromTest,
  planFixes,
  planTestPatch,
} from "./fix.ts";
export {
  addDef,
  editDef,
  episodeLogPathFor,
  lockDef,
  type OpLogEntry,
  patchApplyFile,
  patchRevert,
  readOpLog,
  removeDef,
  renameDef,
  replaceDef,
  unlockDef,
  viewHash,
  viewHistory,
} from "./mutate.ts";
export { runCmd, runScenarioSource, smokeCmd, smokeFile, smokeSource } from "./smoke.ts";
export {
  directDeps,
  findReferences,
  listDefs,
  load,
  type Store,
  viewDef,
  viewWithDeps,
} from "./store.ts";
