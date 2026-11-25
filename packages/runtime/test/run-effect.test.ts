import { describe, expect, it } from "vitest";
import type { CapabilityRegistry, EffectResult, EffectSpec } from "../src/core.ts";
import { runEffect } from "../src/core.ts";

const caps: CapabilityRegistry = { has: () => true, provider: () => undefined };

const unavailable: EffectResult = { kind: "err", value: { status: 503, message: "busy" } };
const loaded: EffectResult = { kind: "ok", value: "loaded" };
const retry = { kind: "linear", n: 3, ms: 1 } as const;

/** Reads a failure as a `Text`, as the compiler's helper for an effect that fails with `Text` does. */
const errText = (v: unknown): string => String((v as { message: unknown }).message);

/** `load`, whose attempts answer with `answers` in turn, and the count of attempts it made. */
function answering(
  answers: ReadonlyArray<() => unknown>,
  spec: Partial<EffectSpec> = {},
): { eff: EffectSpec; attempts: () => number } {
  let attempts = 0;
  const eff: EffectSpec = {
    name: "load",
    cap: "http.get",
    invoke: async () => {
      const answer = answers[attempts++];
      if (!answer) throw new Error("load made an attempt it had no answer for");
      return answer() as EffectResult;
    },
    ...spec,
  };
  return { eff, attempts: () => attempts };
}

const noResult = 'Error: effect "load" resolved to undefined, not {kind, value}';

const failing: ReadonlyArray<[string, () => unknown, unknown]> = [
  [
    "throws",
    () => {
      throw new Error("down");
    },
    { message: "Error: down" },
  ],
  ["resolves to no result", () => undefined, { message: noResult }],
  [
    "resolves to a record with no kind",
    () => ({ value: "loaded" }),
    {
      message:
        'Error: effect "load" resolved to an object with no ok or err kind, not {kind, value}',
    },
  ],
];

describe("runEffect", () => {
  it.each(failing)("is the err of a first attempt that %s", async (_, first, value) => {
    const { eff, attempts } = answering([first]);
    expect(await runEffect(eff, null, caps)).toEqual({ kind: "err", value });
    expect(attempts()).toBe(1);
  });

  it.each(
    failing,
  )("is the err of an attempt partway through a retry that %s, and makes no further attempt", async (_, second, value) => {
    const { eff, attempts } = answering([() => unavailable, second, () => loaded], { retry });
    expect(await runEffect(eff, null, caps)).toEqual({ kind: "err", value });
    expect(attempts()).toBe(2);
  });

  it.each([
    [
      "throws",
      () => {
        throw new Error("disk gone");
      },
      "Error: disk gone",
    ],
    ["resolves to no result", () => undefined, noResult],
  ])("gives the Text of an effect that fails with Text, when its invoke %s", async (_, first, text) => {
    const { eff } = answering([first], { errText });
    expect(await runEffect(eff, null, caps)).toEqual({ kind: "err", value: text });
  });

  it("delivers the attempt that succeeds after a 503", async () => {
    const { eff, attempts } = answering([() => unavailable, () => loaded], { retry });
    expect(await runEffect(eff, null, caps)).toEqual(loaded);
    expect(attempts()).toBe(2);
  });
});
