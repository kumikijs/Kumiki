import { readFileSync } from "node:fs";
import { applyFixPlan, fixCmd, load, planFixes, planFixesExplained } from "@kumikijs/cli";
import { check, collectTimerNames, lex, parse, variantTagsOf } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { APP_A, seed, storeOf } from "./helpers/files.ts";

const APP_ONE_LINE = `app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;

function planOf(file: string) {
  const store = load(file);
  return planFixes(store, check(store.program));
}

const descriptionsOf = (file: string): string[] => planOf(file).map((p) => p.description);

/** Apply the first planned patch to the file's text; the result and its diagnostics. */
function applyFirst(file: string): { patched: string; errors: string[] } {
  const patch = defined(planOf(file)[0], "a planned patch");
  const patched = patch.apply(readFileSync(file, "utf8"));
  return { patched, errors: check(parse(lex(patched))).map((e) => e.code) };
}

describe("kumiki fix: auto-patch suggestions", () => {
  it.each([
    {
      repair: "appends the list accessor a `for` over a Map is missing (E0218)",
      source: `slot names : Map(Text, Text) = {}\ntile App = column(for k in names text(k))\n${APP_A}`,
      description: 'append ".keys" to "names" at 2:28',
      fixed: "for k in names.keys",
    },
    {
      repair: "appends the Set accessor, not a prefix of it (E0218)",
      source: `slot tags : Set(Text) = {}\ntile App = column(for t in tags text(t))\n${APP_A}`,
      description: 'append ".to-list" to "tags" at 2:28',
      fixed: "for t in tags.to-list",
    },
    {
      repair: "rewrites an out-of-scope $route to the slot that holds it (E0119)",
      source: `slot seen : Text = ""
reducer clicked on=ui.click(Btn) do= seen := $route.path
tile Btn = button(text="go")
tile App = column(Btn)
${APP_A}`,
      description: 'read the "route" slot instead of "$route" at 2:46',
      fixed: "seen := route.path",
    },
    {
      repair: "answers a misspelt type member on its own qualifier (E0116)",
      source: `slot a : Int = 0
slot t : Text = "1"
reducer r on=ui.click(B) do= a := Int.pasre(t).get-or(0)
tile B = button(text="b")
tile App = column(B, text(a.show), text(t))
${APP_A}`,
      description: 'replace "Int.pasre" with "Int.parse" at 3:35',
      fixed: "a := Int.parse(t).get-or(0)",
    },
  ])("$repair", ({ source, description, fixed }) => {
    const file = seed(source);
    expect(descriptionsOf(file)).toContain(description);
    const { patched, errors } = applyFirst(file);
    expect(patched).toContain(fixed);
    expect(errors).toEqual([]);
  });

  it("declines when the iterated expression is not a plain name (E0218)", () => {
    const store = storeOf(`slot names : Map(Text, Text) = {}
fn pick(m: Map(Text, Text)) -> Map(Text, Text) = m
tile App = column(for k in pick(names) text(k))
${APP_A}`);
    const { patches, skipped } = planFixesExplained(store, check(store.program));
    expect(patches.map((p) => p.code)).not.toContain("E0218");
    expect(skipped.find((sk) => sk.code === "E0218")?.reason).toBe("e0218-target-not-a-plain-name");
  });

  it("declines a target no accessor repairs, such as an Option (E0218)", () => {
    const store = storeOf(`slot loaded : Option(List(Text)) = Some(["a"])
tile App = column(for x in loaded text(x))
${APP_A}`);
    const { patches, skipped } = planFixesExplained(store, check(store.program));
    expect(patches.map((p) => p.code)).not.toContain("E0218");
    expect(skipped.filter((sk) => sk.code === "E0218").map((sk) => sk.reason)).toEqual([
      "e0218-no-accessor",
    ]);
  });

  it("makes a text builtin's text= its positional content (E0129)", () => {
    const file = seed(`slot title : Text = "Hi"
tile App = column(heading(level=2, text=title), text("A", "B"))
${APP_A}`);
    const store = load(file);
    const { patches, skipped } = planFixesExplained(store, check(store.program));
    expect(patches.map((p) => p.description)).toEqual([
      "make the text= value the positional content at 2:36",
    ]);
    expect(skipped.map((sk) => sk.reason)).toEqual(["e0129-dropped-argument-has-no-single-repair"]);
    const patched = patches.reduce((t, p) => p.apply(t), readFileSync(file, "utf8"));
    expect(patched).toContain("heading(level=2, title)");
    expect(check(parse(lex(patched))).map((e) => e.code)).toEqual(["E0129"]);
  });

  it("tells the E0129 shapes apart by the diagnostic's field, not its message", () => {
    const store = storeOf(`slot title : Text = "Hi"
