import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type CompileResult, compile, generateDts, LexError, ParseError } from "@kumikijs/compiler";
import {
  type CapabilityLookup,
  CapabilityManifestError,
  describeCapabilitySearch,
  nodeRuntimeBundleReader,
  resolveBuiltinIcons,
  resolveCapabilityManifest,
} from "@kumikijs/compiler/node";
import { normalizePath, type Plugin, type Rollup } from "vite";

export type KumikiPluginOptions = {
  /**
   * Inline the @kumikijs/runtime into each compiled module so it is self-contained.
   * Default: false — the module `import`s "@kumikijs/runtime" and the bundler ships one copy.
   *
   * Turning this on duplicates the runtime as soon as anything else imports it, which the documented way to use this plugin does (`mount` / `defineKumikiElement` come from the same package), and each further `.kumiki` import adds another copy.
   * The copies do not merely take space — the runtime keeps module-level state, and the injected state-style sheet is found by DOM id while its sequence counter restarts per copy.
   * Use it only for a module that must stand alone with no runtime dependency.
   */
  bundle?: boolean;
  /**
   * Emit a sibling `<name>.kumiki.gen.ts` of typed helpers (`KumikiSlots` / `KumikiProviders`) for each compiled file, for type-safe provider authoring.
   * Written only when its contents change.
   * Default: false.
   */
  types?: boolean;
  /**
   * Promote a11y warnings (E07xx) to compile errors. Mirrors the dev-server `--strict-a11y` flag so violations surface in Vite's error overlay during development.
   * Default: false.
   */
  strictA11y?: boolean;
  /**
   * Promote unknown literal `icon(name="<x>")` to compile errors as `E0704 unknown-icon`.
   * Mirrors `kumiki check --strict-icons`.
   * The domain is `@kumikijs/icons` ∪ every `theme.icons` block in the source; dynamic `icon(name=expr)` calls stay unchecked.
   * Default: false (the runtime `[name]` placeholder is the fail-soft default).
   */
  strictIcons?: boolean;
  /**
   * Promote `ui.<ev>(Tile#id)` selectors whose `#id` cannot match any of the target tile's literal `{id: "..."}` props to `E0212 selector-id-mismatch`.
   * Mirrors `kumiki check --strict-selector-id`. Tiles with computed or missing `{id}` (where the runtime `_dispatch` filter is authoritative) stay unblocked.
   * Default: false.
   */
  strictSelectorId?: boolean;
};

/** Rewriting unchanged contents would retrigger the watcher. */
function writeIfChanged(path: string, content: string): void {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return;
  writeFileSync(path, content);
}

const KUMIKI_RE = /\.kumiki$/;

const RUNTIME_SPECIFIER = "@kumikijs/runtime";

const VITE_QUERY_RE = /[?&](?:raw|url|worker|sharedworker)(?:&|$)/;

/**
 * The `.kumiki` file a Vite id asks this plugin to compile, or null when the id is not ours.
 * A query still names the compiled module unless it is one of Vite's own: the dev server's `?import`, a `?t=` / `?v=` cache buster, and the `?worker_file` id a worker loads its entry by are all the module itself.
 */
function kumikiFile(id: string): string | null {
  const q = id.indexOf("?");
  const file = q === -1 ? id : id.slice(0, q);
  if (!KUMIKI_RE.test(file)) return null;
  if (q === -1) return file;
  return VITE_QUERY_RE.test(id.slice(q)) ? null : file;
}

/**
 * Where this plugin's own copy of the runtime lives — the fallback for a project that installed `@kumikijs/vite` alone.
 * `@kumikijs/runtime` is a dependency of this package, so it is always on disk; under a strict node_modules layout it is not resolvable *from the project*, and without this the generated `import` would simply fail.
 */
