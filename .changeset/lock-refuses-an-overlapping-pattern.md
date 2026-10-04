---
"@kumikijs/cli": patch
---

`lock` refuses a pattern another agent's overlaps, and `unlock` of nothing fails

`lock` added the requested patterns to the caller's entry without comparing
them against the patterns other agents held. With agent:a holding `slot.*`,
`lock c.kumiki agent:b 'slot.count'` exited `0`, and from then on each agent's
edits of `slot.count` were refused by the other's lock, so nobody could edit
it. `unlock` of an agent that held nothing printed `unlocked`, exited `0`, and
created an empty `.kumiki-locks.json` when there was none.

`lock` now refuses a glob that some qualified name could match together with a
pattern another agent holds, whether or not either contains the other
(`slot.a*` and `slot.*b` both match `slot.ab`). It exits `1`, grants none of
the request, leaves the lock file unchanged, and names the overlap and its
holder:

```
Error: lock conflict: "slot.count" overlaps "slot.*", held by agent:a
```

A pattern the agent already holds, or one that overlaps only its own, is still
granted. `unlock` of an agent that holds no lock exits `1` and neither creates
nor rewrites the lock file:

```
Error: nothing to unlock: agent:x holds no lock on /path/to/c.kumiki
```

In a pattern, `*` is the only wildcard and every other character stands for
itself. A `?` used to make the character before it optional when an op was
checked against a lock; it now stands for a `?`, which no qualified name has,
so the check made at `lock` and the one made at each op read a pattern the
same way.
