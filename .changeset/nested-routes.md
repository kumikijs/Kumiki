---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

feat(routing): nested routes — `sub-routes` declaration on tiles + `route-outlet` child rendering (#85).

`docs/spec/routing.md` §3.6 has described nested routes from day one, but the parser was discarding the `sub-routes` block and `route-outlet()` rendered as an empty `<div>`. Both halves are now wired end-to-end so a layout tile can host a `/parent/*` wildcard, declare its own child route map, and select which child renders inside its `route-outlet`.

- **compiler**: `TileDef.subRoutes` is a real AST field; the parser stores the parsed route map and codegen emits a nested `subRoutes:` array on the parent's route entry. Typecheck validates child tile existence (E0105), wildcard-parent integrity (E0114), orphan sub-routes (E0111), and duplicate sub-route paths (E0112).
- **runtime**: `parseLocation` re-matches the path inside the matched parent's `subRoutes`. `pickRootTile` injects the matched child into the first `route-outlet` of the parent's render tree, and the `route-outlet` renderer now mounts whatever children it has been given. If no sub-route matches under a wildcard parent, the runtime falls through to the global `/404` per §3.6.3.
- **examples**: `packages/examples/features/40-nested-routes.kumiki` + scenario (`/settings/*` with three sub-routes, including the default and the `/404` fallthrough).
