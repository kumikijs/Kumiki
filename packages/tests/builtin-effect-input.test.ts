import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const program = (body: string) => `reducer go on=ui.click(GoBtn) do= ${body}
tile GoBtn = button(text="go") {id: "go"}
tile Home  = column(text("home page"), GoBtn)
tile About = text("about page")
app Nav
  caps = [nav.push, nav.back, notification.show, log.write]
  routes = {"/" -> Home, "/about" -> About, "/404" -> Home}
  init = []
`;

const codesOf = (body: string) => {
  const r = compile(program(body), { runtimeSpecifier: "./runtime.js" });
  return r.kind === "ok" ? [] : r.errors.map((e) => e.code);
};

describe("a standard effect's argument stops the build when it is the wrong one", () => {
  it.each([
    [`emit navigate("/about")`, "E0202"],
    [`emit navigate-back(1)`, "E0213"],
    [`emit navigate()`, "E0213"],
    [`emit toast("Saved")`, "E0202"],
    [`emit toast({kind: "info", text: 42, duration: None})`, "E0202"],
    [`emit scroll-to("top")`, "E0202"],
    [`emit log(42, 43)`, "E0213"],
  ])("%s", (body, code) => {
    expect(codesOf(body)).toEqual([code]);
  });

  it("builds the record navigate takes, with params and query left out", () => {
    expect(codesOf(`emit navigate({path: "/about"})`)).toEqual([]);
  });

  it("builds an if whose branches leave out different fields", () => {
    // Each branch is held to the fields it writes, not to the whole `if`.
    expect(
      codesOf(`emit navigate(if true then {path: "/about"} else {path: "/", query: {"q": "1"}})`),
    ).toEqual([]);
  });
});
