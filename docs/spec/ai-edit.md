# AI Editing API, CRDT ops, and Referential Integrity

Kumiki code is stored not in physical files but in a **content-addressable CRDT graph**. Rather than editing text files, an AI agent issues **structured editing operations (ops)**.

This provides:

- Per-file merge conflicts cannot occur in principle
- The impact scope of an edit can be computed statically
- References don't break on rename (hash is invariant)
- An **automatic repair loop** can be run when an edit fails

## 9.1 Overview

```
┌─────────────────────────────────────────────────┐
│                 CRDT graph store                  │
│  (a set of definitions, each content-addressable) │
└─────────────────────────────────────────────────┘
        ↑                          ↓
        │                          │ kumiki view
        │ kumiki op apply          │
        │                          ↓
┌──────────────┐          ┌──────────────────────┐
│   AI agent   │ ←─────── │ projection (text)    │
└──────────────┘  edit op └──────────────────────┘
```

What the AI sees is a **projection (a text cross-section)** of the graph. What the AI outputs is an **op** (not a text diff).

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

A write op is validated by re-parsing and re-typechecking the file, and rolls back on any `severity: "error"` diagnostic — with one exception. A program is built one definition at a time, so it is app-less until the `app` lands; **`E0003 missing-app` does not roll back a write op**. Whether the program is a complete application is what `kumiki check` reports, not what a mid-edit graph must already satisfy.

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
| `body` | new body (required for add/replace) |
| `author` | issuing agent |
| `ts` | issue time (UNIX ms) |
| `op-id` | the op's ULID |
| `parent-ops` | id of the immediately preceding op this op relies on (CRDT ordering guarantee) |
| `depends-on` | hashes of other definitions the body references (for referential integrity verification) |

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

`--cascade` includes the dependents in the same op bundle and removes them too. `--force` tolerates dangling (emits a warning).

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

### 9.5.2 Reference Resolution

A name reference like `users` in the source text is recorded within the graph store as `slot:hash:9ab3c1...`.

- Name → hash resolution is done at compile time / op application time
- Even with the same name, a different dependency yields a different hash
- Renaming is only a `(rename, name-old, name-new)` op. The hash is invariant

### 9.5.3 Names at Display Time

When retrieved via `kumiki view`, hashes are turned back into human-readable names (**labels**).

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
| `kumiki_check` | `scope?: string` | error list (JSON) |
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
