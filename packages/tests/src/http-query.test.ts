import { feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { clickContaining, mountApp, waitUntil } from "./helpers/dom.ts";
import { type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("127-http-query-string");

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

  async function requested(app: AppShape, button: string) {
    double = stubFetch(() => new Response(JSON.stringify([{ name: "x" }])));
    const calls = double.calls;
    const { root, handle } = mountApp(app);
    try {
      clickContaining(root, button);
      await waitUntil(() => calls.length > 0);
      handle.dispose();
      return calls.map((c) => ({
        url: new URL(c.url, "http://localhost/"),
        method: c.init.method,
      }));
    } finally {
      root.remove();
    }
  }

  it("encodes each entry and appends it to example 127's own query string", async () => {
    const [first, ...rest] = await requested(await loadApp(EXAMPLE), "Search");
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

  it.each([
    [
      "starts the query string when the url has none",
      `"/search", query: {"q": $1, "page": "2"}`,
      "/search?q=a+b%26c&page=2",
    ],
    ["leaves the url unchanged for an empty query", `"/search?x=1", query: {}`, "/search?x=1"],
    [
      "puts the query before a fragment",
      `"/search#top", query: {"q": $1}`,
      "/search?q=a+b%26c#top",
    ],
    [
      "finishes a url that already ends in `?`",
      `"/search?", query: {"q": $1}`,
      "/search?q=a+b%26c",
    ],
    [
      "continues a url that already ends in `&`",
      `"/search?x=1&", query: {"q": $1}`,
      "/search?x=1&q=a+b%26c",
    ],
  ])("%s", async (_, request, sent) => {
    const calls = await requested(
      await loadSource(program(`{url: ${request}, decode: Decoder.Text}`)),
      "Go",
    );
    expect(calls.map((c) => c.url.href)).toEqual([`http://localhost${sent}`]);
  });

  it("sends the query of an http.post effect too", async () => {
    const [call, ...rest] = await requested(
      await loadSource(
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
