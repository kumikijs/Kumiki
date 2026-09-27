// `storage.write` / `session.write` carry three declarations (http.md §6.7.2 /
// §6.7.4): a write (`{key, value}`), a remove (`{key}`) and a clear (`Unit`).
// The handler only knew `setItem`, so a remove stored the string "undefined"
// and reported ok, and a clear threw destructuring its `Unit` input. These run
// the real handlers against the real Web Storage — no provider, no mock.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppShape, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clickByText } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "130-storage-remove-clear.kumiki");

const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

function snapshot(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k !== null) out[k] = storage.getItem(k) ?? "";
  }
  return out;
}

/** Mount `app`, then click each button in turn, returning the text after each. */
async function clicks(app: AppShape, buttons: string[]): Promise<string[]> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const seen: string[] = [];
  try {
    const { dispose } = mount(app, root);
    for (const b of buttons) {
      clickByText(root, b);
      await tick();
      seen.push(root.textContent ?? "");
    }
    dispose();
  } finally {
    root.remove();
  }
  return seen;
}

/** The example's program over `session.*` instead of `storage.*`. */
const SESSION = `slot shown : Text = "idle"

effect save cap=session.write in=Text out=Result(Unit, Text) map-request={key: "note", value: $1}
effect forget cap=session.write in=Text out=Result(Unit, Text) map-request={key: $1}
effect wipe cap=session.write in=Unit out=Result(Unit, Text)

reducer goSave on=ui.click(SaveBtn) do= emit save("hello")
reducer goForget on=ui.click(ForgetBtn) do= emit forget("note")
reducer goWipe on=ui.click(WipeBtn) do= emit wipe()
reducer saved on=save.ok(_, _) do= shown := "saved"
reducer forgotten on=forget.ok(_, _) do= shown := "forgotten"
reducer wiped on=wipe.ok(_, _) do= shown := "wiped"

tile SaveBtn = button(text="Save")
tile ForgetBtn = button(text="Forget")
tile WipeBtn = button(text="Wipe")
tile App = column(SaveBtn, ForgetBtn, WipeBtn, text("shown: " + shown))

app S
    caps = [session.write]
    routes = {"/" -> App, "/404" -> App}
    init = []
`;

describe("storage.write / session.write: write, remove and clear", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("removes the key, so the next read answers None (example 130)", async () => {
    const [afterSave, afterForget, afterLoad] = await clicks(await loadApp(EXAMPLE), [
      "Save",
      "Forget",
      "Load",
    ]);
    expect(afterSave).toContain("shown: saved");
    expect(afterForget).toContain("shown: forgotten");
    expect(snapshot(localStorage)).toEqual({});
    expect(afterLoad).toContain("shown: loaded <none>");
  });

  it("clears every key and reports ok (example 130)", async () => {
    const app = await loadApp(EXAMPLE);
    localStorage.setItem("other", "1");
    const [, afterWipe] = await clicks(app, ["Save", "Wipe"]);
    expect(afterWipe).toContain("shown: wiped");
    expect(snapshot(localStorage)).toEqual({});
  });

  it("does the same against sessionStorage, including a remove written with map-request", async () => {
    const app = await loadSource(SESSION);
    sessionStorage.setItem("other", "1");
    const [, afterForget, afterWipe] = await clicks(app, ["Save", "Forget", "Wipe"]);
    expect(afterForget).toContain("shown: forgotten");
    expect(afterWipe).toContain("shown: wiped");
    expect(snapshot(sessionStorage)).toEqual({});
  });

  it("does not take a value that is None, an empty list or a record for a remove", async () => {
    const app = await loadSource(`slot shown : Text = "idle"

effect w1 cap=storage.write in=Option(Text) out=Result(Unit, Text) map-request={key: "a", value: $1}
effect w2 cap=storage.write in=List(Int) out=Result(Unit, Text) map-request={key: "b", value: $1}
effect w3 cap=storage.write in={key: Text, value: {n: Int}} out=Result(Unit, Text)

reducer go on=ui.click(Go) do= emit w1(None)
                               emit w2([])
                               emit w3({key: "c", value: {n: 1}})

tile Go = button(text="Go")
tile App = column(Go, text(shown))

app W
    caps = [storage.write]
    routes = {"/" -> App, "/404" -> App}
    init = []
`);
    await clicks(app, ["Go"]);
    const stored = snapshot(localStorage);
    expect(Object.keys(stored).sort()).toEqual(["a", "b", "c"]);
    expect(stored.a).not.toBe("undefined");
    expect(JSON.parse(stored.b ?? "")).toEqual([]);
    expect(JSON.parse(stored.c ?? "")).toEqual({ n: 1 });
  });
});
