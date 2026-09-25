// `lastId := emit load(x)` yields the id `emit cancel(id)` is later given, and
// the dispatcher registers the in-flight request under an id of its own. When
// the two differ, the cancel names nothing in flight and aborts nothing,
// silently. What is pinned here is the whole round trip through the real
// dispatcher and a `fetch` double: the request is left pending, the id the
// reducer kept is handed back, and the request that id names is the one that is
// aborted. Nothing in this file restates how either side builds its id.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { clickByText, type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "116-emit-id-after-key-write.kumiki");

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A response that never arrives, and fails the way `fetch` does when its signal is aborted. */
function pendingUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError")),
    );
  });
}

let double: FetchDouble | undefined;

afterEach(() => {
  double?.restore();
  double = undefined;
});

describe("the EffectId an emit yields after its reducer wrote the key slot", () => {
  it("cancels the request the dispatcher registered", async () => {
    const app = await loadApp(EXAMPLE);
    double = stubFetch((call) => pendingUntilAborted(call.init.signal));
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);

      clickByText(root, "Open b");
      await tick();
      expect(double.calls.map((c) => c.url)).toEqual(["/api/notes/b"]);
      expect(double.calls[0]?.init.signal?.aborted).toBe(false);

      clickByText(root, "Cancel");
      await tick();
      expect(double.calls[0]?.init.signal?.aborted).toBe(true);
      expect(root.textContent).toContain("cancelled");

      dispose();
    } finally {
      root.remove();
    }
  });
});

/** One `load` effect under `policy`, a `Go` reducer running `body`, and a `Stop` that cancels `lastId`. */
function cancelApp(policy: string, body: string[]): string {
  const [first, ...rest] = body;
  return `slot noteKey : Text     = "a"
slot lastId  : EffectId = EffectId.none
slot status  : Text     = "idle"
effect load cap=http.get in=Text out=Result(Text, HttpError)
            ${policy}
            map-request={url: "/api/" + $1, decode: Decoder.Text}
effect cancelLoad cap=http.cancel in=EffectId out=Unit
reducer go    on=ui.click(GoBtn)   do= ${first}
${rest.map((s) => `                                         ${s}`).join("\n")}
reducer stop  on=ui.click(StopBtn) do= emit cancelLoad(lastId)
reducer onErr on=load.err($err, _) do= status := $err.message
tile GoBtn   = button(text="Go", onClick=go)
tile StopBtn = button(text="Stop", onClick=stop)
tile App = column(GoBtn, StopBtn, text(status))
app M caps=[http.get, http.cancel] routes={"/" -> App, "/404" -> App} init=[]`;
}

const EMIT = `lastId := emit load("x")`;

describe("`emit cancel(id)` aborts the request `id := emit …` started", () => {
  // Every policy builds an id, and every way of reaching an emit expression
  // from a reducer body must build the one the dispatcher runs the request
  // under. A debounce is short enough that the request is in flight by the
  // time `Stop` is pressed.
  it.each([
    ["no policy", "", [EMIT]],
    ["latest", "policy=latest", [EMIT]],
    ["queue", "policy=queue", [EMIT]],
    ["once", "policy=once", [EMIT]],
    ["throttle", "policy=throttle(1000ms)", [EMIT]],
    ["debounce", "policy=debounce(5ms)", [EMIT]],
    ["latest-per-key on the input", "policy=latest-per-key($1)", [EMIT]],
    ["a key slot the reducer does not write", "policy=latest-per-key(noteKey)", [EMIT]],
    [
      "a key reading the input and a slot written before the emit",
      "policy=latest-per-key($1 + noteKey)",
      [`noteKey := "b"`, EMIT],
    ],
    [
      "a key slot written after the emit",
      "policy=latest-per-key(noteKey)",
      [EMIT, `noteKey := "b"`],
    ],
    [
      "an emit under `let … in`, after a key write",
      "policy=latest-per-key(noteKey)",
      [`noteKey := "b"`, `lastId := let k = "x" in emit load(k)`],
    ],
    [
      "an emit in a binding `match` arm, after a key write",
      "policy=latest-per-key(noteKey)",
      [`noteKey := "b"`, `lastId := match ("x", 1) with | (s, _) -> emit load(s)`],
    ],
  ])("%s", { timeout: 30_000 }, async (_label, policy, body) => {
    const app = await loadSource(cancelApp(policy, body));
    double = stubFetch((call) => pendingUntilAborted(call.init.signal));
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);

      clickByText(root, "Go");
      await tick();
      expect(double.calls.map((c) => c.url)).toEqual(["/api/x"]);
      expect(double.calls[0]?.init.signal?.aborted).toBe(false);

      clickByText(root, "Stop");
      await tick();
      expect(double.calls[0]?.init.signal?.aborted).toBe(true);
      expect(root.textContent).toContain("aborted");

      dispose();
    } finally {
      root.remove();
    }
  });
});
