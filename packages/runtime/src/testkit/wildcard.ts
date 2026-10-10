import { entryKey } from "../core.ts";
import { valueEqual } from "../stdlib.ts";

// `@@`-prefixed sentinels never collide with a Kumiki field name.
export const WILD = "@@kumiki:wild";

/** A wildcard map key (`<any-id>` in key position): pairs with the one generated entry. */
export const WILD_KEY = "@@kumiki:wild-key";

/** How many `<any-id>` members a Set literal has: each pairs with one generated member. */
export const WILD_MEMBERS = "@@kumiki:wild-members";

/**
 * The `<slots.X>` keys of a Set or Map literal, as `[sentinel, value]` pairs: keyed only once the slots are known.
 */
export const WILD_SLOT_KEYS = "@@kumiki:wild-slot-keys";

function isWildValue(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && Object.hasOwn(v, WILD);
}

/** The value a `<slots.X>` sentinel stands for: slot X after execution. */
function slotWildValue(w: Record<string, unknown>, finalSlots: Record<string, unknown>): unknown {
  return finalSlots[w.slot as string];
}

function keySlotEntries(
  eo: Record<string, unknown>,
  finalSlots: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!Object.hasOwn(eo, WILD_SLOT_KEYS)) return eo;
  const keyed: Record<string, unknown> = {};
  const put = (k: string, v: unknown): void => {
    Object.defineProperty(keyed, k, { value: v, enumerable: true });
  };
  for (const k of Object.keys(eo)) if (k !== WILD_SLOT_KEYS) put(k, eo[k]);
  for (const [w, v] of eo[WILD_SLOT_KEYS] as [Record<string, unknown>, unknown][]) {
    const k = entryKey(slotWildValue(w, finalSlots));
    if (Object.hasOwn(keyed, k)) return undefined;
    put(k, v);
  }
  return keyed;
}

export function wildcardEqual(
  expected: unknown,
  actual: unknown,
  finalSlots: Record<string, unknown>,
): boolean {
  if (isWildValue(expected)) {
    const kind = expected[WILD];
    if (kind === "any-id") return actual !== undefined;
    if (kind === "slot") return valueEqual(actual, slotWildValue(expected, finalSlots));
    return false;
  }
  if (expected === actual) return true;
  if (
    expected === null ||
    actual === null ||
    typeof expected !== "object" ||
    typeof actual !== "object"
  ) {
    return false;
  }
  const eArr = Array.isArray(expected);
  const aArr = Array.isArray(actual);
  if (eArr || aArr) {
    if (!eArr || !aArr || expected.length !== actual.length) return false;
    return expected.every((x, i) => wildcardEqual(x, (actual as unknown[])[i], finalSlots));
  }
  const eo = keySlotEntries(expected as Record<string, unknown>, finalSlots);
  if (eo === undefined) return false;
  const ao = actual as Record<string, unknown>;
  const literalKeys = Object.keys(eo).filter((k) => k !== WILD_KEY && k !== WILD_MEMBERS);
  for (const k of literalKeys) {
    if (!Object.hasOwn(ao, k) || !wildcardEqual(eo[k], ao[k], finalSlots)) return false;
  }
  const leftover = Object.keys(ao).filter((k) => !literalKeys.includes(k));
  if (Object.hasOwn(eo, WILD_MEMBERS)) {
    return leftover.length === eo[WILD_MEMBERS] && leftover.every((k) => ao[k] === true);
  }
  if (Object.hasOwn(eo, WILD_KEY)) {
    if (leftover.length !== 1) return false;
    return wildcardEqual(eo[WILD_KEY], ao[leftover[0] as string], finalSlots);
  }
  return leftover.length === 0;
}
