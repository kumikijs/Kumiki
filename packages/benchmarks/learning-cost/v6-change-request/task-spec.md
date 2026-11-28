# Change Request — Kumiki Learning-Cost Measurement Task v6

English · [日本語](./task-spec.ja.md)

The other tasks write a program from nothing; this one changes a program that already works. The file you are given is a project management app of about 990 lines (the reference solution of task v4). Make the three changes below by editing it, and keep everything else it does working as it does now.

## The app as it is

Projects and their tasks, kept in localStorage.

- **`/`** lists the projects, with a form to create one. Each project can be archived, unarchived and deleted.
- **`/projects/:id`** lists a project's tasks, as a list or as a board with a column per status, filtered by status, priority, assignee and a search text. On the board, `Advance` moves a task to the next status.
- **`/projects/:id/new-task`** creates a task, optionally under a parent task.
- **`/projects/:id/tasks/:taskId`** shows a task: its status, priority, due date, tags, subtasks and comments, all editable, and a button to delete it, which also deletes its subtasks and their comments.

The statuses are `Backlog`, `In Progress`, `Review` and `Done`, in that order.

## The changes

1. **A `Blocked` status.** Add a status `Blocked`, shown as `Blocked`. It can be chosen wherever a status can be chosen today — on the task page and in the status filter — and the board gets a `Blocked` column. `Advance` on a blocked task moves it to `In Progress`; the other statuses advance as before. A blocked task counts as active.
2. **Undo a task deletion.** After `Delete task`, the project page shows the text `Task deleted` and a button `Undo`. `Undo` brings back the deleted task and everything deleting it removed — its subtasks and the comments of both — and the notice goes away. Only the latest deletion can be undone.
3. **Hide archived projects.** `/` lists only the active projects. While there are archived ones, a button `Show archived` lists them too, and then reads `Hide archived`.

## Acceptance contract

The program is scored by driving it through the names below, so keep them exactly. The existing app already follows the first part; the second is new. Everything else — layout, wording, how you implement the changes — is yours to choose.

Already in the app (keep):

- Status is shown as `Backlog` / `In Progress` / `Review` / `Done`, priority as `Low` / `Med` / `High` / `Critical`, wherever they appear (labels, badges, select options, board columns).
- **`/`**: an `input` `id: "project-name"`, a `textarea` `id: "project-description"` and a submit button `Create project` (an empty name creates nothing). Each project shows its name as a link to its page, a button `Archive` — or, once archived, the text `Archived` and a button `Unarchive` — and a button `Delete project`. With no project, the text `No projects`.
- **`/projects/:id`**: the project name, a button `New task` that opens `/projects/:id/new-task`, and one button that reads `Board view` in the list and `List view` on the board. A `select` `id: "filter-status"` (`All` and the statuses), a `select` `id: "filter-priority"` (`All` and the priorities), an `input` `id: "filter-assignee"`, an `input` `id: "filter-search"` and a button `Clear filters`. Each task shows its title as a link to its page, its status and its priority; on the board, each task also has a button `Advance`. With no task to show, the text `No tasks`.
- **`/projects/:id/new-task`**: an `input` `id: "task-title"`, a `textarea` `id: "task-description"`, a `select` `id: "task-priority"`, an `input` `id: "task-assignee"`, an `input` `id: "task-tags"`, an `input` `id: "task-due"`, a submit button `Create task` and a button `Cancel`.
- **`/projects/:id/tasks/:taskId`**: the title, the description, the due date, a `select` `id: "detail-status"` and a `select` `id: "detail-priority"`, its tags each with a button `Remove tag`, an `input` `id: "tag-input"` with a button `Add tag`, a button `Add subtask`, the titles of its subtasks as links, an `input` `id: "comment-input"` with a button `Add comment`, each comment's body with a button `Delete comment`, a button `Delete task` that returns to the project, and a button `Back` to the project.

New:

- The status `Blocked`, in `detail-status`, in `filter-status`, and as a board column.
- On the project page after a deletion: the text `Task deleted` and a button `Undo`.
- On `/`: the buttons `Show archived` and `Hide archived`.

## Constraints

- Edit the given file in place; the result is still a single `.kumiki` file
- Do not use TypeScript / JSX / React syntax
- Side effects go through effects

## Evaluation

- parse / typecheck / build, and `kumiki smoke` (`benchmarks/learning-cost/eval.mjs`), which also records how many lines the change added and removed
- the acceptance scenarios (`benchmarks/learning-cost/acceptance.mjs`): the ones that score what the app already did, and the ones that score the three changes; the score is the number of criteria passed
