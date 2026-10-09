# AI Editing API, CRDT ops, and Referential Integrity

Kumiki code is stored not in physical files but in a **content-addressable CRDT graph**. Rather than editing text files, an AI agent issues **structured editing operations (ops)**.

This provides:

- Per-file merge conflicts cannot occur in principle
- The impact scope of an edit can be computed statically
- References don't break on rename (hash is invariant)
- An **automatic repair loop** can be run when an edit fails

## 9.1 Overview

An edit travels a loop with three stops:

1. **The store** — the CRDT graph, holding a set of definitions, each addressed by the hash of its own body.
2. **The projection** — text that `kumiki view` renders out of the store, covering whichever definitions the agent asked for.
3. **The op** — what the agent writes back, and what `kumiki op apply` folds into the store.

So the AI reads a text cross-section of the graph and answers with an op, never with a text diff.

---

## 9.2 The kumiki CLI

### 9.2.1 Read Commands

```bash
kumiki view <selector>              # render a definition as text and output it
kumiki view slot.todos              # a single definition
kumiki view 'slot.*'                # wildcard
kumiki view --with-deps reducer.add # output related definitions together
kumiki view --hash slot.todos       # display the content-hash
kumiki view --history slot.todos    # this definition's edit history
kumiki view --refs slot.todos       # list the referrers of this definition
kumiki list <layer>                 # all definition names within a layer
kumiki list                         # all definition names (with layer prefix)
```

### 9.2.2 Write Commands

```bash
kumiki add <layer> <name> <body>            # add a new definition
kumiki add ... --body-file <path>           # read body from a file ('-' = stdin) — preserves whitespace
kumiki replace <layer>.<name> <body>        # replace a definition
kumiki replace ... --body-file <path>       # read body from a file ('-' = stdin) — preserves whitespace
kumiki edit <layer>.<name> <patch>          # partial edit (e.g., inside a reducer's do=)
kumiki edit ... --patch-file <path>         # read patch JSON from a file ('-' = stdin)
kumiki rename <layer>.<old> <new>           # rename (hash invariant)
kumiki remove <layer>.<name>                # remove (fails if referenced)
kumiki patch apply <file>                   # apply a CRDT op bundle
kumiki patch revert <op-id>                 # revert a specific op
```

Multi-line bodies (a reducer's `do=` block, a fn's multi-line RHS, etc.) must go through `--body-file` — the positional form is joined with single spaces so whitespace-significant content (newlines, tab runs) is lost. Passing `--body-file` alongside a positional body is rejected as a mutually-exclusive conflict.

The `<layer>` of `add` is one of the labels `kumiki list` takes: `type`, `slot`, `effect`, `reducer`, `tile`, `fn`, `app`, `theme`, `motion`, `test`. For any other word, `kumiki add` exits `2` before it reads the file. `<name>` is one identifier, and `add` rejects anything else. The body is the definition without `<layer> <name>` and the separator after it: `Int = 0` for `slot count : Int = 0`, `heading("Hi")` for `tile Greeting = heading("Hi")`. A tile's clauses (`in=`, `error-boundary=`, `scroll-restoration=`, `sub-routes=`) and a type's parameters sit between the name and the `=`, so a body with them starts with them and includes the `=`. `in=Text = heading($1)` writes `tile Greet in=Text = heading($1)`, and `(T) = {v: T}` writes `type Box(T) = {v: T}`. A `replace` body that does not start with clauses or parameters keeps the ones the definition has: on `tile Greeting error-boundary=Oops = …`, the body `heading("Hello")` writes `tile Greeting error-boundary=Oops = heading("Hello")`. To change them, the body states the ones to keep. To drop them all, it starts at the `=`. After its `replaced` line, `replace` prints one line for each clause or parameter the definition no longer has, `  dropped error-boundary` or `  dropped parameter T`, so a write that passes validation does not lose one unnoticed.

