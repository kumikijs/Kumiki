import { lex, parse, parseFailure } from "@kumikijs/compiler";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlayground, type Diagnostic, type PlaygroundView } from "./playground";
import { buildSrcdoc, compileToJs, examples } from "./preview";

// Wrapped so a test can make the compiler throw what no source makes it throw.
vi.mock("./preview", async (importOriginal) => {
  const preview = await importOriginal<typeof import("./preview")>();
  return { ...preview, compileToJs: vi.fn(preview.compileToJs) };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(compileToJs).mockReset();
});

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
const TWO_WARNINGS = program('fmt("Count: {0} {1}", count.show) + fmt(" of {0} {1}", count.show)');
const WITH_ERROR = program('fmt("Count: {0} {1}", total.show)');
// The error comes first in the source, and the checker finds it first.
const ERROR_FIRST = `slot count : Int = 0

tile Total = text(total.show)
tile App = column(Total, heading(fmt("Count: {0} {1}", count.show)))

app Playground
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

// The compiler's own message and column for the `nth` `code` diagnostic of `source`. The playground
// relays them unchanged, so a change to the compiler's wording does not fail this suite.
function relayed(source: string, code: string, nth = 0): Pick<Diagnostic, "message" | "col"> {
  const result = compileToJs(source);
  const all = result.kind === "ok" ? result.warnings : [...result.errors, ...result.warnings];
  const found = all.filter((d) => d.code === code).at(nth);
  if (!found) throw new Error(`expected ${code} #${nth} in ${JSON.stringify(source)}`);
  return { message: found.message, col: found.pos.col };
}

const W0214 = (source: string, line = 6, nth = 0): Diagnostic => ({
  code: "W0214",
  kind: "fmt-placeholder-argument-mismatch",
  line,
  severity: "warning",
  ...relayed(source, "W0214", nth),
});

const E0103 = (source: string, line = 6): Diagnostic => ({
  code: "E0103",
  kind: "undef-ref",
  line,
  severity: "error",
  ...relayed(source, "E0103"),
});

// The compiled module of `source`, and the preview document the playground builds from it.
function compiledJs(source: string): string {
  const result = compileToJs(source);
  if (result.kind !== "ok") throw new Error(`expected ${JSON.stringify(source)} to compile`);
  return result.js;
}
const previewOf = (source: string): string => buildSrcdoc(compiledJs(source));

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
    expect(last()).toEqual({ source: CLEAN, diagnostics: [], srcdoc: previewOf(CLEAN) });
  });

  it("previews a program whose only diagnostics are warnings, and lists the warnings", () => {
    const { playground, last } = mounted();
    playground.preview(WARNING_ONLY);
    expect(last()).toEqual({
      source: WARNING_ONLY,
      diagnostics: [W0214(WARNING_ONLY)],
      srcdoc: previewOf(WARNING_ONLY),
    });
  });

  it.each([
    { given: "after", source: WITH_ERROR, warningLine: 6, errorLine: 6 },
    { given: "before", source: ERROR_FIRST, warningLine: 4, errorLine: 3 },
  ])("shows no preview for a program with an error $given its warning, and lists the warning first", (c) => {
    const { playground, last } = mounted();
    playground.preview(c.source);
    expect(last()).toEqual({
      source: c.source,
      diagnostics: [W0214(c.source, c.warningLine), E0103(c.source, c.errorLine)],
      srcdoc: "",
    });
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
    expect(last()?.srcdoc).toBe(previewOf(example.source));
    expect(playground.loadExample("does-not-exist.kumiki")).toBe(false);
    expect(shown).toHaveLength(1);
  });
});

describe("kumiki_compile", () => {
  it.each([
    { given: "no diagnostics", source: CLEAN, diagnostics: [] },
    { given: "only warnings", source: WARNING_ONLY, diagnostics: [W0214(WARNING_ONLY)] },
  ])("compiles a program with $given and lists them", ({ source, diagnostics }) => {
    expect(mounted().playground.compileSource(source)).toEqual({
      ok: true,
      jsBytes: compiledJs(source).length,
      diagnostics,
    });
  });

  it("fails a program with an error and lists the warnings, then the errors", () => {
    expect(mounted().playground.compileSource(ERROR_FIRST)).toEqual({
      ok: false,
      diagnostics: [W0214(ERROR_FIRST, 4), E0103(ERROR_FIRST, 3)],
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
      given: "a warning",
      source: WARNING_ONLY,
      headline: "ok (1 warning)",
      diagnostics: [W0214(WARNING_ONLY)],
    },
    {
      given: "two warnings",
      source: TWO_WARNINGS,
      headline: "ok (2 warnings)",
      diagnostics: [W0214(TWO_WARNINGS, 6, 0), W0214(TWO_WARNINGS, 6, 1)],
    },
    {
      given: "an error",
      source: ERROR_FIRST,
      headline: null,
      diagnostics: [W0214(ERROR_FIRST, 4), E0103(ERROR_FIRST, 3)],
    },
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

describe("a throw from the compiler that is no lex or parse error", () => {
  const thrown = new TypeError("boom");
  const INTERNAL: Diagnostic = {
    code: "internal-error",
    kind: "internal-error",
    message: "Internal compiler error: TypeError: boom",
    line: 1,
    col: 1,
    severity: "error",
  };

  // The next compile throws `thrown`; what the playground logs of it is returned.
  function compilerThrows() {
    vi.mocked(compileToJs).mockImplementationOnce(() => {
      throw thrown;
    });
    return vi.spyOn(console, "error").mockImplementation(() => {});
  }

  it("replaces the last preview with the fault, shows the new source, and logs the throw", () => {
    const { playground, last } = mounted();
    playground.preview(CLEAN);
    const logged = compilerThrows();
    expect(playground.preview(WARNING_ONLY)).toEqual({ diagnostics: [INTERNAL], js: null });
    expect(last()).toEqual({ source: WARNING_ONLY, diagnostics: [INTERNAL], srcdoc: "" });
    expect(logged).toHaveBeenCalledWith(expect.any(String), thrown);
  });

  it("loads the example into the editor all the same", () => {
    const { playground, last } = mounted();
    const example = examples.at(0);
    if (!example) throw new Error("the playground has no examples");
    compilerThrows();
    expect(playground.loadExample(example.name)).toBe(true);
    expect(last()).toEqual({ source: example.source, diagnostics: [INTERNAL], srcdoc: "" });
  });

  it("answers kumiki_set_source with the fault, and shows the source", () => {
    const { playground, last } = mounted();
    compilerThrows();
    expect(answered(playground.setSource(CLEAN))).toEqual({
      headline: null,
      diagnostics: [INTERNAL],
    });
    expect(last()?.source).toBe(CLEAN);
  });

  it("answers kumiki_compile with the fault", () => {
    compilerThrows();
    expect(mounted().playground.compileSource(CLEAN)).toEqual({
      ok: false,
      diagnostics: [INTERNAL],
    });
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
