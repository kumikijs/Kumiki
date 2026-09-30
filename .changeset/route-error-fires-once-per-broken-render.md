---
"@kumikijs/runtime": patch
---

Fire `route.error` once for a render that panics

A `route.error` reducer's write re-rendered the page on the spot, and that page
was the one that had just panicked. So it panicked again and fired the reducer
again, one level deeper each time — about a thousand nested renders — until the
stack overflowed. The overflow itself was then caught as a render panic with no
tile to name, so which `$event` the reducer last saw depended on the frame it
landed in: sometimes the route target (`"Boom"`), sometimes `"render"`. That is
why a test pinning `$event.location` failed only some of the time.

The handlers' writes no longer render on their own. The render that caught the
panic already renders once more after they return, which is where a navigation
they asked for takes effect; if that render still panics, the built-in panic
display is shown and the handlers are not fired again.
