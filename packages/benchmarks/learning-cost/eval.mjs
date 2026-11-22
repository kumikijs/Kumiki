// Evaluate a single .kumiki file written by an LLM:
//   - parse?
//   - typecheck?
//   - build?
// Emits a JSON line summary to stdout.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { encode as encodeCl100k } from "gpt-tokenizer/encoding/cl100k_base";
import { compile } from "../../compiler/src/compile.ts";
import { lex } from "../../compiler/src/lexer.ts";
import { parse } from "../../compiler/src/parser.ts";
import { check } from "../../compiler/src/typecheck.ts";

function classify(err) {
  const c = err.code || "unknown";
  if (c === "E0103" || c === "E0105") return "unknown-name";
  if (c === "E0102" || c === "E0104") return "unknown-type";
  if (c === "E0001") return "missing-404-route";
  if (c.startsWith("E02")) return "typing";
  if (c.startsWith("E03")) return "effect-policy";
  if (c.startsWith("E04")) return "layer-violation";
  if (c.startsWith("E05")) return "capability";
  if (c.startsWith("E06")) return "reducer-payload";
  if (c.startsWith("E07")) return "a11y";
  return `other(${c})`;
}

function evalFile(path) {
  if (!existsSync(path)) {
    return { path, stage: "missing", error: "file not found" };
  }
  const source = readFileSync(path, "utf8");
  const result = {
    path,
    chars: source.length,
    loc: source.split("\n").length,
    cl100k: encodeCl100k(source).length,
    parse: false,
    typecheck: false,
    build: false,
    errorCount: 0,
    errorCategories: {},
    firstError: null,
  };

  // Parse
  let program;
  try {
    program = parse(lex(source));
    result.parse = true;
  } catch (e) {
    result.firstError = { stage: "parse", message: String(e?.message ?? e) };
    return result;
  }

  // Typecheck: a warning does not fail it, as `kumiki check` exits 0 on warnings alone.
  const errors = check(program).filter((e) => e.severity !== "warning");
  result.errorCount = errors.length;
  for (const err of errors) {
    const cat = classify(err);
    result.errorCategories[cat] = (result.errorCategories[cat] || 0) + 1;
  }
  if (errors.length === 0) {
    result.typecheck = true;
  } else {
    result.firstError = {
      stage: "typecheck",
      code: errors[0].code,
      message: errors[0].message,
      pos: errors[0].pos,
    };
  }

  // Build
  try {
    const r = compile(source, { runtimeSpecifier: "./runtime.js" });
    if (r.kind === "ok") {
      result.build = true;
    } else {
      // already captured in errors
    }
  } catch (e) {
    if (result.firstError === null) {
      result.firstError = { stage: "build", message: String(e?.message ?? e) };
    }
  }

  return result;
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("Usage: tsx eval.mjs <file.kumiki> [file2.kumiki ...]");
  process.exit(2);
}

const results = [];
for (const t of targets) {
  const abs = resolve(process.cwd(), t);
  results.push(evalFile(abs));
}
console.log(JSON.stringify(results, null, 2));
