import { nearestName } from "./text-distance.ts";

/**
 * What a tier says about a reducer name that none of `names` matches: the
 * name as written, and the nearest declared one when one is close enough.
 */
export function noReducerNamed(written: string, names: Iterable<string>): string {
  const near = nearestName(written, names);
  const hint = near === null ? "" : ` — did you mean "${near}"?`;
  // The written name is quoted for the same reason `clickText`'s refusal
  // quotes its text: it came from a fixture, and trailing whitespace or a
  // stray character in it is invisible unquoted — which is the typo a reader
  // is here to find.
  return `no reducer named "${written}"${hint}`;
}

/** A reducer as a `{dispatch}` step sees it: its name, and the id it is scoped to. */
export type DispatchTarget = {
  name: string;
  /** `on=ui.click(Tile#id)`'s id, or `null` for a reducer that matches every instance. */
  id: string | null;
};

export function dispatchFault(
  written: string,
  payload: Record<string, unknown>,
  targets: readonly DispatchTarget[],
): string | undefined {
  const target = targets.find((t) => t.name === written);
  if (!target) {
    return noReducerNamed(
      written,
      targets.map((t) => t.name),
    );
  }
  if (target.id !== null && payload.id !== target.id) {
    return (
      `reducer "${written}" is scoped to #${target.id}, so this step drives nothing` +
      ` — pass payload {"id": "${target.id}"}`
    );
  }
  return undefined;
}
