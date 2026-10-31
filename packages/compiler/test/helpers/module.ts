import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { codegen, compile, type ExtendedCodegenOptions, lex, parse } from "@kumikijs/compiler";
import { expect } from "vitest";

const TMP_ROOT = resolve(import.meta.dirname, "..", "test-tmp");

/** Options under which a generated module can be imported and its app instantiated. */
export const LOADABLE = { runtimeSpecifier: "@kumikijs/runtime", exportApp: true } as const;

export type ReducerShape = {
  name: string;
  apply: (
    live: Record<string, unknown>,
    payload: Record<string, unknown>,
  ) => { slots: Record<string, unknown> };
};

/** Writes `content` to `name` in a fresh directory under `root` and returns its path. */
export function writeTmpFile(
  prefix: string,
  name: string,
  content: string,
  root: string = TMP_ROOT,
): string {
  mkdirSync(root, { recursive: true });
  const file = join(mkdtempSync(join(root, `${prefix}-`)), name);
  writeFileSync(file, content);
  return file;
}

/** Imports generated ESM as a fresh module instance. */
export async function importModule<T>(js: string, prefix = "module"): Promise<T> {
  const file = writeTmpFile(prefix, "app.mjs", js);
  try {
    return (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as T;
  } finally {
    rmSync(resolve(file, ".."), { recursive: true, force: true });
  }
}

/** The generated module for `src`, failing the test with every diagnostic when it does not compile. */
export function compileOrFail(
  src: string,
  opts: ExtendedCodegenOptions = { runtimeSpecifier: "./runtime.js" },
): string {
  const result = compile(src, opts);
  if (result.kind !== "ok") {
    expect.fail(result.errors.map((e) => `${e.code} ${e.message}`).join("\n"));
  }
  return result.js;
}

/** A fresh app instance from `src`'s generated module. */
export async function loadApp<T>(src: string, prefix?: string): Promise<T> {
  const mod = await importModule<{ createApp: () => T }>(compileOrFail(src, LOADABLE), prefix);
  return mod.createApp();
}

/** The reducer `name` of a fresh app instance from `src`. */
export async function loadReducer(src: string, name: string): Promise<ReducerShape> {
  const app = await loadApp<{ reducers: ReducerShape[] }>(src, "reducer");
  const reducer = app.reducers.find((r) => r.name === name);
  if (!reducer) expect.fail(`the compiled module has no reducer named ${name}`);
  return reducer;
}

/** The generated line declaring `function <name>`, which is where a fn body's lowering lands. */
export function fnLowering(src: string, name = "probe"): string {
  const line = compileOrFail(src)
    .split("\n")
    .find((l) => l.includes(`function ${name}`));
  if (line === undefined) expect.fail(`no \`function ${name}\` in the generated module`);
  return line;
}

/** The generated module for `src` without running `check` first. */
export const loweredOf = (src: string): string =>
  codegen(parse(lex(src)), { runtimeSpecifier: "./runtime.js" }).js;
