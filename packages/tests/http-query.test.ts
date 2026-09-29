// An HTTP effect's `query` (http.md §6.1.2) is part of the request the
// built-in handler sends. The handler fetched `base-url + url` and read nothing
// else, so every entry was dropped while `check`, `build` and the headers from
// the same record all went through. These run the real `http.get` handler — no
// provider, no scenario mock — and read the URL that reached `fetch`.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clickByText, type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "127-http-query-string.kumiki");

/** A one-button program whose effect (on `cap`) has `map-request` = `request`. */
function program(request: string, cap = "http.get"): string {
  return `slot res : Text = "idle"

effect search cap=${cap}
              in=Text
              out=Result(Text, HttpError)
              map-request=${request}

reducer go on=ui.click(Go) do= emit search("a b&c")
reducer ok on=search.ok($v, _) do= res := $v

tile Go = button(text="Go")
tile App = column(Go, text(res))

app Q
    caps = [${cap}]
    routes = {"/" -> App, "/404" -> App}
    init = []
`;
}

describe("an HTTP effect's query reaches fetch", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  async function requestedUrl(load: Promise<Parameters<typeof mount>[0]>, button: string) {
    const app = await load;
    double = stubFetch(() => new Response(JSON.stringify([{ name: "x" }])));
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      clickByText(root, button);
      const calls = double.calls;
      // Wait for the request itself rather than a fixed delay, so machine
      // load cannot make the test read an empty call list.
      await vi.waitFor(
        () => {
          if (calls.length === 0) throw new Error("no request reached fetch yet");
        },
        { timeout: 2000, interval: 5 },
      );
      dispose();
      return calls.map((c) => ({
        url: new URL(c.url, "http://localhost/"),
        method: c.init.method,
      }));
    } finally {
      root.remove();
    }
  }

  it("encodes each entry and appends it to the url's own query string (example 127)", async () => {
    const [first, ...rest] = await requestedUrl(loadApp(EXAMPLE), "Search");
    expect(rest).toEqual([]);
    const url = first?.url;
    expect(url?.pathname).toBe("/search");
    // The `&` inside the value is escaped, so it stays one parameter.
    expect([...(url?.searchParams ?? [])]).toEqual([
      ["x", "1"],
      ["q", "a b&c"],
      ["page", "2"],
    ]);
  });

  it("starts the query string when the url has none", async () => {
    const [{ url } = { url: undefined }] = await requestedUrl(
      loadSource(program(`{url: "/search", query: {"q": $1, "page": "2"}, decode: Decoder.Text}`)),
      "Go",
    );
    expect(url?.search).toBe("?q=a+b%26c&page=2");
  });

  it("leaves the url unchanged for an empty query", async () => {
    const [{ url } = { url: undefined }] = await requestedUrl(
      loadSource(program(`{url: "/search?x=1", query: {}, decode: Decoder.Text}`)),
      "Go",
    );
    expect(`${url?.pathname}${url?.search}`).toBe("/search?x=1");
  });

  it("puts the query before a fragment", async () => {
    const [{ url } = { url: undefined }] = await requestedUrl(
      loadSource(program(`{url: "/search#top", query: {"q": $1}, decode: Decoder.Text}`)),
      "Go",
    );
    expect(url?.search).toBe("?q=a+b%26c");
    expect(url?.hash).toBe("#top");
  });

  it("finishes a url that already ends in `?`", async () => {
    const [{ url } = { url: undefined }] = await requestedUrl(
      loadSource(program(`{url: "/search?", query: {"q": $1}, decode: Decoder.Text}`)),
      "Go",
    );
    // No second `?` and no empty `&` in front of the first entry.
    expect(url?.href).toBe("http://localhost/search?q=a+b%26c");
  });

  it("continues a url that already ends in `&`", async () => {
    const [{ url } = { url: undefined }] = await requestedUrl(
      loadSource(program(`{url: "/search?x=1&", query: {"q": $1}, decode: Decoder.Text}`)),
      "Go",
    );
    expect(url?.href).toBe("http://localhost/search?x=1&q=a+b%26c");
  });

  it("sends the query of an http.post effect too", async () => {
    const [call, ...rest] = await requestedUrl(
      loadSource(
        program(
          `{url: "/search", query: {"q": $1}, body: Empty, decode: Decoder.Text}`,
          "http.post",
        ),
      ),
      "Go",
    );
    expect(rest).toEqual([]);
    expect(call?.method).toBe("POST");
    expect(call?.url.search).toBe("?q=a+b%26c");
  });
});