tile App = column(heading(level=2, text=title), text("A", "B"), label(text="X", "Y"))
${APP_A}`);
    const errors = check(store.program);
    const plan = (es: typeof errors) => {
      const { patches, skipped } = planFixesExplained(store, es);
      return { patches: patches.map((p) => p.description), skipped: skipped.map((s) => s.reason) };
    };
    const real = plan(errors);
    expect(real.patches).toHaveLength(2);
    expect(real.skipped).toEqual(["e0129-dropped-argument-has-no-single-repair"]);
    expect(plan(errors.map((e) => ({ ...e, message: "reworded" })))).toEqual(real);
  });

  it.each([
    {
      repair: "removes a text= that a positional argument shadows (E0129)",
      source: `tile A = label(text="X", "Y")
tile B = link(to="/x", "Y", text=("X" + "Z"))
tile App = column(A(), B())
app P
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`,
      applied: 2,
      fixed: `tile A = label("Y")\ntile B = link(to="/x", "Y")\n`,
    },
    {
      repair: "lands both repairs when one line holds two, and the first shifts the second",
      source: `slot seen : Bool = false
reducer clicked on=ui.click(Btn) do= seen := $route.path == $route.pattern
tile Btn = button(text="go")
tile App = column(Btn)
${APP_A}`,
      applied: 2,
      fixed: "seen := route.path == route.pattern",
    },
    {
      repair: "lands a line-scanning repair beside a positioned one on the same line",
      source: `slot counter : Text = ""
slot seen : Text = ""
reducer clicked on=ui.click(Btn) do= seen := countr + $route.path + countr
tile Btn = button(text="go")
tile App = column(Btn)
${APP_A}`,
      applied: 3,
      fixed: "seen := counter + route.path + counter",
    },
    {
      repair: "repairs a diagnostic that does not point at the name it quotes (E0211)",
      source: `slot n : Int = 0
reducer inc on=ui.click(Buton) do= n := n + 1
tile Button = button(text="+")
tile App = column(Button, text(n.show))
${APP_A}`,
      applied: 1,
      fixed: "on=ui.click(Button)",
    },
  ])("$repair", ({ source, applied, fixed }) => {
    const file = seed(source);
    const result = applyFixPlan(file, undefined);
    expect(result.applied).toBe(applied);
    expect(result.remaining).toEqual([]);
    expect(readFileSync(file, "utf8")).toContain(fixed);
  });

  it("leaves the file's line endings alone", () => {
    const source = [
      'slot counter : Text = ""',
      "reducer clicked on=ui.click(Btn) do= counter := $route.path",
      'tile Btn = button(text="go")',
      "tile App = column(Btn)",
      ...APP_A.split("\n"),
    ].join("\r\n");
    const file = seed(source);
    expect(applyFixPlan(file, undefined).applied).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(source.replace("$route.path", "route.path"));
  });

  it("suggests did-you-mean for an undef slot plus the missing /404, and --apply leaves it clean", () => {
    const file = seed(`type N = nominal Int where between(0, 999)
slot count : N = 0
reducer inc on=ui.click(IncBtn) do= conut := conut + 1
tile IncBtn = button(text="+")
tile App = column(heading("Count: " + count), IncBtn)
app Counter
    caps = []
    routes = {"/" -> App}
    init = []
`);
    const descs = descriptionsOf(file);
    expect(descs.some((d) => d.includes(`replace "conut" with "count"`))).toBe(true);
    expect(descs.some((d) => d.includes(`"/404" -> NotFound`))).toBe(true);
    fixCmd(file, true);
    expect(check(load(file).program)).toEqual([]);
  });

  it.each([
    {
      kind: "fn name for an undefined call",
      source: `slot n : Int = 0
fn double(x: Int) -> Int = x * 2
reducer inc on=ui.click(B) do= n := doubel(n)
tile B = button(text="+")
tile App = column(B, text(n.show))
${APP_ONE_LINE}
`,
      description: `replace "doubel" with "double" at 3:37`,
    },
    {
      kind: "type name for an undefined type",
      source: `type Filter = All | Done\nslot f : Filtre = All\ntile App = column(text("x"))\n${APP_ONE_LINE}\n`,
      description: `replace "Filtre" with "Filter" at 2:10`,
    },
    {
      kind: "variant tag for a constructor the union does not have",
      source: `type Status = Idle | Running\nslot s : Status = Runing\ntile App = column(text("x"))\n${APP_ONE_LINE}\n`,
      description: `replace "Runing" with "Running" at 2:19`,
    },
  ])("suggests a close $kind as the only patch, and --apply leaves the file clean", ({
    source,
    description,
  }) => {
    const file = seed(source);
    expect(descriptionsOf(file)).toEqual([description]);
    fixCmd(file, true);
    expect(check(load(file).program)).toEqual([]);
  });

  it("rewrites the reported column, not the line's first word-boundary match", () => {
    const file = seed(`slot n : Int = 0
