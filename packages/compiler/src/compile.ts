import type { Program } from "./ast.ts";
import { type CodegenOptions, codegen, RUNTIME_HELPERS } from "./codegen.ts";
import { lex } from "./lexer.ts";
import { parse } from "./parser.ts";
import { check, type KumikiError, severityOf } from "./typecheck.ts";

export type CompileOk = {
  kind: "ok";
  js: string;
  program: Program;
  runtimeModules: string[];
  usedIcons: string[];
  warnings: KumikiError[];
};
export type CompileFail = {
  kind: "fail";
  errors: KumikiError[];
  warnings: KumikiError[];
};
export type CompileResult = CompileOk | CompileFail;

export type ExtendedCodegenOptions = CodegenOptions & {
  /** Inline the runtime source into the output so the generated module needs no external import. */
  bundle?: boolean;
  readRuntimeBundle?: () => string;
  /** Project-registered capabilities (from `kumiki.caps.json`) accepted in `app.caps`. */
  capabilities?: string[];
  /** Reads an `episode-test`'s `load` file; without it, such a test fails instead of replaying nothing. */
  readEpisodeLog?: (relativePath: string) => string;
  strictA11y?: boolean;
  strictIcons?: boolean;
  strictSelectorId?: boolean;
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
    throw new Error("compile(): `bundle: true` and `runtimeModulesDir` are mutually exclusive.");
  }
  const tokens = lex(source);
  const program = parse(tokens);
  const diags = check(program, {
    capabilities: opts.capabilities ?? [],
    ...(opts.strictA11y ? { strictA11y: true } : {}),
    ...(opts.strictIcons ? { strictIcons: true } : {}),
    ...(opts.strictSelectorId ? { strictSelectorId: true } : {}),
    ...(opts.iconNames ? { iconNames: opts.iconNames } : {}),
  });
  const errors = diags.filter((d) => severityOf(d) === "error");
  const warnings = diags.filter((d) => severityOf(d) === "warning");
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
