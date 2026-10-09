import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import type { AppShape } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

const TYPES = `
type NoteId = nominal Text where uuid
type Note   = {id: NoteId, text: Text where nonempty}
type Plain  = {n: Int, s: Text}
`;

/** A program whose one storage read decodes with `decoder`, plus `extra` definitions. */
const program = (decoder: string, extra = ""): string => `
${TYPES}
${extra}

effect load cap=storage.read
            in=Unit
            out=Result(Option(Text), Text)
            map-request={key: "k", decode: ${decoder}}

tile App = text("x")

app D
    caps   = [storage.read]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

function js(src: string): string {
  const result = compile(src, { runtimeSpecifier: "@kumikijs/runtime", exportApp: true });
  if (result.kind !== "ok") throw new Error(JSON.stringify(result.errors));
  return result.js;
}

type Check = (v: unknown) => { kind: string; args: unknown[]; path: unknown[] } | undefined;

/** The `decode` the compiled `load` effect hands its capability. */
async function decodeOf(decoder: string): Promise<unknown> {
  const dir = mkdtempSync(join(TMP_ROOT, "decoder-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, js(program(decoder)));
  const mod: { default: AppShape } = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  const load = mod.default.effects.load;
  if (!load) throw new Error("the program no longer declares `load`");
  let seen: { decode?: unknown } | undefined;
  const caps = {
    provider: () => async (req: { decode?: unknown }) => {
      seen = req;
      return { kind: "ok", value: null };
    },
  } as unknown as Parameters<typeof load.invoke>[1];
  await load.invoke(undefined, caps, new AbortController().signal);
  if (!seen) throw new Error("the effect did not reach its provider");
  return seen.decode;
}

const UUID = "0b8f2c1e-3d4a-4f5b-8c6d-7e8f9a0b1c2d";

describe("Decoder.Json(T) carries T's check to the handler", () => {
  it("a T with no predicate keeps the json sentinel", async () => {
    expect(await decodeOf("Decoder.Json(Plain)")).toBe("json");
    expect(await decodeOf("Decoder.Json(Map(Text, List(Plain)))")).toBe("json");
  });

  it("a container of a refined record answers the first predicate refused, and where", async () => {
    const check = (await decodeOf("Decoder.Json(Map(NoteId, Note))")) as Check;
    expect(typeof check).toBe("function");
    expect(check({ [UUID]: { id: UUID, text: "a" } })).toBeUndefined();
    expect(check({ k3j9x: { id: UUID, text: "a" } })).toEqual({
      kind: "uuid",
      args: [],
      path: [{ key: "k3j9x" }],
    });
    expect(check({ [UUID]: { id: UUID, text: "" } })).toEqual({
      kind: "nonempty",
      args: [],
      path: [{ entry: UUID }, "text"],
    });
  });

  it("a T refined only on its own chain answers at the value itself", async () => {
    const check = (await decodeOf("Decoder.Json(NoteId)")) as Check;
    expect(check(UUID)).toBeUndefined();
    expect(check("k3j9x")).toEqual({ kind: "uuid", args: [], path: [] });
  });

  it("reads a record type written in place", async () => {
    const check = (await decodeOf("Decoder.Json({note: Note, n: Int})")) as Check;
    expect(check({ note: { id: "x", text: "a" }, n: 1 })).toEqual({
      kind: "uuid",
      args: [],
      path: ["note", "id"],
    });
  });

  it("is the same helper as a slot of the same type, not a second copy", () => {
    const out = js(
      program("Decoder.Json(Map(NoteId, Note))", "slot notes : Map(NoteId, Note) = {}"),
    );
    const helper = /"decode": (_rq\d+)/.exec(out)?.[1];
    expect(helper).toBeDefined();
    expect(out).toContain(`refineFailure: ${helper}`);
  });
});
