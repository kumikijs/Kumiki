import { feature } from "@kumikijs/examples";
import { afterEach, describe, expect, it } from "vitest";
import { click, mountApp, waitUntil } from "./helpers/dom.ts";
import { type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("213-effect-input-typed");

describe("an effect's map-request builds its request from the in= record's fields", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  it("requests /api/users/7?size=20 and renders the answer", async () => {
    const app = await loadApp(EXAMPLE);
    double = stubFetch(() => new Response("Ada"));
    const { root, handle } = mountApp(app);
    try {
      click(root, "load user 7");
      await waitUntil(() => (root.textContent ?? "").includes("got Ada"));
    } finally {
      handle.dispose();
      root.remove();
    }
    const urls = double.calls.map((c) => new URL(c.url, "http://localhost/"));
    expect(urls.map((u) => u.pathname)).toEqual(["/api/users/7"]);
    // `size` is the record's field, not the Map member of that name, which would count the
    // record's two fields.
    expect([...(urls[0]?.searchParams ?? [])]).toEqual([["size", "20"]]);
  });
});
