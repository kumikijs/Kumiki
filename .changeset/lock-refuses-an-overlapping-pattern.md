---
"@kumikijs/cli": patch
---

`lock` refuses a pattern another agent's overlaps, and `unlock` of nothing fails

`lock` added the requested patterns to the caller's entry without comparing
them against the patterns other agents held. With agent:a holding `slot.*`,
`lock c.kumiki agent:b 'slot.count'` exited `0`, and from then on each agent's
edits of `slot.count` were refused by the other's lock, so nobody could edit
it. `unlock` of an agent that held nothing printed `unlocked`, exited `0`, and
created an empty `.kumiki-locks.json` when there was none. A pattern that named
no glob, like `','`, was granted as an entry holding nothing, which `unlock`
then released with exit `0`.

`lock` now refuses a glob that some name with exactly one dot, the shape of
every qualified name, could match together with a pattern another agent holds,
whether or not either contains the other (`slot.a*` and `slot.*b` both match
`slot.ab`). It exits `1`, grants none of the request, leaves the lock file
unchanged, and names the overlap, its holder and what to do about it:

```
Error: lock conflict: "slot.count" overlaps "slot.*", held by agent:a. None of the request was granted: agent:a has to unlock first, or ask for a glob that does not overlap "slot.*".
```

Only other agents' patterns are compared, so a pattern the agent already
holds, or one that overlaps only its own, is still granted. A pattern that
names no glob exits `2` before the file is read, and `lockDef` throws for it.
`unlock` of an agent that holds no lock exits `1`, neither creates nor rewrites
the lock file, and names the agents that do hold one:

```
Error: nothing to unlock: agent-1 holds no lock on /path/to/c.kumiki. Locks on it are held by agent:1.
```

A lock file written before this fix can already hold overlapping patterns: the
first example above leaves `slot.*` with agent:a and `slot.count` with
agent:b. Upgrading does not undo that, since only a new request is compared, so
the two stay deadlocked on `slot.count` until one of them is unlocked.

In a glob, `*` is the only wildcard and every other character stands for
itself. A `?` used to reach the regex each op is checked against unescaped. A
glob starting with `?` made that regex invalid (`/^(?foo)$/: Invalid group`,
and after a comma `/^(slot\.a|?b)$/: Nothing to repeat`), and since every op
builds one for each pattern of every other agent, one such lock made the ops of
every other agent fail. Anywhere else a `?` made the character before it
optional; it now stands for a `?`, which no qualified name has, so an existing
`slot.counts?` lock stops covering `slot.count` after the upgrade.
