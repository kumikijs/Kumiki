# Project Management Tool — Kumiki Learning-Cost Measurement Task v4

English · [日本語](./task-spec.ja.md)

A large SPA (an estimated 800-1500 LOC) that measures the practical limits of an LLM. It has a deeper hierarchy than the Issue Tracker (727 LOC) and multiple views.

## Feature requirements

An Asana / Linear-style Project Management SPA:

### Types

- `type ProjectId = nominal Text where uuid`
- `type TaskId = nominal Text where uuid`
- `type CommentId = nominal Text where uuid`
- `type Status = Backlog | InProgress | Review | Done`
- `type Priority = Low | Med | High | Critical`
- `type ViewMode = ListView | BoardView`
- `type Project = {id: ProjectId, name: Text, description: Text, color: Text, archived: Bool, createdAt: Time}`
- `type Task = {id: TaskId, projectId: ProjectId, title: Text, description: Text, status: Status, priority: Priority, assignee: Text, dueDate: Option(Time), tags: List(Text), parentTaskId: Option(TaskId), createdAt: Time, updatedAt: Time}`
- `type Comment = {id: CommentId, taskId: TaskId, author: Text, body: Text, createdAt: Time}`
- `type FilterState = {status: Option(Status), priority: Option(Priority), assignee: Text, search: Text}`

### Slots

- `projects : Map(ProjectId, Project) = {}`
- `tasks : Map(TaskId, Task) = {}`
- `comments : Map(CommentId, Comment) = {}`
- `viewMode : ViewMode = ListView`
- `filter : FilterState = {status: None, priority: None, assignee: "", search: ""}`
- `themeName : Text = "Light"`
- `draftProject : {name: Text, description: Text, color: Text} = {...initial empty values}`
- `draftTask : {title: Text, description: Text, priority: Priority, assignee: Text, tags: Text, dueDate: Text} = {...initial empty values}`
- `commentDraft : Text = ""`
- `ready : Bool = false` (localStorage load-complete flag)

### Routes

- `/` → ProjectsPage (Projects list + creation form)
- `/projects/:id` → ProjectPage (task List or Board, view switching, filter bar)
- `/projects/:id/tasks/:taskId` → TaskDetailPage (task detail + subtasks + comments)
- `/projects/:id/new-task` → NewTaskPage (new-task form)
- `/settings` → SettingsPage (theme switcher)
- `/404` → NotFound

### Reducers

Projects:
- `createProject`: form submit → create a new Project, navigate("/projects/:id")
- `archiveProject`: set the archived field to true
- `unarchiveProject`: archived false
- `deleteProject`: delete the Project (cascade-delete related tasks/comments too)

Tasks:
- `createTask`: form submit → create a new Task, go to `/projects/:id/tasks/:taskId`
- `updateTaskStatus`, `updateTaskPriority`, `updateTaskAssignee`, `updateTaskDueDate`: detail edits
- `addTaskTag`, `removeTaskTag`: add/remove tags
- `updateTaskTitle`, `updateTaskDescription`: edits
- `deleteTask`: delete (cascade comments too)
- `moveTaskStatus`: advance to the next status on the Board

Comments:
- `addComment`: add a comment
- `deleteComment`: delete

UI state:
- `setFilterStatus`, `setFilterPriority`, `setFilterAssignee`, `setSearch`, `clearFilter`
- `setViewMode`: List ⇄ Board

Lifecycle:
- `loadAll`: restore projects / tasks / comments from localStorage on app.start
- `toggleTheme`: Light ⇄ Dark

### Effects

- `saveProjects`, `saveTasks`, `saveComments` (storage.write, debounce 300ms)
- `loadProjects`, `loadTasks`, `loadComments` (storage.read, once)
- `navigate` builtin

### Pure fns

