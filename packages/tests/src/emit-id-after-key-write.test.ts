import { feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { clickContaining, mountApp, tick } from "./helpers/dom.ts";
import { type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("116-emit-id-after-key-write");

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

/** Click `start`, see one pending request to `url`, click `cancel`, and see it aborted with `shown` on the page. */
async function startThenCancel(
  app: AppShape,
  start: string,
  cancel: string,
  url: string,
  shown: string,
): Promise<void> {
  double = stubFetch((call) => pendingUntilAborted(call.init.signal));
  const { root, handle } = mountApp(app);
  try {
    clickContaining(root, start);
    await tick(30);
    expect(double.calls.map((c) => c.url)).toEqual([url]);
    expect(double.calls[0]?.init.signal?.aborted).toBe(false);

    clickContaining(root, cancel);
    await tick(30);
    expect(double.calls[0]?.init.signal?.aborted).toBe(true);
    expect(root.textContent).toContain(shown);
  } finally {
    handle.dispose();
    root.remove();
  }
}

describe("the EffectId an emit yields after its reducer wrote the key slot", () => {
  it("cancels the request the dispatcher registered", async () => {
    await startThenCancel(await loadApp(EXAMPLE), "Open b", "Cancel", "/api/notes/b", "cancelled");
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
  it.each([
    ["no policy", "", [EMIT]],
    ["latest", "policy=latest", [EMIT]],
    ["queue", "policy=queue", [EMIT]],
    ["once", "policy=once", [EMIT]],
    ["throttle", "policy=throttle(1000ms)", [EMIT]],
    ["debounce", "policy=debounce(5ms)", [EMIT]],
    ["latest-per-key on the input", "policy=latest-per-key($1)", [EMIT]],
    ["a record key", "policy=latest-per-key({k: $1, at: noteKey})", [EMIT]],
    ["a List key", "policy=latest-per-key([$1, noteKey])", [EMIT]],
    ["an Option key", "policy=latest-per-key(Some($1))", [EMIT]],
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
    await startThenCancel(
      await loadSource(cancelApp(policy, body)),
      "Go",
      "Stop",
      "/api/x",
      "aborted",
    );
  });
});
