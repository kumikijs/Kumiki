import type { AppShape } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { builtSummariesOf, codesOf, locatedOf, posOf } from "./helpers/diagnostics.ts";
import { compileOrFail, importModule, LOADABLE } from "./helpers/module.ts";

const TYPES = `
type NoteId = nominal Text where uuid
type Note   = {id: NoteId, text: Text where nonempty}
type Plain  = {n: Int, s: Text}
type Page(T) = {items: List(T), next: Option(Text)}
type Notes  = List(Note)
`;

/** A program of `defs` whose app is granted `cap`. */
const granted = (cap: string, defs: string): string => `
${TYPES}
${defs}

tile App = text("x")

app D
    caps   = [${cap}]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** A storage read whose `map-request` is `request`. */
const storageRead = (request: string, extra = ""): string =>
  granted(
    "storage.read",
    `${extra}

effect load cap=storage.read
            in=Unit
            out=Result(Option(Text), Text)
            map-request=${request}`,
  );

/** A program whose one storage read decodes with `decoder`, plus `extra` definitions. */
const program = (decoder: string, extra = ""): string =>
  storageRead(`{key: "k", decode: ${decoder}}`, extra);

type Check = (v: unknown) => { kind: string; args: unknown[]; path: unknown[] } | undefined;

/** The `decode` the compiled `load` effect hands its capability. */
async function decodeOf(decoder: string): Promise<unknown> {
  const mod = await importModule<{ default: AppShape }>(
    compileOrFail(program(decoder), LOADABLE),
    "decoder",
  );
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

  it("an argument with a value inside it spells no T, so it keeps the json sentinel", async () => {
    expect(await decodeOf("Decoder.Json({note: Note, n: 1})")).toBe("json");
    expect(await decodeOf("Decoder.Json((Note, 1))")).toBe("json");
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

  it("holds each member of a Tuple type to its own type, at its index", async () => {
    const check = (await decodeOf("Decoder.Json(Tuple(Note, Int))")) as Check;
    expect(check([{ id: UUID, text: "a" }, 1])).toBeUndefined();
    expect(check([{ id: "legacy-1", text: "a" }, 1])).toEqual({
      kind: "uuid",
      args: [],
      path: [0, "id"],
    });
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
    const out = compileOrFail(
      program("Decoder.Json(Map(NoteId, Note))", "slot notes : Map(NoteId, Note) = {}"),
    );
    const helper = /"decode": (_rq\d+)/.exec(out)?.[1];
    expect(helper).toBeDefined();
    expect(out).toContain(`refineFailure: ${helper}`);
  });
});

describe("Decoder.Json(T) resolves T as a type", () => {
  /** Each place a decoder can be written, with the program that writes `decoder` there. */
  const PLACES: { place: string; src: (decoder: string) => string }[] = [
    { place: "a storage read's map-request", src: (decoder) => program(decoder) },
    {
      place: "an http request's map-request",
      src: (decoder) =>
        granted(
          "http.get",
          `effect load cap=http.get
            in=Unit
            out=Result(Note, HttpError)
            map-request={url: "/note", decode: ${decoder}}`,
        ),
    },
    {
      place: "a fn that builds the request",
      src: (decoder) =>
        storageRead(`request("k")`, `fn request(key: Text) = {key: key, decode: ${decoder}}`),
    },
    {
      place: "a let inside a map-request",
      src: (decoder) => storageRead(`let d = ${decoder} in {key: "k", decode: d}`),
    },
  ];

  /** One E0117 for `name`, at the one place `src` writes it. */
  const undefinedAt = (src: string, name: string) => {
    expect(src.indexOf(name), `"${name}" is written once`).toBe(src.lastIndexOf(name));
    return [
      { code: "E0117", message: `Reference to undefined type "${name}"`, ...posOf(src, name) },
    ];
  };

  it.each(PLACES)("reports a misspelt Map key in $place at the name", ({ src }) => {
    const written = src("Decoder.Json(Map(NoteIdd, Note))");
    expect(locatedOf(written)).toEqual(undefinedAt(written, "NoteIdd"));
  });

  it.each(PLACES)("keeps $place clean when every name is a type", ({ src }) => {
    expect(locatedOf(src("Decoder.Json(Map(NoteId, Note))"))).toEqual([]);
  });

  it.each([
    { decoder: "Decoder.Json(Notte)", name: "Notte" },
    { decoder: "Decoder.Json(Txt)", name: "Txt" },
    { decoder: "Decoder.Json(Map(NoteId, Notte))", name: "Notte" },
    { decoder: "Decoder.Json(List(Notte))", name: "Notte" },
    { decoder: "Decoder.Json(Option(Notte))", name: "Notte" },
    { decoder: "Decoder.Json({note: Notte, n: Int})", name: "Notte" },
    { decoder: "Decoder.Json(Map(Text, List(Option(Notte))))", name: "Notte" },
    { decoder: "Decoder.Json(Lst(Note))", name: "Lst" },
  ])("reports $name in $decoder where it is written", ({ decoder, name }) => {
    const src = program(decoder);
    expect(locatedOf(src)).toEqual(undefinedAt(src, name));
  });

  it.each([
    "Decoder.Json(Text)",
    "Decoder.Json(Note)",
    "Decoder.Json(NoteId)",
    "Decoder.Json(List(Plain))",
    "Decoder.Json(Option(Note))",
    "Decoder.Json({note: Note, n: Int})",
    "Decoder.Json(Map(Text, List(Option(Plain))))",
    "Decoder.Json(Page(Note))",
    "Decoder.Json(Notes)",
    "Decoder.Json(Result(Note, Text))",
    "Decoder.Json(HttpError)",
    "Decoder.Json(Tuple(Note, Int))",
  ])("reports nothing for %s", (decoder) => {
    expect(locatedOf(program(decoder))).toEqual([]);
  });

  it.each([
    { decoder: "Decoder.Json({note: Notte, n: 1})", name: "Notte" },
    { decoder: "Decoder.Json(List({note: Notte, n: 1}))", name: "Notte" },
    { decoder: 'Decoder.Json(Map(Text, {note: Notte, s: "s"}))', name: "Notte" },
  ])("reports $name in $decoder, which also holds a value", ({ decoder, name }) => {
    const src = program(decoder);
    expect(locatedOf(src)).toEqual(undefinedAt(src, name));
  });

  it("reports a part that spells a type and a value beside it, in the order written", () => {
    const src = program("Decoder.Json(Map(Notte, nowhere))");
    expect(locatedOf(src).map(({ code, line, col }) => ({ code, line, col }))).toEqual([
      { code: "E0117", ...posOf(src, "Notte") },
      { code: "E0103", ...posOf(src, "nowhere") },
    ]);
  });

  it("reports nothing for a type beside a value when every name is a type", () => {
    expect(locatedOf(program("Decoder.Json({note: Note, n: 1})"))).toEqual([]);
  });

  it("leaves an argument after the first to the count, unresolved", () => {
    expect(codesOf(program("Decoder.Json(Note, Notte)"))).toEqual(["E0213"]);
  });

  it("checks the argument as any type is checked, its arity included", () => {
    const src = program("Decoder.Json(List(Note, Int))");
    expect(locatedOf(src).map(({ code, line, col }) => ({ code, line, col }))).toEqual([
      { code: "E0210", ...posOf(src, "List(Note, Int)") },
    ]);
  });

  it("refuses the build rather than lowering the decoder without the name's check", () => {
    expect(builtSummariesOf(program("Decoder.Json(Map(NoteIdd, Note))"))).toEqual([
      'E0117 Reference to undefined type "NoteIdd"',
    ]);
  });
});

describe("Decoder.Json(T) and a tuple, which is a value", () => {
  /** The one E0241 for the tuple written `tuple` in `src`, which names the type `type`. */
  const tupleAt = (src: string, tuple: string, type: string) => ({
    code: "E0241",
    message: `The tuple \`${tuple}\` is a value, and Decoder.Json decodes by a type: write the tuple type as \`${type}\``,
    ...posOf(src, tuple),
  });

  it.each([
    { decoder: "Decoder.Json((Note, Int))", tuple: "(Note, Int)", type: "Tuple(Note, Int)" },
    {
      decoder: "Decoder.Json((NoteId, Note, Text))",
      tuple: "(NoteId, Note, Text)",
      type: "Tuple(NoteId, Note, Text)",
    },
    {
      decoder: "Decoder.Json((Map(NoteId, Note), {n: Int}))",
      tuple: "(Map(NoteId, Note), {n: Int})",
      type: "Tuple(Map(NoteId, Note), {n: Int})",
    },
    { decoder: "Decoder.Json(List((Note, Int)))", tuple: "(Note, Int)", type: "Tuple(Note, Int)" },
    {
      decoder: "Decoder.Json({pair: (Note, Int), n: Int})",
      tuple: "(Note, Int)",
      type: "Tuple(Note, Int)",
    },
  ])("reports $tuple in $decoder as a tuple type to write", ({ decoder, tuple, type }) => {
    const src = program(decoder);
    expect(locatedOf(src)).toEqual([tupleAt(src, tuple, type)]);
  });

  it("resolves each item as a type, reported after the tuple", () => {
    const src = program("Decoder.Json((Notte, Int))");
    expect(locatedOf(src)).toEqual([
      tupleAt(src, "(Notte, Int)", "Tuple(Notte, Int)"),
      { code: "E0117", message: 'Reference to undefined type "Notte"', ...posOf(src, "Notte") },
    ]);
  });

  it("names no type with a value among its items, whose types are still resolved", () => {
    expect(locatedOf(program("Decoder.Json((Note, 1))"))).toEqual([]);
    const src = program("Decoder.Json((Notte, 1))");
    expect(locatedOf(src)).toEqual([
      { code: "E0117", message: 'Reference to undefined type "Notte"', ...posOf(src, "Notte") },
    ]);
  });

  it("leaves a tuple in an argument after the first to the count", () => {
    expect(codesOf(program("Decoder.Json(Note, (Note, Int))"))).toEqual(["E0213"]);
  });

  it("refuses the build rather than lowering the decoder with no check", () => {
    expect(builtSummariesOf(program("Decoder.Json((Note, Int))"))).toEqual([
      "E0241 The tuple `(Note, Int)` is a value, and Decoder.Json decodes by a type: write the tuple type as `Tuple(Note, Int)`",
    ]);
  });
});