A write op is validated by re-parsing and re-typechecking the file, and rolls back on any `severity: "error"` diagnostic — with one exception. A program is built one definition at a time, so it is app-less until the `app` lands; **`E0003 missing-app` does not roll back a write op**. Whether the program is a complete application is what `kumiki check` reports, not what a mid-edit graph must already satisfy.

Write ops on one file are **serialized**. `add`, `replace`, `edit`, `rename`, `remove`, `patch apply`, `patch revert`, `lock` and `unlock` each hold the file's write lock — a sibling `<file>.kumiki-write.lock`, not to be confused with the ownership lock `<file>.kumiki-locks.json` of §9.8.3 — for the whole read → validate → write → log sequence; `patch apply` and `patch revert` hold it once across the ops they are made of. The composed source is validated *before* it is written, and the file is replaced by a renamed sibling rather than written in place, so another reader never sees a half-written file and a rejected op never overwrites anything. (Being replaced, a symlink at the file's path is replaced rather than followed, and the file does not keep its own permissions.) If the op cannot then be appended to the op log, the file is put back and the op is rejected. As a result, every op in the op log is reflected in the file, and every op that reported success is in both. `kumiki fix --apply` also writes by rename but does not take the write lock, so it must not run alongside the write verbs on the same file.

A writer that finds the lock held waits for it: 30 s by default, or `KUMIKI_WRITE_LOCK_WAIT_MS` milliseconds. The wait is per writer, so with several queued the last one waits for every writer ahead of it. If the lock is not released in time, the op is rejected: exit `1`, nothing written, nothing logged, and the message names the holder's pid and host (and its thread, when that is a worker thread) and the lock file. The MCP tools wait the same way, and the server answers no other request while one of them waits. A lock is taken over instead of waited on when its holder is known to be gone: it names a process on this host that has exited; it names the writer's own thread, which holds nothing, so the lock was left by one of its own releases that failed; or it names no holder (empty, not JSON, a pid that is not a positive integer, or a thread id that is not a non-negative integer) and is more than 2 s old. The lock records the writing thread as well as the process, because the worker threads of one process share its pid: a lock naming another thread of a running process is waited on like any live writer's. Whether a thread is still running cannot be checked from another thread, so a lock left by a worker thread that ended mid-write (one that was terminated, say) is waited on until its process exits; if that thread is not writing the file, delete the lock file. A lock that records no thread names the process's main thread. A lock naming a process on another host — another container, or Windows and WSL on a shared drive — is never taken over, because whether that process is still running cannot be checked; if it is not, delete the lock file.

### 9.2.3 Validation Commands

```bash
kumiki check                       # types, references, effects, everything
kumiki check --types               # types only
kumiki check --refs                # referential integrity only
kumiki check --effects             # capability/policy consistency only
kumiki check --a11y                # accessibility conventions
```

The three narrowing flags select along one axis: what kind of mistake a diagnostic describes. They name what to keep, so they compose — `--types --refs` reports both bands rather than one of them. Structure (`E00xx`), opt-in checks and testing-DSL invariants (`E07xx`), and runtime hazards (`E08xx`) are not on that axis — no flag selects them, so **every narrowing reports them anyway**. A flag can decide which kind of mistake you want to hear about; it cannot make a program with no entry point look sound.

### 9.2.4 Fix Assistance

```bash
kumiki fix --auto-patch <error-id>          # propose a CRDT op that auto-fixes the error
kumiki fix --apply                          # apply the proposal as-is
kumiki fix --interactive                    # apply proposals one at a time with confirmation
```

### 9.2.5 Exit Codes

Every verb reports through its exit code, because that is the only part of the output a shell reads. `kumiki fix --apply && kumiki build …` has to stop when the file is still broken, and `kumiki test app.kumiki 'checkout-*'` has to fail when the name it was given matches nothing.

| code | meaning |
|---|---|
| `0` | the verb did what it was asked |
| `1` | the verb ran and the operation failed |
| `2` | the arguments are the wrong shape |

