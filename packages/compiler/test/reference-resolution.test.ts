import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";

const TAIL = `
tile App = column(Panel)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
const PANEL = `slot n : Int = 0\ntile Panel = column(text("hi"))\n`;

describe("lifecycle selectors (E0211)", () => {
  for (const ev of ["mount", "unmount"]) {
    it(`reports an undeclared tile in tile.${ev}`, () => {
      const err = checkSource(`${PANEL}reducer r on=tile.${ev}(Pannel) do= n := 1${TAIL}`).find(
        (e) => e.code === "E0211",
      );
      expect(err, `no E0211 for tile.${ev}`).toBeDefined();
      expect(err?.message).toContain("Pannel");
      expect(`${err?.pos.line}:${err?.pos.col}`).toBe(`3:${`reducer r on=tile.${ev}(`.length + 1}`);
    });

    it(`accepts a declared tile in tile.${ev}`, () => {
      expect(codesOf(`${PANEL}reducer r on=tile.${ev}(Panel) do= n := 1${TAIL}`)).not.toContain(
        "E0211",
      );
    });
  }

  it("has no wildcard to exempt", () => {
    expect(codesOf(`${PANEL}reducer r on=tile.mount(_) do= n := 1${TAIL}`)).toContain("E0211");
  });
});

describe("effect-event selectors (E0104)", () => {
  for (const outcome of ["ok", "err"]) {
    it(`reports an undeclared effect in .${outcome}`, () => {
      const err = checkSource(
        `${PANEL}reducer r on=noSuchEffect.${outcome}($v, _) do= n := 1${TAIL}`,
      ).find((e) => e.code === "E0104");
      expect(err, `no E0104 for .${outcome}`).toBeDefined();
      expect(err?.message).toContain("noSuchEffect");
      // At the effect name, which is what a rewrite has to replace.
      expect(`${err?.pos.line}:${err?.pos.col}`).toBe(`3:${"reducer r on=".length + 1}`);
    });
  }

  it("accepts a declared effect", () => {
    const src = `${PANEL}effect load cap=http.get in=Unit out=Result(Text, HttpError)
reducer r on=load.ok($v, _) do= n := 1${TAIL}`;
    expect(codesOf(src)).not.toContain("E0104");
  });

  for (const outcome of ["ok", "err"]) {
    it(`accepts a built-in effect's .${outcome}`, () => {
      expect(
        codesOf(`${PANEL}reducer r on=navigate.${outcome}(_, _) do= n := 1${TAIL}`),
      ).not.toContain("E0104");
    });
  }
});

