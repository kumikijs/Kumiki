import type { Pos, Refinement, TypeExpr } from "../ast.ts";
import { REFINEMENT_PREDS } from "../refinements.ts";
import { ParseError, TokenStream } from "./token-stream.ts";

/** The primitive type names, which a type position reads as `TypePrim`. */
export const PRIM_TYPES: ReadonlySet<string> = new Set([
  "Int",
  "Text",
  "Bool",
  "Unit",
  "Float",
  "Time",
  "Bytes",
  "File",
  "EffectId",
]);

export class TypeParser extends TokenStream {
  protected parseTypeExpr(): TypeExpr {
    return this.descend(() => this.parseTypeExprNested());
  }

  protected parseTypeExprNested(): TypeExpr {
    const chain = this.startChain();
    const first = this.parseTypeUnionAtom();
    if (this.matchOp("|")) {
      const variants: { name: string; payloads: TypeExpr[]; pos: Pos }[] = [
        this.typeAsVariant(first),
      ];
      while (this.matchOp("|")) {
        this.next();
        variants.push(this.typeAsVariant(this.parseTypeUnionAtom()));
      }
      this.endChain(chain);
      return { kind: "TypeUnion", variants, pos: first.pos };
    }
    let refined = first;
    while (this.matchKw("where")) {
      this.chainStep(chain);
      this.next();
      const ref = this.parseRefinement();
      refined = { kind: "TypeRefinement", inner: refined, refinement: ref, pos: refined.pos };
    }
    this.endChain(chain);
    return refined;
  }

  protected typeAsVariant(t: TypeExpr): { name: string; payloads: TypeExpr[]; pos: Pos } {
    if (t.kind === "TypeRef") return { name: t.name, payloads: [], pos: t.pos };
    if (t.kind === "TypeApp") return { name: t.name, payloads: t.args, pos: t.pos };
    throw new ParseError(`Unsupported variant form`, t.pos);
  }

  protected parseTypeUnionAtom(): TypeExpr {
    if (this.matchKw("nominal")) {
      const start = this.next();
      const inner = this.parseTypeAtom();
      let refinement: Refinement | undefined;
      if (this.matchKw("where")) {
        this.next();
        refinement = this.parseRefinement();
      }
      const node: TypeExpr = { kind: "TypeNominal", inner, pos: start.pos };
      if (refinement) (node as { refinement?: Refinement }).refinement = refinement;
      return node;
    }
    const atom = this.parseTypeAtom();
    if (this.matchKw("where")) {
      this.next();
      const ref = this.parseRefinement();
      return { kind: "TypeRefinement", inner: atom, refinement: ref, pos: atom.pos };
    }
    return atom;
  }

  protected parseTypeAtom(): TypeExpr {
    if (this.matchOp("{")) {
      const start = this.next();
      const fields: { name: string; type: TypeExpr; pos: Pos }[] = [];
      if (!this.matchOp("}")) {
        fields.push(this.parseTypeField());
        while (this.matchOp(",")) {
          this.next();
          fields.push(this.parseTypeField());
        }
      }
      this.eat("op", "}");
      return { kind: "TypeRecord", fields, pos: start.pos };
    }
    const t = this.eat("ident");
    const name = t.value;
    if (this.matchOp("(")) {
      this.next();
      const args: TypeExpr[] = [];
      if (!this.matchOp(")")) {
        args.push(this.parseTypeExpr());
        while (this.matchOp(",")) {
          this.next();
          args.push(this.parseTypeExpr());
        }
      }
      this.eat("op", ")");
      return { kind: "TypeApp", name, args, pos: t.pos };
    }
    if (PRIM_TYPES.has(name)) {
      return { kind: "TypePrim", name: name as "Int", pos: t.pos };
    }
    return { kind: "TypeRef", name, pos: t.pos };
  }

  protected parseTypeField(): { name: string; type: TypeExpr; pos: Pos } {
    const tok = this.eat("ident");
    this.eat("op", ":");
    const type = this.parseTypeExpr();
    return { name: tok.value, type, pos: tok.pos };
  }

  protected parseRefinement(): Refinement {
    const t = this.eat("ident");
    const name = t.value;
    if (!REFINEMENT_PREDS.has(name)) {
      throw new ParseError(`Unknown refinement predicate "${name}"`, t.pos);
    }
    const args: (number | string)[] = [];
    if (this.matchOp("(")) {
      this.next();
      if (!this.matchOp(")")) {
        args.push(this.parseRefinementArg());
        while (this.matchOp(",")) {
          this.next();
          args.push(this.parseRefinementArg());
        }
      }
      this.eat("op", ")");
    }
    return { kind: "Refinement", pred: name, args, pos: t.pos };
  }

  protected parseRefinementArg(): number | string {
    const t = this.peek();
    if (t.kind === "op" && t.value === "-" && this.matchTAt(1, "num")) {
      this.next();
      const n = this.next() as { value: number };
      return -n.value;
    }
    if (t.kind === "num") {
      this.next();
      return t.value;
    }
    if (t.kind === "str") {
      this.next();
      return t.value;
    }
    throw new ParseError("Refinement argument must be a literal", t.pos);
  }
}
