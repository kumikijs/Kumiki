import { app, feature } from "@kumikijs/examples";
import { type AppShape, mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { clickByText, type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("164-decode-refused-value");
const TODOMVC = app("02-todomvc");

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitUntil(done: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await tick(5);
  }
}

type Mounted = { root: HTMLElement; live: Record<string, unknown>; dispose: () => void };

async function mountUntil(
  app: AppShape,
  done: (m: Omit<Mounted, "dispose">) => boolean,
): Promise<Mounted> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const { dispose } = mount(app, root);
  const live = defined(app.live, "the app's live map") as Record<string, unknown>;
  try {
    await waitUntil(() => done({ root, live }));
  } catch (e) {
    dispose();
    root.remove();
    throw e;
  }
  return {
    root,
    live,
    dispose: () => {
      dispose();
      root.remove();
    },
  };
}

const UUID = "0b8f2c1e-3d4a-4f5b-8c6d-7e8f9a0b1c2d";
const todo = (id: string, text: string) => ({ id, text, done: false, createdAt: 1 });

describe("a Decoder.Json(T) whose T refuses the stored value", () => {
  it("answers .err, so example 164 starts empty and usable", async () => {
    const m = await mountUntil(await loadApp(EXAMPLE), ({ live }) => live.status !== "loading");
    try {
      expect(m.live.status).toBe("started empty");
      clickByText(m.root, "Add note");
      await tick(20);
      expect(m.root.textContent).toContain("notes: 1");
    } finally {
      m.dispose();
    }
  });

  it("gets 02-todomvc past its boot screen when one stored entry is refused", async () => {
    // A base-36 id, as an older `fresh()` wrote them, beside one the type takes.
    localStorage.setItem(
      "todos",
      JSON.stringify({ k3j9x: todo("k3j9x", "old"), [UUID]: todo(UUID, "kept") }),
    );
    const m = await mountUntil(await loadApp(TODOMVC), ({ live }) => live.ready === true);
    try {
      expect(m.live.todos).toEqual({});
      expect(m.root.textContent).toContain("0 items left");
    } finally {
      m.dispose();
    }
  });

  it("still restores 02-todomvc from a value the type accepts", async () => {
    localStorage.setItem("todos", JSON.stringify({ [UUID]: todo(UUID, "kept") }));
    const m = await mountUntil(await loadApp(TODOMVC), ({ live }) => live.ready === true);
    try {
      expect(Object.keys(m.live.todos as object)).toEqual([UUID]);
      expect(m.root.textContent).toContain("kept");
    } finally {
      m.dispose();
    }
  });

  it("names the predicate and where it failed in the error's Text", async () => {
    const app = await loadSource(`type NoteId = nominal Text where uuid
type Note = {id: NoteId, text: Text where nonempty}
slot why : Text = ""

effect load cap=storage.read
            in=Unit
            out=Result(Option(List(Note)), Text)
            map-request={key: "notes", decode: Decoder.Json(List(Note))}

reducer boot on=app.start do= emit load()
reducer bad on=load.err($e, _) do= why := $e

tile App = column(text("x"))

app D
    caps = [storage.read]
    routes = {"/" -> App, "/404" -> App}
    init = []
`);
    localStorage.setItem(
      "notes",
      JSON.stringify([
        { id: UUID, text: "a" },
        { id: UUID, text: "" },
      ]),
    );
    const m = await mountUntil(app, ({ live }) => live.why !== "");
    try {
      expect(m.live.why).toBe("decode failed: nonempty at [1].text");
    } finally {
      m.dispose();
    }
  });
});

describe("an HTTP Decoder.Json(T) whose T refuses the body", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  const PROGRAM = `type UserId = nominal Text where uuid
type User = {id: UserId, name: Text}
slot got : Option(User) = None
slot err : Option(HttpError) = None

effect loadUser cap=http.get
                in=Unit
                out=Result(User, HttpError)
                retry=exponential(3, 20ms, 2.0)
                map-request={url: "/me", decode: Decoder.Json(User)}

reducer go on=ui.click(Go) do= emit loadUser()
reducer ok on=loadUser.ok($u, _) do= got := Some($u)
reducer bad on=loadUser.err($e, _) do= err := Some($e)

tile Go = button(text="Go")
tile App = column(Go)

app H
    caps = [http.get]
    routes = {"/" -> App, "/404" -> App}
    init = []
`;

  async function clickGo(body: string): Promise<Record<string, unknown>> {
    double = stubFetch(() => new Response(body, { status: 200 }));
    const app = await loadSource(PROGRAM);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { dispose } = mount(app, root);
    try {
      clickByText(root, "Go");
      const live = defined(app.live, "the app's live map") as Record<string, { _tag?: string }>;
      await waitUntil(() => live.got?._tag === "Some" || live.err?._tag === "Some");
      // Longer than any backoff, so a retry would be seen.
      await tick(200);
      return live;
    } finally {
      dispose();
      root.remove();
    }
  }

  it("is an HttpError with the response's status and text, sent once", async () => {
    const body = JSON.stringify({ id: "nope", name: "Ann" });
    const live = await clickGo(body);
    expect(double?.calls).toHaveLength(1);
    expect(live.got).toEqual({ _tag: "None" });
    expect(live.err).toEqual({
      _tag: "Some",
      _0: { status: 200, message: "decode failed: uuid at .id", body },
    });
  });

  it("is still .ok for a body the type accepts", async () => {
    const live = await clickGo(JSON.stringify({ id: UUID, name: "Ann" }));
    expect(live.got).toEqual({ _tag: "Some", _0: { id: UUID, name: "Ann" } });
  });
});
