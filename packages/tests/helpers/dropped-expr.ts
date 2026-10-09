// Dropped-expression scanner for the example render guard.
//
// `check`/`build` only prove an example compiles; they say nothing about whether a value actually reaches the DOM.
//  Every value-bearing display tile lowers its value through `_s.show(...)` in codegen. A dropped expression in any of those positions therefore surfaces as the exact token `_s.show(undefined)`.
// Kumiki source has no `undefined` literal, so this token can only come from a dropped expression — it is a zero-false-positive sentinel.

const DROPPED_EXPRESSION_SENTINELS = ["_s.show(undefined)"] as const;

export interface DroppedExpression {
  /** The sentinel token that matched. */
  marker: string;
  /** 1-based line number in the generated JS where it occurs. */
  line: number;
}

/**
 * Scan generated JS for dropped-expression markers.
 * Returns one entry per occurrence (empty array = clean).
 * Pure and synchronous so it can be unit tested against known-bad fixtures without invoking the compiler.
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
