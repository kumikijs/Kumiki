---
"@kumikijs/cli": patch
---

`kumiki fix --apply` repairs E0001 and E0301 in the app's own `routes` and `caps`, and no longer breaks the file doing it (#641).

Both repairs were text patterns. E0001's `routes = {` pattern also matched a tile's `sub-routes = {`, so when a nested-routes layout tile came before the `app`, `"/404" -> NotFound` went into the tile, the E0001 stayed, and the gate rolled the patch back. E0001 also always added `tile NotFound = …`, so a program that already had a `NotFound` tile got E0007 and the same rollback. E0301 split `caps = [...]` on commas and joined it onto one line, so with `nav.push    # links` as the last entry the new cap and the closing `]` ended up inside the comment, and the file stopped parsing.

Both now find the clause from the tokens of the app the parser found, and add the new entry right after the last token of its last entry: `"/404" -> NotFound` goes into the app's `routes`, and `nav.push    # links` becomes `nav.push, storage.write    # links`. E0001 adds the `NotFound` tile only when the program does not define one, and routes to the existing one otherwise.
