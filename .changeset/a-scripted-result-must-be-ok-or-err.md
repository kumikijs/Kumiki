---
"@kumikijs/runtime": patch
---

A scenario whose scripted effect result is not `{outcome: "ok" | "err", value}`, such as `"outcome": "error"` or one with no `outcome`, is now refused before the app mounts, with the script's path.

Nothing checked the scripts under `effects` or `defaultEffect`, so the runner handed such a script to the app as a provider's answer that is not a result. The scenario then failed a later step with a message about the effect, which pointed at the app rather than the scenario file. `validateScenario` now names each problem by its path, such as `effects.loadSession[2].outcome must be "ok" or "err", not "error"`, alongside the document's other problems: a script with no `outcome`, a key other than `outcome` and `value`, an entry that is not an object, and `effects` that does not map names to lists.
