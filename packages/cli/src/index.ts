// Public API of @kumikijs/cli — the programmatic surface behind the `kumiki` command.

// The action set `kumiki run` accepts, re-exported so a caller describing that
// surface — the MCP tool's description of `kumiki_run_scenario` — is derived
// from it rather than restating it. It had drifted by six actions.
export { HEADLESS_ACTION_KEYS } from "@kumikijs/runtime";
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
  type RemovedNames,
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
