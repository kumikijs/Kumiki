// Vite plugin for Kumiki — the build-integration ecosystem seam. It lets a normal
// Vite (and therefore Next/Astro/etc.) project `import App from "./app.kumiki"`:
// each `.kumiki` source is compiled to an ESM module that default-exports the
// compiled AppShape (no auto-mount — the importer owns mounting, typically via
// `mount` or `defineKumikiElement` from @kumikijs/runtime).
//
// The compiler core is browser-safe; the Node-only capability/runtime-bundle
// helpers live in @kumikijs/compiler/node and are used here (the plugin runs in
// Node during build/dev).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type CompileResult, compile, generateDts, LexError, ParseError } from "@kumikijs/compiler";
import {
  type CapabilityLookup,
  describeCapabilitySearch,
  nodeRuntimeBundleReader,
  resolveBuiltinIcons,
  resolveCapabilityManifest,
} from "@kumikijs/compiler/node";
import { normalizePath, type Plugin, type Rollup } from "vite";

export type KumikiPluginOptions = {
  /**
   * Inline the @kumikijs/runtime into each compiled module so it is
   * self-contained. Default: false — the module `import`s "@kumikijs/runtime"
   * and the bundler ships one copy.
   *
   * Turning this on duplicates the runtime as soon as anything else imports
   * it, which the documented way to use this plugin does (`mount` /
   * `defineKumikiElement` come from the same package): the counter example
   * builds to 129 kB inlined against 82 kB shared, and each further `.kumiki`
   * import adds another copy. The copies do not merely take space — the
   * runtime keeps module-level state, and the injected state-style sheet is
   * found by DOM id while its sequence counter restarts per copy. Use it only
   * for a module that must stand alone with no runtime dependency.
   */
  bundle?: boolean;
  /**
   * Emit a sibling `<name>.kumiki.gen.ts` of typed helpers (Slots / Providers)
   * for each compiled file, for type-safe provider authoring. Written only when
   * its contents change. Default: false.
   */
  types?: boolean;
  /**
   * Promote a11y warnings (E07xx) to compile errors. Mirrors the dev-server
   * `--strict-a11y` flag (spec §10.7) so violations surface in Vite's error
   * overlay during development. Default: false.
   */
  strictA11y?: boolean;
  /**
   * Promote unknown literal `icon(name="<x>")` to compile errors as
   * `E0704 unknown-icon`. Mirrors `kumiki check --strict-icons`. The domain
   * is `@kumikijs/icons` ∪ every `theme.icons` block in the source; dynamic
   * `icon(name=expr)` calls stay unchecked. Default: false (the runtime
   * `[name]` placeholder is the fail-soft default, spec §4.8.3).
   */
  strictIcons?: boolean;
  /**
   * Promote `ui.<ev>(Tile#id)` selectors whose `#id` cannot match any of the
   * target tile's literal `{id: "..."}` props to `E0212 selector-id-mismatch`.
   * Mirrors `kumiki check --strict-selector-id`. Tiles with computed or
   * missing `{id}` (where the runtime `_dispatch` filter is authoritative)
   * stay unblocked. Default: false.
   */
  strictSelectorId?: boolean;
};

/** Write `path` only if its current contents differ — avoids spurious watch churn. */
function writeIfChanged(path: string, content: string): void {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return;
  writeFileSync(path, content);
}

const KUMIKI_RE = /\.kumiki$/;

/** The specifier the generated module imports when the runtime is not inlined. */
const RUNTIME_SPECIFIER = "@kumikijs/runtime";

/** Strip a Vite id's query/suffix (`/abs/app.kumiki?import` → `/abs/app.kumiki`). */
function cleanId(id: string): string {
  const q = id.indexOf("?");
  return q === -1 ? id : id.slice(0, q);
}

/**
 * Where this plugin's own copy of the runtime lives — the fallback for a
 * project that installed `@kumikijs/vite` alone. `@kumikijs/runtime` is a
 * dependency of this package, so it is always on disk; under a strict
 * node_modules layout it is not resolvable *from the project*, and without
 * this the generated `import` would simply fail. Resolved through the import
 * conditions, since the runtime's `exports` map defines no `require` entry.
 */
function pluginLocalRuntime(): string | null {
  try {
    return normalizePath(fileURLToPath(import.meta.resolve(RUNTIME_SPECIFIER)));
  } catch {
    return null;
  }
}

/**
 * Render a failure that reached us as an exception — a lex or parse error, or
 * a malformed capability manifest — as a diagnostic Vite can place. Both
 * carry a source position; anything else is reported against the file alone,
 * because a stack of compiler frames in the overlay tells the author nothing
 * about their source.
 */
