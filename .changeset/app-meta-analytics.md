---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

feat(app): wire `app.meta` and `app.analytics` end-to-end (#80).

Previously the parser accepted these blocks and threw away the value; both now flow from source to runtime.

- **compiler**: `AppDef.meta` / `AppDef.analytics` are real AST fields with field-level validation. `meta` accepts the closed set `title`, `description`, `og-image`, `favicon` (all string literals). `analytics` takes `provider: "console" | "noop"` plus optional `app-id`. Codegen emits both as plain literals on the App object.
- **runtime**: at mount, `app.meta` is reflected into `<head>` — `document.title`, `<meta name="description">`, `<meta property="og:image">`, `<link rel="icon">` — upserting existing tags rather than duplicating. `app.analytics` installs a default `analytics.send` provider (console / noop) unless the host registers one, so an app can declare measurement without depending on an SDK. `appId` is merged into every event payload.
- **examples**: `packages/examples/apps/09-app-meta-analytics`.
