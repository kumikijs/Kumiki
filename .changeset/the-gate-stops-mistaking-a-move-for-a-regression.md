---
"@kumikijs/cli": minor
---

Stop the fix regression gate mistaking a moved diagnostic for an introduced one

The gate identified a diagnostic by `code@line:col`, so anything a repair moved
was not in the before-set and read as a failure the repair had created. Two
shapes reached it, and both rolled back a correct repair over a diagnostic no
patch had touched:

- a rewrite shorter than what it replaced moves every diagnostic to its right
  on that line — `$route` → `route` beside an unrepairable name;
- `E0001`'s repair prepends a `tile NotFound` block, so **every** diagnostic
  below it moves two lines down. That made the commonest repair in the
  catalogue unusable on any file that also carried one unrepairable name.

A diagnostic is now identified by its **code, kind and message**, and the two
sets are compared as multisets. Counting codes alone is nearly enough and fails
where a second repair balances the books — reword one `E0211` and resolve one
`E0119` in the same plan, and the per-code counts report a clean repair while
the reworded diagnostic is still in the file. A set rather than a multiset
would compute "nothing resolved" for a file holding two diagnostics with one
key where a repair cleared one of them, and roll a real repair back.

A 1-for-1 swap (`E0301` → `E0302` via a typo) is still caught, and so is a
repair that turns a name error into a type error at the same position.
