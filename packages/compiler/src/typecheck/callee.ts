import { constructorArity, isKnownTypeName } from "../assignable.ts";
import type { Expr, Pos } from "../ast.ts";
import {
  type BuiltinArity,
  builtinArity,
  isMissingNamespaceMember,
  typeMemberQualifier,
  UNIMPLEMENTED_CALLS,
} from "../builtin-calls.ts";
import { BUILTIN_TILES } from "../builtins.ts";
import { PARSE_READINGS_PHRASE, parseQualifier, qualifierType } from "../parse-reading.ts";
import { isPrimTypeName } from "../stdlib-types.ts";
import { checkAgainst } from "./against.ts";
import {
  type Ctx,
  type EndedScope,
  isBuiltinCall,
  type KumikiError,
  type NestedScopeKind,
  type SymbolTable,
} from "./context.ts";
import { refuseRenderedEffectId } from "./expr.ts";
import { freshResultType, prim } from "./infer.ts";
import type { ScopedDeclaration } from "./nested-scopes.ts";

export function checkCallee(
  callee: string,
  args: Expr[],
  pos: Pos,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const argCount = args.length;
  const fn = sym.fns.get(callee);
  if (!fn && UNIMPLEMENTED_CALLS.has(callee)) {
    errors.push({
      code: "E0802",
      kind: "unimplemented-function",
      message: `Function "${callee}" is documented but not implemented by the runtime`,
      pos,
    });
    return;
  }
  const dot = callee.indexOf(".");
  if (isMissingNamespaceMember(callee, argCount)) {
    errors.push({
      code: "E0116",
      kind: "undef-call",
      message: `Call to undefined function "${callee}"`,
      pos,
    });
    return;
  }
  const qualifier = typeMemberQualifier(callee, argCount);
  if (qualifier !== undefined) {
    const member = callee.slice(dot + 1);
    if (!isKnownTypeName(qualifier, sym) && !isPrimTypeName(qualifier)) {
      errors.push({
        code: "E0117",
        kind: "undef-type",
        message: `Reference to undefined type "${qualifier}"`,
        pos,
      });
      return;
    }
    const typeArity = isKnownTypeName(qualifier, sym) ? constructorArity(qualifier, sym) : 0;
    if (typeArity !== 0) {
      const wanted =
        typeArity === null
          ? "type arguments"
          : `${typeArity} type argument${typeArity === 1 ? "" : "s"}`;
      const readable =
        member === "parse"
          ? ` and whose base has a reading of a text (${PARSE_READINGS_PHRASE})`
          : member === "fresh"
            ? " and that a Text goes into"
            : "";
      errors.push({
        code: "E0124",
        kind: "type-constructor-qualifier",
        message: `Type "${qualifier}" takes ${wanted}, so it is not a type on its own — "${callee}" needs one that takes none${readable}`,
        pos,
      });
      return;
    }
    if (member === "parse" && parseQualifier(qualifier, sym).kind === "none") {
      errors.push({
        code: "E0802",
        kind: "unimplemented-function",
        message: `"${qualifier}" has no reading of a text — parse into ${PARSE_READINGS_PHRASE} and build it in a fn`,
        pos,
      });
      return;
    }
    if (
      member === "fresh" &&
      qualifierType(qualifier, pos, sym) !== null &&
      freshResultType(qualifier, pos, sym) === null
    ) {
      errors.push({
        code: "E0802",
        kind: "unimplemented-function",
        message: `"${qualifier}" is not a Text, and fresh mints a uuid Text — declare the id nominal Text`,
        pos,
      });
      return;
    }
  }
  const arity = isBuiltinCall(callee, sym) ? builtinArity(callee) : undefined;
  if (arity !== undefined) {
    if (argCount < arity.min || argCount > arity.max) {
      errors.push({
        code: "E0213",
        kind: "call-arity-mismatch",
        message: `Function "${callee}" expects ${wantedArguments(arity)} but got ${argCount}`,
        pos,
      });
      return;
    }
    if (callee === "fmt") {
      reportFmtPlaceholders(args, pos, errors);
      for (const a of args) refuseRenderedEffectId(a, "fmt(...)", sym, errors, ctx);
    }
    const text = args[0];
    if (dot > 0 && callee.slice(dot + 1) === "parse" && text) {
      checkAgainst(text, prim("Text", pos), sym, errors, ctx);
    }
    return;
  }
  if (!fn) {
    // A builtin tile's name is spelled right: what is wrong is where it is written.
    const message = BUILTIN_TILES.has(callee)
      ? `"${callee}" is a tile, and a tile renders only as a positional argument of a builtin other than the value builtins`
      : `Call to undefined function "${callee}"`;
    errors.push({ code: "E0116", kind: "undef-call", message, pos });
    return;
  }
  if (fn.params.length !== argCount) {
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Function "${callee}" expects ${fn.params.length} argument(s) but got ${argCount}`,
      pos,
    });
    return;
  }
  fn.params.forEach((p, i) => {
    const arg = args[i];
    if (arg) checkAgainst(arg, p.type, sym, errors, ctx);
  });
}

export function reportRunReducerPosition(ctx: Ctx, pos: Pos, errors: KumikiError[]): void {
  if (ctx.runReducerScope) return;
  errors.push({
    code: "E0116",
    kind: "undef-call",
    message: 'Call to "run-reducer" outside a property-test invariant',
    pos,
  });
}

function reportFmtPlaceholders(args: Expr[], pos: Pos, errors: KumikiError[]): void {
  const template = args[0];
  if (template?.kind !== "Str") return;
  const supplied = args.length - 1;
  const indices = new Set<number>();
  for (const m of template.value.matchAll(/\{(\d+)\}/g)) indices.add(Number(m[1]));
  const missing = [...indices].filter((i) => i >= supplied).sort((a, b) => a - b);
  const unused = [...Array(supplied).keys()].filter((i) => !indices.has(i));
  if (missing.length === 0 && unused.length === 0) return;
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(
      `${missing.map((i) => `{${i}}`).join(", ")} ${missing.length === 1 ? "has" : "have"} no argument`,
    );
  }
  if (unused.length > 0) {
    parts.push(
      `argument${unused.length === 1 ? "" : "s"} ${unused.map((i) => i + 2).join(", ")} ${unused.length === 1 ? "is" : "are"} named by no placeholder`,
    );
  }
  errors.push({
    code: "W0214",
    kind: "fmt-placeholder-argument-mismatch",
    message: `fmt template and arguments disagree: ${parts.join("; ")}`,
    pos,
    severity: "warning",
  });
}

function wantedArguments(arity: BuiltinArity): string {
  const count = `${arity.min} argument(s)`;
  return arity.min === arity.max ? count : `at least ${count}`;
}

export function arithmeticHint(name: string, sym: SymbolTable, ctx: Ctx): string {
  const cut = name.indexOf("-");
  if (cut <= 0) return "";
  const head = name.slice(0, cut);
  const tail = name.slice(cut + 1);
  const resolves = ctx.localBinds.has(head) || sym.slots.has(head) || sym.fns.has(head);
  if (!resolves) return "";
  if (hasCloseName(name, sym, ctx)) return "";
  return ` — "-" continues an identifier, so this is one name. Write "${head} - ${tail}" with spaces for subtraction.`;
}

/** Where a name of each kind of scope is declared, as a hint says it. */
const DECLARED: Record<NestedScopeKind, string> = {
  if: 'in an "if" branch',
  for: 'in a "for" loop',
  match: "in a match arm",
  "let-in": 'by a "let … in"',
  "for-expr": `in a tile's "for"`,
  "match-expr": 'in an arm of a "match" expression',
};

// A `let n = 0` before the statement would not do: the body's own `n` only shadows it.
const BRANCH_WORDS = {
  if: {
    part: "branch",
    sibling: 'the other branch of this "if"',
    declare: (name: string) =>
      `declare it once before the "if" with an "if" expression (let ${name} = if c then … else …)`,
  },
  match: {
    part: "arm",
    sibling: "another arm of this match",
    declare: () => 'declare it once before the "match" with a match expression',
  },
};

const NO_VALUE_OUT = "and a name carries no value out of a loop";

/** Where else the value a `let … in` binds can be bound so both reads see it, by what reads it. */
function letInRebind(ctx: Ctx): string {
  switch (ctx.kind) {
    case "reducer":
      return ', or bind it with a "let" statement where both reads see it';
    // A tile's body has no `let … in` around its arguments.
    case "tile":
      return ', or move both reads into a tile that declares "in=" and pass it the value';
    // Each entry is an expression of its own, so no `let … in` encloses two of them.
    case "app-init":
      return "";
    default:
      return ', or bind it with one "let … in" around both reads';
  }
}

function endedScopeWords(name: string, ended: EndedScope, ctx: Ctx): string {
  const where = DECLARED[ended.kind];
  switch (ended.kind) {
    case "for":
      return `${where}, ${NO_VALUE_OUT}: move the read into the loop's body, or write the value to a slot there`;
    case "for-expr":
      return `${where}, ${NO_VALUE_OUT}: move the read into the loop's body`;
    case "let-in":
      return `${where}, whose body ended before this read: move the read into that body${letInRebind(ctx)}`;
    case "match-expr":
      return ended.sibling
        ? 'in another arm of this "match" expression: move the read into the arm that declares it'
        : `${where}, which ended before this read: move the read into that arm`;
    default: {
      const w = BRANCH_WORDS[ended.kind];
      if (ended.sibling) {
        return `in ${w.sibling}: ${w.declare(name)}, or move the read into the ${w.part} that declares it`;
      }
      return `${where}, which ended before this read: ${w.declare(name)}, or move the read into that ${w.part}`;
    }
  }
}

/** The read is ahead of the value it names: a name declared again before it would read another. */
function laterScopeRepair(kind: NestedScopeKind, ctx: Ctx): string {
  switch (kind) {
    case "for":
      return "move the read into the loop's body, after the declaration";
    case "if":
      return "move the read into that branch, after the declaration";
    case "match":
      return "move the read into that arm, after the declaration";
    case "let-in":
      return `move the read into its body${letInRebind(ctx)}`;
    case "for-expr":
      return "move the read into the loop's body";
    case "match-expr":
      return "move the read into that arm";
  }
}

const SEE = " (see docs/spec/language.md)";

/** Unlike `arithmeticHint`, kept when a close name is in scope: that the name ended is known. */
export function endedScopeHint(name: string, ended: EndedScope, ctx: Ctx): string {
  return ` — it was declared ${endedScopeWords(name, ended, ctx)}${SEE}`;
}

/** Like `endedScopeHint`, for a read before the scope that declares the name. */
export function laterScopeHint({ kind, at }: ScopedDeclaration, ctx: Ctx): string {
  const where = `later, at ${at.line}:${at.col}, ${DECLARED[kind]}`;
  return ` — it is declared ${where}: ${laterScopeRepair(kind, ctx)}${SEE}`;
}

function hasCloseName(name: string, sym: SymbolTable, ctx: Ctx): boolean {
  const inScope = [...ctx.localBinds, ...sym.slots.keys(), ...sym.fns.keys()];
  return inScope.some((c) => c !== name && withinOneEdit(name, c));
}

/** Levenshtein distance ≤ 1, without building the matrix. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
