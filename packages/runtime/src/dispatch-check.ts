import { nearestNames } from "./text-distance.ts";

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
    const near = nearestNames(
      written,
      targets.map((t) => t.name),
    );
    // A tie names every reducer in it, so declaration order does not answer what distance does not.
    const hint = near.length === 0 ? "" : ` — did you mean ${orList(near)}?`;
    return `no reducer named "${written}"${hint}`;
  }
  if (target.id !== null && payload.id !== target.id) {
    return (
      `reducer "${written}" is scoped to #${target.id}, so this step drives nothing` +
      ` — pass payload {"id": "${target.id}"}`
    );
  }
  return undefined;
}

/** `"a"`, `"a" or "b"`, `"a", "b" or "c"`. */
function orList(names: readonly string[]): string {
  const quoted = names.map((n) => `"${n}"`);
  const last = quoted.pop() ?? "";
  return quoted.length === 0 ? last : `${quoted.join(", ")} or ${last}`;
}
