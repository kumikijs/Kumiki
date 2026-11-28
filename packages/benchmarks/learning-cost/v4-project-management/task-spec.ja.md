# Project Management Tool — Kumiki 学習コスト測定タスク v4

[English](./task-spec.md) · 日本語

大規模 SPA (800-1500 LOC 想定) で LLM の実用限界を測る。Issue Tracker (727 LOC) より階層構造が深く、複数 view を持つ。

## 機能要件

Asana / Linear 風の Project Management SPA:

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
- `draftProject : {name: Text, description: Text, color: Text} = {...初期空値}`
- `draftTask : {title: Text, description: Text, priority: Priority, assignee: Text, tags: Text, dueDate: Text} = {...初期空値}`
- `commentDraft : Text = ""`
- `ready : Bool = false` (localStorage 読み込み完了フラグ)

### Routes

- `/` → ProjectsPage (Projects 一覧 + 新規作成 form)
- `/projects/:id` → ProjectPage (タスク List or Board、view 切替、フィルタバー)
- `/projects/:id/tasks/:taskId` → TaskDetailPage (タスク詳細 + サブタスク + コメント)
- `/projects/:id/new-task` → NewTaskPage (新規タスク form)
- `/settings` → SettingsPage (theme switcher)
- `/404` → NotFound

### Reducers

Projects:
- `createProject`: form 送信 → 新 Project を生成、navigate("/projects/:id")
- `archiveProject`: archived フィールドを true
- `unarchiveProject`: archived false
- `deleteProject`: Project 削除（関連 tasks/comments も cascade 削除）

Tasks:
- `createTask`: form 送信 → 新 Task を生成、`/projects/:id/tasks/:taskId` へ
- `updateTaskStatus`, `updateTaskPriority`, `updateTaskAssignee`, `updateTaskDueDate`: 詳細編集
- `addTaskTag`, `removeTaskTag`: タグ追加/削除
- `updateTaskTitle`, `updateTaskDescription`: 編集
- `deleteTask`: 削除（コメントも cascade）
- `moveTaskStatus`: Board 上で次の status へ進める

Comments:
- `addComment`: コメント追加
- `deleteComment`: 削除

UI 状態:
- `setFilterStatus`, `setFilterPriority`, `setFilterAssignee`, `setSearch`, `clearFilter`
- `setViewMode`: List ⇄ Board

Lifecycle:
- `loadAll`: app.start で localStorage から projects / tasks / comments 復元
- `toggleTheme`: Light ⇄ Dark

### Effects

- `saveProjects`, `saveTasks`, `saveComments` (storage.write, debounce 300ms)
- `loadProjects`, `loadTasks`, `loadComments` (storage.read, once)
- `navigate` builtin

### Pure fns

- `tasksForProject(tasks, projectId) : List(TaskId)` — projectId に属するタスクを updatedAt 降順
- `subtasksFor(tasks, parentId) : List(TaskId)` — parentTaskId == parentId のタスク
- `filteredTasks(tasks, projectId, filter) : List(TaskId)` — projectId に属しフィルタに合致
- `tasksByStatus(tasks, projectId, filter, status) : List(TaskId)` — Board view 用
- `commentsForTask(comments, taskId) : List(CommentId)` — taskId に紐づくコメント、createdAt 昇順
- `statusLabel`, `statusColor`, `priorityLabel`, `priorityColor` — 表示用
- `formatDate(t)` — ISO date 表示
- `dueDateStatus(dueDate)` — Overdue / Today / Soon / Upcoming / NoDue
- `parseTags(text)` — カンマ区切りタグ
- `routeProjectId(route) : Option(ProjectId)` — URL から ProjectId 抽出
- `routeTaskId(route) : Option(TaskId)` — URL から TaskId 抽出
- `currentProject(route, projects) : Option(Project)`

### UI

各 page の構成：

