---
"@kumikijs/cli": minor
"@kumikijs/mcp": minor
---

Gate `fix --auto-patch`'s compile repair the way every other write is gated

`fix --apply` guarantees "apply ⇒ the file is either strictly cleaner or
unchanged": it re-parses and re-typechecks the composed patches and rolls the
write back when they resolve nothing or introduce a diagnostic. The tier-1
repair inside `--auto-patch` composed the same plan and wrote it to disk
unguarded. On the same input, `fix --apply` rolled back and `fix --auto-patch
<test> --apply` wrote — and then reported the error the repair had just
created as the author's own.

Tier 1 now goes through `applyFixPlan`, so there is one gate and one write. A
refusal is its own outcome, **`compile-blocked`**, distinct from "no patch
available": the file is unchanged, the errors reported are the ones the patch
was offered for, and `blocked` names what it would have introduced. The
sentence the CLI prints for it comes from the same function `fix --apply`
prints, so the two verbs cannot describe one refusal differently.

The count reported for a write is now the number of patches that changed the
source rather than the number planned — a patch can decline to change
anything, and the composed write would have counted it. A dry run still
reports what it proposes, which is the honest number for something not yet
applied.

`FixApplyResult` gains `skipped` (the plan's skip reasons, so a caller
reporting "nothing to apply" need not plan the file a second time) and
`approved` (the patches the gate passed, which differs from `applied` only
when the write itself threw). `@kumikijs/mcp` serialises the new status and
`kumiki_fix_from_test` documents it.
