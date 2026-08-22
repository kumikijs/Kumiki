// Public API of @kumikijs/cli — the programmatic surface behind the `kumiki` command.

export { type CheckScope, filterByScope } from "./commands/check.ts";
export { type DevCmdOptions, devCmd, startDevServer } from "./dev.ts";
export {
  type AutoPatch,
  applyFixPlan,
  type FixApplyResult,
  type FixFromTestOutcome,
  type FixPlan,
  fixCmd,
  fixFromTest,
  iterStringLiterals,
  planFix,
  planFixes,
  planFixesExplained,
  planTestPatch,
  planTestPatchExplained,
  plural,
  runFixFromTest,
  type SkipReason,
} from "./fix.ts";
export {
  type HttpFixture,
  type HttpResponseFixture,
  httpRequests,
  installTestDoubles,
  readHttpFixture,
  useHttpFixture,
} from "./harness.ts";
export {
  addDef,
  describeEdit,
  type EditReport,
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
  type LoadedApp,
  loadApp,
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
  LAYERS,
  listDefs,
  load,
  type Store,
  viewDef,
  viewWithDeps,
} from "./store.ts";
