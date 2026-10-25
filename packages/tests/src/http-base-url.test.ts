import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { sentRequest } from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("190-http-base-url-join");

const API = "https://api.example.com";

describe("app.http base-url and a request's url reach fetch as the base-url rule gives them", () => {
  it.each([
    ["User", `${API}/v1/users/1`],
    ["Stats", `${API}/v1/stats`],
    ["Logo", "https://cdn.example.org/logo.json"],
  ])("example 190's %s button fetches %s", async (button, want) => {
    const call = await sentRequest(
      await loadApp(EXAMPLE),
      button,
      () => new Response(JSON.stringify({ name: "x" })),
    );
    expect(call.url).toBe(want);
  });
});
