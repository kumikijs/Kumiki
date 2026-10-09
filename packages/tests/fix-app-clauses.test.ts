// `kumiki fix --apply` repairs E0001 and E0301 in the app's own clauses, and
// leaves the rest of the file as it was.
//
// errors.md (Auto-patch Coverage) lists both as repaired, and both were text
// patterns that failed on ordinary layouts. E0001's `routes = {` pattern also
// matched a tile's `sub-routes = {`, so a layout tile written above the app got
// the `/404` route and the app kept its E0001. E0001 also defined
// `tile NotFound` when the program already had one, which is E0007. E0301 split
// `caps` on commas and joined it onto one line, so a `# comment` after the last
// cap swallowed the new cap and the closing `]`, and the file stopped parsing.
// The gate refused each write, so `fix --apply` could never repair these files.
//
// Both repairs now find the clause from the tokens of the app the parser found,
// and add the new entry right after the last token of the last entry. The
// other cases pin that rule where it is easiest to get wrong: a redirect's
// last token is a string, an empty map has no last entry, of two `caps`
// clauses the parser keeps the second, the app's clauses end at the next
// definition, and in a CRLF file the entry goes in without touching a line
// break.
//
// Where there is nothing the repair can add, `fix` offers no patch and says
// why, so a dry run never proposes a patch that `--apply` then finds empty.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixCmd, planFix } from "@kumikijs/cli";
import { type AppDef, lex, type Program, parse, type TileDef } from "@kumikijs/compiler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-fix-app-clauses-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSource(source: string): string {
  const file = join(dir, "app.kumiki");
  writeFileSync(file, source);
  return file;
}

/** Run `kumiki fix <file> --apply` on `source`; the exit code and the file it left. */
function fixApply(source: string): { code: number; after: string; program: Program } {
  const file = writeSource(source);
  const code = fixCmd(file, true);
  const after = readFileSync(file, "utf8");
  return { code, after, program: parse(lex(after)) };
}

/**
 * What `fix` plans for `code` on `source`: whether it offers a patch, and the
 * reasons it gives for not offering one. The dry run prints this plan and
 * `--apply` composes it, so the two cannot disagree about it.
 */
function planFor(source: string, code: string): { patched: boolean; reasons: string[] } {
  const plan = planFix(writeSource(source), undefined);
  return {
    patched: plan.patches.some((p) => p.code === code),
    reasons: plan.skipped.filter((s) => s.code === code).map((s) => s.reason),
  };
}

function appOf(program: Program): AppDef {
  const app = program.defs.find((d): d is AppDef => d.kind === "AppDef");
  if (!app) throw new Error("no app");
  return app;
}

function tilesNamed(program: Program, name: string): TileDef[] {
  return program.defs.filter((d): d is TileDef => d.kind === "TileDef" && d.name === name);
}

/** Everything but the app: a reducer that emits an effect needing `storage.write`. */
const SAVES = `slot n : Int = 0

effect save cap=storage.write in=Int out=Result(Unit, Text)

reducer bump on=ui.click(Btn) do= emit save(n)

tile Btn = button(text="save")
tile App = column(Btn)
`;

