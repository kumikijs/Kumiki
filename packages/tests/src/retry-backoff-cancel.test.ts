import { app, feature } from "@kumikijs/examples";
import type { AppShape, CapabilityProvider } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { clickContaining, mountApp, tick, waitUntil } from "./helpers/dom.ts";
import {
  answerAfter,
  type FetchDouble,
  stubFetch,
  type TimedResponder,
} from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const RETRY_APP = app("08-http-retry");
const EXAMPLE = feature("192-retry-backoff-cancel");

const busy = (): Response =>
  new Response("busy", { status: 503, statusText: "Service Unavailable" });
const quote = (): Response =>
  new Response(JSON.stringify({ text: "Fresh quote", author: "B" }), { status: 200 });

let double: FetchDouble | undefined;
let teardown: (() => void) | undefined;

afterEach(() => {
  teardown?.();
  double?.restore();
  teardown = undefined;
  double = undefined;
});

/**
 * Mount `shape` with `fetch` answering 503 to the first call and a quote to every later one,
 * `latencyMs` after each call.
 */
function mountWithServer(
  shape: AppShape,
  latencyMs: number,
  providers?: Record<string, CapabilityProvider>,
): { root: HTMLElement; server: TimedResponder } {
  const server = answerAfter(latencyMs, [busy, quote]);
  double = stubFetch(server.respond);
  const { root, handle } = mountApp(shape, providers ? { providers } : {});
  teardown = () => {
    handle.dispose();
    root.remove();
  };
  return { root, server };
}

/** Until the 503 is in and the request has gone on to sleep out its backoff. */
async function inBackoff(server: TimedResponder): Promise<void> {
  await waitUntil(() => server.answered() === 1);
  await tick(20);
}

const calls = (): number => double?.calls.length ?? 0;
const logOf = (r: HTMLElement): string => /log: (\S*)$/.exec(r.textContent ?? "")?.[1] ?? "";

describe("a request that is not cancelled", () => {
  it("waits out its backoff in full before the next attempt", async () => {
    const { root, server } = mountWithServer(await loadApp(EXAMPLE), 0);
    clickContaining(root, "Load");
    await waitUntil(() => logOf(root) !== "");
    expect(logOf(root)).toBe("ok;");
    expect(root.textContent).toContain("quote: Fresh quote");
    expect(server.madeAt).toHaveLength(2);
    expect((server.madeAt[1] ?? 0) - (server.madeAt[0] ?? 0)).toBeGreaterThanOrEqual(490);
  });
});

describe("a request superseded by `policy=latest` during its retry backoff", () => {
  it("leaves the newer request's quote on the page, and fetch is called twice", async () => {
    const { root, server } = mountWithServer(await loadApp(RETRY_APP), 0);
    clickContaining(root, "Load quote");
    await inBackoff(server);
    clickContaining(root, "Load quote");
    await waitUntil(() => root.textContent?.includes("Fresh quote") ?? false);
    await tick(800);
    expect(root.textContent).toContain("— B");
    expect(root.textContent).not.toContain("request failed");
    expect(calls()).toBe(2);
  });

  it("delivers its aborted .err at once, before the newer request answers", async () => {
    const { root, server } = mountWithServer(await loadApp(EXAMPLE), 30);
    clickContaining(root, "Load");
    await inBackoff(server);
    expect(logOf(root)).toBe("");

    clickContaining(root, "Load");
    await tick(0);
    expect(logOf(root)).toBe("aborted;");
    expect(calls()).toBe(2);

    await waitUntil(() => logOf(root) !== "aborted;");
    expect(logOf(root)).toBe("aborted;ok;");
    expect(root.textContent).toContain("quote: Fresh quote");

    await tick(600);
    expect(logOf(root)).toBe("aborted;ok;");
    expect(calls()).toBe(2);
  });
});

describe("a request cancelled by `http.cancel` during its retry backoff", () => {
  it("delivers its aborted .err at once and makes no further attempt", async () => {
    const { root, server } = mountWithServer(await loadApp(EXAMPLE), 0);
    clickContaining(root, "Load");
    await inBackoff(server);
    expect(logOf(root)).toBe("");

    clickContaining(root, "Stop");
    await tick(0);
    expect(logOf(root)).toBe("aborted;");

    await tick(600);
    expect(logOf(root)).toBe("aborted;");
    expect(calls()).toBe(1);
  });
});

describe("a request whose app is unmounted during its retry backoff", () => {
  it("makes no further attempt", async () => {
    const { root, server } = mountWithServer(await loadApp(EXAMPLE), 0);
    clickContaining(root, "Load");
    await inBackoff(server);
    teardown?.();
    teardown = undefined;
    await tick(600);
    expect(calls()).toBe(1);
  });
});

describe("a `policy=queue` chain whose running request is cancelled during its backoff", () => {
  it("starts the entry queued behind it at once", async () => {
    const shape = await loadSource(`type Quote = {text: Text, author: Text}
slot lastId : EffectId = EffectId.none
slot log    : Text     = ""
effect load cap=http.get in=Unit out=Result(Quote, HttpError)
            policy=queue
            retry=linear(2, 500ms)
            map-request={url: "/quote", decode: Decoder.Json(Quote)}
effect cancelLoad cap=http.cancel in=EffectId out=Unit
reducer go    on=ui.click(GoBtn)   do= lastId := emit load()
reducer next  on=ui.click(NextBtn) do= emit load()
reducer stop  on=ui.click(StopBtn) do= emit cancelLoad(lastId)
reducer onOk  on=load.ok($q, _)    do= log := log + $q.author + ";"
reducer onErr on=load.err($e, _)   do= log := log + $e.message + ";"
tile GoBtn   = button(text="Go", onClick=go)
tile NextBtn = button(text="Next", onClick=next)
tile StopBtn = button(text="Stop", onClick=stop)
tile App = column(GoBtn, NextBtn, StopBtn, text("log: " + log))
app M caps=[http.get, http.cancel] routes={"/" -> App, "/404" -> App} init=[]`);
    const { root, server } = mountWithServer(shape, 0);

    clickContaining(root, "Go");
    await inBackoff(server);
    clickContaining(root, "Next");
    await tick(0);
    expect(calls()).toBe(1);

    clickContaining(root, "Stop");
    await tick(0);
    expect(calls()).toBe(2);
    await waitUntil(() => logOf(root) === "aborted;B;");
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
    const { root } = mountWithServer(shape, 0, {
      "storage.read": () => {
        reads++;
        return { kind: "err", value: "blocked" };
      },
    });

    clickContaining(root, "Go");
    await waitUntil(() => reads === 1);
    await tick(20);
    expect(logOf(root)).toBe("");

    clickContaining(root, "Go");
    await tick(0);
    expect(logOf(root)).toBe("aborted;");
    expect(reads).toBe(2);
  });
});
