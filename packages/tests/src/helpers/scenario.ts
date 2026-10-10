import type { ScenarioReport } from "@kumikijs/runtime";

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
