import { describe, expect, it } from "vitest";
import { codesOf, locatedOf } from "./helpers/diagnostics.ts";

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
    expect(codesOf(program("ui.click(Btn)", "seen := $route.path"))).toEqual(["E0119"]);
  });

  it("is reported on an effect event", () => {
    expect(codesOf(program("ping.ok(_, _)", "seen := $route.pattern"))).toEqual(["E0119"]);
  });

  it("is reported on an app lifecycle event", () => {
    expect(codesOf(program("app.start", "seen := $route.path"))).toEqual(["E0119"]);
  });

  it("is reported on a timer", () => {
    expect(codesOf(program("timer(1s)", "seen := $route.path"))).toEqual(["E0119"]);
  });

  it("gives the app.init answer there, not this one", () => {
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
    expect(codesOf(src)).toEqual(["E0120"]);
  });

  it("is not reported when an enclosing bind owns the name", () => {
    expect(codesOf(program("app.start", 'seen := let $route = "x" in $route'))).toEqual([]);
    expect(codesOf(program("app.start", "seen := match seen with | $route -> $route"))).toEqual([]);
  });

  it("names the slot that reads the same route, because it is in scope here", () => {
    const [d] = locatedOf(program("ui.click(Btn)", "seen := $route.path"));
    expect(d?.message).toContain('"route"');
    expect(d?.message).toContain("route.enter");
  });

  it("points at the bind, not at the reducer", () => {
    const [d] = locatedOf(program("ui.click(Btn)", "seen := $route.path"));
    expect([d?.line, d?.col]).toEqual([10, 17]);
  });
});

describe("where $route really is bound", () => {
  for (const ev of ['route.enter("/posts/:id")', 'route.leave("/posts/:id")']) {
    it(`accepts it under ${ev}`, () => {
      expect(codesOf(program(ev, "seen := $route.path"))).toEqual([]);
    });
  }

  it("accepts it under route.error, which the runtime binds the same way", () => {
    expect(codesOf(program('route.error("/posts/:id")', "seen := $route.path"))).toEqual([]);
  });

  it("accepts it in the reducer a link prefetches, which is normally a route reducer too", () => {
    const src = program(
      'route.enter("/posts/:id")',
      'seen := $route.params.get-or("id", "")',
      'tile Ahead = link(to="/posts/7") {text: "7", prefetch: subject, prefetch-args: {"id": "7"}}\n',
    ).replace("tile Page = column(Btn, Other)", "tile Page = column(Btn, Other, Ahead)");
    expect(codesOf(src)).toEqual([]);
  });
});

describe("the prefetch exemption is by name, so it covers the reducer's other triggers too", () => {
  const prefetching = (tile: string, trigger = "ui.click(Other)"): string =>
    program(trigger, 'seen := $route.params.get-or("id", "")', `${tile}\n`).replace(
      "tile Page = column(Btn, Other)",
      "tile Page = column(Btn, Other, Ahead)",
    );

  it("finds a bare-ident target", () => {
    expect(
      codesOf(
        prefetching(
          'tile Ahead = link(to="/posts/7") {text: "7", prefetch: subject, prefetch-args: {"id": "7"}}',
        ),
      ),
    ).toEqual([]);
  });

  it("finds the string form of the same prop", () => {
    expect(
      codesOf(
        prefetching(
          'tile Ahead = link(to="/posts/7") {text: "7", prefetch: "subject", prefetch-args: {"id": "7"}}',
        ),
      ),
    ).toEqual([]);
  });

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
      expect(codesOf(prefetching(tile))).toEqual([]);
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
    expect(codesOf(src)).toEqual(["E0119"]);
  });

  it("finds it as a match scrutinee", () => {
    const src = program(
      "ui.click(Btn)",
      `match $route.params.get("id") with
            | Some(v) -> seen := v
            | None    -> ()`,
    );
    expect(codesOf(src)).toEqual(["E0119"]);
  });

  it("reports each occurrence, because each one is separately wrong", () => {
    const src = program("ui.click(Btn)", "seen := $route.path + $route.pattern");
    expect(codesOf(src)).toEqual(["E0119", "E0119"]);
  });
});

describe("what the rule does not touch", () => {
  it("leaves the route slot alone — it is readable from any reducer", () => {
    expect(codesOf(program("ui.click(Btn)", "seen := route.path"))).toEqual([]);
  });

  it("still reports an undefined name in a fn as an undefined name", () => {
    const src = program("ui.click(Btn)", "seen := viaFn()", "fn viaFn() -> Text = $route.path\n");
    expect(codesOf(src)).toEqual(["E0103"]);
  });

  it("still reports it in a tile body as an undefined name", () => {
    const src = program("ui.click(Btn)", 'seen := "x"').replace(
      'tile Other = button(text="b")',
      "tile Other = button(text=$route.path)",
    );
    expect(codesOf(src)).toEqual(["E0103"]);
  });
});

describe("the type $route has", () => {
  const AHEAD =
    'slot n : Int = 0\ntile Ahead = link(to="/posts/7") {text: "7", prefetch: subject, prefetch-args: {"id": "7"}}\n';
  const withAhead = (src: string): string =>
    src.replace("tile Page = column(Btn, Other)", "tile Page = column(Btn, Other, Ahead)");

  describe.each([
    'route.enter("/posts/:id")',
    'route.leave("/posts/:id")',
    'route.error("/posts/:id")',
  ])("on %s, which hands it the route every time", (trigger) => {
    it("is a Route, so a field read as another type is E0201", () => {
      const [d, ...rest] = locatedOf(program(trigger, "n := $route.path", "slot n : Int = 0\n"));
      expect(rest).toEqual([]);
      expect([d?.code, d?.message]).toEqual(["E0201", "Expected Int but got Text"]);
    });

    it("reports a field a Route does not have", () => {
      expect(codesOf(program(trigger, 'seen := $route.parms.get-or("id", "")'))).toEqual(["E0108"]);
    });
  });

  it("is none where nothing binds it, so the read is E0119 alone", () => {
    expect(codesOf(program("ui.click(Other)", "n := $route.path", "slot n : Int = 0\n"))).toEqual([
      "E0119",
    ]);
  });

  it("is untyped in a prefetch target on another trigger, which hands it {}", () => {
    expect(codesOf(withAhead(program("ui.click(Other)", "n := $route.path", AHEAD)))).toEqual([]);
  });

  it("is a Route in a prefetch target whose own trigger is a route one", () => {
    const src = withAhead(program('route.enter("/posts/:id")', "n := $route.path", AHEAD));
    expect(codesOf(src)).toEqual(["E0201"]);
  });
});
