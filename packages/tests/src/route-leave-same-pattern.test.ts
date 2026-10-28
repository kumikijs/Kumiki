import { describe, expect, it } from "vitest";
import { answerConfirm, logAfter, navigateTo as nav } from "./helpers/scenario.ts";

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

/** The same app with a guard that holds every move off `/t/:id` behind confirm. */
const GUARDED = SRC.replace(
  "caps   = [nav.push]",
  "caps   = [nav.push, notification.show]",
).concat(`
reducer guardT on=route.leave("/t/:id")
    do= emit confirm({title: "Leave?", message: "", onYes: goOn, onNo: stay})
reducer goOn on=ui.click(_) do= ()
reducer stay on=ui.click(_) do= ()
`);

describe("route.leave on a move within one pattern", () => {
  it("leaves the old params, then enters the new ones", async () => {
    expect(await logAfter(SRC, nav("/t/1", "/t/2"))).toBe("enter 1;leave 1;enter 2;");
  });

  it("leaves a sub-routes parent before a child switch re-enters it", async () => {
    expect(await logAfter(SRC, nav("/s/a", "/s/b"))).toBe("enter /s/a;leave /s/a;enter /s/b;");
  });

  it("Yes on a held move enters the new params, not the old ones", async () => {
    expect(await logAfter(GUARDED, [...nav("/t/1", "/t/2"), answerConfirm("yes")])).toBe(
      "enter 1;leave 1;enter 2;",
    );
  });
});