`2` is decided before the `.kumiki` file is read — a missing positional, an unknown option, a positional outside its allowed set. It therefore never means "we looked at your program"; whatever `2` reports, the program was not examined.

Per verb, `1` means:

| verb | exits `1` when |
|---|---|
| `check` | a diagnostic of severity `error` survives the narrowing flags. Warnings do not change the code (`ok (1 warning)` is `0`) |
| `build` | the program does not compile, or the output cannot be written |
| `smoke` | the app fails to mount, or an interaction throws |
| `run` | the scenario document is unreadable / not a scenario, or a step fails |
| `test` | a test fails, **or** a filter was given and matched no test. No filter and no tests is `0`; `--watch` runs until interrupted and so reports nothing |
| `fix` | the file is not in the state that was asked for when the process ends: errors remain, or — with `--auto-patch <test>` — the named test does not pass. A dry run repairs nothing, so it is `1` for any file that is not already in that state |
| `view` / `refs` | the file, or the qualified name inside it, does not exist. `view --history` requires only the file: a definition that was removed still has a history, and that is when it is asked for |
| `list` | the file does not exist, or the filter names no kind of definition. A real one with nothing under it prints nothing and exits `0` |
| `add` / `replace` / `remove` / `rename` / `edit` / `patch` | the write was rejected and rolled back |
| `lock` / `unlock` | the lock is held by another agent, or there is none to release |
| `replay` | the log is unreadable, the named episode is not in it, or a replayed episode panicked |
| `dev` | the server could not start. Once it is serving it runs until interrupted, and so reports nothing |

A warning never changes an exit code. That is what separates the two tiers: an `error` is a claim the program is wrong, a `warning` is a claim it is suspicious, and only the first one is allowed to stop a pipeline.

