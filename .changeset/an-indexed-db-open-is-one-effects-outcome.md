---
"@kumikijs/runtime": patch
---

An IndexedDB open that is blocked or fails is one effect's outcome, not the page's

The runtime opened `app.indexed-db` once and kept the result for the life of
the page, whatever it was. Two things made that result a failure that never
went away:

- `blocked` was treated as a failure. In IndexedDB it is a notification: an
  upgrade that waits on another tab's connection still ends in `success` on
  the same request once that connection closes. The open was rejected on
  `blocked`, so the first load showed `err: Error: IndexedDB open blocked`.
- The rejected open was kept, so every later `indexed-read` / `indexed-write`
  / `indexed-delete` / `indexed-query` returned that same err until reload,
  after the block had cleared and the database was ready:

```
click 1         : err: Error: IndexedDB open blocked
click 2 (+200ms): err: Error: IndexedDB open blocked
indexedDB.open calls: 1
```

The runtime also left its own connection open on `versionchange`, so an older
tab of the same app is exactly what blocked a newer tab's upgrade after a bump
of `app.indexed-db.version`.

Now the open waits through `blocked` for `success` or `error`; an open that
fails is the `.err` of the effects waiting on it and is not kept, so the next
effect opens again; and on `versionchange` the runtime closes its connection,
so it does not block the other tab's upgrade, and its next effect opens again.
A connection the browser closes on its own is dropped the same way:

```
click 1         : loaded hi
click 2 (+200ms): loaded hi
indexedDB.open calls: 1
```

http.md §6.7.4 states this lifecycle; example 185 shows it.
