import { feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { clickContaining, mountApp, tick, waitUntil } from "./helpers/dom.ts";
import { type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("129-http-decode-failure");

/** Example 129 renders its failure; the whole-error program stores it in `err`. */
function settled(app: AppShape, root: HTMLElement): boolean {
  if ((root.textContent ?? "").includes("failed")) return true;
  const err = (app.live as Record<string, { _tag?: string }> | undefined)?.err;
  return err?._tag === "Some";
}

/** Example 129's effect with a shorter backoff, its `.err` payload kept whole in a slot. */
const WHOLE_ERROR = `type Order = {id: Text}
slot err : Option(HttpError) = None

effect placeOrder cap=http.post
                  in=Text
                  out=Result(Order, HttpError)
                  retry=exponential(3, 20ms, 2.0)
                  map-request={url: "/orders", body: {sku: $1}, decode: Decoder.Json(Order)}

reducer buy on=ui.click(Buy) do= emit placeOrder("book")
reducer bad on=placeOrder.err($e, _) do= err := Some($e)

tile Buy = button(text="Buy")
tile App = column(Buy)

app R
    caps = [http.post]
    routes = {"/" -> App, "/404" -> App}
    init = []
`;

/** The `HttpError` the whole-error program stored. */
function storedErr(app: AppShape): Record<string, unknown> {
  const live = defined(app.live, "the app's live map") as Record<string, unknown>;
  const err = defined(live.err, "the err slot") as { _tag: string; _0: Record<string, unknown> };
  expect(err._tag).toBe("Some");
  return err._0;
}

describe("a 2xx whose body does not decode", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  async function clickBuy(app: AppShape, respond: () => Response | Promise<Response>) {
    double = stubFetch(respond);
    const { root, handle } = mountApp(app);
    try {
      clickContaining(root, "Buy");
      await waitUntil(() => settled(app, root), { timeoutMs: 3000 });
      await tick(200);
      const text = root.textContent ?? "";
      handle.dispose();
      return text;
    } finally {
      root.remove();
    }
  }

  const html = () =>
    new Response("<html>Created</html>", {
      status: 201,
      headers: { "content-type": "text/html" },
    });

  it.each([
    ["an HTML body", html],
    ["an empty body", () => new Response("", { status: 201 })],
  ])("is sent once and example 129 reports the status, for %s", async (_, respond) => {
    const text = await clickBuy(await loadApp(EXAMPLE), respond);
    expect(double?.calls).toHaveLength(1);
    expect(text).toContain("failed with status 201");
  });

  it("keeps the response text in body and names the decode in message", async () => {
    const app = await loadSource(WHOLE_ERROR);
    await clickBuy(app, html);
    const err = storedErr(app);
    expect(err.status).toBe(201);
    expect(err.body).toBe("<html>Created</html>");
    expect(String(err.message)).toMatch(/^decode failed: /);
  });

  it("still retries a connection failure, as status 0", async () => {
    const app = await loadSource(WHOLE_ERROR);
    await clickBuy(app, () => Promise.reject(new TypeError("Failed to fetch")));
    expect(double?.calls).toHaveLength(3);
    expect(storedErr(app).status).toBe(0);
  });

  it("still retries a 5xx", async () => {
    const app = await loadSource(WHOLE_ERROR);
    await clickBuy(app, () => new Response("down", { status: 503 }));
    expect(double?.calls).toHaveLength(3);
  });

  it("still retries a body stream that fails mid-read, as status 0", async () => {
    const app = await loadSource(WHOLE_ERROR);
    await clickBuy(
      app,
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.error(new TypeError("stream reset"));
            },
          }),
          { status: 201 },
        ),
    );
    expect(double?.calls).toHaveLength(3);
    const err = storedErr(app);
    expect(err.status).toBe(0);
    expect(String(err.message)).toMatch(/stream reset/);
  });

  it("sends a body-less 204 once and reports status 204", async () => {
    const app = await loadSource(WHOLE_ERROR);
    await clickBuy(app, () => new Response(null, { status: 204 }));
    expect(double?.calls).toHaveLength(1);
    const err = storedErr(app);
    expect(err.status).toBe(204);
    expect(String(err.message)).toMatch(/^decode failed/);
  });
});
