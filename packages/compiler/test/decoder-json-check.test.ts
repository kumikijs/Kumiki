import { describe, expect, it } from "vitest";
import { compileOrFail, decodeHandedBy } from "./helpers/module.ts";

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

type Check = (v: unknown) => { kind: string; args: unknown[]; path: unknown[] } | undefined;

/** The `decode` the compiled `load` effect hands its capability. */
const decodeOf = (decoder: string): Promise<unknown> => decodeHandedBy(program(decoder));

const UUID = "0b8f2c1e-3d4a-4f5b-8c6d-7e8f9a0b1c2d";

describe("Decoder.Json(T) carries T's check to the handler", () => {
  it("a T with no predicate is still a check, of its shape", async () => {
    const check = (await decodeOf("Decoder.Json(Map(Text, List(Plain)))")) as Check;
    expect(typeof check).toBe("function");
    expect(check({ a: [{ n: 1, s: "x" }] })).toBeUndefined();
  });

  it("keeps the json sentinel only for an argument that names no type", async () => {
    expect(await decodeOf('Decoder.Json("Plain")')).toBe("json");
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

  it("walks the predicates with a slot's helper for the same type, not a second copy", () => {
    const slot = "slot notes : Map(NoteId, Note) = {}";
    const walks = (decoder: string) =>
      compileOrFail(program(decoder, slot)).match(/const _rq\d+ = /g)?.length;
    expect(walks("Decoder.Json(Map(NoteId, Note))")).toBe(walks('Decoder.Json("Plain")'));
  });
});
