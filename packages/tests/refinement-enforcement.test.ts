// The standard library's refined nominals are checks, not decoration (#352).
//
// `Email`, `Url`, `Uuid` and `HttpStatus` are declared in `stdlib-types.ts`
// rather than in the program, and codegen resolved a slot's refinement through
// the program's `type` definitions alone — so `slot e : Email` reached the
// runtime with no `refine` at all: every write landed, and `error(field=e)`
// had no predicate to render a message from. The corpus example next to this
// (`90-refinement-validation`) drives the predicates through a scenario; what
// is here is the resolution itself, including the alias hop a scenario cannot
// isolate.

import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSource } from "./helpers/load.ts";

const SOURCE = `
# An alias to a stdlib nominal names the same type, so it carries the same
# check — resolution has to follow the name, not stop at the first hop.
type Handle = Email

slot contact : Email      = ""
slot handle  : Handle     = "ada@example.com"
slot key     : Uuid       = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
slot code    : HttpStatus = 200
slot posts   : Map(Uuid, Text) = {}

reducer breakContact on=ui.click(BreakContactBtn) do= contact := "not-an-email"
reducer fixContact   on=ui.click(FixContactBtn)   do= contact := "grace@example.com"
reducer breakHandle  on=ui.click(BreakHandleBtn)  do= handle  := "nope"
reducer breakKey     on=ui.click(BreakKeyBtn)     do= key     := "not-a-uuid"
reducer breakCode    on=ui.click(BreakCodeBtn)    do= code    := 600
reducer abortCode    on=ui.click(AbortCodeBtn)    do= code    := 0
reducer addPost      on=ui.click(AddPostBtn)      do= posts["3f2504e0-4f89-11d3-9a0c-0305e82c3301"] := "ok"
reducer addBadPost   on=ui.click(AddBadPostBtn)   do= posts["p001"] := "draft"

tile BreakContactBtn = button(text="break-contact", onClick=breakContact)
tile FixContactBtn   = button(text="fix-contact", onClick=fixContact)
tile BreakHandleBtn  = button(text="break-handle", onClick=breakHandle)
tile BreakKeyBtn     = button(text="break-key", onClick=breakKey)
tile BreakCodeBtn    = button(text="break-code", onClick=breakCode)
tile AbortCodeBtn    = button(text="abort-code", onClick=abortCode)
tile AddPostBtn      = button(text="add-post", onClick=addPost)
tile AddBadPostBtn   = button(text="add-bad-post", onClick=addBadPost)

tile App = column(
             BreakContactBtn, FixContactBtn, BreakHandleBtn, BreakKeyBtn, BreakCodeBtn,
             AbortCodeBtn, AddPostBtn, AddBadPostBtn,
             error(field=contact))

app StdlibNominalRefinements
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

let errors: string[];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function mounted(): Promise<{
  app: Awaited<ReturnType<typeof loadSource>>;
  root: HTMLElement;
}> {
  const app = await loadSource(SOURCE);
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  return { app, root };
}

function click(root: HTMLElement, text: string): void {
  const btn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  btn.click();
}

describe("a slot typed with a stdlib nominal is checked by that nominal's predicate", () => {
  it("refuses a write the predicate rejects, and says so", async () => {
    const { app, root } = await mounted();

    click(root, "break-contact");

    expect(app.live?.contact).toBe("");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('slot "contact" cannot hold "not-an-email" (email)');
  });

  it("commits one it accepts", async () => {
    const { app, root } = await mounted();

    click(root, "fix-contact");

    expect(app.live?.contact).toBe("grace@example.com");
    expect(errors).toEqual([]);
  });

  it("follows an alias to the nominal it names", async () => {
    const { app, root } = await mounted();

    click(root, "break-handle");

    expect(app.live?.handle).toBe("ada@example.com");
    expect(errors[0]).toContain('slot "handle" cannot hold "nope" (email)');
  });

  // The one numeric nominal of the four, and the only one whose refinement is
  // `between` — so the stdlib table's non-Text entry is driven too.
  it("gates HttpStatus by the range the standard library declares", async () => {
    const { app, root } = await mounted();

    click(root, "break-code");

    expect(app.live?.code).toBe(200);
    expect(errors[0]).toContain('slot "code" cannot hold 600 (between(0, 599))');
  });

  // http.md §6.4.1: an abort, an auto-cancel, a timeout and a network failure
  // all answer `.err` with `status: 0` — no HTTP response at all. The type
  // every `HttpError` carries has to hold the value the runtime hands over, or
  // the reducer that stores it is discarded.
  it("admits 0, the status of a request that got no response", async () => {
    const { app, root } = await mounted();

    click(root, "abort-code");

    expect(app.live?.code).toBe(0);
    expect(errors).toEqual([]);
  });

  // A stdlib nominal as a container's key is a position inside the value
  // (language.md §1.3.3), so the id a Map is keyed by is checked there too —
  // and the failure names the key it found.
  it("checks a Map's Uuid keys, naming the key that fails", async () => {
    const { app, root } = await mounted();

    click(root, "add-post");
    click(root, "add-bad-post");

    expect(Object.keys(app.live?.posts as object)).toEqual([
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    ]);
    expect(errors[0]).toContain('(uuid at .keys["p001"])');
  });

  it("checks uuid by shape", async () => {
    const { app, root } = await mounted();

    click(root, "break-key");

    expect(app.live?.key).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect(errors[0]).toContain('slot "key" cannot hold "not-a-uuid" (uuid)');
  });

  // The other half of the same resolution: `error` reads the predicate off the
  // slot, so a slot with none has nothing to say. On a pristine form that is
  // the difference between a message and a blank.
  it("gives error(field=…) a message to render for a pristine invalid default", async () => {
    const { root } = await mounted();

    expect(root.textContent).toContain("Invalid email format");

    click(root, "fix-contact");

    expect(root.textContent).not.toContain("Invalid email format");
  });
});
