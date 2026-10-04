// A request cancelled while it waits out a `retry=` backoff — by a newer emit
// under `policy=latest`, or by `http.cancel` — stops there (http.md §6.5): the
// wait ends at once, its `.err` fires with `aborted` before anything that was
// emitted after it can answer, and it makes no further attempt. Driven through
// the real dispatcher and `httpFetch`, against a `fetch` double that answers
// 503 to the first call and 200 to every later one, and that rejects a call
// whose signal is already aborted, as `fetch` does.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppShape, type CapabilityProvider, mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { type FetchCall, type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "..", "examples");
// The retry app as it ships: `policy=latest` and
// `retry=exponential(3, 200ms, 2.0)`.
const RETRY_APP = join(examples, "apps", "08-http-retry", "app.kumiki");
// `policy=latest`, `retry=linear(2, 500ms)`, a Stop button that cancels through
// `http.cancel`, and a `log` both result reducers append to.
const EXAMPLE = join(examples, "features", "192-retry-backoff-cancel.kumiki");

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll until `done` holds or `limitMs` passes; the assertions that follow say which. */
async function until(done: () => boolean, limitMs = 3000): Promise<void> {
  const deadline = Date.now() + limitMs;
  while (!done() && Date.now() < deadline) await tick(5);
}

const abortError = (): DOMException => new DOMException("The operation was aborted.", "AbortError");

/**
 * 503 to the first call, 200 with `{text: "Fresh quote", author: "B"}` to every
 * later one, `latencyMs` after it is made. A call whose signal is aborted —
 * when it is made, or while it waits — rejects the way `fetch` does.
 */
function quoteServer(latencyMs: number): (call: FetchCall) => Promise<Response> {
  let n = 0;
  return (call) => {
    n++;
    const first = n === 1;
    const signal = call.init.signal;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const h = setTimeout(() => {
        resolve(
          first
            ? new Response("busy", { status: 503, statusText: "Service Unavailable" })
            : new Response(JSON.stringify({ text: "Fresh quote", author: "B" }), { status: 200 }),
        );
      }, latencyMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(h);
        reject(abortError());
      });
    });
  };
}

let double: FetchDouble | undefined;
let root: HTMLElement | undefined;
let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  double?.restore();
  dispose = undefined;
  root = undefined;
  double = undefined;
});

/** Mount `app` against {@link quoteServer}, with `providers` for any capability `fetch` does not serve. */
function mountApp(
  app: AppShape,
  latencyMs: number,
  providers?: Record<string, CapabilityProvider>,
): HTMLElement {
  double = stubFetch(quoteServer(latencyMs));
  const r = document.createElement("div");
  root = r;
  document.body.appendChild(r);
  dispose = mount(app, r, providers ? { providers } : {}).dispose;
  return r;
}

