---
"@kumikijs/runtime": patch
---

An `indexed-*` effect no longer fails with `IndexedDB open blocked` while another tab holds the database, and a failed open no longer fails every later effect until reload

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

Now the open waits through `blocked` for `success` or `error`, and later
effects share it:

```
click 1         : loaded hi
click 2 (+200ms): loaded hi
indexedDB.open calls: 1
```

Nothing times that wait out. While it lasts, the effects waiting on the open
stay in flight, and the runtime logs a `kumiki:` console warning naming the
database and both versions. An open that fails is the `.err` of the effects
waiting on it and is not kept, so the next effect opens again.

On `versionchange` the runtime now closes its connection, so it no longer
blocks the other tab's upgrade. The page's next effect reopens with the
page's own `version`. When the other tab's version is newer, as after a
deploy, the upgraded database refuses that reopen, and every `indexed-*`
effect on the old page is `.err` (`VersionError: …`) until it reloads. Before,
the old page kept working and held the new page's upgrade back. A connection
the browser closes on its own (site data cleared, eviction) is not kept
either, and the next effect opens again.

`docs/spec/http.md` states this lifecycle.