fn re-laod(x: Int) -> Int = x + 1
fn load(x: Int) -> Int = x * 2
reducer go on=ui.click(B) do= n := re-laod(laod(n))
tile B = button(text="+")
tile App = column(B, text(n.show))
${APP_ONE_LINE}
`);
    fixCmd(file, true);
    const after = readFileSync(file, "utf8");
    expect(after).toContain("re-laod(load(n))");
    expect(after).toContain("fn re-laod(x: Int)");
    expect(check(load(file).program)).toEqual([]);
  });
});

describe("planFixes: name suggestions", () => {
  it.each([
    {
      from: "prefers-drak",
      to: "prefers-dark",
      where: "a builtin, not only a declared fn",
      source: `slot t : Text = "Light"
reducer initTheme on=app.start do= t := if prefers-drak() then "Dark" else "Light"
tile App = column(text(t))
${APP_ONE_LINE}
`,
    },
    {
      from: "HttpErrro",
      to: "HttpError",
      where: "a standard-library type, not only a declared one",
      source: `slot e : Option(HttpErrro) = None\ntile App = column(text("x"))\n${APP_ONE_LINE}\n`,
    },
    {
      from: "fadeInn",
      to: "fadeIn",
      where: "a motion name (E0107)",
      source: `motion fadeIn = {keyframes: {from: {opacity: 0}, to: {opacity: 1}}}
tile App = heading("hi") {motion: "fadeInn"}
${APP_A}`,
    },
    {
      from: "Pannel",
      to: "Panel",
      where: "a tile in a lifecycle event (E0211)",
      source: `slot mounts : Int = 0
tile Panel = card(text("p"))
reducer onPanel on=tile.mount(Pannel) do= mounts := mounts + 1
tile App = column(Panel)
${APP_A}`,
    },
    {
      from: "IncBtnn",
      to: "IncBtn",
      where: "a tile in a ui.click selector (E0211)",
      source: `slot count : Int = 0
tile IncBtn = button(text="+")
reducer inc on=ui.click(IncBtnn) do= count := count + 1
tile App = column(IncBtn)
${APP_A}`,
    },
    {
      from: "navigat",
      to: "navigate",
      where: "a standard effect (E0104)",
      source: `slot n : Int = 0
tile Btn = button(text="go", onClick=go)
reducer go on=ui.click(Btn) do= emit navigat({path: "/x", params: {}})
tile App = column(Btn)
${APP_A.replace("caps   = []", "caps   = [nav.push]")}`,
    },
    {
      from: "laod",
      to: "load",
      where: "an effect in an on=<effect>.ok selector",
      source: `slot n : Int = 0
effect load cap=http.get in=Unit out=Result(Text, HttpError)
reducer got on=laod.ok($v, _) do= n := 1
tile App = column(text("hi"))
${APP_A.replace("caps   = []", "caps   = [http.get]")}`,
    },
    {
      from: "onUnath",
      to: "onUnauth",
      where: "a reducer named by an app.http handler",
      source: `slot n : Int = 0
reducer onUnauth on=app.start do= n := 1
tile App = column(text("hi"))
${APP_A.replace("caps   = []", "caps   = [http.get]")}    http   = {base-url: "/api", on-401: onUnath}
`,
    },
    {
      from: "themeNam",
      to: "themeName",
      where: "a slot for app.theme, not only a theme name (E0118)",
      source: `slot themeName : Text = "Light"
theme Light = {colors: {bg: "#fff"}}
tile App = heading("hi")
${APP_A}    theme  = themeNam
`,
    },
    {
      from: "Ligth",
      to: "Light",
      where: "a theme for app.theme (E0118)",
      source: `theme Light = {colors: {bg: "#fff"}}
tile App = heading("hi")
${APP_A}    theme  = Ligth
`,
    },
    {
      from: "coutdown",
      to: "countdown",
      where: "a timer (E0106)",
      source: `slot remaining : Int = 5
