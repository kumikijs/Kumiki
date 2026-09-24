// `T.parse(text)` is an `Option(T)` (stdlib §2.4.3), and the checker has said
// so since #430 — but the lowering branched on the qualifier's *name*: `Int`,
// `Float` and `Time` converted, and every other qualifier fell into a branch
// that wrapped the raw string. So a nominal over `Int` parsed to a `Text`, and
// the arithmetic after it concatenated:
//
//   type Cents = nominal Int where positive
//   total := total + Cents.parse("12").get-or(0)      # 12 + "12" = "1212"
//
// `check` said `ok` and nothing threw, which is the 06-expenses shape: the
// defect is a value of the wrong kind, and only the state shows it. So every
// assertion here reads `shape.live`, never the DOM (#431). `Duration.parse` is
// the same defect on a standard-library nominal — a `Duration` is milliseconds,
// and it came back as the text it was given (#424).

import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

function freshRoot(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

/** One reducer, dispatched by name, whose writes are what the test reads. */
function app(defs: string, body: string): string {
  return `${defs}
reducer go on=ui.click(Go)
    do= ${body}
tile Go = button(text="go")
tile App = column(Go)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
}

async function stateAfterGo(source: string): Promise<Record<string, unknown>> {
  const shape = await loadSource(source);
  const report = await runScenario(shape, freshRoot(), {
    steps: [{ do: { dispatch: "go" }, expect: { noErrors: true } }],
  });
  expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
  return shape.live ?? {};
}

describe("a nominal parses by the base it is declared over", () => {
  it("adds a parsed nominal Int as a number", async () => {
    const live = await stateAfterGo(
      app(
        `type Cents = nominal Int where positive\nslot total : Cents = 12`,
        `total := total + Cents.parse("12").get-or(0)`,
      ),
    );
    expect(live.total).toBe(24);
  });

  it("reads a nominal Float as a number", async () => {
    const live = await stateAfterGo(
      app(`type Ratio = nominal Float\nslot r : Option(Ratio) = None`, `r := Ratio.parse("0.25")`),
    );
    expect(live.r).toEqual({ _tag: "Some", _0: 0.25 });
  });

  it("reads a nominal Time as the millisecond instant a Time is", async () => {
    const live = await stateAfterGo(
      app(
        `type Due = nominal Time\nslot d : Option(Due) = None`,
        `d := Due.parse("2026-01-01T00:00:00Z")`,
      ),
    );
    expect(live.d).toEqual({ _tag: "Some", _0: Date.UTC(2026, 0, 1) });
  });

  it("keeps the string for a nominal over Text", async () => {
    const live = await stateAfterGo(
      app(`type Slug = nominal Text\nslot s : Option(Slug) = None`, `s := Slug.parse("a-b")`),
    );
    expect(live.s).toEqual({ _tag: "Some", _0: "a-b" });
  });

  it("answers None for a nominal Int given text that names no number", async () => {
    const live = await stateAfterGo(
      app(
        `type Cents = nominal Int where positive\nslot c : Option(Cents) = Some(1)`,
        `c := Cents.parse("twelve")`,
      ),
    );
    expect(live.c).toEqual({ _tag: "None" });
  });
});

describe("Bool.parse converts rather than answering the text", () => {
  // `Some("false")` was the answer, and a non-empty string is truthy, so every
  // `if` over the unwrapped value took the `true` branch.
  it("reads false as false and true as true", async () => {
    const live = await stateAfterGo(
      app(
        `slot f : Option(Bool) = None\nslot t : Option(Bool) = None`,
        `f := Bool.parse("false")\n        t := Bool.parse("true")`,
      ),
    );
    expect(live.f).toEqual({ _tag: "Some", _0: false });
    expect(live.t).toEqual({ _tag: "Some", _0: true });
  });

  it("answers None for text that is neither", async () => {
    const live = await stateAfterGo(
      app(`slot b : Option(Bool) = Some(true)`, `b := Bool.parse("yes")`),
    );
    expect(live.b).toEqual({ _tag: "None" });
  });
});

describe("the standard library's Duration and Bytes parse to their own representation", () => {
  it("reads a Duration as the millisecond number it is", async () => {
    // `.get-or(0).to-ms` style arithmetic is what the number is for; adding it
    // to a Duration is the same concatenation `Cents` suffered.
    const live = await stateAfterGo(
      app(
        `slot d : Duration = Duration.ms(100)`,
        `d := d + Duration.parse("500").get-or(Duration.ms(0))`,
      ),
    );
    expect(live.d).toBe(600);
  });

  it("reads Bytes as the UTF-8 bytes of the text", async () => {
    const live = await stateAfterGo(app(`slot b : Option(Bytes) = None`, `b := Bytes.parse("hi")`));
    const b = live.b as { _tag: string; _0: unknown };
    expect(b._tag).toBe("Some");
    expect(b._0).toBeInstanceOf(Uint8Array);
    expect([...(b._0 as Uint8Array)]).toEqual([104, 105]);
  });
});
