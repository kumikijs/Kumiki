import { runScenario, type ScenarioReport, type StepResult } from "@kumikijs/runtime";
import { expect } from "vitest";
import { withRoot } from "./dom.ts";
import { loadSource } from "./load.ts";

/** What a step of the route-event tests does. */
export type Step = { navigate: string } | { click: string } | { wait: number };

/** One `navigate` step per path, in order. */
export const navigateTo = (...paths: string[]): Step[] => paths.map((navigate) => ({ navigate }));

/** The step that answers the `confirm` dialog open in the document. */
export const answerConfirm = (outcome: "yes" | "no"): { click: string } => ({
  click: `[data-kumiki-confirm] button[data-kumiki-confirm-action='${outcome}']`,
});

/** One line per failed step, naming what went wrong — the message for `expect(report.ok, …)`. */
export function failureDetail(report: ScenarioReport): string {
  return report.steps
    .map((st, i) => ({ st, i }))
    .filter(({ st }) => !st.ok)
    .map(({ st, i }) => {
      const fault = st.actionError ? ` action-failed=${st.actionError}` : "";
      const errs = st.errors.length ? ` errors=${st.errors.join("|")}` : "";
      const fails = st.failures.length ? ` failures=${st.failures.join("|")}` : "";
      return `step ${i} (${st.label ?? st.action ?? "-"}):${fault}${errs}${fails}`;
    })
    .join("\n");
}

/**
 * Run `steps` on `src` with `nav.push`, `nav.replace` and `notification.show` granted, under a memory
 * router that starts at `initialPath`, and hand back each step's result once every step passed.
 */
export async function stepsAfter(
  src: string,
  steps: Step[],
  initialPath = "/",
): Promise<StepResult[]> {
  const app = await loadSource(src, ["nav.push", "nav.replace", "notification.show"]);
  const report = await withRoot((root) =>
    runScenario(
      app,
      root,
      { steps: steps.map((s) => ({ do: s })) },
      { router: "memory", initialPath },
    ),
  );
  expect(report.ok, failureDetail(report)).toBe(true);
  return report.steps;
}

/** The `log` slot once `stepsAfter` has run `steps`. */
export async function logAfter(src: string, steps: Step[], initialPath = "/"): Promise<unknown> {
  return (await stepsAfter(src, steps, initialPath)).at(-1)?.state?.log;
}
