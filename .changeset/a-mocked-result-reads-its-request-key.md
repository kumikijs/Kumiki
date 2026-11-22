---
"@kumikijs/runtime": patch
---

A reducer-test that mocks an effect hands its `.ok` / `.err` reducers the request key as `$2`, the input the effect was emitted with, as a running app does.

The reducer-test runner answered each mocked emit with its stand-in result but did not keep the emit's input, so every `.ok` / `.err` reducer it ran got `undefined` as its second bind. A reducer that writes `$k` into a slot failed a test of a program that works:

```kumiki
reducer submit on=ui.click(SaveBtn) do= emit save(draft)
reducer done   on=save.ok($r, $k)   do= saved := $k
```

```
before: FAIL  the-ok-reducer-reads-the-input
          diff at:  slots.saved  "note-1" -> undefined
after:  PASS  the-ok-reducer-reads-the-input
```

Each mocked result now carries the input of the emit it answers, so a reducer further down the chain reads its own emit's key, not the first one's.
