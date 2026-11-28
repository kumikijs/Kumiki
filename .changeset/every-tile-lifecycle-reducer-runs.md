---
"@kumikijs/runtime": patch
---

A `tile.mount`, `tile.unmount` or `app.*` reducer that throws past its body no longer stops the other reducers that render or event owes

When a render mounted or unmounted several tiles, a reducer on one of them that threw past its
body, such as in the dispatch of what it emitted or as a host's episode logger recorded it, ended
the render's lifecycle reducers there. The rest never ran, then or later, since those tiles already
counted as mounted or gone. The same throw stopped the next reducer on one `app.start`,
`app.stop`, `app.visible`, `app.hidden`, `app.online` or `app.offline` event. Now every one of
them runs, and what threw is handed on after them: to the step of the reducer whose batch started
the render, or out of `mount` on its first render, as the one throw or one `AggregateError`
holding each.
