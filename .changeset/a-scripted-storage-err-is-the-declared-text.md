---
"@kumikijs/runtime": patch
"@kumikijs/compiler": patch
---

A scenario's scripted `err` on a storage / session / indexed effect now reaches `.err` as the `Text` the real app would deliver.

`runScenario` takes the place of each effect's invoke, so a scripted err skipped the reading the compiled invoke gives a provider's err: `{"outcome": "err", "value": {"message": "blocked"}}` stored the record in a `Text` slot and the page showed `[object Object]`, while the scenario passed. Each such effect's spec now carries that reading as `errText` — the same compiled function its invoke calls — and the runner reads a scripted err through it: `{"message": "blocked"}` is `"blocked"`, `42` is `"42"`, a `Text` is unchanged, and a script with no `value` is `"undefined"`, as a provider's err with no `value` is. HTTP and custom-capability errs still reach `.err` as the script writes them.
