export type BindSegment = string | { get: true };

/** `.get`, as the setter reads it. */
export const UNWRAP_SEGMENT: { get: true } = { get: true };

export function isUnwrapStep(field: string, accessKind?: "field" | "shortcut"): boolean {
  return accessKind !== "field" && field === "get";
}

export function indexSegmentJs(keyJs: string): string {
  return `{ at: ${keyJs} }`;
}