describe("E0001: the /404 route goes into the app's routes", () => {
  it("not into the sub-routes of a layout tile written above the app", () => {
    const { code, program } = fixApply(`tile AccountSettings = page(heading("Account settings"))
tile SettingsHome    = page(heading("Settings home"))

tile SettingsLayout
    sub-routes = {
        "/settings/account" -> AccountSettings,
        "/settings"         -> SettingsHome
    }
    = page(heading("Settings"), route-outlet())

tile Landing = page(heading("Landing"))

app NestedRoutes
    caps   = [nav.push]
    routes = {
        "/"            -> Landing,
        "/settings/*"  -> SettingsLayout
    }
    init   = []
`);
    expect(code).toBe(0);
    expect(appOf(program).routes.map((r) => [r.path, r.tile])).toEqual([
      ["/", "Landing"],
      ["/settings/*", "SettingsLayout"],
      ["/404", "NotFound"],
    ]);
    const [layout] = tilesNamed(program, "SettingsLayout");
    expect(layout?.subRoutes?.map((r) => [r.path, r.tile])).toEqual([
      ["/settings/account", "AccountSettings"],
      ["/settings", "SettingsHome"],
    ]);
    expect(tilesNamed(program, "NotFound")).toHaveLength(1);
  });

  it("routes to the NotFound tile the program already has, and defines no second one", () => {
    const { code, after, program } = fixApply(`tile NotFound = page(heading("Nothing here"))
tile Landing = page(heading("Landing"))

app A
    caps   = []
    routes = {"/" -> Landing}
    init   = []
`);
    expect(code).toBe(0);
    expect(appOf(program).routes.map((r) => [r.path, r.tile])).toEqual([
      ["/", "Landing"],
      ["/404", "NotFound"],
    ]);
    expect(tilesNamed(program, "NotFound")).toHaveLength(1);
    expect(after).toContain('tile NotFound = page(heading("Nothing here"))');
  });

  it("after a redirect that is the last route", () => {
    const { code, after, program } = fixApply(`tile Landing = page(heading("Landing"))

app A
    caps   = []
    routes = {"/" -> Landing, "/home" ->> "/"}
    init   = []
`);
    expect(code).toBe(0);
    expect(appOf(program).routes.map((r) => r.path)).toEqual(["/", "/home", "/404"]);
    expect(after).toContain('routes = {"/" -> Landing, "/home" ->> "/", "/404" -> NotFound}');
  });

  it("into an empty routes map", () => {
    const { code, after, program } = fixApply(`tile Landing = page(heading("Landing"))

app A
    caps   = []
    routes = {}
    init   = []
`);
    expect(code).toBe(0);
    expect(appOf(program).routes.map((r) => [r.path, r.tile])).toEqual([["/404", "NotFound"]]);
    expect(after).toContain('routes = {"/404" -> NotFound}');
  });

  it("of an app followed by other definitions, whose clauses are not the app's", () => {
    // A test named `routes` reads `routes =` at bracket depth 0, the way an app
    // clause does. The app's clauses end at the definition after it.
    const { code, program } = fixApply(`tile AccountSettings = page(heading("Account settings"))
tile Landing = page(heading("Landing"))

app NestedRoutes
    caps   = []
    routes = {"/" -> Landing, "/settings/*" -> SettingsLayout}
    init   = []

tile SettingsLayout
    sub-routes = {"/settings/account" -> AccountSettings}
    = page(heading("Settings"), route-outlet())

test routes =
    tile-test Landing
        given  = {slots: {}}
        expect = page(heading("Landing"))
`);
    expect(code).toBe(0);
    expect(appOf(program).routes.map((r) => [r.path, r.tile])).toEqual([
      ["/", "Landing"],
      ["/settings/*", "SettingsLayout"],
      ["/404", "NotFound"],
    ]);
    const [layout] = tilesNamed(program, "SettingsLayout");
    expect(layout?.subRoutes?.map((r) => r.path)).toEqual(["/settings/account"]);
  });

  it("in a CRLF file, whose own lines keep CRLF while the added NotFound tile has LF", () => {
    // This pins today's output, not the intended one. The route goes in
    // without touching a line break, but the prepended tile is written with
    // LF, so the file ends up with mixed line breaks. It should get the file's
    // own line break once fix.ts writes lines through the shared line-break
    // helper; flip the expectation then.
    const lines = [
      'tile Landing = page(heading("Landing"))',
      "",
      "app A",
      "    caps   = []",
      "    routes = {",
      '        "/" -> Landing    # home',
      "    }",
      "    init   = []",
      "",
    ];
    const { code, after } = fixApply(lines.join("\r\n"));
    expect(code).toBe(0);
    const repaired = lines.map((l) =>
      l.includes("# home") ? '        "/" -> Landing, "/404" -> NotFound    # home' : l,
    );
    expect(after).toBe(`\ntile NotFound = page(heading("404"))\n${repaired.join("\r\n")}`);
  });
});

