import { app, feature } from "@kumikijs/examples";
import { type AppShape, type CapabilityProvider, mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { clickContaining, freshRoot, tick } from "./helpers/dom.ts";
import { type FetchCall, type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const RETRY_APP = app("08-http-retry");
const EXAMPLE = feature("192-retry-backoff-cancel");

async function until(done: () => boolean, limitMs = 3000): Promise<void> {
  const deadline = Date.now() + limitMs;
  while (!done() && Date.now() < deadline) await tick(5);
}

const abortError = (): DOMException => new DOMException("The operation was aborted.", "AbortError");

/**
 * 503 to the first call, 200 with `{text: "Fresh quote", author: "B"}` to every later one,
 * `latencyMs` after it is made. A call whose signal is aborted rejects the way `fetch` does.
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

function mountAgainst(
  shape: AppShape,
  latencyMs: number,
  providers?: Record<string, CapabilityProvider>,
): HTMLElement {
  double = stubFetch(quoteServer(latencyMs));
  const r = freshRoot();
  root = r;
  dispose = mount(shape, r, providers ? { providers } : {}).dispose;
  return r;
}

function click(r: HTMLElement, selector: string): void {
  const el = r.querySelector(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

const calls = (): number => double?.calls.length ?? 0;
const logOf = (r: HTMLElement): string => /log: (\S*)$/.exec(r.textContent ?? "")?.[1] ?? "";

// First, so that what it measures is its own request's wait: a cancelled request that went on
// sleeping would wake during a later test and call whichever `fetch` double is installed then.
describe("a request that is not cancelled", () => {
  it("waits out its backoff in full before the next attempt", async () => {
    const r = mountAgainst(await loadApp(EXAMPLE), 0);
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
    const r = mountAgainst(await loadApp(RETRY_APP), 0);
    clickContaining(r, "Load quote");
    await tick(50);
    expect(calls()).toBe(1);
    clickContaining(r, "Load quote");
    await tick(800);
    expect(r.textContent).toContain("Fresh quote");
    expect(r.textContent).toContain("— B");
    expect(r.textContent).not.toContain("request failed");
    expect(calls()).toBe(2);
  });

  it("delivers its aborted .err at once, before the newer request answers", async () => {
    const r = mountAgainst(await loadApp(EXAMPLE), 30);
    click(r, "#load");
    await tick(60);
    expect(calls()).toBe(1);
    expect(logOf(r)).toBe("");

    click(r, "#load");
    await tick(0);
    expect(logOf(r)).toBe("aborted;");
    expect(calls()).toBe(2);

    await until(() => logOf(r) !== "aborted;");
    expect(logOf(r)).toBe("aborted;ok;");
    expect(r.textContent).toContain("quote: Fresh quote");

    await tick(600);
    expect(logOf(r)).toBe("aborted;ok;");
    expect(calls()).toBe(2);
  });
});

describe("a request cancelled by `http.cancel` during its retry backoff", () => {
  it("delivers its aborted .err at once and makes no further attempt", async () => {
    const r = mountAgainst(await loadApp(EXAMPLE), 0);
    click(r, "#load");
    await tick(60);
    expect(calls()).toBe(1);
    expect(logOf(r)).toBe("");

    click(r, "#stop");
    await tick(0);
    expect(logOf(r)).toBe("aborted;");

    await tick(600);
    expect(logOf(r)).toBe("aborted;");
    expect(calls()).toBe(1);
  });
});

describe("a `policy=queue` chain whose running request is cancelled during its backoff", () => {
  it("starts the next request at once", async () => {
    const shape = await loadSource(`type Quote = {text: Text, author: Text}
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
    const r = mountAgainst(shape, 0);

    clickContaining(r, "Go");
    await tick(60);
    expect(calls()).toBe(1);

    clickContaining(r, "Stop");
    clickContaining(r, "Go");
    await tick(60);
    expect(calls()).toBe(2);
    expect(logOf(r)).toBe("aborted;B;");
  });
});

describe("an effect that fails with `Text`, cancelled during its retry backoff", () => {
  it("delivers `aborted` as the `Text` its `.err` declares", async () => {
    const shape = await loadSource(`slot log : Text = ""
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
    const r = mountAgainst(shape, 0, {
      "storage.read": () => {
        reads++;
        return { kind: "err", value: "blocked" };
      },
    });

    clickContaining(r, "Go");
    await tick(60);
    expect(reads).toBe(1);
    expect(logOf(r)).toBe("");

    clickContaining(r, "Go");
    await tick(0);
    expect(logOf(r)).toBe("aborted;");
    expect(reads).toBe(2);
  });
});
