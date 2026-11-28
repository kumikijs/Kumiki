// Evaluate a single .kumiki file written by an LLM:
//   - parse?
//   - typecheck?
//   - build?
//   - smoke? (mounts, renders, survives the generic interaction pass)
// Emits a JSON line summary to stdout. acceptance.mjs scores what the program does.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { smokeSource } from "@kumikijs/cli";
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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Recorded in eval.json, so it reads the same whichever directory or OS the harness ran from.
const recordedPath = (abs) => relative(repoRoot, abs).split(sep).join("/");

/** The vN-* task directory a file sits in. */
function taskDir(abs) {
  for (let dir = dirname(abs); dir !== dirname(dir); dir = dirname(dir)) {
    if (/^v\d+-/.test(basename(dir))) return dir;
  }
  return null;
}

// A task whose app makes requests ships the answers smoke gives it, in vN-*/smoke.http.json.
function smokeFixture(task) {
  const fixture = task && join(task, "smoke.http.json");
  return fixture && existsSync(fixture) ? JSON.parse(readFileSync(fixture, "utf8")) : null;
}

// A task that changes a program, rather than writing one, starts from vN-*/base.kumiki: how many
// lines the change added and removed.
function changedLines(task, abs) {
  const base = task && join(task, "base.kumiki");
  if (!base || !existsSync(base)) return undefined;
  const numstat = spawnSync("git", ["diff", "--no-index", "--numstat", base, abs], {
    encoding: "utf8",
  }).stdout;
  const [added = "0", removed = "0"] = numstat.trim().split(/\s+/);
  return { added: Number(added), removed: Number(removed) };
}

async function evalFile(abs) {
  const path = recordedPath(abs);
  if (!existsSync(abs)) {
    return { path, stage: "missing", error: "file not found" };
  }
  const source = readFileSync(abs, "utf8");
  const task = taskDir(abs);
  const result = {
    path,
    chars: source.length,
    loc: source.split("\n").length,
    cl100k: encodeCl100k(source).length,
    changed: changedLines(task, abs),
    parse: false,
    typecheck: false,
    build: false,
    smoke: false,
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

  if (result.build) {
    try {
      result.smoke = (await smokeSource(source, [], { httpFixture: smokeFixture(task) })).ok;
    } catch {
      result.smoke = false;
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
  results.push(await evalFile(abs));
}
console.log(JSON.stringify(results, null, 2));
