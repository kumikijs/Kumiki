---
"@kumikijs/runtime": patch
---

An episode-test's `slots-equal: from-log` leaves `volatile` slots out, so replaying a log against the program that recorded it passes when a reducer writes one.

A `volatile` slot is not written to the episode log (language.md), so its writes are in no `slot-diffs`. `from-log` built its expectation over every declared slot, starting each at its initial value and applying the recorded diffs, while replay writes the volatile slot as the reducer always did. Any reducer that touched one, such as a password field cleared on submit, failed its own episode-test:

```
before: FAIL  replay-vol
          expected: {"count":1,"lastClick":""}
          diff at:  slots.lastClick  "" -> "clicked"
after:  PASS  replay-vol
```

A slot the program declares `volatile` is now out of the `from-log` comparison, even where an older log, recorded before the slot was volatile, holds a write to it. Every other slot is expected as before: at the last value the log recorded for it, or at its initial value when the log never wrote it, so a divergence there fails at the same `slots.<name>` it did. A record such as `slots-equal: {lastClick: "clicked"}` names its slots, and compares a `volatile` one like any other.
