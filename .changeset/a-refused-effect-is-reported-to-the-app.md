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
the whole of it.

The episode a refusal attaches to is the one that owns the emit, which is not
always the one in focus. A deferred policy (`debounce`, `queue`) launches from
a timer or a queue tail, long after the triggering episode closed, so the
refusal is recorded against the episode that claimed the `effect-start` — and
`episode-id` names it. Without that, a refused `debounce` left its episode
holding an `effect-start` and an `effect-cancel` and nothing else, which is
exactly what a *replaced* timer looks like. The one emit with no episode to
name is one from `app.init`, dispatched before the first episode opens; it
reports to the console and to `app.error` carrying `episode-id: None`.

**The bootstrap episode of a refused emit is now `status: "panic"`** rather
than `"completed"`, because it carries a panic step — which is what that status
means on the live path too. Where a refusal records both a `panic` step and an
`effect-cancel`, the panic comes first: the cancel settles the episode (a step
appended after it lands on one already handed to `onEpisode` and the
localStorage mirror), and the reason reads ahead of the consequence.

One consequence worth naming: the `kumiki dev` error overlay raises on an
episode whose status is `"panic"` *and* whose last step is a `panic`, so a
refusal under the default policy now raises it where it previously did not.
One whose `panic` step is followed by an `effect-cancel` — the SSR bootstrap,
and a deferred-policy refusal — still does not, exactly as before.

§10.4.2 now says all of this instead of one sentence, in both language tracks.
`docs/spec/runtime.md` §10.5.1 and `lifecycle.md` §7.2.3 said the opposite —
that `capability` was a value reserved for a callsite not yet wired — and now
say it is wired; so do the `PanicCategory` declaration and E0301's rationale,
which still described the console warning that is gone. The JA track has no
§10.5.1.1, so `runtime.md`'s JA diff is the §10.4.2 hunk alone; `lifecycle.md`
and `errors.md` are fixed in both.
