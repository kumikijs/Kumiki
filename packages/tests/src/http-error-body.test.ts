import { readHttpFixture, useHttpFixture } from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { click, mountApp, waitUntil } from "./helpers/dom.ts";
import { type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("229-http-error-body");

/** A `.err` reducer that reads `$e.body` through `.is-some` and `.get-or`. */
const PROGRAM = `slot failures : Int      = 0
slot hasBody  : Bool     = false
slot body     : Text     = ""
slot loadId   : EffectId = EffectId.none

effect load cap=http.get
            in=Unit
            out=Result(Text, HttpError)
            map-request={url: "/report", decode: Decoder.Text}

effect stop cap=http.cancel in=EffectId out=Unit

reducer go     on=ui.click(Go)    do= loadId := emit load()
reducer halt   on=ui.click(Halt)  do= emit stop(loadId)
reducer failed on=load.err($e, _) do= failures := failures + 1
                                      hasBody := $e.body.is-some
                                      body := $e.body.get-or("<none>")

tile Go   = button(text="Go")
tile Halt = button(text="Halt")
tile App  = column(Go, Halt)

app ErrorBody
    caps   = [http.get, http.cancel]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** A fetch that answers nothing until the request is aborted, then rejects as fetch does. */
const hangsUntilAborted = (init: RequestInit): Promise<Response> =>
  new Promise((_, reject) => {
    init.signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });

describe("$e.body on an http effect's .err", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  /** Click Go (then Halt, when `halt`), and return what `.err` stored. */
  async function failWith(
    respond: (init: RequestInit) => Response | Promise<Response>,
    halt = false,
  ): Promise<{ hasBody: unknown; body: unknown }> {
    double = stubFetch((call) => respond(call.init));
    const app = await loadSource(PROGRAM);
    const { root, handle } = mountApp(app);
    try {
      const live = defined(app.live, "the app's live map") as Record<string, unknown>;
      click(root, "Go");
      if (halt) {
        await waitUntil(() => double?.calls.length === 1);
        click(root, "Halt");
      }
      await waitUntil(() => live.failures === 1, { timeoutMs: 3000 });
      return { hasBody: live.hasBody, body: live.body };
    } finally {
      handle.dispose();
      root.remove();
    }
  }

  it("is Some of the body a 4xx sent", async () => {
    const got = await failWith(() => new Response("report 7 was archived", { status: 404 }));
    expect(got).toEqual({ hasBody: true, body: "report 7 was archived" });
  });

  it("is Some of an empty body a 4xx sent, which is not the absence of one", async () => {
    const got = await failWith(() => new Response("", { status: 404 }));
    expect(got).toEqual({ hasBody: true, body: "" });
  });

  it("is None for a request aborted in flight, which got no response", async () => {
    const got = await failWith(hangsUntilAborted, true);
    expect(got).toEqual({ hasBody: false, body: "<none>" });
  });

  it("is None for a network failure", async () => {
    const got = await failWith(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(got).toEqual({ hasBody: false, body: "<none>" });
  });
});

describe("the http-error-body example matches on the body", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
    useHttpFixture(null);
  });

  async function shown(app: AppShape, act: (root: HTMLElement) => Promise<void>): Promise<string> {
    const { root, handle } = mountApp(app);
    try {
      await act(root);
      await waitUntil(() => /problem: \S/.test(root.textContent ?? ""), { timeoutMs: 3000 });
      return root.textContent ?? "";
    } finally {
      handle.dispose();
      root.remove();
    }
  }

  it("shows the reason the 404 in its own fixture carries", async () => {
    useHttpFixture(readHttpFixture(EXAMPLE));
    const text = await shown(await loadApp(EXAMPLE), async (root) => {
      click(root, "Load");
    });
    expect(text).toContain("problem: the server answered 404: report 7 was archived");
  });

  it("says there was no response when Cancel aborts the request", async () => {
    double = stubFetch((call) => hangsUntilAborted(call.init));
    const text = await shown(await loadApp(EXAMPLE), async (root) => {
      click(root, "Load");
      await waitUntil(() => double?.calls.length === 1);
      click(root, "Cancel");
    });
    expect(text).toContain("problem: no response (aborted)");
  });
});
