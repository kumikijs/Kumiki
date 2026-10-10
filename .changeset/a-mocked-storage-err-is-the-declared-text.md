---
"@kumikijs/runtime": minor
"@kumikijs/cli": patch
---

A `kumiki replay --mock 'x: err(<json>)'` on a storage / session / indexed effect now reaches `.err` as the `Text` the real app would deliver.

The `--mock` payload is JSON nobody typechecks, and the replay runner handed it to `.err` as written: `--mock 'load: err({"message":"blocked"})'` stored the record in a `Text` slot, and the trace printed `problem: "" -> {"message":"blocked"}`. It now reads it the way the effect reads a provider's err — through the effect's `errText`, the reading a scenario script already goes through — so the slot gets `"blocked"`. The same reading covers a recorded `effect-end` replayed by `from-log` (including the one an `ssr.hydrate` bootstrap's entry reducer takes as its `$1`) and an `episode-test` / `reducer-test` mock handed to the runtime runner directly. In a `.kumiki` test nothing changes: the checker already rejects `err({message: "blocked"})` on such an effect with E0201, and `err("blocked")` is delivered as before. HTTP and custom-capability errs still reach `.err` as written.

A stand-in `ok` with no value now reaches `.ok` as `null` on every path. A reducer-test mock and a scenario script already did; a `fixed` / `from-log` replay mock and the `ssr.hydrate` entry passed it on as `undefined`, which no Kumiki value is.

`replayEpisodes`, `runEpisodeTest` and `runReducerTestFlow` now require the app's `effects` alongside `live` / `slots` / `reducers`, since that is where the reading lives; pass the app's own `effects`. That is a breaking change to their TypeScript signatures, hence the minor bump.
