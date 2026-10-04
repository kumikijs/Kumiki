// A value `storage.write` / `session.write` stores reads back through
// `storage.read` / `session.read` as the value it was (http.md §6.7.2 /
// §6.7.4), a `Bytes` and a non-finite `Float` included, and a value JSON does
// hold is still stored as its plain JSON text. These run the real handlers
// against the real Web Storage — no provider, no scripted effect results.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppShape, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clickByText } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "187-stored-bytes-and-infinity.kumiki");

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Mount `app` and, for each step, click the button and wait until the page
 * shows `until`. Returns the page's text after the last step.
 */
async function run(app: AppShape, steps: [button: string, until: string][]): Promise<string> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  let dispose: (() => void) | undefined;
  try {
    ({ dispose } = mount(app, root));
    for (const [button, until] of steps) {
      clickByText(root, button);
      const deadline = Date.now() + 2000;
      while (!(root.textContent ?? "").includes(until)) {
        if (Date.now() > deadline) {
          throw new Error(`after "${button}": wanted "${until}", page shows "${root.textContent}"`);
        }
        await tick();
      }
    }
    return root.textContent ?? "";
  } finally {
    dispose?.();
    root.remove();
  }
}

const SAVE_THEN_LOAD: [string, string][] = [
  ["Save", "shown: saved"],
  ["Load", "shown: same="],
];

const READ_BACK = "shown: same=true data=104,105 ratio=Infinity";
const STORED = '~{"data":{"$bytes":"aGk="},"ratio":{"$float":"Infinity"}}';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

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
    expect(page).toContain("shown: xs=NaN,-Infinity,2.5 m=0,255 o=Infinity");
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
