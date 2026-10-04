// An effect's `map-request` and `latest-per-key` key read `$1` as the type the
// effect's `in=` declares (language.md §1.5.2). The first block checks a
// program whose misspelt field would send the request with the id missing; the
// second runs example 213 through the real `http.get` handler — no provider,
// no scenario mock — and reads the URL that reached `fetch`, which is built
// from the record's fields whatever they are named. The checker's verdicts on
// the other `in=` types are in `packages/compiler/test/effect-policy-key.test.ts`.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, lex, parse } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clickByText, type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "213-effect-input-typed.kumiki");

/** The program of the report, with `clause` as the effect's last clause. */
const program = (clause: string): string => `type UserQuery = {id: Text}
type Load = Idle | Loaded(Text) | Failed(Text)
slot state : Load = Idle
effect loadUser cap=http.get in=UserQuery out=Result(Text, HttpError)
    ${clause}
reducer go on=ui.click(Go) do= emit loadUser({id: "7"})
reducer ok on=loadUser.ok($t, _) do= state := Loaded($t)
reducer bad on=loadUser.err($e, _) do= state := Failed("request failed")
tile Go = button(text="load user 7")
tile P = column(Go, match state with
    | Idle -> text("idle")
    | Loaded(t) -> text("got " + t)
    | Failed(m) -> text(m))
app M
    caps   = [http.get]
    routes = {"/" -> P, "/404" -> P}
    init   = []
`;

function diagnose(source: string): { code: string; message: string; at: string }[] {
  const lines = source.split("\n");
  return check(parse(lex(source))).map((e) => ({
    code: e.code,
    message: e.message,
    at: (lines[e.pos.line - 1] ?? "").slice(e.pos.col - 1),
  }));
}

describe("a field the effect's in= record lacks is E0108 where it is read", () => {
  it.each([
    ["map-request", `map-request={url: "/api/users/" + $1.idd, decode: Decoder.Text}`],
    [
      "the latest-per-key key",
      `policy=latest-per-key($1.idd) map-request={url: "/api/users/" + $1.id, decode: Decoder.Text}`,
    ],
  ])("in %s", (_where, clause) => {
    const found = diagnose(program(clause));
    expect(found.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: "E0108", message: 'Record type has no field or method ".idd"' },
    ]);
    expect(found[0]?.at).toMatch(/^\$1\.idd/);
  });

  it("accepts the field the record has", () => {
    const clause = `policy=latest-per-key($1.id) map-request={url: "/api/users/" + $1.id, decode: Decoder.Text}`;
    expect(diagnose(program(clause))).toEqual([]);
  });
});

describe("example 213 builds its request from the in= record's fields", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  it("requests /api/users/7?size=20 and renders the answer", async () => {
    const app = await loadApp(EXAMPLE);
    double = stubFetch(() => new Response("Ada"));
    const calls = double.calls;
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);
      clickByText(root, "load user 7");
      await vi.waitFor(
        () => {
          if (!(root.textContent ?? "").includes("got Ada")) throw new Error("no answer yet");
        },
        { timeout: 2000, interval: 5 },
      );
      dispose();
    } finally {
      root.remove();
    }
    const urls = calls.map((c) => new URL(c.url, "http://localhost/"));
    expect(urls.map((u) => u.pathname)).toEqual(["/api/users/7"]);
    // `size` is the record's field, 20 — not the Map member of that name,
    // which would count the record's two fields.
    expect([...(urls[0]?.searchParams ?? [])]).toEqual([["size", "20"]]);
  });
});
