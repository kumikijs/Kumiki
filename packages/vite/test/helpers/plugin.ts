import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, type PluginOption } from "vite";
import { expect } from "vitest";
import { type KumikiPluginOptions, kumiki } from "../../src/index.ts";

/** The `app` line every fixture whose root tile is `App` ends with. */
export const APP_A = `app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;

/** Vite hooks may be a function or an object hook; normalize to a callable. */
function hookOf<T>(hook: T | { handler: T } | undefined, name: string): T {
  const fn = typeof hook === "function" ? hook : (hook as { handler: T } | undefined)?.handler;
  if (!fn) throw new Error(`plugin has no ${name} hook`);
  return fn;
}

export function transformOf(opts?: KumikiPluginOptions) {
  return hookOf(kumiki(opts).transform, "transform");
}

export function resolveIdOf() {
  return hookOf(kumiki().resolveId, "resolveId");
}

export function configOf() {
  return hookOf(kumiki().config, "config");
}

/** A plugin context whose `error` throws the reported message and whose `warn` records. */
export function throwingCtx(warnings: unknown[] = []) {
  return {
    error(e: unknown): never {
      throw new Error(typeof e === "string" ? e : (e as Error).message);
    },
    warn(w: unknown): void {
      warnings.push(w);
    },
  };
}

export async function transformCode(
  src: string,
  file: string,
  opts?: KumikiPluginOptions,
  warnings?: unknown[],
): Promise<string> {
  const out = (await transformOf(opts).call(throwingCtx(warnings) as never, src, file)) as {
    code: string;
  } | null;
  if (!out) throw new Error("transform returned null");
  return out.code;
}

export type Reported = {
  message: string;
  id?: string;
  loc?: { file: string; line: number; column: number };
};

/** Run the transform with a context that records what `this.error` was given. */
export async function failureOf(
  src: string,
  file: string,
  opts?: KumikiPluginOptions,
): Promise<Reported> {
  let reported: Reported | undefined;
  const ctx = {
    error(e: unknown): never {
      reported = typeof e === "string" ? { message: e } : (e as Reported);
      throw new Error("ctx.error");
    },
    warn(): void {},
  };
  await expect(transformOf(opts).call(ctx as never, src, file)).rejects.toThrow();
  if (!reported) throw new Error("transform failed without calling ctx.error");
  return reported;
}

/** Write `src` as `app.kumiki` in a fresh directory under `root`; return its path. */
export function writeKumiki(root: string, prefix: string, src: string): string {
  const file = join(mkdtempSync(join(root, `${prefix}-`)), "app.kumiki");
  writeFileSync(file, src);
  return file;
}

/** A throwaway project under `where` holding `source` at `src/app.kumiki` and `main` at `src/main.ts`. */
export function project(where: string, source: string, main = ""): string {
  const root = mkdtempSync(join(where, "project-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.kumiki"), source);
  writeFileSync(join(root, "src", "main.ts"), main);
  return root;
}

/** `vite build` the project's `src/main.ts` into `outDir`; return the concatenated output. */
export async function buildInto(
  root: string,
  outDir: string,
  plugins: PluginOption[],
  workerPlugins: PluginOption[] = [],
): Promise<string> {
  await build({
    root,
    logLevel: "silent",
    plugins,
    worker: { format: "es", plugins: () => workerPlugins },
    build: {
      outDir,
      emptyOutDir: true,
      lib: { entry: join(root, "src", "main.ts"), formats: ["es"], fileName: "out" },
      minify: false,
    },
  });
  return readdirSync(outDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
}
