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

  it("is reported in app.init, which runs before any route with no payload at all", () => {
    const src = `slot seen : Text = ""

effect ping cap=log.write
            in=Text
            out=Result(Unit, Text)
            map-request={level: "info", message: $1}

tile Page = column(text(seen))

app A
    caps   = [log.write]
    routes = {"/" -> Page, "/404" -> Page}
    init   = [ping($route.path)]
`;
    expect(codes(src)).toEqual(["E0119"]);
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

  it("accepts it in the reducer a link prefetches, which is normally a route reducer too", () => {
    // §3.8: the prefetch fires its target with the same binding as route.enter,
    // precisely so one body can serve the prefetch and the navigation. That
    // body is a `route.enter` reducer, and this is the shape the exemption is
    // written for.
    const src = program(
      'route.enter("/posts/:id")',
      'seen := $route.params.get-or("id", "")',
      'tile Ahead = link(to="/posts/7") {text: "7", prefetch: subject, prefetch-args: {"id": "7"}}\n',
    ).replace("tile Page = column(Btn, Other)", "tile Page = column(Btn, Other, Ahead)");
    expect(codes(src)).toEqual([]);
  });
});

// Every test below reads `$route` from a reducer whose OWN trigger binds none,
// and expects silence. That silence is the over-approximation, not a guarantee:
// `bindsRoute` exempts a prefetch target by name, and a reducer reached through
// its own trigger gets the routeless payload like any other. The check has no
// path sensitivity to tell the two apart, and exempting is the side that never
// rejects a working program.
describe("the prefetch exemption is by name, so it covers the reducer's other triggers too", () => {
  const prefetching = (tile: string, trigger = "ui.click(Other)"): string =>
    program(trigger, 'seen := $route.params.get-or("id", "")', `${tile}\n`).replace(
      "tile Page = column(Btn, Other)",
      "tile Page = column(Btn, Other, Ahead)",
    );

  it("finds a bare-ident target", () => {
    expect(
      codes(
        prefetching(
          'tile Ahead = link(to="/posts/7") {text: "7", prefetch: subject, prefetch-args: {"id": "7"}}',
        ),
      ),
    ).toEqual([]);
  });

  it("finds the string form of the same prop", () => {
    expect(
      codes(
        prefetching(
          'tile Ahead = link(to="/posts/7") {text: "7", prefetch: "subject", prefetch-args: {"id": "7"}}',
        ),
      ),
    ).toEqual([]);
  });

  // The collector has to reach a link wherever a tile body can put one. A
  // branch it does not descend into makes the exemption invisible, which turns
  // a working program into a false E0119 — so each wrapper is its own case.
  const wrapped: [string, string][] = [
    [
      "a for loop, which is where a per-row prefetch actually lives",
      `slot posts : List(Text) = []
tile Ahead = column(for p in posts link(to="/posts/" + p) {text: p, prefetch: subject, prefetch-args: {"id": p}})`,
    ],
    [
      "a when",
      `slot ready : Bool = false
tile Ahead = column(when(ready, link(to="/posts/7") {text: "7", prefetch: subject, prefetch-args: {"id": "7"}}))`,
    ],
    [
      "either branch of an if",
      `slot ready : Bool = false
tile Ahead = column(if ready then text("wait") else link(to="/posts/7") {text: "7", prefetch: subject, prefetch-args: {"id": "7"}})`,
    ],
    [
      "any arm of a match",
      `slot pick : Option(Text) = None
tile Ahead = column(match pick with
          | None    -> text("none")
          | Some(p) -> link(to="/posts/" + p) {text: p, prefetch: subject, prefetch-args: {"id": p}})`,
    ],
    [
      "a tile argument, which is a tile expression of its own",
      `tile Ahead = column(card(link(to="/posts/7") {text: "7", prefetch: subject, prefetch-args: {"id": "7"}}))`,
    ],
  ];
  for (const [where, tile] of wrapped) {
    it(`descends into ${where}`, () => {
      expect(codes(prefetching(tile))).toEqual([]);
    });
  }
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