The MCP server ([§9.7](#_9-7-mcp-server)) answers the same question with `isError`: a failure that would exit `1` here sets `isError: true` there. The content is unchanged by the flag — a failed check still answers with its diagnostics and a failed scenario with its trace. Only a failure that produced no answer at all (a missing file, a name that resolves to nothing) replaces the content with the envelope `{"error": {"kind", "message"}}`.

## 9.3 The Form of a CRDT op

### 9.3.1 op Kinds

| op | Meaning |
|---|---|
| `add` | Add a new definition |
| `replace` | Replace a definition body |
| `edit` | Edit part of a definition (field update, adding/removing statements inside a reducer's do=, etc.) |
| `rename` | Rename (hash invariant; references updated by a separate op) |
| `remove` | Remove a definition (dependent ops auto-generated) |
| `link` | Add a reference (explicit) |
| `unlink` | Remove a reference (explicit) |

### 9.3.2 Wire Format

```json
{
  "op": "add",
  "layer": "slot",
  "name": "todos",
  "body": "Map(TodoId, Todo) = {}",
  "author": "agent:claude-1",
  "ts": 1779884546123,
  "op-id": "op_01JC...",
  "parent-ops": ["op_01JB..."],
  "depends-on": ["type:TodoId@h:9ab3...", "type:Todo@h:7cde..."]
}
```

| Field | Meaning |
|---|---|
| `op` | op kind |
| `layer` | target layer |
| `name` | target name |
| `body` | new body (required for add/replace), as [§9.2.2](#_9-2-2-write-commands) describes it. A tile's or a type's always states its clauses or parameters, and starts at its `=` when it has none (`= heading("Hi")`), so `patch apply` writes the definition the op wrote, whatever clauses the definition has gained since |
| `prev` | `replace` and `edit` only: the body the definition had before the op, in the same form as `body`. `patch revert` writes it back, so clauses and parameters that no logged body has, such as ones written by hand, come back too. What separated the name from the body, such as a comment after the name or a line break, is not kept: the body follows the name as `add` writes it |
| `author` | issuing agent |
| `ts` | issue time (UNIX ms) |
| `op-id` | the op's ULID |
| `parent-ops` | id of the immediately preceding op this op relies on (CRDT ordering guarantee) |
| `depends-on` | hashes of other definitions the body references (for referential integrity verification) |
| `removed` | `remove --cascade` only: every definition the op deleted, the requested one first ([§9.4.1](#_9-4-1-pre-check-at-op-issuance)) |
| `bodies` | `remove` only: every definition the op deleted as `{layer, name, body}`, with the body it had when it was deleted, the requested one first. `patch revert` restores these |
| `with` | `add` only: further definitions `{layer, name, body}` added in the same op — how the revert of a cascade restores its dependents |

`with` and `bodies` must be arrays of objects whose three fields are strings, `removed` an array of qualified names starting with the op's own definition, and `prev` a string on a `replace` or an `edit`, which are the only ops that have one. An op in a patch file or a line in the op log that breaks this is rejected, naming the field, before anything is written.

`patch revert` of a `replace` or an `edit` logged without `prev` falls back to the last body the log has for the definition. A tile or a type body there that does not state its clauses or parameters keeps the ones the definition has, as in a `replace`. A logged body that is a whole definition, starting with `<layer> <name>`, is refused, naming the definition, and nothing is written.

### 9.3.3 op Convergence Guarantees

The Kumiki graph is an **Add-Wins LWW-Map** (last-write-wins + add takes priority over remove).

- When same-name adds come from multiple agents: the winner is decided by the lexicographic order of `op-id`
- When add and remove cross: add wins (better to keep it than to create a dangling reference)
- replace vs replace: the one with the newer ts wins
- rename vs remove: rename wins

These are mathematically guaranteed to converge. However, **semantic consistency requires separate checking** (next section).

## 9.4 Enforcing Referential Integrity

Even though CRDT guarantees syntactic convergence, **semantic conflicts** are a separate matter:

- A: `kumiki remove slot.draft`
- B: `kumiki add tile.NewForm input(bind=draft)`

After both converge as CRDT, the reference from `tile.NewForm` to `slot.draft` becomes dangling.

Kumiki prevents this in **two stages**:

### 9.4.1 Pre-Check at op Issuance

```bash
kumiki remove slot.draft
# Error: cannot remove slot.draft (referenced by 3 tiles, 2 reducers)
#   tile.NewForm:1
#   tile.Compose:4
#   tile.SearchBox:1
#   reducer.submitNew:2
#   reducer.clearDraft:1
# Use --cascade to remove all dependents, or --force to leave dangling
```

`--cascade` includes the dependents in the same op bundle and removes them too. The dependents are every definition that references the removed one, directly or transitively, which can include the `app`. A definition that the removed one references stays, unless it is a dependent as well. `--force` tolerates dangling (emits a warning).

The cascade's `remove` op lists every definition it took in `removed`, the requested one first, and records each one's body in `bodies`. `kumiki patch revert` of that op restores all of them as **one** `add` op: the requested definition is its `layer` / `name` / `body`, and the dependents are its `with` list. The bodies are the ones recorded on the remove, so they are what the file held at that moment, even when a rename has since rewritten a dependent without logging its new body. A `remove` logged before `bodies` existed falls back to the last body the op log recorded for each name before the remove; if any of them cannot be found, the revert writes nothing, exits `1`, and names the definitions it could not restore. A cascade logged without `removed` is refused outright, because what it removed is unknown. A revert never reports a partial restore as success.

Reverting that `add` removes exactly the set it added: the named definition and every member of `with`. It does not re-derive the set from what references the named definition now, so a member that no longer depends on it is still removed. A member renamed since is removed under its new name ([§9.5.3](#_9-5-3-names-at-display-time)). It is refused, before anything is written, if a member is no longer in the file (removed since) or if a definition outside the set references a member; the error names each such reference as `<outside> references <member>`. A member locked by another agent refuses it too, as for any op ([§9.8.3](#_9-8-3-task-boundaries)): the file is left byte-identical and nothing is logged. The same holds for each definition the restoring `add` puts back. `patch apply` of a cascade `remove` that carries `removed` likewise removes that recorded set, under the same refusals.

### 9.4.2 Post-Check at op Application

When ops from multiple agents arrive simultaneously, the **graph store performs a reference check at the transaction boundary**:

```
transaction begin
  apply op_A (remove slot.draft)
  apply op_B (add tile.NewForm with ref to draft)
check refs
  -> dangling: tile.NewForm -> slot.draft
resolve:
  policy=strict: rollback both ops, mark as conflict
  policy=heal:   add slot.draft back with default value, log conflict
  policy=warn:   apply both, mark warning, emit notification
transaction commit
```

The resolve policy is set via `kumiki config conflict-policy <strict|heal|warn>`. Default is `strict`.

## 9.5 hash Computation and Reference Resolution

### 9.5.1 hash Computation

```
canonical(body) = AST normalization (identifiers replaced by type hash + position, field names alphabetized, whitespace stripped)
hash(def) = blake3(canonical(def.body) ⊕ hash(dep1) ⊕ hash(dep2) ⊕ ...)
```

No definition's name is part of the hash. The definition's own name is left out, and a reference to another definition counts as that definition's hash, not as its spelling. Whitespace and comments are not part of it either. So a rename leaves the hash of the renamed definition, and of every definition that references it, as it was, and so does a change of whitespace or comments. A `depends-on` digest recorded before a rename still matches `kumiki view --hash` of the dependency after it. A change to what a body says (`Int = 0` to `Int = 1`) changes the hash of that definition and of every definition that depends on it, with the one known exception below. Two definitions that differ only in their names, such as `slot a : Int = 0` and `slot b : Int = 0`, have the same hash.

Definitions that refer to each other in a cycle, such as two mutually recursive types, are hashed as one unit, since none of their hashes can be computed before the others'. Within the unit, a reference from one member to another counts as what that member says, with its own references to members of the unit left out, rather than as its hash, and every member's hash covers what every member of the unit says. So a member's hash is the same whichever member is reached first, and a `depends-on` digest of a member matches its `kumiki view --hash`.

Known limitation: a reference counts as the hash of the definition it names, and two definitions that differ only in their names share a hash, so a reference to one of them counts the same as a reference to the other. `a := b` and `b := a` hash alike when `slot a` and `slot b` are both `Int = 0`, though the two slots are separate state.

### 9.5.2 Reference Resolution

A name reference like `users` in the source text is recorded within the graph store as `slot:hash:9ab3c1...`.

- Name → hash resolution is done at compile time / op application time
- Even with the same name, a different dependency yields a different hash
- Renaming is only a `(rename, name-old, name-new)` op. The hash is invariant

### 9.5.3 Names at Display Time

When retrieved via `kumiki view`, hashes are turned back into human-readable names (**labels**).

A rename moves the label, not the definition. A remove ends the definition: one added under its name afterwards, or renamed to it, is another definition. After `kumiki rename slot.count total`:

- `kumiki view --history slot.total` lists the ops made on the definition while it was `slot.count`, back to the op that added it, then the rename, then the ops made since. Ops on an earlier definition that was called `slot.total` and removed stay listed too. `slot.count` keeps listing the ops made under it, as that name's history, including the ops on an earlier definition that was called `slot.count` and removed; `slot.total` does not list those.
- `kumiki patch revert` of an op made before the rename acts on the definition under the name it has now. Reverting a `replace` of `slot.count` restores the earlier body on `slot.total`, even if another definition has taken the name `slot.count` since. The earlier body is looked up under whichever name the definition had when the op log recorded it. Where that body names the definition itself, as its own name and in each reference to itself (a recursive type or fn), it is written with the name the definition has now, at the positions a rename rewrites, so it refers to itself rather than to whatever has its earlier name.
- `kumiki patch revert` of an op on a definition that a later op removed is refused before anything is written, naming the op that ended it: `patch revert: <op> replaced slot.count, which is no longer in the file: <op> removed slot.count; nothing was written`. That holds whatever has the name now: a definition added under it or renamed to it since is another definition, and so, to the op log, is the removed one put back by reverting the remove.

## 9.6 Error Codes and Automatic Repair

All errors are structured:

```json
{
  "code": "E0103",
  "kind": "undef-ref",
  "location": "tile.TodoRow.body:2",
  "message": "Reference to undefined slot 'usres'",
  "suggestion": {
    "kind": "did-you-mean",
    "name": "users",
    "similarity": 0.92
  },
  "auto-patch": {
    "op": "edit",
    "layer": "tile",
    "name": "TodoRow",
    "patch": {"body:2": "replace 'usres' -> 'users'"}
  }
}
```

This `edit` op replaces the first `usres` on line 2 of `tile.TodoRow`, counting from the definition's first line. If `usres` is not on that line, for example because the line has changed since the error was reported, the op is rejected like any other failed write (§9.2.5): it exits `1`, writes nothing and logs nothing, and the message names the text and the line. A `{"find": …, "replace": …}` patch is rejected the same way when `find` is not in the definition.

### 9.6.1 Where the codes are defined

[Error Code Specification](./errors.md) defines every code, normatively and in one place: what raises it, the message it carries, and the fix. Nothing here restates them — a second table is how `E0302` came to mean both "direct effect call" and "unknown capability", and a code whose meaning depends on which document you opened is not the permanent contract errors.md says it is.

For automatic repair, the column that matters is errors.md's own **Auto-patch Coverage** table: it says, per code, whether `kumiki fix` can repair it and by what strategy. The loop below consumes that.

### 9.6.2 Automatic Repair Loop

```bash
# AI agent script
while true; do
    errors=$(kumiki check --json)
    if [ -z "$errors" ]; then break; fi
    for err in $errors; do
        if has_auto_patch "$err"; then
            kumiki patch apply <(echo "$err" | jq .auto-patch)
        else
            # delegate the fix to the AI
            echo "$err" | ai-fix
        fi
    done
done
```

With `kumiki fix --auto-patch <code>`, errors that have an auto-patch are resolved structurally. Only errors without an auto-patch are placed in the AI's context for it to fix.

## 9.7 MCP Server

Kumiki can run as a Model Context Protocol server, allowing AI agents to call tools directly:

```bash
kumiki mcp serve --store ./project.kumiki-store
```

The tools provided:

| tool name | Arguments | Return value |
|---|---|---|
| `kumiki_view` | `selector: string, with_deps?: bool` | definition text |
| `kumiki_list` | `layer?: string` | list of definition names |
| `kumiki_add` | `layer, name, body` | op-id |
| `kumiki_replace` | `qname, body` | op-id |
| `kumiki_edit` | `qname, patch` | op-id |
| `kumiki_rename` | `qname, new_name` | op-id |
| `kumiki_remove` | `qname, cascade?: bool` | op-id + the names removed ([§9.4.1](#_9-4-1-pre-check-at-op-issuance)) |
| `kumiki_check` | `scope?: string` | diagnostic list (JSON); each entry's `severity` is `"error"` or `"warning"`, never omitted |
| `kumiki_fix` | `error_code, apply?: bool` | patch (JSON) |
| `kumiki_refs` | `qname` | list of referrers |
| `kumiki_history` | `qname` | op history |
| `kumiki_episode` | `episode_id` | episode log |

From the AI, these are called in place of file operations.

## 9.8 Agent Parallel Development Protocol

Coordination when multiple agents edit simultaneously:

### 9.8.1 Concurrency

- Each agent works with a **snapshot of the local graph store**
- The output is an op bundle
- Push ops to the master graph store → converge via CRDT

### 9.8.2 Lock-Free

The graph store takes no locks. ops can be pushed at any time. However:

- They may be rejected by referential integrity
- A rejected agent pulls the latest master and retries

This is about coordination between agents: nobody reserves a definition before editing it. Writing one `.kumiki` file is a separate matter — the write verbs take turns on the file itself (§9.2.2), so a concurrent op either lands or is rejected, and is never silently lost.

### 9.8.3 Task Boundaries

We want to avoid multiple agents editing the same definition. Task splitting is done by the unit of "**the domain of definition names**":

```
agent-1: slot.todos*, reducer.todo-*, tile.Todo*
agent-2: slot.user*,  reducer.user-*, tile.User*
agent-3: slot.route,  reducer.route-*
```

This is a convention, but an **ownership lock** (optional) can be added to the Kumiki compiler:

```bash
kumiki lock agent-1 'slot.todos*,reducer.todo-*'
```

If another agent issues an op in the same namespace, it is rejected.

The lock is checked against **every definition the op touches**, not only the one the verb names. What the op touched is read off the source, not off the verb: once the source the op would write passes validation, the definitions before and after it are compared by qualified name, and every one that was added, removed, or whose text changed is checked. That covers each dependent a `remove --cascade` removes, the new name a `rename` creates and each definition whose text it rewrites, and a definition that a `replace`, `add` or `edit` body brings in with it (a `replace` of `slot.count` whose body goes on to a line `slot todosX : Int = 0` creates `slot.todosX`). One locked definition among them rejects the whole op before it is written: the file is left byte-identical, no op is logged, the command exits `1`, and the message names the first locked definition in qualified-name order and its owner. The named definition is also checked before anything is written. `patch apply`, `patch revert` and the MCP tools go through the same mutators, so the same check applies to them.

## 9.9 The Relationship Between episode and op

The runtime episode log is recorded against the build artifact. ops are **the edit history of the source graph**. The two are separated:

| | op log | episode log |
|---|---|---|
| Target | changes to source definitions | runtime state changes |
| Persisted to | graph store | episode store |
| Purpose | parallel development / regression checking | debugging / replay test |
| Unit | CRDT op | reducer execution + effect result |

→ The episode log is in [Runtime](./runtime.md).

## 9.10 Filesystem Compatibility Layer

In early implementation, the graph store can also be **projected as a set of files within a directory**:

```
project.kumiki/
├── types/
│   ├── User.kumiki
│   └── TodoId.kumiki
├── slots/
│   └── todos.kumiki
├── effects/
│   └── loadTodo.kumiki
├── reducers/
│   └── add.kumiki
├── tiles/
│   ├── TodoRow.kumiki
│   └── App.kumiki
├── fns/
│   └── matchFilter.kumiki
└── .kumiki/
    ├── store.crdt        ← CRDT graph body (binary)
    ├── op-log.jsonl
    └── episode-log.jsonl
```

`kumiki sync` performs bidirectional sync: file edit → convert to op → apply to store, or store change → reflect to files.

This allows coexistence with existing Git-based workflows. However, **the true source of compatibility is on the graph store side**.

## 9.11 Design Decision Record

| Decision | Rationale |
|---|---|
| Edits are structured ops, not file diffs | Semantically safe in parallel merges |
| Referential integrity in two stages, at op issuance and application | Structurally prevents semantic conflicts in CRDT |
| Automatic repair loop | Structurally shortens the AI's debugging cycle |
| Provide an MCP server | Usable directly from AI agents |
| Optional ownership lock | Mechanizes the convention for parallel development |
| Compatibility with file projection | Coexists with existing tools (Git/editors) |

---

## 9.12 Next

- Runtime implementation details → [Runtime](./runtime.md)
- Complete examples → [examples/](https://github.com/kumikijs/Kumiki/tree/main/packages/examples)
