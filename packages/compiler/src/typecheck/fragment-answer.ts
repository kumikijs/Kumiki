import { unaliasType, unknownType } from "../assignable.ts";
import type { TypeExpr } from "../ast.ts";
import { fragmentAnswer, TYPE_ARGUMENT_OF } from "../stdlib-members.ts";
import type { SymbolTable } from "./context.ts";
import { container, prim } from "./infer.ts";

/**
 * The type `recv.method`'s fragment is checked against, from {@link fragmentAnswer}, or `null`. A
 * `container` keeps every type argument but the value's: `Option(?)` over an `Option(T)`, and
 * `Result(?, E)` over a `Result(T, E)`.
 */
export function fragmentAnswerType(
  recv: TypeExpr | null,
  method: string,
  sym: SymbolTable,
): TypeExpr | null {
  const t = unaliasType(recv, sym);
  if (t?.kind !== "TypeApp") return null;
  switch (fragmentAnswer(t.name, method)) {
    case undefined:
      return null;
    case "Bool":
      return prim("Bool", t.pos);
    case "container":
      return container(
        t.name,
        t.args.map((a, i) => (i === TYPE_ARGUMENT_OF.T ? unknownType(a.pos) : a)),
        t.pos,
      );
  }
}
