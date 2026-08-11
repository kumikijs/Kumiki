import type { Pos, Token } from "./ast.ts";

const KEYWORDS = new Set([
  "type",
  "slot",
  "effect",
  "reducer",
  "tile",
  "fn",
  "app",
  "test",
  "nominal",
  "where",
  "when",
  "for",
  "in",
  "let",
  "if",
  "then",
  "else",
  "match",
  "with",
  "on",
  "do",
  "emit",
  "cap",
  "out",
  "policy",
  "retry",
  "true",
  "false",
  "fresh",
  "self",
  "now",
  "null",
]);

// Multi-character operators must be checked before single-character ones, longest first.
const MULTI_CHAR_OPS = ["->>", ":=", "==", "!=", "<=", ">=", "->", "||", "&&"];
const SINGLE_CHAR_OPS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "=",
  "|",
  "&",
  "!",
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  ",",
  ";",
  ":",
  ".",
  "#",
]);

const MAX_IDENT_LEN = 32;

export class LexError extends Error {
  constructor(
    message: string,
    public pos: Pos,
  ) {
    super(`Lex error at ${pos.line}:${pos.col}: ${message}`);
  }
}

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = (n = 1): void => {
    for (let k = 0; k < n; k++) {
      if (source[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };

  const pos = (): Pos => ({ line, col });

  /**
   * The run of identifier characters starting at `i`.
   *
   * `-` is both an identifier character and the subtraction operator, and
   * longest munch is what decides: it continues the name only when an
   * identifier character follows it. `on-401` and `count-1` are the same shape,
   * so the name wins in both; `s- 1` and `s-` end at the `s`, which is what
   * makes the operator reachable at all. One function because there are two
   * identifier forms — a name and a `$` binding — and a rule applied to only
   * one of them makes `$el- 1` mean something `el- 1` does not.
   */
  const readIdentBody = (): string => {
    let raw = "";
    while (i < source.length && isIdentCont(source[i] as string)) {
      if (source[i] === "-" && !isIdentCont(source[i + 1] ?? "")) break;
      raw += source[i];
      advance();
    }
    return raw;
  };

  while (i < source.length) {
    const c = source[i] as string;

    // Whitespace (including newlines). A byte-order mark is how several
    // editors mark a UTF-8 file and it is not part of the text — but it is
    // part of the STRING, and every consumer of a position splices that string
    // at `column - 1`. Counting it as a whitespace character keeps the two
    // agreeing; skipping the index without advancing the column would leave
    // line 1 one short, and `kumiki fix` silently patching nothing.
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\uFEFF") {
      advance();
      continue;
    }

    // `#` is the one context-sensitive character in the language: the selector
    // operator in `TileName#id`, and the start of a comment everywhere else.
    // It is the operator only when the character before it ends a value and the
    // character after it begins an identifier. Looking only at the character
    // before, as this did, made `slot n : Int = 0# how many` an operator
    // followed by the rest of the line as tokens.
    //
    // Stated the other way, which is the rule to remember: a `#` with
    // whitespace on either side of it always starts a comment.
    if (c === "#") {
      const prev = i > 0 ? source[i - 1] : undefined;
      const next = source[i + 1];
      const attaches =
        prev !== undefined &&
        (isIdentCont(prev) || prev === ")" || prev === "]" || prev === "}") &&
        next !== undefined &&
        isIdentStart(next);
      if (attaches) {
        tokens.push({ kind: "op", value: "#", pos: pos() });
        advance();
        continue;
      }
      while (i < source.length && source[i] !== "\n") advance();
      continue;
    }

    const startPos = pos();

    // String literal
    if (c === '"') {
      let value = "";
      advance(); // skip opening quote
      while (i < source.length && source[i] !== '"') {
        const ch = source[i] as string;
        if (ch === "\\") {
          advance();
          const esc = source[i] as string | undefined;
          if (esc === undefined) throw new LexError("Unterminated string", startPos);
          if (esc === "n") value += "\n";
          else if (esc === "t") value += "\t";
          else if (esc === "r") value += "\r";
          else if (esc === '"') value += '"';
          else if (esc === "\\") value += "\\";
          else if (esc === "u") {
            // `\u{hex+}` (spec §1.2). A code POINT, not a UTF-16 unit, so
            // `String.fromCodePoint` — the astral half of the escape is the
            // reason the form exists.
            const escPos = pos();
            advance();
            if (source[i] !== "{") throw new LexError("\\u must be written \\u{hex}", escPos);
            advance();
            // Only hex digits, so an unterminated escape stops at the first
            // character that cannot belong to one rather than swallowing the
            // rest of the file into the message.
            let hex = "";
            while (i < source.length && isHexDigit(source[i] as string)) {
              hex += source[i];
              advance();
            }
            if (hex.length === 0 || source[i] !== "}") {
              throw new LexError(`\\u{${hex}…} is not a hex escape`, escPos);
            }
            const code = Number.parseInt(hex, 16);
            if (code > 0x10ffff) {
              throw new LexError(`\\u{${hex}} is past the last code point`, escPos);
            }
            // A surrogate is half of a code point, and a string holding one
            // alone is ill-formed: it survives here and breaks at whatever
            // encodes it later, which is the wrong place to find out.
            if (code >= 0xd800 && code <= 0xdfff) {
              throw new LexError(`\\u{${hex}} is half of a surrogate pair`, escPos);
            }
            value += String.fromCodePoint(code);
          } else throw new LexError(`Unknown escape \\${esc}`, pos());
          advance();
        } else {
          value += ch;
          advance();
        }
      }
      if (source[i] !== '"') throw new LexError("Unterminated string", startPos);
      advance(); // closing quote
      tokens.push({ kind: "str", value, pos: startPos });
      continue;
    }

    // Number literal (integer or float). Supports unary minus only when not adjacent to identifier (handled in parser).
    if (isDigit(c)) {
      let raw = "";
      while (i < source.length && isDigit(source[i] as string)) {
        raw += source[i];
        advance();
      }
      if (source[i] === "." && isDigit(source[i + 1] as string)) {
        raw += ".";
        advance();
        while (i < source.length && isDigit(source[i] as string)) {
          raw += source[i];
          advance();
        }
      }
      tokens.push({ kind: "num", value: Number(raw), raw, pos: startPos });
      continue;
    }

    // Theme-token reference prefix (spec/style.md §4.3): `@colors.surface`.
    // Only `@` itself is one op; the parser assembles `@ ident ( . ident )+`
    // into a TokenRef. Keeping the lexer dumb lets ident/`.` reuse the
    // existing token kinds.
    if (c === "@") {
      tokens.push({ kind: "op", value: "@", pos: startPos });
      advance();
      continue;
    }

    // Positional binding: $identifier or $digits (e.g. $1, $el, $event, $route)
    if (c === "$") {
      advance();
      const raw = `$${readIdentBody()}`;
      if (raw.length === 1) throw new LexError(`Bare "$" is not a token`, startPos);
      tokens.push({ kind: "ident", value: raw, pos: startPos });
      continue;
    }

    // Identifier or keyword
    if (isIdentStart(c)) {
      const raw = readIdentBody();
      if (raw.length > MAX_IDENT_LEN) {
        throw new LexError(`Identifier too long (max ${MAX_IDENT_LEN}): "${raw}"`, startPos);
      }
      if (KEYWORDS.has(raw)) {
        tokens.push({ kind: "kw", value: raw, pos: startPos });
      } else {
        tokens.push({ kind: "ident", value: raw, pos: startPos });
      }
      continue;
    }

    // Multi-character operators
    let matched: string | undefined;
    for (const op of MULTI_CHAR_OPS) {
      if (source.startsWith(op, i)) {
        matched = op;
        break;
      }
    }
    if (matched !== undefined) {
      tokens.push({ kind: "op", value: matched, pos: startPos });
      advance(matched.length);
      continue;
    }

    // Single-character operators
    if (SINGLE_CHAR_OPS.has(c)) {
      tokens.push({ kind: "op", value: c, pos: startPos });
      advance();
      continue;
    }

    throw new LexError(`Unexpected character "${c}"`, startPos);
  }

  tokens.push({ kind: "eof", pos: pos() });
  return tokens;
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isHexDigit(c: string): boolean {
  return isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
}

function isIdentStart(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}

function isIdentCont(c: string): boolean {
  return isIdentStart(c) || isDigit(c) || c === "_" || c === "-";
}
