import { nearestName } from "./text-distance.ts";

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
    const near = nearestName(
      written,
      targets.map((t) => t.name),
    );
    const hint = near === null ? "" : ` — did you mean "${near}"?`;
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
