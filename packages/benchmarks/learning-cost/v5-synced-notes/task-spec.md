# Synced Notes — Kumiki Learning-Cost Measurement Task v5

English · [日本語](./task-spec.ja.md)

A notes app kept in sync with a server (an estimated 250–450 LOC). It is smaller than v4 and harder in a different way: almost every behavior goes through an effect that can fail, be retried, be superseded or be refused for authentication, and the screen has to tell the truth about each case.

## Feature requirements

### Types

- `type NoteId = nominal Text` — the server's id for a note
- `type Note = {id: NoteId, title: Text, body: Text}`
- `type SyncState = Saved | Saving | Failed(Text)` — where a note stands with the server
- `type LoadState = Loading | Loaded | LoadFailed(Text)`

### Slots

- `notes : Map(NoteId, Note) = {}`
- `sync : Map(NoteId, SyncState) = {}`
- `load : LoadState = Loading`
- `session : Text = "demo-token"` — sent as `Authorization: Bearer <session>`
- `signedOut : Bool = false`
- `draftTitle : Text = ""`
- `banner : Option(Text) = None` — the last thing that went wrong

### The server

Every request goes to `https://api.example.com` with the session header, set once in `app.http`, which also sends any 401 response to a reducer.

| effect | request | answers |
|---|---|---|
| `loadNotes` | `GET /notes` | the notes as JSON, `List(Note)` |
| `createNote` | `POST /notes` with `{title, body}` | the created note, with the server's id |
| `updateNote` | `PUT /notes/:id` with the note | the saved note |
| `deleteNote` | `DELETE /notes/:id` | nothing |

### Behavior

1. **Load on start.** `loadNotes` runs at start-up. A server error (5xx) or a connection error is retried with exponential backoff, for at most three attempts in all (`retry=exponential(3, 200ms, 2.0)`: the first after 200 ms, the next after 400 ms); a 4xx is not retried. While it runs the page says it is loading; if it finally fails, the page says so and offers a retry.
2. **Add a note optimistically.** Adding puts the note on the screen at once, marked as saving, under a temporary id. When the server answers, the note takes the server's id and is marked saved. If the server refuses, the note is removed and the banner says it could not be added. An empty title adds nothing.
3. **Save edits per note.** Editing a note's body saves it. A newer edit of the same note supersedes an older request still in flight (`policy=latest-per-key` on the note's id); edits of different notes do not wait for each other. A failed save leaves the edit on screen, marks the note failed, and offers to retry that save.
4. **Delete optimistically.** Deleting removes the note at once. If the server refuses, the note comes back and the banner says it could not be deleted.
5. **Expired session.** Any 401 signs the user out: the notes are replaced by a page that says the session expired and offers to sign in again, which loads the notes anew.

## Acceptance contract

The program is scored by driving it through the names below, so use them exactly. Everything else — layout, wording, extra features — is yours to choose.

- The effects are named `loadNotes`, `createNote`, `updateNote` and `deleteNote`, as in the table above.
- A heading `Notes (N)` with the number of notes shown.
- While loading, the text `Loading notes`. After a final load failure, the text `Could not load notes` and a button `Retry`.
- An `input` `id: "new-title"` and a button `Add note`.
- Each note shows its title, its body in a `textarea` with `id: "body-<id>"` (the note's id), a button `Delete note`, and its state: `Saving`, `Saved`, or `Save failed` with a button `Retry save`.
- The banner texts `Could not add note` and `Could not delete note`.
- Signed out: the text `Session expired` and a button `Sign in again`.

## Constraints

- The output is a single `.kumiki` file
- Do not use TypeScript / JSX / React syntax
- Side effects go through effects
- The necessary capabilities in the `app` declaration's `caps`

## Output

Write it out as a `.kumiki` file at the specified path. **Do not leave any stray XML tags or markdown fence at the end of the file.**

## Evaluation

- parse / typecheck / build, and `kumiki smoke` (`benchmarks/learning-cost/eval.mjs`)
- the acceptance scenarios, which drive the program through the contract above and script each effect's answers (`benchmarks/learning-cost/acceptance.mjs`); the score is the number of criteria passed
- LOC and token count are recorded
