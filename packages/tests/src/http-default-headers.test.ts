import { feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { click, mountApp, waitUntil } from "./helpers/dom.ts";
import {
  type FetchCall,
  type FetchDouble,
  headerValues,
  stubFetch,
} from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("188-http-default-headers");

/** A one-button program whose `http.post` effect has `map-request=request`, under `app.http = http`. */
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

describe("the headers an HTTP request carries", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  async function sent(app: AppShape, button: string): Promise<FetchCall> {
    double = stubFetch(() => new Response('{"name":"lamp"}'));
    const calls = double.calls;
    const { root, handle } = mountApp(app);
    try {
      click(root, button);
      await waitUntil(() => calls.length > 0);
    } finally {
      handle.dispose();
      root.remove();
    }
    expect(calls).toHaveLength(1);
    return calls[0] as FetchCall;
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

  it.each([
    [
      "one Accept, the effect's upper-case one, in place of the default",
      "Feed",
      ["application/vnd.shop+json"],
    ],
    ["no Accept for a Text decoder", "Readme", []],
  ])("sends %s", async (_, button, want) => {
    const call = await sent(await loadApp(EXAMPLE), button);
    expect(values(call, "Accept")).toEqual(want);
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
