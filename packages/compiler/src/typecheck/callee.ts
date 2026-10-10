import { constructorArity, isKnownTypeName } from "../assignable.ts";
import type { Expr, Pos } from "../ast.ts";
import {
  type BuiltinArity,
  builtinArity,
  isQualifierName,
  QUALIFIED_BUILTIN_CALLS,
  QUALIFIED_CALL_NAMESPACES,
  TYPE_MEMBER_CALLS,
  UNIMPLEMENTED_CALLS,
} from "../builtin-calls.ts";
import { PARSE_READINGS_PHRASE, parseQualifier, qualifierType } from "../parse-reading.ts";
import { isPrimTypeName } from "../stdlib-types.ts";
import { checkAgainst } from "./against.ts";
import type { Ctx, EndedScope, KumikiError, SymbolTable } from "./context.ts";
import { freshResultType, prim } from "./infer.ts";

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
  if (
    dot > 0 &&
    argCount === 0 &&
    QUALIFIED_CALL_NAMESPACES.has(callee.slice(0, dot)) &&
    !QUALIFIED_BUILTIN_CALLS.has(callee)
  ) {
    errors.push({
      code: "E0116",
      kind: "undef-call",
      message: `Call to undefined function "${callee}"`,
      pos,
    });
    return;
  }
  if (dot > 0 && TYPE_MEMBER_CALLS.has(callee.slice(dot + 1))) {
    const qualifier = callee.slice(0, dot);
    if (
      isQualifierName(qualifier) &&
      !isKnownTypeName(qualifier, sym) &&
      !isPrimTypeName(qualifier)
    ) {
      errors.push({
        code: "E0117",
        kind: "undef-type",
        message: `Reference to undefined type "${qualifier}"`,
        pos,
      });
      return;
    }
    const typeArity =
      isQualifierName(qualifier) && isKnownTypeName(qualifier, sym)
        ? constructorArity(qualifier, sym)
        : 0;
    if (typeArity !== 0) {
      const wanted =
        typeArity === null
          ? "type arguments"
          : `${typeArity} type argument${typeArity === 1 ? "" : "s"}`;
      const member = callee.slice(dot + 1);
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
    if (
      callee.slice(dot + 1) === "parse" &&
      isQualifierName(qualifier) &&
      parseQualifier(qualifier, sym).kind === "none"
    ) {
      errors.push({
        code: "E0802",
        kind: "unimplemented-function",
        message: `"${qualifier}" has no reading of a text — parse into ${PARSE_READINGS_PHRASE} and build it in a fn`,
        pos,
      });
      return;
    }
    if (
      callee.slice(dot + 1) === "fresh" &&
      isQualifierName(qualifier) &&
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
  const arity = builtinArity(callee);
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
    if (callee === "fmt") reportFmtPlaceholders(args, pos, errors);
    const text = args[0];
    if (dot > 0 && callee.slice(dot + 1) === "parse" && text) {
      checkAgainst(text, prim("Text", pos), sym, errors, ctx);
    }
    return;
  }
  if (!fn) {
    errors.push({
      code: "E0116",
      kind: "undef-call",
      message: `Call to undefined function "${callee}"`,
      pos,
    });
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

// A tile `for`'s variable and a `match` arm's pattern stand for one element, one case, so the read
// moves in; a statement body's name can be declared before it, a `let … in` value bound higher.
const ENDED_SCOPE_WORDS: Record<EndedScope, { scope: string; repair: string }> = {
  if: {
    scope: 'an "if" branch',
    repair: 'declare it before the "if", or move the read into the branch',
  },
  for: {
    scope: 'a "for" body',
    repair: 'declare it before the "for", or move the read into the body',
  },
  match: {
    scope: "a match arm",
    repair: 'declare it before the "match", or move the read into the arm',
  },
  "let-in": {
    scope: 'the body of a "let … in"',
    repair: "move the read into that body, or bind it where both reads see it",
  },
  "for-expr": { scope: `a tile's "for" body`, repair: "move the read into the body" },
  "match-expr": { scope: 'an arm of a "match" expression', repair: "move the read into the arm" },
};

/** Unlike `arithmeticHint`, kept when a close name is in scope: that the name ended is known. */
export function endedScopeHint(kind: EndedScope): string {
  const { scope, repair } = ENDED_SCOPE_WORDS[kind];
  return ` — it is scoped to ${scope}, which ends with it: ${repair} (see docs/spec/language.md)`;
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