describe("E0001: no patch where there is nothing to add, and the plan says why", () => {
  it("when the app has no routes clause", () => {
    const source = `tile Landing = page(heading("Landing"))

app A
    caps   = []
    init   = []
`;
    expect(planFor(source, "E0001")).toEqual({
      patched: false,
      reasons: ["e0001-no-routes-clause"],
    });
  });

  it("when /404 is a redirect, which E0001 does not count and a second /404 would repeat", () => {
    const source = `tile Landing = page(heading("Landing"))

app A
    caps   = []
    routes = {"/" -> Landing, "/404" ->> "/"}
    init   = []
`;
    expect(planFor(source, "E0001")).toEqual({
      patched: false,
      reasons: ["e0001-404-is-a-redirect"],
    });
  });

  it("when a sub-routes map has an entry at /404, which is removed rather than added to", () => {
    for (const entry of ['"/404" -> NotFound', '"/404" ->> "/"']) {
      const source = `tile Landing  = page(heading("Landing"))
tile NotFound = page(heading("Not found"))

tile SettingsLayout
    sub-routes = {"/settings" -> Landing, ${entry}}
    = page(heading("Settings"), route-outlet())

app A
    caps   = []
    routes = {"/" -> Landing, "/settings/*" -> SettingsLayout, "/404" -> NotFound}
    init   = []
`;
      expect(planFor(source, "E0001")).toEqual({
        patched: false,
        reasons: ["e0001-404-in-sub-routes"],
      });
    }
  });
});

describe("E0301: the capability is a new item of app.caps", () => {
  it("ahead of a comment after the last cap, which stays a comment", () => {
    const { code, after, program } = fixApply(`${SAVES}
app A
    caps   = [
        nav.push    # links
    ]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`);
    expect(code).toBe(0);
    expect(appOf(program).caps).toEqual(["nav.push", "storage.write"]);
    expect(after).toContain("nav.push, storage.write    # links\n    ]");
  });

  it("in the caps clause the parser keeps, when the clause is written twice", () => {
    // The duplicate is E0008, which no patch repairs, so the file still has an
    // error. What the repair can do is clear the E0301.
    const { code, after, program } = fixApply(`${SAVES}
app A
    caps   = [nav.push]
    routes = {"/" -> App, "/404" -> App}
    caps   = []
    init   = []
`);
    expect(code).toBe(1);
    expect(appOf(program).caps).toEqual(["storage.write"]);
    expect(after).toContain("caps   = [nav.push]\n");
  });

  it("is not offered when the app has no caps clause, and the plan says why", () => {
    const source = `${SAVES}
app A
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(planFor(source, "E0301")).toEqual({
      patched: false,
      reasons: ["e0301-cap-already-present-or-no-caps-field"],
    });
  });
});

describe("E0001 and E0301 in one --apply", () => {
  it("both land, each in the app's own clause", () => {
    const { code, program } = fixApply(`${SAVES}
tile SettingsLayout
    sub-routes = {"/settings" -> App}
    = page(route-outlet())

app A
    caps   = [
        nav.push    # links
    ]
    routes = {"/" -> App, "/settings/*" -> SettingsLayout}
    init   = []
`);
    expect(code).toBe(0);
    const app = appOf(program);
    expect(app.caps).toEqual(["nav.push", "storage.write"]);
    expect(app.routes.map((r) => [r.path, r.tile])).toEqual([
      ["/", "App"],
      ["/settings/*", "SettingsLayout"],
      ["/404", "NotFound"],
    ]);
    const [layout] = tilesNamed(program, "SettingsLayout");
    expect(layout?.subRoutes?.map((r) => r.path)).toEqual(["/settings"]);
  });
});
