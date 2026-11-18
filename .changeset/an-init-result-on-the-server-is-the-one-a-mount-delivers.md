---
"@kumikijs/runtime": patch
---

`renderToString` delivers an `app.init` effect's result as a mount does: its `.ok` / `.err` reducers get the emit's input as `$2`, a `retry=` effect is retried, and an invoke that throws fails with the `{message}` record.

The server pass ran `app.init` through a dispatcher of its own, which differed from the live one in three ways. It handed every result reducer `undefined` as its second bind, so a slot written from `$k` was empty in the served page, left out of the snapshot, and still at its declared default after hydration. It called the effect's invoke once, so a request declared `retry=` that met one 503 on the server failed there and succeeded in the browser. And when the invoke threw, its `.err` value was the bare message text, so `$e.message` read nothing. Hydration does not run `app.init` again, so the hydrated page kept each of these.

For an app whose init loads `/theme/dark` under `latest-per-key($1)`, a `/quote` that answers 503 once under `retry=linear(3, 10ms)`, and a `ping` whose `http.post` provider throws:

```
before: SSR html : themeAt= quote=failed 503 pinged=err []
after:  SSR html : themeAt=dark quote=hello pinged=err [Error: transport down]
```

The snapshot and the hydrated page now carry the same values, which are the ones a mount shows. Both passes now run an effect through one function, so the attempts and the value of a thrown invoke cannot drift apart again.
