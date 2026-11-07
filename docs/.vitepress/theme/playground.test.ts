import { lex, parse, parseFailure } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { createPlayground, type Diagnostic, type PlaygroundView } from "./playground";
import { examples } from "./preview";

const program = (heading: string) => `slot count : Int = 0

reducer inc on=ui.click(IncBtn) do= count := count + 1

tile IncBtn = button(text="+1", onClick=inc)
tile App = column(heading(${heading}), IncBtn)

app Playground
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

const CLEAN = program('"Count: " + count.show');
const WARNING_ONLY = program('fmt("Count: {0} {1}", count.show)');
const WITH_ERROR = program('fmt("Count: {0} {1}", total.show)');

const W0214: Diagnostic = {
  code: "W0214",
  kind: "fmt-placeholder-argument-mismatch",
  message: "fmt template and arguments disagree: {1} has no argument",
  line: 6,
  col: 27,
  severity: "warning",
};

const E0103: Diagnostic = {
  code: "E0103",
  kind: "undef-ref",
  message: 'Reference to undefined name "total"',
  line: 6,
  col: 49,
  severity: "error",
};

const PARSE_ERROR = "tile = = =";
const LEX_ERROR = 'slot x : Int = "unterminated';

const UNPARSABLE = [
  { given: "a parse error", source: PARSE_ERROR, line: 1, col: 6 },
  { given: "a lex error", source: LEX_ERROR, line: 1, col: 16 },
];

// The E0000 the compiler's own `parseFailure` makes of the throw, on the wire.
function compilerE0000(source: string): Diagnostic {
  try {
    parse(lex(source));
  } catch (e) {
    const { pos, ...rest } = parseFailure(e);
    return { ...rest, line: pos.line, col: pos.col, severity: "error" };
  }
  throw new Error(`expected ${JSON.stringify(source)} not to parse`);
}

function mounted() {
  const shown: PlaygroundView[] = [];
  const playground = createPlayground((view) => shown.push(view));
  return { playground, shown, last: () => shown.at(-1) };
}

// kumiki_set_source answers "ok", "ok (<n> warnings)" over the warnings' JSON, or the JSON alone.
function answered(s: string): { headline: string | null; diagnostics: unknown[] } {
  if (s === "ok") return { headline: "ok", diagnostics: [] };
  if (s.startsWith("ok")) {
    const nl = s.indexOf("\n");
    return { headline: s.slice(0, nl), diagnostics: JSON.parse(s.slice(nl + 1)) };
  }
  return { headline: null, diagnostics: JSON.parse(s) };
}

describe("playground preview", () => {
  it("previews a program with no diagnostics", () => {
    const { playground, last } = mounted();
    playground.preview(CLEAN);
    expect(last()).toMatchObject({ source: CLEAN, diagnostics: [] });
    expect(last()?.srcdoc).toContain('<script type="module">');
  });

  it("previews a program whose only diagnostics are warnings, and lists the warnings", () => {
    const { playground, last } = mounted();
    playground.preview(WARNING_ONLY);
    expect(last()?.diagnostics).toEqual([W0214]);
    expect(last()?.srcdoc).toContain('<script type="module">');
  });

  it("shows no preview for a program with an error, and lists every diagnostic", () => {
    const { playground, last } = mounted();
    playground.preview(WITH_ERROR);
    expect(last()).toEqual({ source: WITH_ERROR, diagnostics: [E0103, W0214], srcdoc: "" });
  });

  it.each(UNPARSABLE)("reports $given as the compiler's E0000, at its position", (c) => {
    const { playground, last } = mounted();
    playground.preview(c.source);
    expect(last()).toEqual({
      source: c.source,
      diagnostics: [compilerE0000(c.source)],
      srcdoc: "",
    });
    expect(last()?.diagnostics[0]).toMatchObject({ code: "E0000", line: c.line, col: c.col });
  });

  it("loads a named example into the editor and previews it", () => {
    const { playground, shown, last } = mounted();
    const example = examples.at(0);
    if (!example) throw new Error("the playground has no examples");
    expect(playground.loadExample(example.name)).toBe(true);
    expect(last()?.source).toBe(example.source);
    expect(last()?.srcdoc).toContain('<script type="module">');
    expect(playground.loadExample("does-not-exist.kumiki")).toBe(false);
    expect(shown).toHaveLength(1);
  });
});

describe("kumiki_compile", () => {
  it.each([
    { given: "no diagnostics", source: CLEAN, diagnostics: [] },
    { given: "only warnings", source: WARNING_ONLY, diagnostics: [W0214] },
  ])("compiles a program with $given and lists them", ({ source, diagnostics }) => {
    expect(mounted().playground.compileSource(source)).toEqual({
      ok: true,
      jsBytes: expect.any(Number),
      diagnostics,
    });
  });

  it("fails a program with an error and lists every diagnostic", () => {
    expect(mounted().playground.compileSource(WITH_ERROR)).toEqual({
      ok: false,
      diagnostics: [E0103, W0214],
    });
  });

  it.each(UNPARSABLE)("fails $given with the compiler's E0000", ({ source }) => {
    expect(mounted().playground.compileSource(source)).toEqual({
      ok: false,
      diagnostics: [compilerE0000(source)],
    });
  });

  it("leaves the editor and preview alone", () => {
    const { playground, shown } = mounted();
    playground.compileSource(WARNING_ONLY);
    expect(shown).toEqual([]);
  });
});

describe("kumiki_set_source", () => {
  it.each([
    { given: "no diagnostics", source: CLEAN, headline: "ok", diagnostics: [] },
    {
      given: "only warnings",
      source: WARNING_ONLY,
      headline: "ok (1 warning)",
      diagnostics: [W0214],
    },
    { given: "an error", source: WITH_ERROR, headline: null, diagnostics: [E0103, W0214] },
    {
      given: "a parse error",
      source: PARSE_ERROR,
      headline: null,
      diagnostics: [compilerE0000(PARSE_ERROR)],
    },
  ])("answers a program with $given", ({ source, headline, diagnostics }) => {
    const { playground, last } = mounted();
    expect(answered(playground.setSource(source))).toEqual({ headline, diagnostics });
    expect(last()?.source).toBe(source);
  });
});

describe("every diagnostic a WebMCP tool returns", () => {
  it.each([
    { given: "only warnings", source: WARNING_ONLY },
    { given: "an error", source: WITH_ERROR },
    ...UNPARSABLE,
  ])("has line, col and severity, and no pos, for a program with $given", ({ source }) => {
    const { playground } = mounted();
    const returned = [
      ...playground.compileSource(source).diagnostics,
      ...answered(playground.setSource(source)).diagnostics,
    ] as object[];
    expect(returned.length).toBeGreaterThan(0);
    for (const d of returned) {
      expect(Object.keys(d).sort()).toEqual(["code", "col", "kind", "line", "message", "severity"]);
    }
  });
});
