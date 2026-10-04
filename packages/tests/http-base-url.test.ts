// How `app.http`'s `base-url` meets a request's `url` (http.md §6.3.1): an
// absolute url — a scheme, or a leading `//` — is fetched as written; any other
// url is joined to the base with exactly one `/` between them, and a base that
// carries a path keeps it as a prefix. These run the real `http.get` handler —
// no provider, no scenario mock — and read the URL that reached `fetch`.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppShape, mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clickByText, type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "190-http-base-url-join.kumiki");

const API = "https://api.example.com";
const CDN = "https://cdn.other.org/item.json";

/**
 * A program whose "Go" button emits one effect per url in `urls`, under
 * `app.http = {base-url: base}` (no `app.http` when `base` is absent).
 */
function program(urls: string[], base?: string): string {
  const effects = urls.map(
    (url, i) => `effect e${i} cap=http.get
           in=Unit
           out=Result(Item, HttpError)
           map-request={url: ${JSON.stringify(url)}, decode: Decoder.Json(Item)}
`,
  );
  return `type Item = {name: Text}
slot res : Text = "idle"

${effects.join("\n")}
reducer go on=ui.click(Go) do= ${urls.map((_, i) => `emit e${i}()`).join("\n                               ")}

tile Go = button(text="Go")
tile App = column(Go, text(res))

app Q
    caps = [http.get]
    routes = {"/" -> App, "/404" -> App}
    init = []
${base === undefined ? "" : `    http = {base-url: ${JSON.stringify(base)}}\n`}`;
}

describe("app.http base-url and a request's url reach fetch joined", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  /** Mount `app`, click each of `buttons`, and return the URLs fetch was given, in order. */
  async function requested(app: AppShape, buttons: string[], expected: number): Promise<string[]> {
    double = stubFetch(() => new Response(JSON.stringify({ name: "x" })));
    const root = document.createElement("div");
    document.body.appendChild(root);
    let dispose: (() => void) | undefined;
    try {
      // Released in `finally`, so a request that never comes does not leave a
      // mounted app behind for the next test.
      ({ dispose } = mount(app, root));
      for (const b of buttons) clickByText(root, b);
      const calls = double.calls;
      // Wait for the requests themselves rather than a fixed delay, so machine
      // load cannot make the test read a short call list.
      await vi.waitFor(
        () => {
          if (calls.length < expected) throw new Error(`${calls.length} of ${expected} requests`);
        },
        { timeout: 2000, interval: 5 },
      );
      return calls.map((c) => c.url);
    } finally {
      dispose?.();
      root.remove();
    }
  }

  it("joins relative urls under a base with a path, and leaves an absolute one (example 190)", async () => {
    const urls = await requested(await loadApp(EXAMPLE), ["User", "Stats", "Logo"], 3);
    expect(urls).toEqual([
      `${API}/v1/users/1`,
      `${API}/v1/stats`,
      "https://cdn.example.org/logo.json",
    ]);
  });

  it.each([
    API,
    `${API}/`,
  ])("joins /items/1 and items/1 to %s with one / and fetches an absolute url as written", async (base) => {
    const urls = await requested(
      await loadSource(program(["/items/1", "items/1", CDN, "//cdn.other.org/item.json"], base)),
      ["Go"],
      4,
    );
    expect(urls).toEqual([`${API}/items/1`, `${API}/items/1`, CDN, "//cdn.other.org/item.json"]);
  });

  it("keeps a base's path in front of the url, whether or not the url starts with /", async () => {
    const urls = await requested(
      await loadSource(program(["/users", "users"], `${API}/v1`)),
      ["Go"],
      2,
    );
    expect(urls).toEqual([`${API}/v1/users`, `${API}/v1/users`]);
  });

  it("fetches every url as written with no base-url", async () => {
    const urls = await requested(
      await loadSource(program(["/items/1", "items/1", CDN])),
      ["Go"],
      3,
    );
    expect(urls).toEqual(["/items/1", "items/1", CDN]);
  });
});
