import { httpRequests, readHttpFixture, useHttpFixture } from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import { afterEach, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { clickContaining, tick, waitUntil, withMounted } from "./helpers/dom.ts";
import { type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("284-decode-checks-shape");

// 2026-03-07T10:00:00Z
const AT = 1772877600000;

/** A program whose one http.get decodes into `type`, keeping `.ok` and `.err` whole in slots. */
const program = (types: string, type: string): string => `${types}
slot got : Option(${type}) = None
slot err : Option(HttpError) = None

effect load cap=http.get
            in=Unit
            out=Result(${type}, HttpError)
            retry=exponential(3, 20ms, 2.0)
            map-request={url: "/api", decode: Decoder.Json(${type})}

reducer go  on=ui.click(Go)     do= emit load()
reducer ok  on=load.ok($v, _)   do= got := Some($v)
reducer bad on=load.err($e, _)  do= err := Some($e)

tile Go = button(text="Go")
tile App = column(Go)

app D
    caps   = [http.get]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

const USER = program("type User = {id: Int, name: Text}", "User");
const BOOKING = program("type Booking = {iso: Time, ms: Time, off: Time}", "Booking");

type Settled = { got: unknown; err: unknown; calls: number };

describe("Decoder.Json(T) through the built-in http handler", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
    useHttpFixture(null);
  });

  /** Click Go against a 200 answering `body`, and return what `.ok` and `.err` stored. */
  async function answer(src: string, body: unknown): Promise<Settled> {
    const text = JSON.stringify(body);
    double = stubFetch(() => new Response(text, { status: 200 }));
    const app = await loadSource(src);
    return withMounted(app, async (root) => {
      const live = defined(app.live, "the app's live map") as Record<string, { _tag?: string }>;
      clickContaining(root, "Go");
      await waitUntil(() => live.got?._tag === "Some" || live.err?._tag === "Some", {
        timeoutMs: 3000,
      });
      // Longer than the backoff, so a retry would be seen.
      await tick(200);
      return { got: live.got, err: live.err, calls: double?.calls.length ?? 0 };
    });
  }

  const refused = (message: string, body: unknown) => ({
    _tag: "Some",
    _0: { status: 200, message, body: { _tag: "Some", _0: JSON.stringify(body) } },
  });

  it.each([
    {
      what: "a field of the wrong type",
      body: { id: "7", title: "not a user" },
      message: "decode failed: expected Int at .id",
    },
    { what: "a missing field", body: { id: 7 }, message: "decode failed: missing at .name" },
    { what: "a body that is no record", body: [7, "Ann"], message: "decode failed: expected User" },
  ])("refuses $what as .err, sent once, and .ok never sees it", async ({ body, message }) => {
    const settled = await answer(USER, body);
    expect(settled).toEqual({ got: { _tag: "None" }, err: refused(message, body), calls: 1 });
  });

  it("still delivers a body that is a User to .ok as it came", async () => {
    const settled = await answer(USER, { id: 7, name: "Ann" });
    expect(settled.got).toEqual({ _tag: "Some", _0: { id: 7, name: "Ann" } });
    expect(settled.err).toEqual({ _tag: "None" });
  });

  it("reads each Time field from ISO text or a number of milliseconds", async () => {
    const body = { iso: "2026-03-07T10:00:00Z", ms: AT, off: "2026-03-07T19:00:00+09:00" };
    const settled = await answer(BOOKING, body);
    expect(settled.got).toEqual({ _tag: "Some", _0: { iso: AT, ms: AT, off: AT } });
  });

  it.each([
    { field: "ms", at: "1772877600000" },
    { field: "off", at: "2026-03-07T10:00:00+0000" },
  ])("refuses $at at .$field, which Time.parse refuses", async ({ field, at }) => {
    const body = { iso: "2026-03-07T10:00:00Z", ms: AT, off: AT, [field]: at };
    const settled = await answer(BOOKING, body);
    expect(settled.got).toEqual({ _tag: "None" });
    expect(settled.err).toEqual(refused(`decode failed: expected Time at .${field}`, body));
  });

  it("shows example 284's refusal and the instant it read, through its own fixture", async () => {
    useHttpFixture(readHttpFixture(EXAMPLE));
    const app = await loadApp(EXAMPLE);
    const text = await withMounted(app, async (root) => {
      await waitUntil(() => !(root.textContent ?? "").includes("loading"), { timeoutMs: 3000 });
      await tick(200);
      return root.textContent ?? "";
    });
    expect(text).toContain("user: 200 decode failed: expected Int at .id");
    expect(text).toContain(`booking: an hour later is ${AT + 3_600_000}`);
    expect(httpRequests().filter((r) => r === "GET /api/user")).toHaveLength(1);
  });
});

describe("Decoder.Json(T) through the built-in storage handler", () => {
  it("refuses a stored value of the wrong shape with the Text its out= declares", async () => {
    const app = await loadSource(`type Count = {n: Int}
slot why : Text = ""

effect load cap=storage.read
            in=Unit
            out=Result(Option(Count), Text)
            map-request={key: "count", decode: Decoder.Json(Count)}

reducer boot on=app.start      do= emit load()
reducer bad  on=load.err($e, _) do= why := $e

tile App = column(text(why))

app S
    caps   = [storage.read]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`);
    localStorage.setItem("count", JSON.stringify({ n: "1" }));
    const why = await withMounted(app, async () => {
      const live = defined(app.live, "the app's live map") as Record<string, unknown>;
      await waitUntil(() => live.why !== "", { timeoutMs: 3000 });
      return live.why;
    });
    expect(why).toBe("decode failed: expected Int at .n");
  });
});
