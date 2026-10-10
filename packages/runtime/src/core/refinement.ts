import type { SlotDiff } from "../episode.ts";
import type { BindSegment } from "./path.ts";
import type { RefinementCheck } from "./types.ts";

export type RefinementPart = {
  kind: string;
  args?: (number | string)[];
  refine: RefinementCheck;
};

export type SlotMeta = {
  value: unknown;
  refine?: RefinementCheck;
  volatile?: boolean;
  /** Refinement predicate name + args — drives the `error` tile's message. */
  refineKind?: string;
  refineArgs?: (number | string)[];
  refineAll?: RefinementPart[];
  refineFailure?: (v: unknown, at?: readonly BindSegment[]) => RefinementFailure | undefined;
};

export type RefinementStep =
  | string
  | number
  | { readonly variant: string; readonly payload?: number }
  | { readonly key: string | number }
  | { readonly entry: string | number }
  | { readonly member: string | number };

export type RefinementFailure = {
  kind: string;
  args: (number | string)[];
  path: readonly RefinementStep[];
};

export function showRefinementPath(path: readonly RefinementStep[]): string {
  return path
    .map((step) => {
      if (typeof step === "string") return `.${step}`;
      if (typeof step === "number") return `[${step}]`;
      if ("variant" in step)
        return step.payload === undefined
          ? `.${step.variant}`
          : `.${step.variant}[${step.payload}]`;
      if ("key" in step) return `.keys[${JSON.stringify(step.key)}]`;
      if ("entry" in step) return `[${JSON.stringify(step.entry)}]`;
      return `{${JSON.stringify(step.member)}}`;
    })
    .join("");
}

export function showRefinementFailure(f: {
  kind?: string;
  args?: readonly (number | string)[];
  path?: readonly RefinementStep[];
}): string {
  const pred =
    f.kind === undefined
      ? "its refinement"
      : f.args && f.args.length > 0
        ? `${f.kind}(${f.args.join(", ")})`
        : f.kind;
  const at = f.path && f.path.length > 0 ? ` at ${showRefinementPath(f.path)}` : "";
  return `${pred}${at}`;
}

/** The slot fields that decide whether a value is let in. */
export type SlotGate = {
  refine?: RefinementCheck;
  refineFailure?: RefinementNaming["refineFailure"];
};

export function slotAccepts(
  meta: SlotGate | undefined,
  value: unknown,
  at?: readonly BindSegment[],
): boolean {
  if (meta?.refineFailure) return meta.refineFailure(value, at) === undefined;
  return meta?.refine ? meta.refine(value) : true;
}

export type RefinementNaming = {
  refineKind?: string;
  refineArgs?: (number | string)[];
  refineAll?: RefinementPart[];
  refineFailure?: (v: unknown, at?: readonly BindSegment[]) => RefinementFailure | undefined;
};

export function failedRefinement(
  value: unknown,
  meta: RefinementNaming | undefined,
): { kind?: string; args?: (number | string)[]; path?: readonly RefinementStep[] } {
  // A type with predicates below its own chain answers with the failure itself, which is the only reader that can say *where* inside the value.
  if (meta?.refineFailure) {
    const deep = meta.refineFailure(value);
    if (!deep) return {};
    return deep.path.length === 0 ? { kind: deep.kind, args: deep.args } : deep;
  }
  const part = meta?.refineAll?.find((p) => !p.refine(value));
  if (part) return { kind: part.kind, args: part.args ?? [] };
  const named: { kind?: string; args?: (number | string)[] } = {};
  if (meta?.refineKind !== undefined) named.kind = meta.refineKind;
  if (meta?.refineArgs) named.args = meta.refineArgs;
  return named;
}

/** One slot in a reducer batch whose new value its refinement refuses. */
export type RefinementRejection = {
  slot: string;
  value: unknown;
  /** The predicate name + args, when the slot carries them (`between`, [0, 3]). */
  kind?: string;
  args?: (number | string)[];
  /**
   * Where inside the value the predicate failed, when that is not the value
   * itself — see {@link RefinementFailure}.
   */
  path?: readonly RefinementStep[];
};

export function refinementRejectionOf(
  slot: string,
  value: unknown,
  meta: RefinementNaming,
): RefinementRejection {
  const rejection: RefinementRejection = { slot, value };
  const { kind, args, path } = failedRefinement(value, meta);
  if (kind !== undefined) rejection.kind = kind;
  if (args !== undefined) rejection.args = args;
  if (path !== undefined) rejection.path = path;
  return rejection;
}

export function refinementRejections(
  next: Record<string, unknown>,
  slotMetas: Record<string, { refine?: RefinementCheck } & RefinementNaming>,
): RefinementRejection[] {
  const out: RefinementRejection[] = [];
  for (const [k, v] of Object.entries(next)) {
    const meta = slotMetas[k];
    if (!meta || slotAccepts(meta, v)) continue;
    out.push(refinementRejectionOf(k, v, meta));
  }
  return out;
}

export function batchRejections(
  result: { slots?: Record<string, unknown>; rejected?: RefinementRejection[] } | null | undefined,
  slotMetas: Record<string, { refine?: RefinementCheck } & RefinementNaming>,
): RefinementRejection[] {
  const out: RefinementRejection[] = [];
  const seen = new Set<string>();
  for (const r of [
    ...(result?.rejected ?? []),
    ...refinementRejections(result?.slots ?? {}, slotMetas),
  ]) {
    if (seen.has(r.slot)) continue;
    seen.add(r.slot);
    out.push(r);
  }
  return out;
}

function describeRejection(r: RefinementRejection): string {
  return `slot ${JSON.stringify(r.slot)} cannot hold ${showRejectedValue(r.value)} (${showRefinementFailure(r)})`;
}

function showRejectedValue(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  let shown: string;
  try {
    shown = JSON.stringify(value) ?? String(value);
  } catch {
    shown = String(value);
  }
  return shown.length > 120 ? `${shown.slice(0, 117)}...` : shown;
}

export function reportRejectedBatch(
  reducer: string,
  rejections: readonly RefinementRejection[],
): void {
  console.error(
    `[kumiki] reducer ${JSON.stringify(reducer)} was rejected: ${rejections
      .map(describeRejection)
      .join(", ")}. No slot was written and no effect was emitted.`,
  );
}

export function computeSlotDiffs(
  prev: Record<string, unknown>,
  result: { slots: Record<string, unknown>; rejected?: RefinementRejection[] },
  slotMetas: Record<string, SlotMeta>,
): { diffs: SlotDiff[]; dirty: string[]; rejected: RefinementRejection[] } {
  const rejected = batchRejections(result, slotMetas);
  if (rejected.length > 0) return { diffs: [], dirty: [], rejected };
  const diffs: SlotDiff[] = [];
  const dirty: string[] = [];
  for (const [k, v] of Object.entries(result.slots)) {
    const meta = slotMetas[k];
    const before = prev[k];
    prev[k] = v;
    if (!meta?.volatile) {
      diffs.push({ name: k, before, after: v });
      dirty.push(k);
    }
  }
  return { diffs, dirty, rejected };
}
