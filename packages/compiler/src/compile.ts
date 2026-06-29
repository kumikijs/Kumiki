import type { Program } from "./ast.ts";
import { type CodegenOptions, codegen, RUNTIME_HELPERS } from "./codegen.ts";
import { lex } from "./lexer.ts";
import { parse } from "./parser.ts";
import { check, type KumikiError } from "./typecheck.ts";

export type CompileOk = {
  kind: "ok";
  js: string;
  program: Program;
  /**
   * The granular runtime modules (file basenames, no extension) the generated
   * code imports when compiled with `runtimeModulesDir` (#71) — `kumiki build`
   * ships exactly these from `@kumikijs/runtime/modules/`.
   */
  runtimeModules: string[];
  /**
   * Icon names referenced by `icon(name="<literal>")` calls in the source
   * (#101). The Vite plugin / CLI use this to look up matching SVG path data
   * in `@kumikijs/icons` and re-compile with the `icons` option so only used
   * paths reach the bundle.
   */
  usedIcons: string[];
  /**
   * Non-fatal diagnostics surfaced by `check()` (severity `"warning"`).
   * Always defined; `[]` when there are none. CLI/Vite render these to
   * stderr / Rollup `this.warn` without blocking the build.
   */
  warnings: KumikiError[];
};
export type CompileFail = {
  kind: "fail";
  errors: KumikiError[];
  /**
   * Warnings observed in the same check pass that produced the errors. Kept
   * alongside `errors` so CLI/Vite can render them even when the compile
   * fails — without this field a warning detected before the fatal error
   * would be silently dropped together with the (never-reached) `CompileOk`.
   */
  warnings: KumikiError[];
};
export type CompileResult = CompileOk | CompileFail;

export type ExtendedCodegenOptions = CodegenOptions & {
  /** Inline the runtime source into the output so the generated module needs no external import. */
  bundle?: boolean;
  /**
   * Returns the prebuilt runtime bundle JS. Required when `bundle` is true.
   * This is injected (rather than read here) to keep the compiler free of any
   * Node-only imports, so it can run unchanged in the browser. Node callers can
   * use `nodeRuntimeBundleReader` from `@kumikijs/compiler/node`.
   */
  readRuntimeBundle?: () => string;
  /** Project-registered capabilities (from `kumiki.caps.json`) accepted in `app.caps`. */
  capabilities?: string[];
  /**
   * Resolve and read an episode-log file for an `episode-test load = "<path>"`
   * directive (spec §8.6). The compiler inlines the parsed log into the
   * emitted test so the runtime doesn't need filesystem access. Node callers
   * use `nodeEpisodeLogReader` from `@kumikijs/compiler/node`; passing
   * `undefined` is fine when the source has no `episode-test`.
   */
  readEpisodeLog?: (relativePath: string) => string;
  /**
   * Surface a11y findings (E07xx) as compilation errors. Mirrors
   * `kumiki check --strict-a11y` (spec §10.7 dev server flag). When false or
   * unset, `check()` filters E07xx codes out entirely so they never block
   * compile and never reach the caller — there is no "warning" tier here.
   */
  strictA11y?: boolean;
  /**
   * Promote literal `icon(name="<x>")` calls whose name is in neither
   * `iconNames` nor any `theme.icons` block to `E0704 unknown-icon`.
   * Mirrors `kumiki check --strict-icons`; default-off so the runtime
   * placeholder (spec §4.8.3) stays fail-soft. Dynamic `icon(name=expr)`
   * calls are never checked.
   */
  strictIcons?: boolean;
  /**
   * The closed icon-name set from `@kumikijs/icons` (typically
   * `Object.keys(ALL_ICONS)`). When omitted, only names declared in the
   * source's `theme.icons` blocks satisfy the strict-icons check, matching
   * standalone apps that do not depend on the registry package.
   */
  iconNames?: Iterable<string>;
};

/** Inline a runtime bundle into generated module code, stripping the bridging import/export lines. */
export function inlineRuntime(generatedJs: string, runtimeBundleJs: string): string {
  // Drop the runtime's final `export { ... }` line.
  const sanitized = runtimeBundleJs.replace(/^export \{[^}]*\};?\s*$/m, "");
  // Drop the generated code's `import { mount, ... } from "..."` line.
  const withoutImport = generatedJs.replace(/^import \{[^}]*\} from "[^"]*";\s*$/m, "");
  return `${sanitized}\n${withoutImport}`;
}

export function compile(source: string, opts: ExtendedCodegenOptions): CompileResult {
  if (opts.bundle && opts.runtimeModulesDir) {
    // The inlining path strips the generated module's single import line; the
    // modular header has many, so the two modes cannot combine.
    throw new Error("compile(): `bundle: true` and `runtimeModulesDir` are mutually exclusive.");
  }
  const tokens = lex(source);
  const program = parse(tokens);
  const diags = check(program, {
    capabilities: opts.capabilities ?? [],
    ...(opts.strictA11y ? { strictA11y: true } : {}),
    ...(opts.strictIcons ? { strictIcons: true } : {}),
    ...(opts.iconNames ? { iconNames: opts.iconNames } : {}),
  });
  const errors = diags.filter((d) => d.severity !== "warning");
  const warnings = diags.filter((d) => d.severity === "warning");
  if (errors.length > 0) return { kind: "fail", errors, warnings };

  const generated = codegen(program, opts);
  let js = `${RUNTIME_HELPERS}\n${generated.js}`;

  if (opts.bundle) {
    if (!opts.readRuntimeBundle) {
      throw new Error(
        "compile({ bundle: true }) requires a readRuntimeBundle function (see @kumikijs/compiler/node).",
      );
    }
    js = inlineRuntime(js, opts.readRuntimeBundle());
  }

  return {
    kind: "ok",
    js,
    program,
    runtimeModules: generated.runtimeModules,
    usedIcons: generated.usedIcons,
    warnings,
  };
}