describe("route lifecycle patterns (E0228)", () => {
  // The two `->>` keys are ones the router replaces before anything is entered.
  const ROUTED = (on: string) => `slot n : Int = 0
reducer r on=${on} do= n := 1
tile Home = column(text("home"))
tile Account = column(text("account"))
tile Settings
    sub-routes = {"/settings/account" -> Account, "/settings" -> Home, "/settings/old" ->> "/settings/account"}
    = column(route-outlet())
app A
    caps   = []
    routes = {"/" -> Home, "/users/:id" -> Home, "/settings/*" -> Settings, "/old" ->> "/", "/404" -> Home}
    init   = []
`;
  const DECLARED = ["/", "/users/:id", "/settings/*", "/settings/account", "/settings", "/404"];
  const cases = (patterns: string[]) =>
    ["enter", "leave", "error"].flatMap((ev) => patterns.map((pattern) => ({ ev, pattern })));
  const e0228 = (ev: string, pattern: string) =>
    checkSource(ROUTED(`route.${ev}("${pattern}")`)).find((e) => e.code === "E0228");

  it.each(cases(DECLARED))("accepts route.$ev($pattern), which the app declares", ({
    ev,
    pattern,
  }) => {
    expect(codesOf(ROUTED(`route.${ev}("${pattern}")`))).not.toContain("E0228");
  });

  it.each(
    cases(["/*", "/usrs/:id", "/users/:userId", "/settings/acount"]),
  )("reports route.$ev($pattern) at the pattern, listing the declared routes", ({
    ev,
    pattern,
  }) => {
    const err = e0228(ev, pattern);
    expect(err, `no E0228 for route.${ev}("${pattern}")`).toBeDefined();
    expect(err?.kind).toBe("undef-route-pattern");
    expect(`${err?.pos.line}:${err?.pos.col}`).toBe(`2:${`reducer r on=route.${ev}(`.length + 1}`);
    expect(err?.message).toContain(`route.${ev}("${pattern}")`);
    for (const p of DECLARED) expect(err?.message).toContain(`"${p}"`);
  });

  it.each(
    cases(["/old", "/settings/old"]),
  )("reports route.$ev($pattern), a redirect nothing enters", ({ ev, pattern }) => {
    const err = e0228(ev, pattern);
    expect(err, `no E0228 for route.${ev}("${pattern}")`).toBeDefined();
    expect(err?.message).toContain("redirect");
  });

  it("leaves the question to E0003 when there is no app to declare routes", () => {
    const src = `slot n : Int = 0\nreducer r on=route.enter("/x") do= n := 1\n`;
    expect(codesOf(src, { requireApp: false })).not.toContain("E0228");
  });
});

describe("app.http handlers (E0102)", () => {
  const app = (on401: string, on403: string, on5xx: string) => `
slot n : Int = 0
tile App = column(text("hi"))
reducer known on=app.start do= n := 1
app A
    caps   = [http.get]
    routes = {"/" -> App, "/404" -> App}
    init   = []
    http   = {base-url: "/api",
              on-401: ${on401},
              on-403: ${on403},
              on-5xx: ${on5xx}}
`;

  it("reports each undeclared handler at its own name", () => {
    const found = checkSource(app("noSuchA", "noSuchB", "noSuchC")).filter(
      (e) => e.code === "E0102",
    );
    expect(
      found.map((e) => `${e.pos.line}:${e.pos.col} ${e.message.match(/"(.+)"/)?.[1]}`),
    ).toEqual(["10:23 noSuchA", "11:23 noSuchB", "12:23 noSuchC"]);
  });

  it("accepts declared reducers", () => {
    expect(codesOf(app("known", "known", "known"))).not.toContain("E0102");
  });
});

const THEMES = `theme Light = {colors: {bg: "#fff"}}
theme Dark = {colors: {bg: "#111"}}
`;

describe("app.theme (E0118)", () => {
  const app = (theme: string, extra = "") => `
tile App = column(text("hi"))
${extra}app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
    theme  = ${theme}
`;

  it("reports a name that is neither a theme nor a slot", () => {
    const err = checkSource(app("NoSuchTheme")).find((e) => e.code === "E0118");
    expect(err, "no E0118").toBeDefined();
    expect(err?.message).toContain("NoSuchTheme");
    expect(err?.pos.col).toBe(14);
  });

  it("accepts a declared theme", () => {
    expect(codesOf(app("Light", THEMES))).not.toContain("E0118");
  });

  it("accepts a slot the theme name is read from", () => {
    expect(codesOf(app("themeName", `${THEMES}slot themeName : Text = "Light"\n`))).not.toContain(
      "E0118",
    );
  });

  it("says nothing about the value the slot holds", () => {
    const src = app(
      "themeName",
      `${THEMES}slot themeName : Text = "unset"
tile Btn = button(text="t", onClick=pick)
reducer pick on=ui.click(Btn) do= themeName := "Ligth"
`,
    );
    expect(codesOf(src)).not.toContain("E0118");
  });
});

describe("app.init effect calls (E0104)", () => {
  it("reports an undeclared effect", () => {
    const src = `
tile App = column(text("hi"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[noSuchEffect()]
`;
    expect(codesOf(src)).toContain("E0104");
  });
});
