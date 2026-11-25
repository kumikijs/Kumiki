import { readFileSync } from "node:fs";
import { feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { clickThrough } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("187-stored-bytes-and-infinity");

/** Click through `steps` on `app`, and return the page's text after the last one. */
async function run(app: AppShape, steps: [button: string, until: string][]): Promise<string> {
  const pages = await clickThrough(app, steps, (root) => root.textContent ?? "");
  return pages.at(-1) ?? "";
}

const SAVE_THEN_LOAD: [string, string][] = [
  ["Save", "shown: saved"],
  ["Load", "shown: same="],
];

const READ_BACK = "shown: same=true data=aGk= ratio=Infinity";
const STORED = '~{"data":{"$bytes":"aGk="},"ratio":{"$float":"Infinity"}}';

describe("a Bytes and a non-finite Float survive a write then a read", () => {
  it("through storage.* (example 187)", async () => {
    const page = await run(await loadApp(EXAMPLE), SAVE_THEN_LOAD);
    expect(page).toContain(READ_BACK);
    expect(localStorage.getItem("blob")).toBe(STORED);
  });

  it("through session.*, the same program over sessionStorage", async () => {
    const source = readFileSync(EXAMPLE, "utf8").replaceAll("storage.", "session.");
    const page = await run(await loadSource(source), SAVE_THEN_LOAD);
    expect(page).toContain(READ_BACK);
    expect(sessionStorage.getItem("blob")).toBe(STORED);
    expect(localStorage.length).toBe(0);
  });

  it("NaN, -Infinity and a Bytes deep in a List, a Map and an Option", async () => {
    const app =
      await loadSource(`type Deep = {xs: List(Float), m: Map(Text, Bytes), o: Option(Float)}
slot sent  : Deep = {xs: [0.0 / 0.0, -1.0 / 0.0, 2.5], m: {"k": Bytes.from-bytes([0, 255])}, o: Some(1.0 / 0.0)}
slot shown : Text = "idle"

effect save cap=storage.write in=Deep out=Result(Unit, Text) map-request={key: "deep", value: $1}
effect load cap=storage.read in=Unit out=Result(Option(Deep), Text) map-request={key: "deep", decode: Decoder.Json(Deep)}

reducer goSave on=ui.click(SaveBtn) do= emit save(sent)
reducer goLoad on=ui.click(LoadBtn) do= emit load()
reducer saved on=save.ok(_, _) do= shown := "saved"
reducer loaded on=load.ok($o, _) do=
    match $o with
      | Some(d) -> shown := "xs=" + d.xs.map($1.show).join(",") + " m=" + d.m.get-or("k", Bytes.from-text("")).show + " o=" + d.o.get-or(0.0).show
      | None -> shown := "nothing stored"

tile SaveBtn = button(text="Save")
tile LoadBtn = button(text="Load")
tile App = column(SaveBtn, LoadBtn, text("shown: " + shown))

app D
    caps = [storage.read, storage.write]
    routes = {"/" -> App, "/404" -> App}
    init = []
`);
    const page = await run(app, [
      ["Save", "shown: saved"],
      ["Load", "shown: xs="],
    ]);
    expect(page).toContain("shown: xs=NaN,-Infinity,2.5 m=AP8= o=Infinity");
  });
});

describe("a value JSON holds keeps its plain JSON text", () => {
  it("is stored as JSON, and a Map key that starts with $ reads back as that key", async () => {
    const app = await loadSource(`slot sent  : Map(Text, Text) = {"$bytes": "aGk="}
slot shown : Text = "idle"

effect save cap=storage.write in=Map(Text, Text) out=Result(Unit, Text) map-request={key: "m", value: $1}
effect load cap=storage.read in=Unit out=Result(Option(Map(Text, Text)), Text) map-request={key: "m", decode: Decoder.Json(Map(Text, Text))}

reducer goSave on=ui.click(SaveBtn) do= emit save(sent)
reducer goLoad on=ui.click(LoadBtn) do= emit load()
reducer saved on=save.ok(_, _) do= shown := "saved"
reducer loaded on=load.ok($o, _) do=
    match $o with
      | Some(m) -> shown := "same=" + (m == sent).show + " bytes=" + m.get-or("$bytes", "?")
      | None -> shown := "nothing stored"

tile SaveBtn = button(text="Save")
tile LoadBtn = button(text="Load")
tile App = column(SaveBtn, LoadBtn, text("shown: " + shown))

app M
    caps = [storage.read, storage.write]
    routes = {"/" -> App, "/404" -> App}
    init = []
`);
    const page = await run(app, SAVE_THEN_LOAD);
    expect(localStorage.getItem("m")).toBe('{"$bytes":"aGk="}');
    expect(page).toContain("shown: same=true bytes=aGk=");
  });
});

/** A program that stores `value`, a `type`, and reads it back with `Decoder.Json(type)`. */
const roundTrip = (types: string, type: string, value: string): string => `${types}
slot sent  : ${type} = ${value}
slot shown : Text = "idle"

effect save cap=storage.write in=${type} out=Result(Unit, Text) map-request={key: "rt", value: $1}
effect load cap=storage.read in=Unit out=Result(Option(${type}), Text) map-request={key: "rt", decode: Decoder.Json(${type})}

reducer goSave on=ui.click(SaveBtn) do= emit save(sent)
reducer goLoad on=ui.click(LoadBtn) do= emit load()
reducer saved on=save.ok(_, _) do= shown := "saved"
reducer loaded on=load.ok($o, _) do=
    match $o with
      | Some(v) -> shown := "got " + v.show
      | None -> shown := "got nothing"
reducer failed on=load.err($e, _) do= shown := "got err " + $e

tile SaveBtn = button(text="Save")
tile LoadBtn = button(text="Load")
tile App = column(SaveBtn, LoadBtn, text("sent: " + sent.show), text("shown: " + shown))

app R
    caps = [storage.read, storage.write]
    routes = {"/" -> App, "/404" -> App}
    init = []
`;

// What a program stores, it reads back: `Decoder.Json(T)` checks the form `storage-write` writes.
describe("a value storage-write stored is a T to Decoder.Json(T)", () => {
  it.each([
    { what: "a Set", type: "Set(Int)", value: "[3, 1, 2]" },
    { what: "a Map with Int keys", type: "Map(Int, Text)", value: '{1: "a", -2: "b"}' },
    { what: "a Map with tuple keys", type: "Map(Tuple(Int, Int), Text)", value: '{(1, 2): "x"}' },
    { what: "a Set of records", type: "Set({n: Int, s: Text})", value: '[{n: 1, s: "a"}]' },
    { what: "a Unit field", type: "{u: Unit}", value: "{u: ()}" },
    { what: "a Set of Unit", type: "Set(Unit)", value: "[()]" },
    {
      what: "a user union",
      types: "type Shape = Circle(Float) | Square(Float, Float) | Dot",
      type: "List(Shape)",
      value: "[Square(1.0, 2.0), Dot, Circle(0.5)]",
    },
    { what: "an Option(Time)", type: "Option(Time)", value: 'Time.parse("2026-03-07T10:00:00Z")' },
    // `(-1.0).sqrt.floor` is an `Int` that is `NaN`.
    { what: "an Int that is NaN", type: "{n: Int}", value: "{n: (-1.0).sqrt.floor}" },
    { what: "a Set of Ints holding NaN", type: "Set(Int)", value: "[(-1.0).sqrt.floor, 1]" },
  ])("reads back $what", async ({ types = "", type, value }) => {
    const page = await run(await loadSource(roundTrip(types, type, value)), [
      ["Save", "shown: saved"],
      ["Load", "shown: got"],
    ]);
    const sent = /sent: (.*)shown:/.exec(page)?.[1];
    expect(sent).toBeTruthy();
    expect(page).toContain(`shown: got ${sent}`);
  });
});
