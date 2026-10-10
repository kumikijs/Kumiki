import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installFixtureFetch,
  parseReadme,
  previewApp,
  previewSource,
  showcaseApps,
} from "./showcase";

describe("the showcase catalog", () => {
  it("lists every app once, in order, with the title, summary and lessons of its README", () => {
    const apps = showcaseApps("en");
    expect(apps.map((a) => a.name)).toEqual([...apps.map((a) => a.name)].sort());
    expect(apps.length).toBeGreaterThanOrEqual(11);
    const counter = apps.find((a) => a.name === "01-counter");
    expect(counter?.title).toBe("Counter");
    expect(counter?.summary).not.toBe("");
    expect(counter?.learn.length).toBeGreaterThan(0);
    expect(counter?.lines).toBe(counter?.source.trimEnd().split("\n").length);
  });

  it("reads the Japanese README for the Japanese page", () => {
    const counter = showcaseApps("ja").find((a) => a.name === "01-counter");
    expect(counter?.summary).toMatch(/[ぁ-んァ-ン一-龥]/);
    expect(counter?.learn.join("")).toMatch(/[ぁ-んァ-ン一-龥]/);
  });

  it.each(
    showcaseApps("en").map((a) => a.name),
  )("compiles %s into a previewable document", (name) => {
    const preview = previewApp(name);
    expect(preview.kind, preview.kind === "err" ? preview.message : "").toBe("ok");
  });

  it("serves an app's HTTP fixture inside its preview, and only that app's", () => {
    const blog = previewApp("03-blog");
    const counter = previewApp("01-counter");
    expect(blog.kind === "ok" && blog.srcdoc).toContain("/api/posts");
    expect(counter.kind === "ok" && counter.srcdoc).not.toContain("globalThis.fetch");
  });

  it("reports an app it does not know", () => {
    expect(previewApp("nope")).toEqual({ kind: "err", message: "unknown app: nope" });
  });

  it("answers saving either blog post", () => {
    const blog = previewApp("03-blog");
    expect(blog.kind === "ok" && blog.srcdoc).toContain(
      "PUT /api/posts/9f1c2a54-0e2b-4d6e-9a71-1b2c3d4e5f60",
    );
    expect(blog.kind === "ok" && blog.srcdoc).toContain(
      "PUT /api/posts/3a7b8c91-4d5e-4f60-8a1b-2c3d4e5f6071",
    );
  });

  it("reports a source the compiler throws on instead of throwing", () => {
    const preview = previewSource("tile = = =", undefined);
    expect(preview.kind).toBe("err");
    expect(preview.kind === "err" && preview.message).not.toBe("");
  });

  it("reports a fixture that is not JSON instead of throwing", () => {
    const counter = showcaseApps("en").find((a) => a.name === "01-counter");
    const preview = previewSource(counter?.source ?? "", "{ not json");
    expect(preview.kind).toBe("err");
    expect(preview.kind === "err" && preview.message).toMatch(/app\.http\.json/);
  });
});

describe("a README", () => {
  it("drops the number from the title and keeps the first paragraph as the summary", () => {
    const readme = `# 07 — App HTTP

English · [日本語](./README.ja.md)

One base URL,
shared headers.

## What you'll learn

- \`app.http\`
- retries

## Run
`;
    expect(parseReadme(readme)).toEqual({
      title: "App HTTP",
      summary: "One base URL, shared headers.",
      learn: ["`app.http`", "retries"],
    });
  });
});

describe("the fixture fetch", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("answers a request by method and path, as JSON, from any host", async () => {
    installFixtureFetch({ "GET /api/quote": { json: { text: "hi" } } }, 0);
    const res = await fetch("https://api.example.com/api/quote");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ text: "hi" });
  });

  it("walks a queue and repeats its last answer", async () => {
    installFixtureFetch({ "GET /q": [{ status: 503 }, { status: 503 }, { text: "ok" }] }, 0);
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await fetch("/q")).status);
    expect(statuses).toEqual([503, 503, 200, 200]);
  });

  it("prefers the entry that names the query, and answers 404 to anything else", async () => {
    installFixtureFetch(
      { "GET /s?q=a": { text: "a" }, "GET /s": { text: "any" }, "POST /s": { text: "post" } },
      0,
    );
    expect(await (await fetch("/s?q=a")).text()).toBe("a");
    expect(await (await fetch("/s?q=b")).text()).toBe("any");
    expect(await (await fetch("/s", { method: "post" })).text()).toBe("post");
    expect((await fetch("/missing")).status).toBe(404);
  });

  it("answers a 204 or 205 with no body", async () => {
    installFixtureFetch({ "POST /out": { status: 204 }, "POST /reset": { status: 205 } }, 0);
    const out = await fetch("/out", { method: "POST" });
    expect(out.status).toBe(204);
    expect(out.body).toBeNull();
    expect((await fetch("/reset", { method: "POST" })).status).toBe(205);
  });

  it("names a request it has no answer for in the status text and the console", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    installFixtureFetch({}, 0);
    const res = await fetch("/api/posts/x?draft=1", { method: "put" });
    expect(res.status).toBe(404);
    expect(res.statusText).toBe("no demo response for PUT /api/posts/x?draft=1");
    expect(logged).toHaveBeenCalledWith("no demo response for PUT /api/posts/x?draft=1");
    logged.mockRestore();
  });
});
