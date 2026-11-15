import { feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { sentRequest } from "./helpers/http-double.ts";
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
  /** The one request a click on `button` makes, with its url resolved against the page. */
  async function requested(
    app: AppShape,
    button: string,
  ): Promise<{ url: URL; method: string | undefined }> {
    const call = await sentRequest(
      app,
      button,
      () => new Response(JSON.stringify([{ name: "x" }])),
    );
    return { url: new URL(call.url, "http://localhost/"), method: call.init.method };
  }

  it("encodes each entry and appends it to example 127's own query string", async () => {
    const { url } = await requested(await loadApp(EXAMPLE), "Search");
    expect(url.pathname).toBe("/search");
    // The `&` inside the value is escaped, so it stays one parameter.
    expect([...url.searchParams]).toEqual([
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
    const { url } = await requested(
      await loadSource(program(`{url: ${request}, decode: Decoder.Text}`)),
      "Go",
    );
    expect(url.href).toBe(`http://localhost${sent}`);
  });

  it("sends the query of an http.post effect too", async () => {
    const call = await requested(
      await loadSource(
        program(
          `{url: "/search", query: {"q": $1}, body: Empty, decode: Decoder.Text}`,
          "http.post",
        ),
      ),
      "Go",
    );
    expect(call.method).toBe("POST");
    expect(call.url.search).toBe("?q=a+b%26c");
  });
});
