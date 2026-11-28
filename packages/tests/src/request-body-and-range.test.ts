import { feature } from "@kumikijs/examples";
import type { CapabilityProvider } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished } from "vitest";
import { click, mountApp, waitUntil } from "./helpers/dom.ts";
import { readHeader, sentRequest } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("289-request-body-and-range-types");

const some = (value: unknown) => ({ _tag: "Some", _0: value });

/** A program whose `http-post` declares `body: Body`, `defs` defining `Body`, and sends `value` on Go. */
const declaredBody = (defs: string, value: string): string => `${defs}
effect http-post cap=http.post
                 in={url: Url, headers: Map(Text, Text), query: Map(Text, Text), body: Body, decode: Decoder}
                 out=Result(Text, HttpError)
reducer go on=ui.click(Go)
    do= emit http-post({url: "https://x.example/n", headers: {}, query: {}, body: ${value}, decode: Decoder.Text})
tile Go = button(text="Go")
tile App = column(Go)
app B
    caps   = [http.post]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

describe("the requests of an input declared with HttpBody(T) and IndexRange(K)", () => {
  it.each([
    ["Send a note", '{"id":"n1","title":"first","at":10}', "application/json"],
    ["Ping", undefined, null],
  ])("sends example 289's %s body as %j under Content-Type %s", async (button, body, type) => {
    const call = await sentRequest(await loadApp(EXAMPLE), button, () => new Response("ok"));
    expect(call.init.body).toBe(body);
    expect(readHeader(call.init.headers, "Content-Type")).toBe(type);
  });

  it.each([
    ["type Body = Full(Int) | Empty", "Empty", undefined],
    ["type Body = Text(Text) | Json(Int)", `Text("a")`, "a"],
    ["type Body = Text(Text) | Json(Int)", "Json(3)", "3"],
  ])("sends a body declared by %s as the HttpBody variant its tag names: %s as %j", async (defs, value, body) => {
    const app = await loadSource(declaredBody(defs, value));
    const call = await sentRequest(app, "Go", () => new Response("ok"));
    expect(call.init.body).toBe(body);
  });

  it("hands example 289's range to the indexed.read handler as IndexRange spells it", async () => {
    const seen: unknown[] = [];
    const provider: CapabilityProvider = (input) => {
      seen.push(input);
      return { kind: "ok", value: [] };
    };
    const { root, handle } = mountApp(await loadApp(EXAMPLE), {
      providers: { "indexed.read": provider },
    });
    onTestFinished(() => {
      handle.dispose();
      root.remove();
    });
    click(root, "Find 10..20");
    await waitUntil(() => seen.length > 0);
    expect(seen).toEqual([
      {
        store: "notes",
        index: some("at"),
        range: some({ lower: some(10), upper: some(20), lowerOpen: false, upperOpen: true }),
      },
    ]);
  });
});
