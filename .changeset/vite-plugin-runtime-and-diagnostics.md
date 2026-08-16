---
"@kumikijs/compiler": minor
"@kumikijs/vite": minor
"@kumikijs/cli": minor
---

fix: let the Vite plugin do what a bundler plugin is for.

**The runtime is no longer copied into every module.** `bundle` now defaults to
`false`, so the compiled module keeps its `import "@kumikijs/runtime"` and the
bundler ships one copy. The old default fought the pattern this plugin's own
documentation recommends — `mount` comes from that same package — so a project
that imported one `.kumiki` file built the runtime twice (129 kB against 82 kB
for the counter), and each further `.kumiki` import added another. Size was the
smaller half: the runtime keeps module-level state, and the injected
state-style sheet is found by DOM id while its sequence counter restarts per
copy. The plugin resolves the specifier from the project when it can and from
its own dependency otherwise, so a project that installed only `@kumikijs/vite`
still builds — with one copy either way. `bundle: true` remains for a module
that must stand alone.

**`generateDts` emitted TypeScript that did not compile.** A slot name is
allowed to be kebab-case, and it was written into the declaration bare
(`my-slot: string`); the generated helpers were called `Provider` / `Slots` /
`Providers`, which are among the likelier names a program declares itself. With
`types: true` both landed in the user's project and broke their `tsc`. Slot
names are now quoted — the spelling the emitted `slots` object actually uses —
the helpers are `KumikiProvider` / `KumikiSlots` / `KumikiProviders`, and a type
whose Kumiki name is not a TypeScript identifier is declared under one that is.
The guard runs a real `tsc` over the generated output.

**A parse error is now a diagnostic.** `compile()` returns type errors but
throws lex and parse errors, and the plugin only handled the returned form — so
the most common authoring mistake reached Vite's overlay as a stack of compiler
frames with no line to jump to. Both now arrive with file, line and column.

**`kumiki.caps.json` is found where a project would put it.** The lookup only
ever checked the directory holding the `.kumiki` file; a manifest at the project
root — where the rest of a Vite project's configuration lives — was ignored
without a word. It is now searched for from the source file up to the project
root — the nearest `package.json` — nearest manifest wins, and a
malformed manifest on that path is an error naming the file rather than a
silent fall-through. `E0302` now says which manifest was read, or which
directories were searched — in the plugin and in `kumiki check` / `kumiki
build` alike.
