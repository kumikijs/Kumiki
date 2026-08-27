# Design Philosophy

Why is Kumiki shaped the way it is? This page condenses the design rationale. For *how* the 7 layers work in practice, read [Thinking in Kumiki](./thinking-in-kumiki.md); this page is about *why* they exist at all.

## Origins

The premise is simple: **if you design from scratch for AI to *write* the code, human-centered idioms like Hooks and JSX become liabilities**. Kumiki began as a test of that premise.

## Why not React

React is a human-centered optimum: Hooks, Context, and JSX are idioms refined over nearly twenty years to feel natural to people. As the writer of code shifts to AI, the same machinery becomes friction:

| Friction | What it costs an AI |
|---|---|
| Syntactic overhead | JSX inflates tokens — closing tags, camelCase attributes, expression embedding |
| Implicit side effects | `useEffect` dependency arrays, stale closures, forgotten cleanup |
| Order-dependent rules | Hooks call order, no Hooks in conditionals or lists |
| Implicit scope | Provider hierarchies, Context resolved invisibly from descendants |
| Non-local rendering | A parent re-render propagates; suppressing it with `memo` adds complexity |

The pattern: all of these are writable when an AI *writes* them, and become sharply harder when an AI must *fix* them or *touch them in parallel*. When the cause of a bug lives outside the program text the AI cannot reason about it without cramming the entire history into its context window.

Kumiki removes this friction **structurally**, not by convention.

## Design requirements

1. **Token efficiency** — the same UI in fewer tokens than React.
2. **Static traceability of side effects** — which effect depends on which state, and where it fires, is evident from the syntax alone.
3. **Architectural predictability** — bugs localize; errors are machine-readable codes.
4. **Resilience to parallel editing** — dozens of agents editing simultaneously must not break the program semantically.
5. **Readability may be sacrificed** — whether humans enjoy reading it is a secondary goal. The primary goal is that AI writes and fixes it accurately.

Requirements 1 and (partially) 2–4 are not aspirations — they are measured continuously. See [Benchmarks](./benchmarks.md).

## Where four independent designs converged

Kumiki did not start as one design. It started as **four independent proposals**, each from a separate model-assisted exploration that never saw the others.

Comparing them critically revealed that despite entirely different surface syntax, **all four converged on the same four cores**:

1. **Side effects are explicit descriptors** — pure values, not function calls.
2. **Local state is prohibited or minimized** — every piece of state is statically locatable.
3. **source ≠ runtime** — an IR and a compile step are mandatory.
4. **An append-only causal log** — debugging, replay, and audit share one foundation.

The only remaining disagreement was the physical form of the source text. Kumiki is the hybrid: 7 enforced layers and named slots (Pyramid), capability-bearing effect descriptors (IR+Actor / Pyramid), episode log thinking (Loom), parallel editing as referentially-checked ops (Nexus) — with each proposal's known weakness covered by another's strength (e.g. nesting is allowed only inside tiles, so the one-declaration-per-line shape never degenerates into parenthesis hell or assembly).

## Lessons taken from prior art

| Attempt | Adopted | Avoided |
|---|---|---|
| Elm | Complete side-effect isolation; Result/Option | Boilerplate bloat; rigidity of banning local state outright |
| Unison | Content-addressable definitions | Disconnection from the text/Git ecosystem |
| SolidJS | Fine-grained reactivity, compiled dependencies | Hidden tracking scope, signal staleness |
| Hazel / Subtext | Typed holes, zero syntax errors | Input friction |
| Dark | Trace-driven development | Ecosystem lock-in |
| Datomic | Append-only fact log | Unfit for high-frequency updates |

## Non-goals

Kumiki deliberately does **not** aim for:

- **Incremental migration of existing React code** — zero compatibility; new apps only.
- **Comfortable from-scratch authoring by humans** — humans *can* write it; it is not optimized for that.
- **Macros, plugins, or language extensions** — the AI's learning target stays single and closed.
- **Dynamic types** — everything is static.
- **Multiple rendering targets** — DOM only.

## Connect at the boundary, never through the language

The non-goals above imply a positive principle: **the language itself never grows holes** for interop. Connection to the existing JS ecosystem happens at three boundaries, all outside the language:

- **Inbound** — host code injects implementations for declared capabilities (`mount(app, target, { providers })`); standard capabilities like `http.*` can be overridden the same way. See [Standard Capabilities](../spec/stdlib.md#_2-5-standard-capabilities).
- **Outbound** — a Kumiki app embeds into any page as a Web Component (`defineKumikiElement`). See [Runtime](../spec/runtime.md).
- **Build** — `@kumikijs/vite` lets any Vite project `import App from "./app.kumiki"`, with generated TS types for the providers.

A `.kumiki` file means the same thing everywhere, because nothing host-specific can leak into it.
