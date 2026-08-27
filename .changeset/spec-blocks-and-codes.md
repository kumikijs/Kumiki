---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
"@kumikijs/cli": patch
---

fix: make the spec's own examples compile, and give each code one meaning.

**Every ` ```kumiki ` block in `docs/` is now checked.** Fewer than half of
them parsed: 27 blocks used `;` as a comment while `language.md` §1.2 defines
`#` as the comment and `;` as the statement separator — which the corpus uses
it as, so the conversion is per occurrence rather than wholesale. A block now
declares what it is (a complete program, a `fragment` of definitions, a
`snippet` of less than a definition, or a deliberately `invalid` example) and
each mark is falsifiable in both directions, so a wrong mark fails as loudly as
a wrong block. English and Japanese must mark the same block the same way.

**`ai-edit.md` defined a second table of diagnostic codes**, disagreeing with
`errors.md` on eleven of them — `E0302` meant "direct effect call" in one and
"unknown capability" in the other, in a document that calls a code a permanent
contract. The section now points at `errors.md`, and the spec-drift guard reads
every file that assigns a code (`typecheck.ts`, `cli/src/fix.ts`,
`mcp/src/index.ts`), not the checker alone. `E0000` — which those two tools
synthesize so a parse failure can appear in a list of diagnostics — is
documented rather than deleted; `--refs` no longer claims a band (`E05xx`) that
no code has ever belonged to.

Two implementation-side corrections came out of the same pass:

- **`Route` gains `pattern` and `hash`.** The router builds all five fields and
  `routing.md` §3.2 documents all five; the compiler's standard-library table
  had three, so a generated provider signature typed `route.pattern` as
  `unknown`.
- **`toast` honours `duration` and carries its `kind`.** `lifecycle.md` §7.7
  has always shown `duration: Option(Duration)` and the example corpus emits
  it; the runtime ignored it and every `kind`, hardcoding three seconds. The
  kind lands as `data-kumiki-toast-kind` with no built-in appearance (the call
  `variant` makes on a button), and the toast is the `aria-live` region
  `lifecycle.md` §7.8 lists as a runtime guarantee.
