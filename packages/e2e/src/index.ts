// Public API of @kumikijs/e2e — the real-browser (Playwright) verification tier.
export {
  type Action,
  type BrowserOptions,
  type BrowserReport,
  type Expect,
  runMultiOnPage,
  runOnPage,
  runScenarioInBrowser,
  type Scenario,
  type ScenarioStep,
  type StepResult,
} from "./browser.ts";
