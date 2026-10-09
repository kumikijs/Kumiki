import { app, feature } from "@kumikijs/examples";
import type { AppShape, CapabilityRegistry } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { clickContaining, mountApp, tick } from "./helpers/dom.ts";
import {
  type FetchCall,
  type FetchDouble,
  headerValues,
  readHeader,
  stubFetch,
} from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("128-http-body-variants");
const BLOG = app("03-blog");

/**
 * A one-button `http.post` program whose `map-request` is `request`. The effect takes `"x"` as a Text, or nothing when `input` is `Unit`.
 */
function program(request: string, input: "Text" | "Unit" = "Text", http = ""): string {
  return `slot res : Text = "idle"

effect send cap=http.post
            in=${input}
            out=Result(Text, HttpError)
            map-request=${request}

reducer go on=ui.click(Go) do= emit send(${input === "Text" ? '"x"' : ""})
reducer ok on=send.ok($v, _) do= res := $v

tile Go = button(text="Go")
tile App = column(Go, text(res))

app B
    caps = [http.post]
    routes = {"/" -> App, "/404" -> App}
    init = []
${http}`;
}

describe("an HTTP request body is sent as its HttpBody variant names", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  /** Mount `app`, click `button`, and return the one request it made. */
  async function sent(app: AppShape, button: string): Promise<FetchCall> {
    double = stubFetch(() => new Response("ok"));
    const { root, handle } = mountApp(app);
    try {
      clickContaining(root, button);
      await tick(30);
      handle.dispose();
    } finally {
      root.remove();
    }
    expect(double.calls).toHaveLength(1);
    return double.calls[0] as FetchCall;
  }

  const contentType = (c: FetchCall): string | null => readHeader(c.init.headers, "Content-Type");

  it.each([
    ["Form", "user=ann&pass=pw", "application/x-www-form-urlencoded"],
    ["Json", '{"name":"x"}', "application/json"],
    ["Text", "raw", null],
    ["Empty", undefined, null],
    ["Record", '{"sku":"book"}', "application/json"],
  ])("sends example 128's %s button's body as %j under Content-Type %s", async (button, body, type) => {
    const call = await sent(await loadApp(EXAMPLE), button);
    expect(call.init.body).toBe(body);
    expect(contentType(call)).toBe(type);
  });

  it("sends Multipart as FormData, leaving the Content-Type to fetch", async () => {
    const app = await loadSource(
      program(
        `{url: "/up", body: Multipart({"name": TextV($1), "n": NumberV(2.5)}), decode: Decoder.Text}`,
      ),
    );
    const call = await sent(app, "Go");
    expect(call.init.body).toBeInstanceOf(FormData);
    const fd = call.init.body as FormData;
    expect([...fd.entries()]).toEqual([
      ["name", "x"],
      ["n", "2.5"],
    ]);
    expect(contentType(call)).toBeNull();
  });

  it("sends Bytes as the byte sequence", async () => {
    const app = await loadSource(
      program(`{url: "/raw", body: Bytes(Bytes.from-text($1)), decode: Decoder.Text}`),
    );
    const call = await sent(app, "Go");
    expect(call.init.body).toBeInstanceOf(Uint8Array);
    expect([...(call.init.body as Uint8Array)]).toEqual([120]);
    expect(contentType(call)).toBeNull();
  });

  it("keeps a Content-Type the program set, whatever its case", async () => {
    const app = await loadSource(
      program(
        `{url: "/f", headers: {"content-type": "text/x-custom"}, body: Form({"a": $1}), decode: Decoder.Text}`,
      ),
    );
    const call = await sent(app, "Go");
    expect(call.init.body).toBe("a=x");
    expect(headerValues(call.init.headers, "Content-Type")).toEqual(["text/x-custom"]);
  });

  it("lets an input content-type replace a global Content-Type, whatever the case", async () => {
    const app = await loadSource(
      program(
        `{url: "/f", headers: {"content-type": "text/x-input"}, body: Form({"a": $1}), decode: Decoder.Text}`,
        "Text",
        `    http = {headers: {"Content-Type": "text/x-global"}}\n`,
      ),
    );
    const call = await sent(app, "Go");
    expect(headerValues(call.init.headers, "Content-Type")).toEqual(["text/x-input"]);
  });

  it("sends a bare Text body as JSON, as any body that is not an HttpBody variant", async () => {
    const app = await loadSource(program(`{url: "/t", body: $1, decode: Decoder.Text}`));
    const call = await sent(app, "Go");
    expect(call.init.body).toBe('"x"');
    expect(contentType(call)).toBe("application/json");
  });

  it("sends Json of Unit as JSON null, not an empty body under a JSON Content-Type", async () => {
    const app = await loadSource(
      program(`{url: "/j", body: Json($1), decode: Decoder.Text}`, "Unit"),
    );
    const call = await sent(app, "Go");
    expect(call.init.body).toBe("null");
    expect(contentType(call)).toBe("application/json");
  });

  it("drops a Content-Type the program set on Multipart, so fetch writes the boundary", async () => {
    const app = await loadSource(
      program(
        `{url: "/up", headers: {"Content-Type": "multipart/form-data"}, body: Multipart({"name": TextV($1)}), decode: Decoder.Text}`,
      ),
    );
    const call = await sent(app, "Go");
    expect(call.init.body).toBeInstanceOf(FormData);
    expect(headerValues(call.init.headers, "Content-Type")).toEqual([]);
  });

  it("sends 03-blog's login and save payloads, not the Json wrapper", async () => {
    const blog = await loadApp(BLOG);
    double = stubFetch(() => new Response("{}"));
    const noProvider: CapabilityRegistry = { has: () => true, provider: () => undefined };
    const signal = new AbortController().signal;
    const login = blog.effects.login;
    const savePost = blog.effects.savePost;
    if (!login || !savePost) throw new Error("03-blog no longer declares login / savePost");
    await login.invoke({ email: "a@b.c", password: "pw" }, noProvider, signal);
    const post = { id: "p1", title: "T", body: "B", tags: ["k"] };
    await savePost.invoke(post, noProvider, signal);
    expect(double.calls.map((c) => JSON.parse(String(c.init.body)))).toEqual([
      { email: "a@b.c", password: "pw" },
      post,
    ]);
  });
});
