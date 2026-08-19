// The doubles the headless tiers run against. What they answer decides what a
// green `kumiki smoke` means, so each of their promises is asserted here rather
// than assumed by the corpus that depends on them.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type HttpFixture,
  httpRequests,
  installTestDoubles,
  readHttpFixture,
  useHttpFixture,
} from "../src/harness.ts";
import { smokeSource } from "../src/smoke.ts";

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

  // The app above turns every failure into `Failed(...)` — which is what an app
  // is supposed to do, and what made a network outage look like a passing run.
  // The report has to fail even though the app handled it.
  it("fails the run even when the app has an .err reducer for it", async () => {
    const report = await drive(QUOTE, {});
    expect(report.mounted).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("serves a fixtured request", async () => {
    const report = await drive(QUOTE, { "GET /quote": OK });
    expect(report.issues.map((i) => i.message)).toEqual([]);
  });

  // A queue is what makes a retry ladder observable: the same URL has to answer
  // differently on the second and third attempt, or `retry=exponential` is
  // exercised only in the shape of its declaration.
  it("walks a queue and repeats its last entry", async () => {
    useHttpFixture({ "GET /quote": [{ status: 500 }, { status: 503 }, OK] });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await fetch("/quote")).status);
    expect(statuses).toEqual([500, 503, 200, 200]);
  });

  // …and the ladder run through the runtime, not through the double: three
  // attempts against one click is the retry policy actually firing.
  it("is what a retry policy climbs", async () => {
    // A settle long enough for the ladder: 10ms then 20ms of backoff, which the
    // CLI's 20ms window cuts off — the run ends and disposal aborts what is
    // still in flight.
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
  const here = dirname(fileURLToPath(import.meta.url));
  const counter = resolve(here, "../../examples/apps/01-counter/app.kumiki");
  const quotes = resolve(here, "../../examples/apps/07-app-http/app.kumiki");

  it("reads the fixture beside a source that has one", () => {
    expect(readHttpFixture(quotes)).toHaveProperty("GET /quote");
  });

  it("returns null for a source with no fixture beside it", () => {
    expect(readHttpFixture(counter)).toBeNull();
  });

  // A bare catch would call every read failure "no fixture", and the author
  // would be told to add a file that is sitting right there — or, in an example
  // that issues no request, told nothing at all.
  it("does not call a directory in the fixture's place 'no fixture'", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fixture-"));
    const source = join(dir, "app.kumiki");
    writeFileSync(source, "");
    mkdirSync(join(dir, "app.http.json"));
    try {
      expect(() => readHttpFixture(source)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // `replace(/\.kumiki$/, …)` is a no-op for a path that does not end in
  // `.kumiki`, so the source itself was parsed as JSON and the author was told
  // their `.kumiki` file was not valid JSON.
  it("refuses a path that is not a Kumiki source", () => {
    expect(() => readHttpFixture("somewhere/app.txt")).toThrow(/not a Kumiki source/);
  });

  // "add it to the .http.json" is unhelpful advice for an author who wrote the
  // key and left its queue empty — the one way a queue can run out, since the
  // documented rule is that the last entry repeats.
  it("says an empty queue is empty rather than missing", async () => {
    const report = await drive(QUOTE, { "GET /quote": [] });
    const said = report.issues.map((i) => i.message).join("\n");
    expect(said).toContain("queue");
    expect(said).not.toContain("add it to the example");
  });
});

describe("the fetch double can be cancelled", () => {
  // Without a tick of latency nothing is ever in flight, so `policy=latest`,
  // `http.cancel` and the timeout would all be certified by a stub that had
  // already answered.
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
  // happy-dom ships one whose `observe()` does nothing, so the runtime's §3.8
  // prefetch path was unreachable from either headless tier — and so was its
  // own fallback, because the branch is chosen by `typeof IO === "function"`.
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
