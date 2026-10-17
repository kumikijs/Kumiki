---
"@kumikijs/runtime": patch
---

An `episode-test` reports a replay panic as the panic, not as the slot it left unwritten

`runEpisodeTest` compared `slots-equal` before it checked `no-panics` and
`no-errors`. A reducer that panicked during replay writes nothing, so every
slot it would have written diverged, and the report named that slot instead
of the panic. Which of the two an author was told about depended on whether
they also wrote a `slots-equal`:

```
# expect = {slots-equal: {seen: "/"}, no-panics: true}
FAIL  replay-reads-the-route
  expected: {"seen":"/"}
  actual:   {"seen":"", …}
  diff at:  slots.seen  "/" -> ""
```

Now `no-panics` is judged first, then `no-errors`, then `slots-equal`, and the
first that fails is the report (testing.md §8.6):

```
FAIL  replay-reads-the-route
  expected: no panics
  actual:   ep_0001: Cannot read properties of undefined (reading 'path')
  diff at:  panics
```

An err that reaches no `.err` reducer moves ahead of `slots-equal` for the
same reason: the slots the missing `.err` reducer would have written keep
their old values, and `diff at: slots.<name>` named them in place of
`diff at: errors`. A `reducer-test` already reports an unexpected panic and
an unhandled effect error ahead of its slots, so the two test kinds now agree.

A test that does not set `no-panics` or `no-errors` is unaffected: panics and
dropped errs are still not reported, and a divergence is reported at the slot,
as before.
