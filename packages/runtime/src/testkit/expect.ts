import { wildcardEqual } from "./wildcard.ts";

export type TestResult = {
  name: string;
  pass: boolean;
  expected?: string;
  actual?: string;
  diffAt?: string;
  /**
   * The values at the divergence point, when the runner can isolate one.
   */
  leaf?: { expected: unknown; actual: unknown };
  /** Number of generated cases run by a `property-test` (for the `(N cases)` tag). */
  cases?: number;
  /** Wall-clock milliseconds the test took (filled in by the runner). */
  ms?: number;
};

export function _jsonStr(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export type ReducerExpect =
  | { kind: "panic"; message: string }
  | {
      kind: "state";
      slots: Record<string, unknown>;
      effects: { effect: string; args: unknown[]; argsSpecified?: boolean }[];
    };

export function compareReducerExpect(
  name: string,
  finalSlots: Record<string, unknown>,
  emits: { effect: string; args: unknown[] }[],
  panic: string | null,
  expect: ReducerExpect,
  unhandledErr: string | null = null,
): TestResult {
  if (expect.kind === "panic") {
    const pass = panic !== null && String(panic).includes(expect.message);
    return {
      name,
      pass,
      expected: `panic: ${_jsonStr(expect.message)}`,
      actual: panic === null ? "(no panic)" : `panic: ${_jsonStr(panic)}`,
      ...(pass ? {} : { diffAt: "(panic)" }),
    };
  }
  if (panic !== null) {
    return {
      name,
      pass: false,
      expected: _jsonStr(expect.slots),
      actual: `panic: ${_jsonStr(panic)}`,
      diffAt: "(unexpected panic)",
    };
  }
  if (unhandledErr !== null) {
    return {
      name,
      pass: false,
      expected: _jsonStr(expect.slots),
      actual: `unhandled effect error: ${unhandledErr} (no .err reducer)`,
      diffAt: "(unhandled effect error)",
    };
  }
  let diffAt: string | undefined;
  let leaf: { expected: unknown; actual: unknown } | undefined;
  for (const k of Object.keys(expect.slots)) {
    // Wildcard-aware: `expect` is the pattern, `finalSlots[k]` the value.
    if (!wildcardEqual(expect.slots[k], finalSlots[k], finalSlots)) {
      diffAt = `slots.${k}`;
      leaf = { expected: expect.slots[k], actual: finalSlots[k] };
      break;
    }
  }
  if (diffAt === undefined) {
    if (emits.length !== expect.effects.length) {
      diffAt = "effects.length";
    } else {
      for (let i = 0; i < expect.effects.length; i++) {
        const ex = expect.effects[i];
        const ac = emits[i];
        if (!ex || !ac || ex.effect !== ac.effect) {
          diffAt = `effects[${i}].effect`;
          break;
        }
        if (ex.argsSpecified && !wildcardEqual(ex.args, ac.args, finalSlots)) {
          diffAt = `effects[${i}].args`;
          break;
        }
      }
    }
  }
  const pickExpected = (s: Record<string, unknown>): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(expect.slots)) o[k] = s[k];
    return o;
  };
  return {
    name,
    pass: diffAt === undefined,
    expected: `slots=${_jsonStr(expect.slots)} effects=${_jsonStr(expect.effects.map((e) => e.effect))}`,
    actual: `slots=${_jsonStr(pickExpected(finalSlots))} effects=${_jsonStr(emits.map((e) => e.effect))}`,
    ...(diffAt ? { diffAt } : {}),
    ...(leaf ? { leaf } : {}),
  };
}