- **ProjectsPage**: header + 新規 form + Project カード一覧 (name, description, アクティブ件数, archived 切替, 削除)
- **ProjectPage**: project name + view toggle (List/Board) + filter bar + List/Board 表示
  - List view: Task カード (title, status, priority, assignee, dueDate, tags)
  - Board view: 4 列 (Backlog/InProgress/Review/Done) で task card を分類
- **TaskDetailPage**: 戻るボタン + title/description 編集 + status/priority/assignee/dueDate dropdown + tags + サブタスク一覧 + コメントセクション
- **NewTaskPage**: title, description, priority, assignee, tags, dueDate の form
- **SettingsPage**: テーマ切替

### Theme

Light / Dark の 2 種 theme。最低限の色 / spacing / typography トークン。

### 永続化

`projects`, `tasks`, `comments` を localStorage に保存・復元。

## 受け入れ条件の約束事

プログラムは以下の名前を使って操作し採点するので、そのとおりに使うこと。それ以外（レイアウト、文言、追加機能）は自由に決めてよい。

- ステータスは `Backlog` / `In Progress` / `Review` / `Done`、優先度は `Low` / `Med` / `High` / `Critical` と表示する（ラベル、バッジ、select の選択肢、ボードの列のどこでも）。
- **`/`**：`id: "project-name"` の `input`、`id: "project-description"` の `textarea`、送信ボタン `Create project`（名前が空なら何も作らない）。各プロジェクトは名前をそのページへのリンクとして表示し、ボタン `Archive`（アーカイブ後はテキスト `Archived` とボタン `Unarchive`）とボタン `Delete project` を持つ。プロジェクトが無いときはテキスト `No projects`。
- **`/projects/:id`**：プロジェクト名、`/projects/:id/new-task` を開くボタン `New task`、リスト表示では `Board view`、ボード表示では `List view` と読める 1 つのボタン。`id: "filter-status"` の `select`（`All` と各ステータス）、`id: "filter-priority"` の `select`（`All` と各優先度）、`id: "filter-assignee"` の `input`（担当者がその文字列を含む）、`id: "filter-search"` の `input`（タイトルがその文字列を含む）、ボタン `Clear filters`。各タスクはタイトルをそのページへのリンクとして表示し、ステータスと優先度も表示する。ボードでは各タスクに、次のステータスへ進めるボタン `Advance` もある。表示するタスクが無いときはテキスト `No tasks`。
- **`/projects/:id/new-task`**：`id: "task-title"` の `input`、`id: "task-description"` の `textarea`、`id: "task-priority"` の `select`（既定は `Med`）、`id: "task-assignee"` の `input`、`id: "task-tags"` の `input`（カンマ区切り）、`type="date"` の `id: "task-due"` の `input`（空でもよい）、送信ボタン `Create task`、ボタン `Cancel`。タイトルが空なら何も作らない。
- **`/projects/:id/tasks/:taskId`**：タイトル、説明、期日があれば `yyyy-MM-dd` 形式の期日、タスクを変更する `id: "detail-status"` の `select` と `id: "detail-priority"` の `select`、各タグとそのボタン `Remove tag`、`id: "tag-input"` の `input` とボタン `Add tag`、このタスクの下にタスクを作る新規タスクフォームを開くボタン `Add subtask`、サブタスクのタイトル（リンク）、`id: "comment-input"` の `input` とボタン `Add comment`、各コメントの本文とボタン `Delete comment`、プロジェクトに戻るボタン `Delete task`、プロジェクトに戻るボタン `Back`。

## 制約

- 出力は 1 つの `.kumiki` ファイル
- TypeScript / JSX / React syntax を使わない
- 副作用は effect 経由
- `app` 宣言の `caps` に必要な capability

## 出力

指定された path に `.kumiki` ファイルとして書き出すこと。**ファイル末尾に余計な XML タグや markdown fence を残さない**。

## 評価

- parse / typecheck / build と `kumiki smoke`（`benchmarks/learning-cost/eval.mjs`）
- 上の約束事を使ってプログラムを操作する受け入れシナリオ（`benchmarks/learning-cost/acceptance.mjs`）。合格した条件の数が得点になる
- LOC とトークン数を記録する
