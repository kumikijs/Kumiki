import type { Program, Token } from "./ast.ts";
import { Parser } from "./parser/definitions.ts";

export { ParseError } from "./parser/token-stream.ts";
export { PRIM_TYPES } from "./parser/types.ts";

export function parse(tokens: Token[]): Program {
  return new Parser(tokens).parseProgram();
}
