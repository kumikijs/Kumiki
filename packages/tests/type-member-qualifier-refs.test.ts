// A type-member call — `ItemId.fresh()`, `ItemId.parse(t)`, `ItemId.show(v)` —
// names its type by its qualifier (errors.md E0117), so the call is a
// reference to that type: `refs` lists the definition that makes it, and
// `rename` rewrites the qualifier with the rest (ai-edit.md §9.2), so an id
// type minted with `fresh()` can be renamed and the file still checks.

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findReferences, load, renameDef } from "@kumikijs/cli";
import { check, lex, parse } from "@kumikijs/compiler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "..", "examples");
const EXAMPLE = join(examples, "features", "177-type-member-qualifier-refs.kumiki");
const TODOMVC = join(examples, "apps", "02-todomvc", "app.kumiki");

/** The source without its `#` comment lines, which name the types in prose. */
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

describe("a type-member call's qualifier", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-type-member-refs-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function copy(from: string): string {
    const path = join(dir, "app.kumiki");
    copyFileSync(from, path);
    return path;
  }

  it("is a reference: refs lists the reducer that mints the ids", () => {
    const refs = findReferences(load(copy(EXAMPLE)), "type.ItemId");
    expect(refs.map((r) => r.qname)).toContain("reducer.addItem");
  });

  it("is rewritten by rename, leaving a file that checks", { timeout: 30_000 }, () => {
    const path = copy(EXAMPLE);
    renameDef(path, "type.ItemId", "ThingId");
    const source = readFileSync(path, "utf8");
    expect(code(source)).toContain("let id = ThingId.fresh()");
    expect(code(source)).toContain("picked := ThingId.parse(ThingId.show(id))");
    expect(code(source)).not.toContain("ItemId");
    expect(errorsOf(source)).toEqual([]);
  });

  it("does not stop the todomvc id type from being renamed", { timeout: 30_000 }, () => {
    const path = copy(TODOMVC);
    renameDef(path, "type.TodoId", "TaskId");
    const source = readFileSync(path, "utf8");
    expect(code(source)).toContain("type TaskId = nominal Text where uuid");
    expect(code(source)).toContain("let id = TaskId.fresh()");
    expect(code(source)).not.toContain("TodoId.fresh()");
    expect(errorsOf(source)).toEqual([]);
  });
});
