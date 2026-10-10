import { describe, expect, it } from "vitest";
import { BUILTIN_EFFECTS } from "../src/capabilities.ts";
import { checkSource } from "./helpers/diagnostics.ts";

// Written out rather than read off the table, so the table is checked against the spec's list.
const STANDARD = [
  "navigate",
  "navigate-replace",
  "navigate-back",
  "scroll-to",
  "toast",
  "confirm",
  "log",
];

const declaring = (name: string) => `effect ${name} cap=http.get in=Text out=Result(Text, HttpError)
    map-request={url: "/api/" + $1, decode: Decoder.Text}
slot got : Text = ""
reducer go   on=ui.click(B)        do= emit ${name}("x")
reducer done on=${name}.ok($r, _) do= got := $r
tile B = button(text="b", onClick=go)
app A caps=[http.get] routes={"/" -> B, "/404" -> B} init=[]
`;

const diagnostics = (src: string) =>
  checkSource(src).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

describe("an effect declared under a standard effect's name", () => {
  it("the list here is every standard effect the checker knows", () => {
    expect([...BUILTIN_EFFECTS.keys()].sort()).toEqual([...STANDARD].sort());
  });

  it.each(STANDARD)("effect %s is E0234 at the declaration, naming the built-in", (name) => {
    expect(diagnostics(declaring(name))).toEqual([
      `E0234 1:1 Effect "${name}" collides with the built-in effect ${name}; emits of it never run this effect`,
    ]);
  });

  it("is reported once per declaration, beside E0007 for the second one", () => {
    const twice = declaring("log").replace(
      "slot got",
      `effect log cap=http.get in=Text out=Result(Text, HttpError)\nslot got`,
    );
    expect(diagnostics(twice).map((d) => d.slice(0, 9))).toEqual([
      "E0234 1:1",
      "E0234 3:1",
      "E0007 3:1",
    ]);
  });

  it("refuses the program whose log never made its request", () => {
    // The declaration's `policy` and `map-request` are what the runtime drops;
    // neither changes the report.
    const src = `slot lastId : EffectId = EffectId.none
effect log cap=http.get in=Text out=Result(Text, HttpError)
           policy=latest-per-key($1)
           map-request={url: "/api/" + $1, decode: Decoder.Text}
reducer go on=ui.click(B) do= lastId := emit log("x")
tile B = button(text="b", onClick=go)
tile Home = column(B, text(lastId.show))
app M caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]
`;
    expect(diagnostics(src)).toEqual([
      `E0234 2:1 Effect "log" collides with the built-in effect log; emits of it never run this effect`,
    ]);
  });

  it("checks the program's uses of the name against the declaration they were written for", () => {
    // `emit toast(…)` with the standard toast's record is held to the declared
    // `in=Text`, and the capability is the declared `cap=` — so renaming the
    // declaration with its uses leaves nothing else to fix.
    const src = `effect toast cap=http.get in=Text out=Result(Text, HttpError)
    map-request={url: "/api/" + $1, decode: Decoder.Text}
reducer go on=ui.click(B) do= emit toast({kind: "info", text: "hi"})
tile B = button(text="b", onClick=go)
app A caps=[http.get] routes={"/" -> B, "/404" -> B} init=[]
`;
    expect(diagnostics(src).map((d) => d.slice(0, 5))).toEqual(["E0234", "E0202"]);
  });
});

describe("what the reservation leaves alone", () => {
  it.each([
    "load",
    "logger",
    "toasts",
    "navigate2",
    "confirmDelete",
    "scroll",
  ])("an effect named %s is the program's own", (name) => {
    expect(diagnostics(declaring(name))).toEqual([]);
  });

  it.each([
    ["navigate", `emit navigate({path: "/", params: {}, query: {}})`, "nav.push"],
    ["navigate-replace", `emit navigate-replace({path: "/"})`, "nav.replace"],
    ["navigate-back", `emit navigate-back()`, "nav.back"],
    ["scroll-to", `emit scroll-to({x: 0, y: 0})`, ""],
    ["toast", `emit toast({kind: "info", text: "hi"})`, "notification.show"],
    ["confirm", `emit confirm({title: "t", onYes: go, onNo: go})`, "notification.show"],
    ["log", `emit log({level: "info", message: "m", data: {}})`, "log.write"],
  ])("emitting %s with no declaration", (_, emit, cap) => {
    const src = `reducer go on=ui.click(B) do= ${emit}
tile B = button(text="b", onClick=go)
app A caps=[${cap}] routes={"/" -> B, "/404" -> B} init=[]
`;
    expect(diagnostics(src)).toEqual([]);
  });

  it("a reducer named log is in the reducer namespace", () => {
    const src = `slot n : Int = 0
reducer log on=ui.click(B) do= n := n + 1
reducer go  on=ui.click(C) do= emit log({level: "info", message: "m", data: {}})
tile B = button(text="b", onClick=log)
tile C = button(text="c", onClick=go)
tile H = column(B, C)
app A caps=[log.write] routes={"/" -> H, "/404" -> H} init=[]
`;
    expect(diagnostics(src)).toEqual([]);
  });

  it("a fn named log is in the fn namespace", () => {
    const src = `slot n : Int = 0
fn log(x: Int) -> Int = x + 1
reducer go on=ui.click(B) do= n := log(n)
                              emit log({level: "info", message: "m", data: {}})
tile B = button(text="b", onClick=go)
app A caps=[log.write] routes={"/" -> B, "/404" -> B} init=[]
`;
    expect(diagnostics(src)).toEqual([]);
  });

  it("a slot named toast is in the slot namespace", () => {
    const src = `slot toast : Text = "x"
reducer go on=ui.click(B) do= emit toast({kind: "info", text: toast})
tile B = button(text=toast, onClick=go)
app A caps=[notification.show] routes={"/" -> B, "/404" -> B} init=[]
`;
    expect(diagnostics(src)).toEqual([]);
  });
});
