// The headers the built-in HTTP handler puts on a request itself, and the
// program's own headers over them (http.md §6.1.5): `Accept: application/json`
// when the decoder is Json, the Content-Type the body is sent as, then
// `app.http.headers`, then the effect's own `headers`. A name matches in any
// letter case, so each header reaches `fetch` with one value. These run the real
// handler — no provider, no scenario mock — and read what reached `fetch`.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppShape, mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import {
  clickByText,
  type FetchCall,
  type FetchDouble,
  headerValues,
  stubFetch,
} from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "188-http-default-headers.kumiki");

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A one-button program whose `http.post` effect has `map-request=request`
 * and whose `app.http` is `http` (none when empty).
 */
function program(request: string, http = ""): string {
  return `type Item = {name: Text}
slot res : Text = "idle"

effect send cap=http.post
            in=Text
            out=Result(Item, HttpError)
            map-request=${request}

reducer go on=ui.click(Go) do= emit send("x")
reducer ok on=send.ok($v, _) do= res := $v.name

tile Go = button(text="Go")
tile App = column(Go, text(res))

app H
    caps = [http.post]
    routes = {"/" -> App, "/404" -> App}
    init = []
${http ? `    http = ${http}\n` : ""}`;
}

describe("the headers an HTTP request carries (http.md §6.1.5)", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  /** Mount `app`, click `button`, and return the one request it made. */
  async function sent(app: AppShape, button: string): Promise<FetchCall> {
    double = stubFetch(() => new Response('{"name":"lamp"}'));
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      clickByText(root, button);
      await tick();
      dispose();
    } finally {
      root.remove();
    }
    expect(double.calls).toHaveLength(1);
    return double.calls[0] as FetchCall;
  }

  const values = (c: FetchCall, name: string): string[] => headerValues(c.init.headers, name);

  it("sends Accept: application/json for a Json decoder, and no Content-Type without a body", async () => {
    const call = await sent(await loadApp(EXAMPLE), "Load");
    expect(values(call, "Accept")).toEqual(["application/json"]);
    expect(values(call, "Content-Type")).toEqual([]);
  });

  it("sends one Content-Type, the effect's lower-case one, beside the default Accept", async () => {
    const call = await sent(await loadApp(EXAMPLE), "Rename");
    expect(call.init.method).toBe("PATCH");
    expect(values(call, "Content-Type")).toEqual(["application/merge-patch+json"]);
    expect(values(call, "Accept")).toEqual(["application/json"]);
  });

  it("sends one Accept, the effect's upper-case one, in place of the default", async () => {
    const call = await sent(await loadApp(EXAMPLE), "Feed");
    expect(values(call, "Accept")).toEqual(["application/vnd.shop+json"]);
  });

  it("sends no Accept for a Text decoder", async () => {
    const call = await sent(await loadApp(EXAMPLE), "Readme");
    expect(values(call, "Accept")).toEqual([]);
  });

  it("sends Accept: application/json when the request names no decoder", async () => {
    const call = await sent(await loadSource(program(`{url: "/i"}`)), "Go");
    expect(values(call, "Accept")).toEqual(["application/json"]);
  });

  it("lets app.http.headers replace a default, whatever the case", async () => {
    const app = await loadSource(
      program(
        `{url: "/i", body: {name: $1}, decode: Decoder.Json(Item)}`,
        `{headers: {"accept": "application/vnd.shop+json", "CONTENT-TYPE": "application/json; charset=utf-8"}}`,
      ),
    );
    const call = await sent(app, "Go");
    expect(values(call, "Accept")).toEqual(["application/vnd.shop+json"]);
    expect(values(call, "Content-Type")).toEqual(["application/json; charset=utf-8"]);
  });

  it("lets the effect's headers replace app.http.headers, whatever the case", async () => {
    const app = await loadSource(
      program(
        `{url: "/i", headers: {"Accept": "text/x-effect"}, body: {name: $1}, decode: Decoder.Json(Item)}`,
        `{headers: {"accept": "text/x-global"}}`,
      ),
    );
    const call = await sent(app, "Go");
    expect(values(call, "Accept")).toEqual(["text/x-effect"]);
  });
});
