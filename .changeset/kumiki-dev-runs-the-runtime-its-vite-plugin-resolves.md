---
"@kumikijs/cli": patch
---

`kumiki dev` runs the runtime its Vite plugin resolves, and starts without an optimizer warning

`kumiki dev` asked Vite to pre-bundle `@kumikijs/runtime`, resolved from the
`.kumiki` file's directory. A directory without the package installed — any
project that installed only the CLI, a file in a temp directory, every example
in this repository — started with:

```
Failed to resolve dependency: @kumikijs/runtime, present in client 'optimizeDeps.include'
```

The dev client also looked up its own runtime import with `require.resolve`
from the CLI's location: a second answer beside the one `@kumikijs/vite` gives
the compiled app, and the two agree only while both reach the same file. The
published runtime's `exports` has no `require` entry, so with the CLI installed
from npm that lookup threw, and `kumiki dev` exited at start:

```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in …/node_modules/@kumikijs/runtime/package.json
```

`@kumikijs/vite` now answers the runtime import for the dev client exactly as it
does for the compiled app — the project's own copy when the file's directory
resolves one, the plugin's dependency otherwise — so the page runs one copy, and
the dev server names nothing to Vite's dependency optimizer. A runtime installed
in the project is still pre-bundled, by Vite's own dependency discovery. A
linked (workspace) runtime is served from its source, as Vite serves any linked
package, rather than pre-bundled; the plugin's own copy is served as it is,
which for the published runtime is one module.