reducer tick on=timer(100ms, name=countdown) do= remaining := remaining - 1
reducer stop on=ui.click(StopBtn) do= stop-timer(coutdown)
tile StopBtn = button(text="Stop", onClick=stop)
tile App = column(heading("hi"), StopBtn)
${APP_A}`,
    },
    {
      from: "Non",
      to: "None",
      where: "a variant tag of a built-in Option scrutinee (E0209)",
      source: `fn describe(o: Option(Int)) -> Text = match o with
  | Some(_) -> "some"
  | Non    -> "none"
slot x : Int = 0
tile App = column(text(x.show))
${APP_A}`,
    },
  ])("suggests $to for $from: $where", ({ from, to, source }) => {
    expect(
      descriptionsOf(seed(source)).some((d) => d.includes(`replace "${from}" with "${to}"`)),
    ).toBe(true);
  });

  it("suggests a close variant tag for E0209 on a user union, not a tile of a similar name", () => {
    const file = seed(`type Light = Red | Green
fn label(l: Light) -> Text = match l with
  | Red -> "STOP"
  | Grn -> "GO"
slot x : Int = 0
tile Grn0 = text("hi")
tile App = column(text(x.show), Grn0)
${APP_A}`);
    const e0209 = planOf(file).filter((p) => p.code === "E0209");
    expect(e0209).toHaveLength(1);
    expect(e0209[0]?.description).toContain(`replace "Grn" with "Green"`);
    expect(e0209[0]?.description).not.toContain("Grn0");
  });

  it("E0106 does not fall back to unrelated top-level names (scoped candidate set)", () => {
    const store = storeOf(`slot note  : Int = 0
slot count : Int = 0
reducer step on=timer(100ms, name=tick) do= count := count + 1
reducer stop on=ui.click(StopBtn) do= stop-timer(nope)
tile StopBtn = button(text="Stop", onClick=stop)
tile App = column(heading("hi"), StopBtn)
${APP_A}`);
    expect(collectTimerNames(store.program)).toEqual(new Set(["tick"]));
    const errors = check(store.program);
    expect(errors.some((e) => e.code === "E0106")).toBe(true);
    const patches = planFixes(store, errors);
    expect(patches.some((p) => p.code === "E0106")).toBe(false);
    expect(patches.some((p) => /"note"|"count"/.test(p.description))).toBe(false);
  });

  it("E0209 does not fall back to unrelated top-level names (scoped candidate set)", () => {
    const store = storeOf(`type Direction = North | South
fn describe(d: Direction) -> Text = match d with
  | North -> "n"
  | South -> "s"
  | Qqq   -> "?"
