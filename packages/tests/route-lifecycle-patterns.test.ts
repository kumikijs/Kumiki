// routing.md §3.4: a route lifecycle event names a declared route pattern — a
// key of `app.routes` or of a `sub-routes` map — and fires for every pattern the
// route is matched under: the top-level pattern and the sub-route it matched
// below it. A sub-route pattern therefore fires on entering that child, and its
// parent's pattern fires beside it, the parent first on the way in and the
// child first on the way out. A move to another path leaves the whole chain it
// came from and enters the whole chain it lands on, as it does for a single
// top-level pattern; `route.error` fires for every pattern of the route being
// shown, and hands each reducer the pattern it named.

import { mount, runScenario } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const SRC = `
slot log : Text = ""
reducer enterS on=route.enter("/s/*") do= log := log + "+S;"
reducer leaveS on=route.leave("/s/*") do= log := log + "-S;"
reducer enterA on=route.enter("/s/a") do= log := log + "+a;"
reducer leaveA on=route.leave("/s/a") do= log := log + "-a;"
reducer enterB on=route.enter("/s/b") do= log := log + "+b;"
reducer leaveB on=route.leave("/s/b") do= log := log + "-b;"
reducer enterD on=route.enter("/s")   do= log := log + "+d;"
reducer leaveD on=route.leave("/s")   do= log := log + "-d;"
reducer enterH on=route.enter("/")    do= log := log + "+h;"
reducer leaveH on=route.leave("/")    do= log := log + "-h;"
tile A        = page(heading("A"))
tile B        = page(heading("B"))
tile D        = page(heading("S home"))
tile S sub-routes = {"/s/a" -> A, "/s/b" -> B, "/s" -> D} = page(route-outlet())
tile Home     = page(heading("Home"))
tile NotFound = page(heading("404"))
app Chain
    caps   = [nav.push]
    routes = {"/" -> Home, "/s/*" -> S, "/404" -> NotFound}
    init   = []
`;

// The same app with a guard that holds every move off `/s/a` behind confirm.
const GUARDED = SRC.replace(
  "caps   = [nav.push]",
  "caps   = [nav.push, notification.show]",
).concat(`
reducer guardA on=route.leave("/s/a")
    do= emit confirm({title: "Leave?", message: "", onYes: goOn, onNo: stay})
reducer goOn on=ui.click(_) do= ()
reducer stay on=ui.click(_) do= ()
`);

type Step = { navigate: string } | { click: string } | { wait: number };

const YES = { click: "[data-kumiki-confirm] button[data-kumiki-confirm-action='yes']" };
const NO = { click: "[data-kumiki-confirm] button[data-kumiki-confirm-action='no']" };

async function logAfter(steps: Step[], src = SRC, initialPath = "/"): Promise<unknown> {
  const app = await loadSource(src, ["nav.push", "notification.show"]);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const report = await runScenario(
    app,
    root,
    { steps: steps.map((s) => ({ do: s })) },
    { router: "memory", initialPath },
  );
  root.remove();
  expect(report.ok, JSON.stringify(report.steps.filter((s) => !s.ok))).toBe(true);
  return report.steps.at(-1)?.state?.log;
}

const nav = (...paths: string[]): Step[] => paths.map((navigate) => ({ navigate }));

describe("route.enter / route.leave follow the matched chain", () => {
  it("enters the parent, then the sub-route it matched", async () => {
    expect(await logAfter(nav("/s/a"))).toBe("+h;-h;+S;+a;");
  });

  it("enters the whole chain the app mounts on", async () => {
    expect(await logAfter([{ wait: 0 }], SRC, "/s/b")).toBe("+S;+b;");
  });

  it("leaves the sub-route, then the parent, when the path changes", async () => {
    expect(await logAfter(nav("/s/a", "/"))).toBe("+h;-h;+S;+a;-a;-S;+h;");
  });

  it("leaves and re-enters the parent on a switch between its children", async () => {
    expect(await logAfter(nav("/s/a", "/s/b"))).toBe("+h;-h;+S;+a;-a;-S;+S;+b;");
  });

  it("enters the parent's default sub-route on its bare path and on a path no child takes", async () => {
    expect(await logAfter(nav("/s", "/s/zzz"))).toBe("+h;-h;+S;+d;-d;-S;+S;+d;");
  });

  it("re-enters the chain and leaves nothing on a move that keeps the path", async () => {
    expect(await logAfter(nav("/s/a", "/s/a?tab=1"))).toBe("+h;-h;+S;+a;+S;+a;");
  });
});

describe("route.leave on a sub-route pattern guards the move", () => {
  it("holds a switch to a sibling behind confirm, and Yes enters the new chain", async () => {
    expect(await logAfter([...nav("/s/a", "/s/b"), YES], GUARDED)).toBe("+h;-h;+S;+a;-a;-S;+S;+b;");
  });

  it("No stays on the child it guards and enters nothing", async () => {
    expect(await logAfter([...nav("/s/a", "/s/b"), NO], GUARDED)).toBe("+h;-h;+S;+a;-a;-S;");
  });
});

describe("route.error follows the chain of the route being shown", () => {
  let disposeFn: (() => void) | undefined;
  let mountedRoot: HTMLElement | undefined;
  afterEach(() => {
    disposeFn?.();
    disposeFn = undefined;
    mountedRoot?.remove();
    mountedRoot = undefined;
  });

  const ERR = `slot xs : List(Int) = []
slot seen : Text = ""
reducer errS on=route.error("/s/*") do= seen := seen + "S " + $event.pattern + ";"
reducer errA on=route.error("/s/a") do= seen := seen + "a " + $event.pattern + ";"
reducer errB on=route.error("/s/b") do= seen := seen + "b " + $event.pattern + ";"
tile NotFound = column(text("nf"))
tile Boom = column(text(xs.head.get.show))
tile Fine = column(text("fine"))
tile S sub-routes={"/s/a" -> Boom, "/s/b" -> Fine} = column(route-outlet())
app M caps=[] routes={"/s/*" -> S, "/404" -> NotFound} init=[]
`;

  it("fires for the parent and the sub-route, each with the pattern it named", async () => {
    const app = await loadSource(ERR);
    mountedRoot = document.createElement("div");
    document.body.appendChild(mountedRoot);
    const { dispose } = mount(app, mountedRoot, { router: "memory", initialPath: "/s/a" });
    disposeFn = dispose;
    await new Promise((r) => setTimeout(r, 0));
    expect((app.live as Record<string, unknown>).seen).toBe("S /s/*;a /s/a;");
  });
});
