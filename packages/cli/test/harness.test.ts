import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import {
  type HttpFixture,
  httpRequests,
  installTestDoubles,
  readHttpFixture,
  useHttpFixture,
} from "../src/harness.ts";
import { smokeSource } from "../src/smoke.ts";
import { seed } from "./helpers/files.ts";

installTestDoubles();

const drive = (
  source: string,
  httpFixture: HttpFixture,
  settleMs = 20,
): ReturnType<typeof smokeSource> => smokeSource(source, ["http.get"], { httpFixture, settleMs });

const QUOTE = `type Quote = {text: Text, author: Text}
type Load  = Idle | Loading | Loaded(Quote) | Failed(Text)

slot state : Load = Idle

effect fetchQuote cap=http.get
                  in=Unit
                  out=Result(Quote, HttpError)
                  policy=latest
                  retry=exponential(3, 10ms, 2.0)
                  map-request={url: "/quote", decode: Decoder.Json(Quote)}

reducer load   on=ui.click(LoadBtn)     do= state := Loading
                                           emit fetchQuote()
reducer loaded on=fetchQuote.ok($q, _)  do= state := Loaded($q)
reducer failed on=fetchQuote.err($e, _) do= state := Failed("failed: " + $e.status.show)

tile LoadBtn = button(text="Load", onClick=load)
tile App = column(
             LoadBtn,
             match state with
               | Idle        -> text("idle")
               | Loading     -> spinner()
               | Loaded(q)   -> text(q.text)
               | Failed(msg) -> text(msg))
app Quotes
    caps   = [http.get]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

const OK = { json: { text: "made of wood", author: "kumiki" } };

describe("the fetch double answers from the fixture, never from a host", () => {
  it("reports a request no fixture covers, rather than attempting it", async () => {
    const report = await drive(QUOTE, {});
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.message).join("\n")).toContain(
      "no HTTP fixture for GET /quote",
    );
  });

  it("fails the run even when the app has an .err reducer for it", async () => {
    const report = await drive(QUOTE, {});
    expect(report.mounted).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("serves a fixtured request", async () => {
    const report = await drive(QUOTE, { "GET /quote": OK });
    expect(report.issues.map((i) => i.message)).toEqual([]);
  });

  it("walks a queue and repeats its last entry", async () => {
    useHttpFixture({ "GET /quote": [{ status: 500 }, { status: 503 }, OK] });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await fetch("/quote")).status);
    expect(statuses).toEqual([500, 503, 200, 200]);
  });

  it("is what a retry policy climbs", async () => {
    const report = await drive(
      QUOTE,
      { "GET /quote": [{ status: 500 }, { status: 500 }, OK] },
      400,
    );
    expect(report.issues.map((i) => i.message)).toEqual([]);
    expect(httpRequests()).toEqual(["GET /quote", "GET /quote", "GET /quote"]);
  });

  it("matches a key without a query string against any query", async () => {
    const searching = QUOTE.replace('url: "/quote"', 'url: "/quote?q=" + "wood"');
    const report = await drive(searching, { "GET /quote": OK });
    expect(report.issues.map((i) => i.message)).toEqual([]);
  });
});

describe("a fixture that is there, and one that is not", () => {
  const counter = app("01-counter");
  const quotes = app("07-app-http");

  it("reads the fixture beside a source that has one", () => {
    expect(readHttpFixture(quotes)).toHaveProperty("GET /quote");
  });

  it("returns null for a source with no fixture beside it", () => {
    expect(readHttpFixture(counter)).toBeNull();
  });

  it("does not call a directory in the fixture's place 'no fixture'", () => {
    const source = seed("");
    mkdirSync(join(dirname(source), "app.http.json"));
    expect(() => readHttpFixture(source)).toThrow();
  });

  it("refuses a path that is not a Kumiki source", () => {
    expect(() => readHttpFixture("somewhere/app.txt")).toThrow(/not a Kumiki source/);
  });

  it("says an empty queue is empty rather than missing", async () => {
    const report = await drive(QUOTE, { "GET /quote": [] });
    const said = report.issues.map((i) => i.message).join("\n");
    expect(said).toContain("queue");
    expect(said).not.toContain("add it to the example");
  });
});

describe("the fetch double can be cancelled", () => {
  it("rejects an in-flight request when its signal aborts", async () => {
    useHttpFixture({ "GET /quote": OK });
    const controller = new AbortController();
    const pending = fetch("/quote", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects a request whose signal is already aborted", async () => {
    useHttpFixture({ "GET /quote": OK });
    await expect(fetch("/quote", { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("the IntersectionObserver double actually notifies", () => {
  it("reports an observed target as intersecting", async () => {
    const seen: Element[] = [];
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) seen.push(e.target);
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    io.observe(el);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([el]);
    el.remove();
  });
});