function pluginLocalRuntime(ctx: Rollup.PluginContext): string | null {
  try {
    return normalizePath(fileURLToPath(import.meta.resolve(RUNTIME_SPECIFIER)));
  } catch (e) {
    ctx.warn(`${RUNTIME_SPECIFIER} could not be resolved from the plugin: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Where a diagnostic sits, in the form Rollup and Vite read it.
 * The compiler counts columns from 1, as `kumiki check` prints them; Rollup's `loc.column` counts from 0 (its `line` counts from 1), and Vite's code frame adds it to the offset of the line's start.
 * Every located report goes through here so the overlay's caret lands on the character the compiler named.
 */
function locOf(
  file: string,
  pos: { line: number; col: number },
): { file: string; line: number; column: number } {
  return { file, line: pos.line, column: pos.col - 1 };
}

/**
 * Render a failure about the author's source that reached us as an exception — a lex or parse error, which carry a position, or a malformed capability manifest, which names a file — as a diagnostic Vite can place.
 * A stack of compiler frames in the overlay tells the author nothing about their source.
 * Anything else is a defect in the toolchain rather than in the source, and is rethrown untouched: its stack and `cause` are the whole of what a bug report would carry, and flattening it to one line would throw that away.
 */
function reportThrown(ctx: Rollup.PluginContext, e: unknown, file: string): never {
  const located = e instanceof ParseError || e instanceof LexError;
  if (!located && !(e instanceof CapabilityManifestError)) throw e;
  const message = `Kumiki compile failed (${file}):\n  ${(e as Error).message}`;
  if (located) {
    const pos = (e as ParseError | LexError).pos;
    ctx.error({ message, id: file, loc: locOf(file, pos) });
  }
  ctx.error({ message, id: file });
}

export function kumiki(options: KumikiPluginOptions = {}): Plugin {
  const bundle = options.bundle ?? false;
  return {
    name: "vite-plugin-kumiki",
    enforce: "pre",
    config() {
      // A project with two copies of the runtime on disk (its own install plus a nested one) would otherwise bundle both; the resolution below only guarantees that the compiled module and the app agree.
      return { resolve: { dedupe: [RUNTIME_SPECIFIER] } };
    },
    async resolveId(source, importer, opts) {
      if (source !== RUNTIME_SPECIFIER) return null;
      // The project's own resolution wins, so the app and the compiled module share one copy; this only answers when there is nothing to share.
      const own = await this.resolve(source, importer, { ...opts, skipSelf: true });
      return own ? null : pluginLocalRuntime(this);
    },
    async transform(code, id) {
      const file = kumikiFile(id);
      if (file === null) return null;

      // Without the registry, `theme.icons` alone defines the strict-icons domain.
      let iconNames: string[] = [];
      if (options.strictIcons) {
        const registry = await resolveBuiltinIcons(file);
        if (registry) {
          iconNames = Object.keys(registry);
        } else {
          this.warn("strictIcons: @kumikijs/icons not resolved; checking against theme.icons only");
        }
      }

      // Not bounded by Vite's `root`: `kumiki dev` makes the `.kumiki` file's own directory the root so the static `import App` resolves, and a manifest that `kumiki check` reads has to be the manifest the dev server reads. One rule — up to the nearest `package.json` — is the only way every tool agrees about one file.
      let caps: CapabilityLookup;
      try {
        caps = resolveCapabilityManifest(file);
      } catch (e) {
        reportThrown(this, e, file);
      }

      const baseOpts = {
        runtimeSpecifier: RUNTIME_SPECIFIER,
        exportApp: true,
        bundle,
        ...(bundle ? { readRuntimeBundle: nodeRuntimeBundleReader } : {}),
        capabilities: caps.capabilities,
        ...(options.strictA11y ? { strictA11y: true as const } : {}),
        ...(options.strictIcons ? { strictIcons: true as const, iconNames } : {}),
        ...(options.strictSelectorId ? { strictSelectorId: true as const } : {}),
      } as const;

      // A lex or parse error leaves `compile` as an exception rather than a result.
      let first: CompileResult;
      try {
        first = compile(code, baseOpts);
      } catch (e) {
        reportThrown(this, e, file);
      }
      // Emitted before the error bail-out: `this.error` throws, and warnings found alongside a fatal error would be lost.
      for (const w of first.warnings) {
        this.warn({
          message: `${w.code} ${w.kind}: ${w.message}`,
          loc: locOf(file, w.pos),
        });
      }
      if (first.kind !== "ok") {
        const detail = first.errors.map((e) => `  ${e.code} ${e.message}`).join("\n");
        // A capability the manifest was supposed to register is the one error whose fix is a file the author cannot see from the message alone.
        const note = first.errors.some((e) => e.code === "E0302")
          ? `\n  ${describeCapabilitySearch(caps)}`
          : "";
        const message = `Kumiki compile failed (${file}):\n${detail}${note}`;
        const head = first.errors[0];
        this.error({ message, id: file, ...(head ? { loc: locOf(file, head.pos) } : {}) });
      }

      // Re-codegen with only the icons the first pass used, so unused paths never reach the output.
      let result = first;
      if (first.usedIcons.length > 0) {
        const registry = await resolveBuiltinIcons(file);
        if (registry) {
          const subset: Record<string, string> = {};
          for (const name of first.usedIcons) {
            const path = registry[name];
            if (typeof path === "string") subset[name] = path;
          }
          if (Object.keys(subset).length > 0) {
            const second = compile(code, { ...baseOpts, icons: subset });
            if (second.kind === "ok") result = second;
          }
        }
      }

      if (options.types) writeIfChanged(`${file}.gen.ts`, generateDts(result.program));

      return { code: result.js, map: null };
    },
  };
}

export default kumiki;
