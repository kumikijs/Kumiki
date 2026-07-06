// Mechanized guard for issue #157: the diagnostic code set emitted by the
// compiler must equal the code set documented in the normative spec — on both
// EN (docs/spec/errors.md) and JA (docs/ja/spec/errors.md) tracks.
//
// Design decision (documented in docs/spec/errors.md / docs/ja/spec/errors.md
// under "The Form of an Error" / "エラーの形"): coded diagnostics are emitted
// only by packages/compiler/src/typecheck.ts. The lexer and parser throw
// bare ParseError values (message + pos) with no code by design — the parse
// stage stops at the first error and no recovery table exists to hang codes
// off. This test therefore extracts implementation-side codes from
// typecheck.ts only.
//
// If a new code is introduced, add it to typecheck.ts AND to both errors.md
// files in the same PR. If a code is removed from typecheck.ts, drop its
// section from both errors.md files in the same PR. The symmetric-difference
// assertion below will fail the CI until both sides agree.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/compiler/test/ → repo root
const repoRoot = path.resolve(here, "..", "..", "..");

const CODE_RE = /code:\s*"(E\d{4}|W\d{4})"/g;
const HEADING_RE = /^### (E\d{4}|W\d{4})\b/gm;

function collect(source: string, re: RegExp): Set<string> {
  const set = new Set<string>();
  for (const m of source.matchAll(re)) set.add(m[1]!);
  return set;
}

function diff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort();
}

function report(label: string, implSide: Set<string>, specSide: Set<string>): string {
  const missingInSpec = diff(implSide, specSide);
  const missingInImpl = diff(specSide, implSide);
  const lines: string[] = [];
  if (missingInSpec.length > 0) {
    lines.push(
      `[${label}] impl emits but spec is missing: ${missingInSpec.join(", ")} — add a "### <code> \`<kind>\`" section to the spec.`,
    );
  }
  if (missingInImpl.length > 0) {
    lines.push(
      `[${label}] spec documents but impl no longer emits: ${missingInImpl.join(", ")} — drop the section from the spec (or restore the code in typecheck.ts).`,
    );
  }
  return lines.join("\n");
}

describe("spec ⇆ typecheck code-set drift (issue #157)", () => {
  const implSrc = readFileSync(
    path.join(repoRoot, "packages", "compiler", "src", "typecheck.ts"),
    "utf8",
  );
  const specEnSrc = readFileSync(path.join(repoRoot, "docs", "spec", "errors.md"), "utf8");
  const specJaSrc = readFileSync(path.join(repoRoot, "docs", "ja", "spec", "errors.md"), "utf8");
  const implCodes = collect(implSrc, CODE_RE);
  const specEnCodes = collect(specEnSrc, HEADING_RE);
  const specJaCodes = collect(specJaSrc, HEADING_RE);

  it("EN spec (docs/spec/errors.md) documents exactly the codes typecheck.ts emits", () => {
    const msg = report("EN", implCodes, specEnCodes);
    if (msg !== "") expect.fail(msg);
    expect(msg).toBe("");
  });

  it("JA spec (docs/ja/spec/errors.md) documents exactly the codes typecheck.ts emits", () => {
    const msg = report("JA", implCodes, specJaCodes);
    if (msg !== "") expect.fail(msg);
    expect(msg).toBe("");
  });
});
