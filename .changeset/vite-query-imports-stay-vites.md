---
"@kumikijs/vite": patch
---

Leave `?raw`, `?url` and Vite's other query imports of a `.kumiki` file to Vite

The plugin compiled every id whose path ended in `.kumiki`, whatever its query.
For `?raw` and `?url` Vite had already turned the file into a JavaScript
module, so the plugin compiled that JavaScript as Kumiki and the build stopped:

```
import src from "./app.kumiki?raw";

[plugin vite-plugin-kumiki] src/app.kumiki?raw:1:1
Kumiki compile failed (src/app.kumiki):
  Parse error at 1:1: Expected a definition keyword
```

The dev server failed the same way, so a page could not show an app's source
next to the app, or take its URL.

Now an id whose query carries one of Vite's own `raw`, `url`, `inline`,
`no-inline`, `worker` or `sharedworker` is left to Vite, and `?raw` gives the
file's text and `?url` its URL, exactly as without the plugin. A plain import,
the dev server's `?import`, a `?t=` cache buster and a worker entry's
`?worker_file` still compile. A `?worker` import bundles its entry with
`worker.plugins`, so list `kumiki()` there too.
