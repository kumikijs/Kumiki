// `storage.write` / `session.write` carry three declarations (http.md §6.7.2 /
// §6.7.4), told apart by the request: a write (`{key, value}`), a remove
// (`{key}`) and a clear (an effect declared `in=Unit` with no `map-request`).
// These run the real handlers against the real Web Storage — no provider, no
// mock — and read what the storage holds after each step, so a remove that
// cleared everything, or a bad request that cleared anything, shows up.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppShape, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clickByText } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "130-storage-remove-clear.kumiki");

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

function snapshot(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k !== null) out[k] = storage.getItem(k) ?? "";
  }
  return out;
}

/**
 * Mount `app` and, for each step, click the button and wait until the page
 * shows `until`. Returns what `storage` holds after each step.
 */
async function run(
  app: AppShape,
  storage: Storage,
  steps: [button: string, until: string][],
): Promise<Record<string, string>[]> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const after: Record<string, string>[] = [];
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
      after.push(snapshot(storage));
    }
  } finally {
    dispose?.();
    root.remove();
  }
  return after;
}

/** A one-button program whose effect `e` reports `shown: ok` or `shown: err`. */
function oneEffect(decls: string, emit: string, cap = "storage.write"): string {
  return `${decls}
slot shown : Text = "idle"

reducer go on=ui.click(Go) do= emit ${emit}
reducer ok on=e.ok(_, _) do= shown := "ok"
reducer bad on=e.err(_, _) do= shown := "err"

tile Go = button(text="Go")
tile App = column(Go, text("shown: " + shown))

app W
    caps = [${cap}]
    routes = {"/" -> App, "/404" -> App}
    init = []
`;
}

/** The example's program over `session.*`, with its remove written without `map-request`. */
const SESSION = `slot shown : Text = "idle"

effect save cap=session.write in=Text out=Result(Unit, Text) map-request={key: "note", value: $1}
effect forget cap=session.write in={key: Text} out=Result(Unit, Text)
effect wipe cap=session.write in=Unit out=Result(Unit, Text)

reducer goSave on=ui.click(SaveBtn) do= emit save("hello")
reducer goForget on=ui.click(ForgetBtn) do= emit forget({key: "note"})
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

  it("removes only its key, so the next read answers None (example 130)", async () => {
    const app = await loadApp(EXAMPLE);
    localStorage.setItem("other", "1");
    const [afterSave, afterForget] = await run(app, localStorage, [
      ["Save", "shown: saved"],
      ["Forget", "shown: forgotten"],
      ["Load", "shown: loaded <none>"],
    ]);
    expect(afterSave).toEqual({ other: "1", note: '"hello"' });
    expect(afterForget).toEqual({ other: "1" });
  });

  it("clears every key and reports ok (example 130)", async () => {
    const app = await loadApp(EXAMPLE);
    localStorage.setItem("other", "1");
    const [, afterWipe] = await run(app, localStorage, [
      ["Save", "shown: saved"],
      ["Wipe", "shown: wiped"],
    ]);
    expect(afterWipe).toEqual({});
  });

  it("removes only its key through map-request={key: $1} on storage.write", async () => {
    const app = await loadSource(
      oneEffect(
        `effect e cap=storage.write in=Text out=Result(Unit, Text) map-request={key: $1}`,
        `e("note")`,
      ),
    );
    localStorage.setItem("note", '"hello"');
    localStorage.setItem("other", "1");
    const [after] = await run(app, localStorage, [["Go", "shown: ok"]]);
    expect(after).toEqual({ other: "1" });
  });

  it("does the same against sessionStorage, with a remove written without map-request", async () => {
    const app = await loadSource(SESSION);
    sessionStorage.setItem("other", "1");
    const [afterSave, afterForget, afterWipe] = await run(app, sessionStorage, [
      ["Save", "shown: saved"],
      ["Forget", "shown: forgotten"],
      ["Wipe", "shown: wiped"],
    ]);
    expect(afterSave).toEqual({ other: "1", note: '"hello"' });
    expect(afterForget).toEqual({ other: "1" });
    expect(afterWipe).toEqual({});
  });

  it("does not mistake a write of None, an empty list or a record for a remove", async () => {
    const app = await loadSource(`slot shown : Text = "idle"

effect w1 cap=storage.write in=Option(Text) out=Result(Unit, Text) map-request={key: "a", value: $1}
effect w2 cap=storage.write in=List(Int) out=Result(Unit, Text) map-request={key: "b", value: $1}
effect w3 cap=storage.write in={key: Text, value: {n: Int}} out=Result(Unit, Text)

reducer go on=ui.click(Go) do= emit w1(None)
                               emit w2([])
                               emit w3({key: "c", value: {n: 1}})
reducer done on=w3.ok(_, _) do= shown := "done"

tile Go = button(text="Go")
tile App = column(Go, text(shown))

app W
    caps = [storage.write]
    routes = {"/" -> App, "/404" -> App}
    init = []
`);
    const [stored] = await run(app, localStorage, [["Go", "done"]]);
    expect(stored).toEqual({ a: '{"_tag":"None"}', b: "[]", c: '{"n":1}' });
  });
});

describe("a storage.write request that is none of the three shapes is an err, not a wipe", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("other", "1");
    localStorage.setItem("undefined", "kept");
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("a Map lookup that finds nothing leaves the storage alone and fires .err", async () => {
    const app = await loadSource(
      oneEffect(
        `type Ref = {key: Text}
slot refs : Map(Text, Ref) = {}
effect e cap=storage.write in=Option(Ref) out=Result(Unit, Text)`,
        `e(refs.get("nope"))`,
      ),
    );
    const [after] = await run(app, localStorage, [["Go", "shown: err"]]);
    expect(after).toEqual({ other: "1", undefined: "kept" });
  });

  // The request is the effect's input: a `map-request` that writes `k` is
  // E0215 (http.md §6.6.1), so it never reaches the handler.
  it("a remove whose key is missing removes nothing and fires .err", async () => {
    const app = await loadSource(
      oneEffect(
        `effect e cap=storage.write in={k: Text} out=Result(Unit, Text)`,
        `e({k: "other"})`,
      ),
    );
    const [after] = await run(app, localStorage, [["Go", "shown: err"]]);
    expect(after).toEqual({ other: "1", undefined: "kept" });
  });

  it("a write whose value is missing stores nothing and fires .err", async () => {
    const app = await loadSource(
      oneEffect(
        `slot texts : Map(Text, Text) = {}
effect e cap=storage.write in=Unit out=Result(Unit, Text) map-request={key: "t", value: texts["nope"]}`,
        `e()`,
      ),
    );
    const [after] = await run(app, localStorage, [["Go", "shown: err"]]);
    expect(after).toEqual({ other: "1", undefined: "kept" });
  });
});
