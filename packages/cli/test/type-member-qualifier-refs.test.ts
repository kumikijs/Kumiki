import { readFileSync } from "node:fs";
import { findReferences, load, removeDef } from "@kumikijs/cli";
import { lex } from "@kumikijs/compiler";
import { app, feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { errorsOf } from "./helpers/diagnostics.ts";
import { APP_A, renamed, seed, seedCopy } from "./helpers/files.ts";

const EXAMPLE = feature("177-type-member-qualifier-refs");
const TODOMVC = app("02-todomvc");

/** Whether `source` names `ident` in code. The example's header also names its type in prose. */
const names = (source: string, ident: string): boolean =>
  lex(source).some((t) => t.kind === "ident" && t.value === ident);

describe("a type-member call's qualifier", () => {
  it("is a reference: refs lists the reducer that mints the ids, at each call", () => {
    const refs = findReferences(load(seedCopy(EXAMPLE)), "type.ItemId");
    expect(refs.filter((r) => r.qname === "reducer.addItem").map((r) => r.line)).toEqual([24, 26]);
  });

  it("is rewritten by rename, leaving a file that checks", () => {
    const source = renamed(seedCopy(EXAMPLE), "type.ItemId", "ThingId");
    expect(source).toContain("let id = ThingId.fresh()");
    expect(source).toContain("picked := ThingId.parse(ThingId.show(id))");
    expect(names(source, "ItemId")).toBe(false);
    expect(errorsOf(source)).toEqual([]);
  });

  it("makes the calling reducer a dependent that remove --cascade takes along", () => {
    // The qualifier is the type's only use, so a cascade that missed it left the reducer naming a
    // removed type, and the remove was rolled back on E0117.
    const file = seed(`type Token = nominal Text where uuid
slot shown : Text = ""
reducer mint on=ui.click(App) do= shown := Token.show(Token.fresh())
tile App = button(text="mint")
${APP_A}`);
    expect(removeDef(file, "type.Token", true).removed).toEqual(["type.Token", "reducer.mint"]);
    expect(names(readFileSync(file, "utf8"), "Token")).toBe(false);
  });

  it("does not stop the todomvc id type from being renamed, in its decoder too", () => {
    const source = renamed(seedCopy(TODOMVC), "type.TodoId", "TaskId");
    expect(source).toContain("let id = TaskId.fresh()");
    expect(source).toContain("decode: Decoder.Json(Map(TaskId, Todo))");
    expect(source).not.toContain("TodoId");
  });
});
