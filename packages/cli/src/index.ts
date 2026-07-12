// Public API of @kumikijs/cli — the programmatic surface behind the `kumiki` command.

export { type DevCmdOptions, devCmd, startDevServer } from "./dev.ts";
export {
  type AutoPatch,
  applyFixPlan,
  type FixApplyResult,
  type FixFromTestOutcome,
  type FixPlan,
  fixCmd,
  fixFromTest,
  planFix,
  planFixes,
  planFixesExplained,
  planTestPatch,
  planTestPatchExplained,
  runFixFromTest,
  type SkipReason,
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
export {
  type Coverage,
  runCmd,
  runScenarioSource,
  runTests,
  smokeCmd,
  smokeFile,
  smokeSource,
  type TestReport,
  testCmd,
  testFile,
} from "./smoke.ts";
export {
  directDeps,
  findReferences,
  listDefs,
  load,
  type Store,
  viewDef,
  viewWithDeps,
} from "./store.ts";
