---
"@kumikijs/runtime": patch
"@kumikijs/cli": patch
---

A `kumiki replay --mock 'x: err(<json>)'` on a storage / session / indexed effect now reaches `.err` as the `Text` the real app would deliver (#727).

The `--mock` payload is JSON nobody typechecks, and the replay runner handed it to `.err` as written: `--mock 'load: err({"message":"blocked"})'` stored the record in a `Text` slot, and the trace printed `problem: "" -> {"message":"blocked"}`. It now reads it the way the effect reads a provider's err — through the effect's `errText`, the reading a scenario script already goes through — so the slot gets `"blocked"`. The same reading covers a recorded `effect-end` replayed by `from-log`, and an `episode-test` / `reducer-test` mock handed to the runtime runner directly. In a `.kumiki` test nothing changes: the checker already rejects `err({message: "blocked"})` on such an effect with E0201, and `err("blocked")` is delivered as before. HTTP and custom-capability errs still reach `.err` as written.

`replayEpisodes`, `runEpisodeTest` and `runReducerTestFlow` now require the app's `effects` alongside `live` / `slots` / `reducers`, since that is where the reading lives; pass the app's own `effects`.