- `tasksForProject(tasks, projectId) : List(TaskId)` — tasks belonging to projectId, descending by updatedAt
- `subtasksFor(tasks, parentId) : List(TaskId)` — tasks where parentTaskId == parentId
- `filteredTasks(tasks, projectId, filter) : List(TaskId)` — belonging to projectId and matching the filter
- `tasksByStatus(tasks, projectId, filter, status) : List(TaskId)` — for the Board view
- `commentsForTask(comments, taskId) : List(CommentId)` — comments linked to taskId, ascending by createdAt
- `statusLabel`, `statusColor`, `priorityLabel`, `priorityColor` — for display
- `formatDate(t)` — ISO date display
- `dueDateStatus(dueDate)` — Overdue / Today / Soon / Upcoming / NoDue
- `parseTags(text)` — comma-separated tags
- `routeProjectId(route) : Option(ProjectId)` — extract ProjectId from the URL
- `routeTaskId(route) : Option(TaskId)` — extract TaskId from the URL
- `currentProject(route, projects) : Option(Project)`

### UI

The composition of each page:

- **ProjectsPage**: header + creation form + Project card list (name, description, active count, archived toggle, delete)
- **ProjectPage**: project name + view toggle (List/Board) + filter bar + List/Board display
  - List view: Task card (title, status, priority, assignee, dueDate, tags)
  - Board view: classify task cards across 4 columns (Backlog/InProgress/Review/Done)
- **TaskDetailPage**: back button + title/description editing + status/priority/assignee/dueDate dropdowns + tags + subtask list + comment section
- **NewTaskPage**: a form for title, description, priority, assignee, tags, dueDate
- **SettingsPage**: theme switching

### Theme

Two themes, Light / Dark. A minimal set of color / spacing / typography tokens.

### Persistence

Save and restore `projects`, `tasks`, `comments` in localStorage.

## Acceptance contract

The program is scored by driving it through the names below, so use them exactly. Everything else — layout, wording, extra features — is yours to choose.

- Status is shown as `Backlog` / `In Progress` / `Review` / `Done`, priority as `Low` / `Med` / `High` / `Critical`, wherever they appear (labels, badges, select options, board columns).
- **`/`**: an `input` `id: "project-name"`, a `textarea` `id: "project-description"` and a submit button `Create project` (an empty name creates nothing). Each project shows its name as a link to its page, a button `Archive` — or, once archived, the text `Archived` and a button `Unarchive` — and a button `Delete project`. With no project, the text `No projects`.
- **`/projects/:id`**: the project name, a button `New task` that opens `/projects/:id/new-task`, and one button that reads `Board view` in the list and `List view` on the board. A `select` `id: "filter-status"` (`All` and the statuses), a `select` `id: "filter-priority"` (`All` and the priorities), an `input` `id: "filter-assignee"` (assignees containing the text), an `input` `id: "filter-search"` (titles containing the text) and a button `Clear filters`. Each task shows its title as a link to its page, its status and its priority; on the board, each task also has a button `Advance` that moves it to the next status. With no task to show, the text `No tasks`.
- **`/projects/:id/new-task`**: an `input` `id: "task-title"`, a `textarea` `id: "task-description"`, a `select` `id: "task-priority"` (`Med` by default), an `input` `id: "task-assignee"`, an `input` `id: "task-tags"` (comma-separated), an `input` `id: "task-due"` of `type="date"` (may be left empty), a submit button `Create task` and a button `Cancel`. An empty title creates nothing.
- **`/projects/:id/tasks/:taskId`**: the title, the description, the due date as `yyyy-MM-dd` when it has one, a `select` `id: "detail-status"` and a `select` `id: "detail-priority"` that change the task, its tags each with a button `Remove tag`, an `input` `id: "tag-input"` with a button `Add tag`, a button `Add subtask` that opens the new-task form for a task under this one, the titles of its subtasks as links, an `input` `id: "comment-input"` with a button `Add comment`, each comment's body with a button `Delete comment`, a button `Delete task` that returns to the project, and a button `Back` to the project.

## Constraints

- The output is a single `.kumiki` file
- Do not use TypeScript / JSX / React syntax
- Side effects go through effects
- The necessary capabilities in the `app` declaration's `caps`

## Output

Write it out as a `.kumiki` file at the specified path. **Do not leave any stray XML tags or markdown fence at the end of the file.**

## Evaluation

- parse / typecheck / build, and `kumiki smoke` (`benchmarks/learning-cost/eval.mjs`)
- the acceptance scenarios, which drive the program through the contract above (`benchmarks/learning-cost/acceptance.mjs`); the score is the number of criteria passed
- LOC and token count are recorded
