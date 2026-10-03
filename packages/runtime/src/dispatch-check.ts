// What both verification tiers ask before driving a reducer by name.
//
// `{dispatch}` is the one action verb that does not go through a selector: it
// names a reducer, and the `_dispatch` seam returns silently when the name
// matches nothing. Every tier that offers the verb therefore needs the same
// precondition, and `docs/spec/testing.md` §8.10 promises they agree — so the
// rule lives here once rather than as two hand-written copies that drift.
//
// Pure: no DOM, no `AppShape`. The scenario tier passes what it reads off
// `app.reducers`; the browser tier reads the same two fields out of the page
// and passes them across the `page.evaluate` boundary, where a `ReducerSpec`
// (it carries `apply`, a function) could not go.

import { nearestName } from "./text-distance.ts";

/** A reducer as a `{dispatch}` step sees it: its name, and the id it is scoped to. */
export type DispatchTarget = {
  name: string;
  /** `on=ui.click(Tile#id)`'s id, or `null` for a reducer that matches every instance. */
  id: string | null;
};

/**
 * Why this `{dispatch}` step would drive nothing, or `undefined` when it will
 * fire. The caller throws it, which lands on `StepResult.actionError` — the
 * scenario's own fault, on its own channel, out of `errorIncludes`' reach.
 *
 * Both silences the seam has are faults *here*, which is the part worth being
 * careful about. The id-scoped `return` inside `_dispatch` is deliberate on the
 * click path: a DOM event reaches the codegen'd handler, which calls the seam
 * once per same-tile reducer name, and the id-mismatched ones drop out there —
 * that is §1.6.2 working. This function is never on that path. It sees only an
 * explicit `{"do": {"dispatch": "…"}}` step, which names one reducer and asks
 * for it, so a step that cannot reach the reducer it named did nothing and must
 * not report success.
 */
export function dispatchFault(
  written: string,
  payload: Record<string, unknown>,
  targets: readonly DispatchTarget[],
): string | undefined {
  const target = targets.find((t) => t.name === written);
  if (!target) {
    const near = nearestName(
      written,
      targets.map((t) => t.name),
    );
    const hint = near === null ? "" : ` — did you mean "${near}"?`;
    // The written name is quoted for the same reason `clickText`'s refusal
    // quotes its text: it came from the fixture, and trailing whitespace or a
    // stray character in it is invisible unquoted — which is the typo a reader
    // is here to find.
    return `no reducer named "${written}"${hint}`;
  }
  if (target.id !== null && payload.id !== target.id) {
    return (
      `reducer "${written}" is scoped to #${target.id} (§1.6.2), so this step drives nothing` +
      ` — pass payload {"id": "${target.id}"}`
    );
  }
  return undefined;
}
