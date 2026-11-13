import {
  type CompileResult,
  type KumikiError,
  LexError,
  ParseError,
  parseFailure,
  type Severity,
  severityOf,
} from "@kumikijs/compiler";
import { buildSrcdoc, compileToJs, examples } from "./preview";
import type { PlaygroundApi } from "./webmcp";

/** A diagnostic in the shape the MCP server answers with. */
export type Diagnostic = {
  code: string;
  kind: string;
  message: string;
  line: number;
  col: number;
  severity: Severity;
};

function toDiagnostics(errors: readonly KumikiError[]): Diagnostic[] {
  return errors.map((e) => ({
    code: e.code,
    kind: e.kind,
    message: e.message,
    line: e.pos.line,
    col: e.pos.col,
    severity: severityOf(e),
  }));
}

export type PlaygroundBuild = { diagnostics: Diagnostic[]; js: string | null };

function buildPlayground(source: string): PlaygroundBuild {
  let result: CompileResult;
  try {
    result = compileToJs(source);
  } catch (e) {
    // Any other throw is a fault in the compiler, not a diagnostic of the source.
    if (e instanceof LexError || e instanceof ParseError) {
      return { diagnostics: toDiagnostics([parseFailure(e)]), js: null };
    }
    throw e;
  }
  return result.kind === "ok"
    ? { diagnostics: toDiagnostics(result.warnings), js: result.js }
    : { diagnostics: toDiagnostics([...result.errors, ...result.warnings]), js: null };
}

/** What the playground shows: the editor's source, its diagnostics, and the preview ("" for none). */
export type PlaygroundView = { source: string; diagnostics: Diagnostic[]; srcdoc: string };

export type CompileAnswer =
  | { ok: true; jsBytes: number; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

export interface Playground extends PlaygroundApi {
  preview(source: string): PlaygroundBuild;
  compileSource(source: string): CompileAnswer;
  setSource(source: string): string;
}

const warnings = (n: number) => `${n} warning${n === 1 ? "" : "s"}`;

export function createPlayground(show: (view: PlaygroundView) => void): Playground {
  function preview(source: string): PlaygroundBuild {
    const build = buildPlayground(source);
    show({
      source,
      diagnostics: build.diagnostics,
      srcdoc: build.js === null ? "" : buildSrcdoc(build.js),
    });
    return build;
  }

  return {
    preview,
    compileSource(source) {
      const { diagnostics, js } = buildPlayground(source);
      return js === null
        ? { ok: false, diagnostics }
        : { ok: true, jsBytes: js.length, diagnostics };
    },
    listExamples: () => examples.map((e) => e.name),
    loadExample(name) {
      const example = examples.find((e) => e.name === name);
      if (!example) return false;
      preview(example.source);
      return true;
    },
    setSource(source) {
      const { diagnostics, js } = preview(source);
      if (js === null) return JSON.stringify(diagnostics);
      if (diagnostics.length === 0) return "ok";
      return `ok (${warnings(diagnostics.length)})\n${JSON.stringify(diagnostics)}`;
    },
  };
}
