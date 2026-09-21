---
"@kumikijs/runtime": minor
---

Report a refused effect to the app

`runtime.md` §10.4.2 defines the capability check in two clauses — "A violation
is not executed **and is notified to `app.error`**" — and only the first was
enforced. A violation reached `console.warn` and stopped:

```ts
console.warn(`Capability "${cap}" not declared in app.caps`);
```

No `app.error` reducer ran and no `panic` step landed. Worse, neither `smoke`
nor `scenario` patches `console.warn` — they watch `console.error` — so an app
whose only effect was refused mounted, rendered, and **passed** every
verification tier. The compile-time half (E0301) catches the common case, which
is exactly why the cases that reach the runtime (a host-built `AppShape`, a
`caps` array edited after codegen, a provider that was supposed to register)
were the ones a silent channel served worst.

A refusal is now reported, in three places:

```
[kumiki] panic in effect "save": capability "storage.write" is not declared in app.caps
```

to `console.error`, where the tiers read; to the episode as a `panic` step with
`category: "capability"` — the value the spec had already declared for it — so
`kumiki replay` shows why nothing ran; and to `app.error`, which takes it as an
ordinary `PanicInfo`:

```kumiki fragment
reducer onPanic
    on=app.error
    do= lastError := Some($event)     # $event.category is "capability"
```

Both the live dispatcher and the SSR pass report, in the same words, through
one shared builder. What differs is what each can report *to*: `renderToString`
has no `app.error` to fire, the same way a reducer panic on that pass is a
`panic` step and nothing more, so on the server the console and the episode are
the whole of it. On the live path an `app.init` emit is dispatched before the
first episode opens, so it reports to the console and to `app.error` but has no
episode to attach a step to. §10.4.2 now says all of this instead of one
sentence, in both language tracks.

**The SSR bootstrap episode of a refused emit is now `status: "panic"`** rather
than `"completed"`, because it carries a panic step — which is what that status
means on the live path too. The `effect-start` / `effect-cancel` pair stays
where it was, with the `panic` step after it: the pair is the event, the step is
the reason.

`docs/spec/runtime.md` §10.7 and `lifecycle.md` §7.2.3 said the opposite of
§10.4.2 — that `capability` was a value reserved for a callsite not yet wired —
and now say it is wired. Both tracks.