function click(r: HTMLElement, selector: string): void {
  const el = r.querySelector(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function clickText(r: HTMLElement, text: string): void {
  const btn = Array.from(r.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(text),
  );
  if (!btn) throw new Error(`button "${text}" not found`);
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

const calls = (): number => double?.calls.length ?? 0;
/** The `log: …` text, which every app here renders last. */
const logOf = (r: HTMLElement): string => /log: (\S*)$/.exec(r.textContent ?? "")?.[1] ?? "";

// First, so that what it measures is its own request's wait: a cancelled
// request that went on sleeping would wake during a later test and call
// whichever `fetch` double is installed by then.
describe("a request that is not cancelled", () => {
  it("waits out its backoff in full before the next attempt", async () => {
    const r = mountApp(await loadApp(EXAMPLE), 0);
    click(r, "#load");
    await tick(300);
    expect(calls()).toBe(1);
    expect(logOf(r)).toBe("");

    await until(() => logOf(r) !== "");
    expect(calls()).toBe(2);
    expect(logOf(r)).toBe("ok;");
    expect(r.textContent).toContain("quote: Fresh quote");
  });
});

describe("a request superseded by `policy=latest` during its retry backoff", () => {
  it("leaves the newer request's quote on the page, and fetch is called twice", async () => {
    const r = mountApp(await loadApp(RETRY_APP), 0);
    clickText(r, "Load quote");
    await tick(50);
    // The 503 has arrived and the 200ms wait has begun.
    expect(calls()).toBe(1);
    clickText(r, "Load quote");
    // Well past where the superseded request's wait would have ended.
    await tick(800);
    expect(r.textContent).toContain("Fresh quote");
    expect(r.textContent).toContain("— B");
    expect(r.textContent).not.toContain("request failed");
    expect(calls()).toBe(2);
  });

  it("delivers its aborted .err at once, before the newer request answers", async () => {
    const r = mountApp(await loadApp(EXAMPLE), 30);
    click(r, "#load");
    // The 503 arrives after 30ms, and the 500ms wait begins.
    await tick(60);
    expect(calls()).toBe(1);
    expect(logOf(r)).toBe("");

    click(r, "#load");
    // One macrotask: the superseded request's `.err` has fired; the newer
    // request is still 30ms from its answer.
    await tick();
    expect(logOf(r)).toBe("aborted;");
    expect(calls()).toBe(2);

    await until(() => logOf(r) !== "aborted;");
    expect(logOf(r)).toBe("aborted;ok;");
    expect(r.textContent).toContain("quote: Fresh quote");

    // Past where the first request's 500ms wait would have ended.
    await tick(600);
    expect(logOf(r)).toBe("aborted;ok;");
    expect(calls()).toBe(2);
  });
});

describe("a request cancelled by `http.cancel` during its retry backoff", () => {
  it("delivers its aborted .err at once and makes no further attempt", async () => {
    const r = mountApp(await loadApp(EXAMPLE), 0);
    click(r, "#load");
    await tick(60);
    expect(calls()).toBe(1);
    expect(logOf(r)).toBe("");

    click(r, "#stop");
    await tick();
    expect(logOf(r)).toBe("aborted;");

    await tick(600);
    expect(logOf(r)).toBe("aborted;");
    expect(calls()).toBe(1);
  });
});

describe("a `policy=queue` chain whose running request is cancelled during its backoff", () => {
  it("starts the next request at once", async () => {
    const app = await loadSource(`type Quote = {text: Text, author: Text}
slot lastId : EffectId = EffectId.none
slot log    : Text     = ""
effect load cap=http.get in=Unit out=Result(Quote, HttpError)
            policy=queue
            retry=linear(2, 500ms)
            map-request={url: "/quote", decode: Decoder.Json(Quote)}
effect cancelLoad cap=http.cancel in=EffectId out=Unit
reducer go    on=ui.click(GoBtn)   do= lastId := emit load()
reducer stop  on=ui.click(StopBtn) do= emit cancelLoad(lastId)
reducer onOk  on=load.ok($q, _)    do= log := log + $q.author + ";"
reducer onErr on=load.err($e, _)   do= log := log + $e.message + ";"
tile GoBtn   = button(text="Go", onClick=go)
tile StopBtn = button(text="Stop", onClick=stop)
tile App = column(GoBtn, StopBtn, text("log: " + log))
app M caps=[http.get, http.cancel] routes={"/" -> App, "/404" -> App} init=[]`);
    const r = mountApp(app, 0);

    clickText(r, "Go");
    await tick(60);
    expect(calls()).toBe(1);

    clickText(r, "Stop");
    clickText(r, "Go");
    // The second request does not wait for the rest of the first one's 500ms.
    await tick(60);
    expect(calls()).toBe(2);
    expect(logOf(r)).toBe("aborted;B;");
  });
});

describe("an effect that fails with `Text`, cancelled during its retry backoff", () => {
  it("delivers `aborted` as the `Text` its `.err` declares", async () => {
    const app = await loadSource(`slot log : Text = ""
effect load cap=storage.read in=Unit out=Result(Option(Text), Text)
            policy=latest
            retry=linear(2, 500ms)
            map-request={key: "note", decode: Decoder.Json(Text)}
reducer go    on=ui.click(GoBtn) do= emit load()
reducer onErr on=load.err($e, _) do= log := log + $e + ";"
tile GoBtn = button(text="Go", onClick=go)
tile App = column(GoBtn, text("log: " + log))
app M caps=[storage.read] routes={"/" -> App, "/404" -> App} init=[]`);
    let reads = 0;
    // An err with no status, which the retry policy retries.
    const r = mountApp(app, 0, {
      "storage.read": () => {
        reads++;
        return { kind: "err", value: "blocked" };
      },
    });

    clickText(r, "Go");
    await tick(60);
    expect(reads).toBe(1);
    expect(logOf(r)).toBe("");

    clickText(r, "Go");
    await tick();
    expect(logOf(r)).toBe("aborted;");
    expect(reads).toBe(2);
  });
});
