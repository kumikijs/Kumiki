// `$route` is a bind the runtime fills in, not a name that is always in scope.
// It is passed to route lifecycle reducers and to a link's prefetch target;
// every other reducer is applied with a payload that has no `$route` in it, so
// a body reading one saw `{}` and every field off it came back `undefined`.
// The compiler accepted all of them.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

function diagnose(source: string): { code: string; message: string; line: number; col: number }[] {
  return check(parse(lex(source))).map((e) => ({
    code: e.code,
    message: e.message,
    line: e.pos.line,
    col: e.pos.col,
  }));
}

function codes(source: string): string[] {
  return diagnose(source).map((e) => e.code);
}

/**
 * A program with one reducer under test. `trigger` is the whole `on=` clause,
 * `body` the whole `do=` clause; both tiles exist so a selector can name one.
 */
function program(trigger: string, body: string, extra = ""): string {
  return `slot seen : Text = ""

effect ping cap=log.write
            in=Unit
            out=Result(Unit, Text)
            map-request={level: "info", message: "ping"}

reducer subject
    on=${trigger}
    do= ${body}
${extra}
tile Btn = button(text="a")
tile Other = button(text="b")
tile Page = column(Btn, Other)

app A
    caps   = [log.write]
    routes = {"/" -> Page, "/posts/:id" -> Page, "/404" -> Page}
    init   = []
`;
}

describe("$route outside a route lifecycle reducer", () => {
  it("is reported on a ui event", () => {
    expect(codes(program("ui.click(Btn)", "seen := $route.path"))).toEqual(["E0119"]);
  });

  it("is reported on an effect event", () => {
    expect(codes(program("ping.ok(_, _)", "seen := $route.pattern"))).toEqual(["E0119"]);
  });

  it("is reported on an app lifecycle event", () => {
    expect(codes(program("app.start", "seen := $route.path"))).toEqual(["E0119"]);
  });

  it("is reported on a timer", () => {
    expect(codes(program("timer(1s)", "seen := $route.path"))).toEqual(["E0119"]);
  });

  it("names the slot that reads the same route, because it is in scope here", () => {
    const [d] = diagnose(program("ui.click(Btn)", "seen := $route.path"));
    expect(d?.message).toContain('"route"');
    expect(d?.message).toContain("route.enter");
  });

  it("points at the bind, not at the reducer", () => {
    // The `$` of `$route` in `    do= seen := $route.path`, not the `reducer`
    // keyword — `kumiki fix` rewrites at this column.
    const [d] = diagnose(program("ui.click(Btn)", "seen := $route.path"));
    expect([d?.line, d?.col]).toEqual([10, 17]);
  });
});

describe("where $route really is bound", () => {
  for (const ev of ['route.enter("/posts/:id")', 'route.leave("/posts/:id")']) {
    it(`accepts it under ${ev}`, () => {
      expect(codes(program(ev, "seen := $route.path"))).toEqual([]);
    });
  }

  it("accepts it under route.error, which the runtime binds the same way", () => {
    // `applyReducer(h, { $event: info, $route: cur })` — the route error path
    // passes the route it was rendering, so a body may read it.
    expect(codes(program('route.error("/posts/:id")', "seen := $route.path"))).toEqual([]);
  });

  it("accepts it in a reducer a link names as its prefetch target", () => {
    // §3.8: the prefetch fires with the same argument binding as route.enter,
    // so the reducer it names is a route reducer wherever it is triggered from.
    const src = program(
      "ui.click(Other)",
      'seen := $route.params.get-or("id", "")',
      'tile Ahead = link(to="/posts/7") {text: "7", prefetch: subject, prefetch-args: {"id": "7"}}\n',
    ).replace("tile Page = column(Btn, Other)", "tile Page = column(Btn, Other, Ahead)");
    expect(codes(src)).toEqual([]);
  });

  it("accepts the string form of the same prefetch target", () => {
    const src = program(
      "ui.click(Other)",
      "seen := $route.path",
      'tile Ahead = link(to="/posts/7") {text: "7", prefetch: "subject", prefetch-args: {"id": "7"}}\n',
    ).replace("tile Page = column(Btn, Other)", "tile Page = column(Btn, Other, Ahead)");
    expect(codes(src)).toEqual([]);
  });
});

describe("every position the bind can hide in", () => {
  it("finds it inside a call argument", () => {
    const src = program(
      "ping.ok(_, _)",
      "seen := label($route)",
      "fn label(r: Route) -> Text = r.path\n",
    );
    expect(codes(src)).toEqual(["E0119"]);
  });

  it("finds it as a match scrutinee", () => {
    const src = program(
      "ui.click(Btn)",
      `match $route.params.get("id") with
            | Some(v) -> seen := v
            | None    -> ()`,
    );
    expect(codes(src)).toEqual(["E0119"]);
  });

  it("reports each occurrence, because each one is separately wrong", () => {
    const src = program("ui.click(Btn)", "seen := $route.path + $route.pattern");
    expect(codes(src)).toEqual(["E0119", "E0119"]);
  });
});

describe("what the rule does not touch", () => {
  it("leaves the route slot alone — it is readable from any reducer", () => {
    expect(codes(program("ui.click(Btn)", "seen := route.path"))).toEqual([]);
  });

  it("still reports an undefined name in a fn as an undefined name", () => {
    // A fn is not applied with a payload at all, so `$route` there is not an
    // out-of-scope bind — it is a name that does not exist. That was already
    // E0103 and stays E0103.
    const src = program("ui.click(Btn)", "seen := viaFn()", "fn viaFn() -> Text = $route.path\n");
    expect(codes(src)).toEqual(["E0103"]);
  });

  it("still reports it in a tile body as an undefined name", () => {
    const src = program("ui.click(Btn)", 'seen := "x"').replace(
      'tile Other = button(text="b")',
      "tile Other = button(text=$route.path)",
    );
    expect(codes(src)).toEqual(["E0103"]);
  });
});
