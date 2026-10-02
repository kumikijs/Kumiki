// Dropped-expression scanner for the example render guard (issue #39).
//
// `check`/`build` only prove an example compiles; they say nothing about
// whether a value actually reaches the DOM. The `03-union-and-match` heading
// bug compiled green yet rendered an always-empty heading because a mis-parsed
// value argument was lowered to `_s.show(undefined)` — a structurally-present,
// semantically-empty node that smoke ("not empty / no throw") also missed.
//
// Every value-bearing display tile (heading / text / button / label / link
// `text`+`to` / markdown / image `src` / icon `name` / input+textarea `value`)
// lowers its value through `_s.show(...)` in codegen. A dropped expression in
// any of those positions therefore surfaces as the exact token
// `_s.show(undefined)`. Kumiki source has no `undefined` literal, so this token
// can only come from a dropped expression — it is a zero-false-positive
// sentinel (verified: it occurs 0 times across the current example corpus,
// whereas bare `undefined` is pervasive and benign — selector-less reducers'
// `selector: undefined`, null/undefined guards — so we match the precise
// sentinel rather than bare `undefined`, which needs no allowlist).

/** A dropped-expression marker that can only originate from a dropped value. */
const DROPPED_EXPRESSION_SENTINELS = ["_s.show(undefined)"] as const;

export interface DroppedExpression {
  /** The sentinel token that matched. */
  marker: string;
  /** 1-based line number in the generated JS where it occurs. */
  line: number;
}

/**
 * Scan generated JS for dropped-expression markers. Returns one entry per
 * occurrence (empty array = clean). Pure and synchronous so it can be unit
 * tested against known-bad fixtures without invoking the compiler.
 */
export function findDroppedExpressions(js: string): DroppedExpression[] {
  const out: DroppedExpression[] = [];
  const lines = js.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i] ?? "";
    for (const marker of DROPPED_EXPRESSION_SENTINELS) {
      let from = 0;
      while (true) {
        const at = lineText.indexOf(marker, from);
        if (at === -1) break;
        out.push({ marker, line: i + 1 });
        from = at + marker.length;
      }
    }
  }
  return out;
}