slot x : Int = 0
tile Qqq0 = text("hi")
tile App = column(text(x.show), Qqq0)
${APP_A}`);
    expect(variantTagsOf("Direction", store.program)).toEqual(["North", "South"]);
    const errors = check(store.program);
    expect(errors.some((e) => e.code === "E0209")).toBe(true);
    const patches = planFixes(store, errors);
    expect(patches.some((p) => p.code === "E0209")).toBe(false);
    expect(patches.some((p) => p.description.includes("Qqq0"))).toBe(false);
  });
});

describe("planFixesExplained: skip-reason classification", () => {
  const synth = (code: string, message: string) => ({
    code,
    kind: "type-error" as const,
    message,
    pos: { line: 1, col: 1 },
  });
  const LONE_TILE = 'tile A = heading("hi")\n';
  const withApp = (caps: string) => `tile App = heading("hi")\n${APP_A.replace("[]", caps)}`;

  it.each([
    ["quoted-name-extract-failed", LONE_TILE, "E0102", "reducer name is undefined"],
    [
      "no-close-name-suggestion",
      LONE_TILE,
      "E0102",
      'reducer refers to undefined name "ZZZZZZZZZZ"',
    ],
    ["no-close-name-suggestion", LONE_TILE, "E0102", 'reducer refers to undefined name "A"'],
    ["e0106-quoted-name-extract-failed", LONE_TILE, "E0106", "stop-timer bad"],
    [
      "e0106-empty-timer-namespace",
      LONE_TILE,
      "E0106",
      'stop-timer refers to undefined timer name "x"',
    ],
    [
      "e0106-no-close-timer",
      'slot count : Int = 0\nreducer step on=timer(100ms, name=tick) do= count := count + 1\ntile App = heading("hi")\n',
      "E0106",
      'stop-timer refers to undefined timer name "ZZZZZZZZZZ"',
    ],
    ["e0209-quoted-name-extract-failed", LONE_TILE, "E0209", 'Variant "X" is bad'],
    [
      "e0209-unresolved-variant-type",
      LONE_TILE,
      "E0209",
      'Variant "X" is not a member of scrutinee type "NoSuchType"',
    ],
    [
      "e0209-no-close-tag",
      'type Light = Red | Green\nslot x : Int = 0\ntile App = heading("hi")\n',
      "E0209",
      'Variant "ZZZZZZZZZZ" is not a member of scrutinee type "Light"',
    ],
    ["e0116-quoted-name-extract-failed", LONE_TILE, "E0116", "call to something undefined"],
    [
      "e0116-no-close-callee",
      'fn double(x: Int) -> Int = x * 2\ntile App = heading("hi")\n',
      "E0116",
      'Call to undefined function "ZZZZZZZZZZ"',
    ],
    [
      "e0116-no-close-callee",
      'slot doubel-value : Int = 0\ntile App = heading("hi")\n',
      "E0116",
      'Call to undefined function "doubel-value"',
    ],
    ["e0117-quoted-name-extract-failed", LONE_TILE, "E0117", "some undefined type"],
    [
      "e0117-no-close-type",
      'type Filter = All | Done\ntile App = heading("hi")\n',
      "E0117",
      'Reference to undefined type "ZZZZZZZZZZ"',
    ],
    [
      "e0117-no-close-type",
      'slot Filtar : Int = 0\ntile App = heading("hi")\n',
      "E0117",
      'Reference to undefined type "Filtar"',
    ],
    [
      "e0124-type-arguments-unknown",
      'slot l : List(Int) = List.fresh()\ntile App = heading("hi")\n',
      "E0124",
      'Type "List" takes 1 type argument, so it is not a type on its own — "List.fresh" needs one that takes none',
    ],
    ["e0216-quoted-name-extract-failed", LONE_TILE, "E0216", 'Variant "Zork" is unknown'],
    [
      "e0216-unresolved-variant-type",
      'type N = Int\ntile App = heading("hi")\n',
      "E0216",
      'Variant "Zork" is not a member of type "N"',
    ],
    [
      "e0216-no-close-tag",
      'type S = Idle | Busy\ntile App = heading("hi")\n',
      "E0216",
      'Variant "ZZZZZZZZZZ" is not a member of type "S"',
    ],
    ["e0301-quoted-name-extract-failed", withApp("[]"), "E0301", "capability not declared"],
    [
      "e0301-no-app-def",
      LONE_TILE,
      "E0301",
      'Effect "e" requires capability "log.write" which is not declared',
    ],
    [
      "e0301-cap-already-present-or-no-caps-field",
      withApp("[log.write]"),
      "E0301",
      'Effect "e" requires capability "log.write" which is not declared',
    ],
    ["no-repair-branch", LONE_TILE, "E0999", "some future diagnostic"],
  ])("%s: %s / %s %s", (reason, source, code, message) => {
    const { patches, skipped } = planFixesExplained(storeOf(source), [synth(code, message)]);
    expect(patches).toEqual([]);
    expect(skipped).toEqual([expect.objectContaining({ code, reason })]);
  });

  it("self-match does not eclipse a close alternative candidate", () => {
    const { patches } = planFixesExplained(
      storeOf('tile App = heading("hi")\ntile Apps = label("hi")\n'),
      [synth("E0102", 'reducer refers to undefined name "App"')],
    );
    expect(patches).toHaveLength(1);
    expect(patches[0]?.description).toContain('replace "App" with "Apps"');
  });
});

describe("applyFixPlan: regression gate", () => {
  it("clean patch: writes through and reports not-blocked", () => {
    const file = seed(
      'tile App = heading("hi")\napp A\n    caps   = []\n    routes = {"/" -> App}\n    init   = []\n',
    );
    const before = readFileSync(file, "utf8");
    const result = applyFixPlan(file, "E0001");
    expect(result.regressionBlocked).toBeFalsy();
    expect(result.applied).toBeGreaterThan(0);
    expect(readFileSync(file, "utf8")).not.toBe(before);
  });

  it("swap E0301 → E0302 (typo cap): blocked, file byte-identical", () => {
    const file = seed(`effect logHello cap=lgo
                in=Text
                out=Unit

reducer greet on=app.start do= emit logHello("hi")
tile App = heading("hi")
${APP_A}`);
    const before = readFileSync(file, "utf8");
    const result = applyFixPlan(file, "E0301");
    expect(result.regressionBlocked).toBe(true);
    expect(result.applied).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("no resolutions: rolled back even when nothing new is introduced", () => {
    const file = seed(`slot count : Int = 0
reducer bad on=ui.click(B) do=
    count := 1
    count := 2
tile B = button(text="+")
tile App = column(heading("hi"), B)
${APP_A}`);
    const before = readFileSync(file, "utf8");
    expect(applyFixPlan(file, undefined).applied).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});
