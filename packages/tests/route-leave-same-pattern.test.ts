// routing.md §3.4: a navigation that fires `route.enter` for the route it lands
// on fires `route.leave` for the one it leaves first, even when both are the
// same pattern (a params-only move, or a child switch under a `sub-routes`
// parent). The corpus example (`155-leave-on-param-change`) pins the counts and
// the confirm guard through its scenario; this suite pins the order the two
// events run in and which route each one is handed.

import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const SRC = `
slot log : Text = ""
reducer leaveT on=route.leave("/t/:id") do= log := log + "leave " + $route.params.get-or("id", "?") + ";"
reducer enterT on=route.enter("/t/:id") do= log := log + "enter " + $route.params.get-or("id", "?") + ";"
reducer leaveS on=route.leave("/s/*") do= log := log + "leave " + $route.path + ";"
reducer enterS on=route.enter("/s/*") do= log := log + "enter " + $route.path + ";"
tile T        = page(heading("T " + route.params.get-or("id", "?")))
tile A        = page(heading("A"))
tile B        = page(heading("B"))
tile S sub-routes = {"/s/a" -> A, "/s/b" -> B} = page(route-outlet())
tile Home     = page(heading("Home"))
tile NotFound = page(heading("404"))
app LeaveOrder
    caps   = [nav.push]
    routes = {"/" -> Home, "/t/:id" -> T, "/s/*" -> S, "/404" -> NotFound}
    init   = []
`;

async function logAfter(paths: string[]): Promise<unknown> {
  const app = await loadSource(SRC, ["nav.push"]);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const report = await runScenario(
    app,
    root,
    { steps: paths.map((p) => ({ do: { navigate: p } })) },
    { router: "memory" },
  );
  root.remove();
  return report.steps.at(-1)?.state?.log;
}

describe("route.leave on a move within one pattern", () => {
  it("leaves the old params, then enters the new ones", async () => {
    expect(await logAfter(["/t/1", "/t/2"])).toBe("enter 1;leave 1;enter 2;");
  });

  it("leaves a sub-routes parent before a child switch re-enters it", async () => {
    expect(await logAfter(["/s/a", "/s/b"])).toBe("enter /s/a;leave /s/a;enter /s/b;");
  });
});