function reportThrown(ctx: Rollup.PluginContext, e: unknown, file: string): never {
  const message = `Kumiki compile failed (${file}):\n  ${e instanceof Error ? e.message : String(e)}`;
  const pos = e instanceof ParseError || e instanceof LexError ? e.pos : null;
  if (pos) ctx.error({ message, id: file, loc: { file, line: pos.line, column: pos.col } });
  ctx.error({ message, id: file });
}

export function kumiki(options: KumikiPluginOptions = {}): Plugin {
  const bundle = options.bundle ?? false;
  // Vite's project root, once it is known: the capability-manifest search
  // stops there rather than guessing from `package.json`.
  let root: string | undefined;
  return {
    name: "vite-plugin-kumiki",
    enforce: "pre",
    config() {
      // A project with two copies of the runtime on disk (its own install plus
      // a nested one) would otherwise bundle both; the resolution below only
      // guarantees that the compiled module and the app agree.
      return { resolve: { dedupe: [RUNTIME_SPECIFIER] } };
    },
    configResolved(resolved) {
      root = resolved.root;
    },
    async resolveId(source, importer, opts) {
      if (source !== RUNTIME_SPECIFIER) return null;
      // The project's own resolution wins, so the app and the compiled module
      // share one copy; this only answers when there is nothing to share.
      const own = await this.resolve(source, importer, { ...opts, skipSelf: true });
      return own ? null : pluginLocalRuntime();
    },
    async transform(code, id) {
      const file = cleanId(id);
      if (!KUMIKI_RE.test(file)) return null;

      // When --strict-icons is on, resolve @kumikijs/icons up front so the
      // closed name set reaches `check()` on the first pass. The resolver is
      // cached per project root, so this is a one-time cost. When the
      // registry is absent or strictIcons is off, `iconNames` stays empty —
      // `theme.icons` then defines the domain. The degraded-mode warning is
      // emitted through Rollup's plugin context so it shows up in the build
      // log next to other Vite diagnostics.
      let iconNames: string[] = [];
      if (options.strictIcons) {
        const registry = await resolveBuiltinIcons(file);
        if (registry) {
          iconNames = Object.keys(registry);
        } else {
          this.warn("strictIcons: @kumikijs/icons not resolved; checking against theme.icons only");
        }
      }

      let caps: CapabilityLookup;
      try {
        caps = resolveCapabilityManifest(file, root ? { root } : {});
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

      // A lex or parse error leaves `compile` as an exception rather than a
      // result — the likeliest failure while typing, and the one that used to
      // reach the overlay as a stack trace with no line to jump to.
      let first: CompileResult;
      try {
        first = compile(code, baseOpts);
      } catch (e) {
        reportThrown(this, e, file);
      }
      // Surface non-fatal warnings (W02xx) through Rollup's plugin context so
      // they show in Vite's overlay/build log without breaking the import.
      // Emit BEFORE the error-bail path so warnings detected alongside a
      // fatal error aren't silently lost when `this.error` throws.
      for (const w of first.warnings) {
        this.warn({
          message: `${w.code} ${w.kind}: ${w.message}`,
          loc: { file, line: w.pos.line, column: w.pos.col },
        });
      }
      if (first.kind !== "ok") {
        const detail = first.errors.map((e) => `  ${e.code} ${e.message}`).join("\n");
        // A capability the manifest was supposed to register is the one error
        // whose fix is a file the author cannot see from the message alone.
        const note = first.errors.some((e) => e.code === "E0302")
          ? `
  ${describeCapabilitySearch(caps)}`
          : "";
        const message = `Kumiki compile failed (${file}):\n${detail}${note}`;
        // Hand the first error's source position to Rollup so Vite's overlay
        // links straight to the offending line instead of just naming the
        // file. `loc.column` is 1-based in the parser; Rollup expects the
        // same here. `first.errors` is non-empty here (kind !== "ok" ⇒
        // errors.length > 0) but TS can't infer that.
        const head = first.errors[0];
        if (head) {
          this.error({
            message,
            id: file,
            loc: { file, line: head.pos.line, column: head.pos.col },
          });
        } else {
          this.error(message);
        }
      }

      // Auto-bundle referenced icons (#101). When the project has
      // @kumikijs/icons installed, look up each name surfaced by the first
      // pass and re-codegen with `icons` populated so only used paths reach
      // the output. When the package is absent we fall through; theme.icons
      // remains the manual escape hatch.
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
