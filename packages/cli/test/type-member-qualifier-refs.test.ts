import { readFileSync } from "node:fs";
import { findReferences, load, renameDef } from "@kumikijs/cli";
import { check, lex, parse } from "@kumikijs/compiler";
import { app, feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { seedCopy } from "./helpers/files.ts";

const EXAMPLE = feature("177-type-member-qualifier-refs");
const TODOMVC = app("02-todomvc");

// The examples' header comments name the types in prose, which rename leaves alone.
function code(source: string): string {
  return source
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
}

function errorsOf(source: string): string[] {
  return check(parse(lex(source)))
    .filter((e) => e.severity !== "warning")
    .map((e) => `${e.code} ${e.message}`);
}

function renamed(file: string, qname: string, to: string): string {
  renameDef(file, qname, to);
  return readFileSync(file, "utf8");
}

describe("a type-member call's qualifier", () => {
  it("is a reference: refs lists the reducer that mints the ids", () => {
    const refs = findReferences(load(seedCopy(EXAMPLE)), "type.ItemId");
    expect(refs.map((r) => r.qname)).toContain("reducer.addItem");
  });

  it("is rewritten by rename, leaving a file that checks", { timeout: 30_000 }, () => {
    const source = renamed(seedCopy(EXAMPLE), "type.ItemId", "ThingId");
    expect(code(source)).toContain("let id = ThingId.fresh()");
    expect(code(source)).toContain("picked := ThingId.parse(ThingId.show(id))");
    expect(code(source)).not.toContain("ItemId");
    expect(errorsOf(source)).toEqual([]);
  });

  it("does not stop the todomvc id type from being renamed", { timeout: 30_000 }, () => {
    const source = renamed(seedCopy(TODOMVC), "type.TodoId", "TaskId");
    expect(code(source)).toContain("type TaskId = nominal Text where uuid");
    expect(code(source)).toContain("let id = TaskId.fresh()");
    expect(code(source)).not.toContain("TodoId.fresh()");
    expect(errorsOf(source)).toEqual([]);
  });
});
