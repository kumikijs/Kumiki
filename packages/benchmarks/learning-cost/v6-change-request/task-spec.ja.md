# Change Request — Kumiki 学習コスト測定タスク v6

[English](./task-spec.md) · 日本語

ほかのタスクはプログラムを一から書くが、このタスクはすでに動いているプログラムを変更する。渡されるファイルは約 990 行のプロジェクト管理アプリ（タスク v4 の参照解）。これを編集して下の 3 つの変更を加え、それ以外の振る舞いは今のまま動くように保つこと。

## 現状のアプリ

プロジェクトとそのタスクを localStorage に保存する。

- **`/`** はプロジェクトの一覧と作成フォーム。各プロジェクトはアーカイブ、アーカイブ解除、削除できる。
- **`/projects/:id`** はプロジェクトのタスクを、リストまたはステータスごとの列を持つボードとして表示し、ステータス、優先度、担当者、検索文字列で絞り込む。ボードでは `Advance` でタスクを次のステータスへ進める。
- **`/projects/:id/new-task`** はタスクを作る。親タスクの下に作ることもできる。
- **`/projects/:id/tasks/:taskId`** はタスクのステータス、優先度、期日、タグ、サブタスク、コメントを表示し、どれも編集できる。削除ボタンはサブタスクとそのコメントも一緒に削除する。

ステータスは `Backlog`、`In Progress`、`Review`、`Done` の順。

## 変更内容

1. **`Blocked` ステータス。** ステータス `Blocked` を追加し、`Blocked` と表示する。今ステータスを選べる場所（タスクページとステータスフィルター）のどこでも選べ、ボードには `Blocked` の列が加わる。Blocked のタスクに `Advance` すると `In Progress` になる。ほかのステータスの進み方は変えない。Blocked のタスクはアクティブとして数える。
2. **タスク削除の取り消し。** `Delete task` の後、プロジェクトページにテキスト `Task deleted` とボタン `Undo` を出す。`Undo` は削除したタスクと、その削除で消えたものすべて（サブタスクと、両方のコメント）を戻し、通知は消える。取り消せるのは最後の削除だけ。
3. **アーカイブ済みプロジェクトを隠す。** `/` はアクティブなプロジェクトだけを一覧する。アーカイブ済みのものがあるあいだはボタン `Show archived` でそれらも一覧し、ボタンは `Hide archived` になる。

## 受け入れ条件の約束事

プログラムは以下の名前を使って操作し採点するので、そのとおりに保つこと。前半は既存のアプリがすでに守っており、後半は新しいもの。それ以外（レイアウト、文言、変更の実装方法）は自由に決めてよい。

既存（保つこと）：

- ステータスは `Backlog` / `In Progress` / `Review` / `Done`、優先度は `Low` / `Med` / `High` / `Critical` と表示する（ラベル、バッジ、select の選択肢、ボードの列のどこでも）。
- **`/`**：`id: "project-name"` の `input`、`id: "project-description"` の `textarea`、送信ボタン `Create project`（名前が空なら何も作らない）。各プロジェクトは名前をそのページへのリンクとして表示し、ボタン `Archive`（アーカイブ後はテキスト `Archived` とボタン `Unarchive`）とボタン `Delete project` を持つ。プロジェクトが無いときはテキスト `No projects`。
- **`/projects/:id`**：プロジェクト名、`/projects/:id/new-task` を開くボタン `New task`、リスト表示では `Board view`、ボード表示では `List view` と読める 1 つのボタン。`id: "filter-status"` の `select`（`All` と各ステータス）、`id: "filter-priority"` の `select`（`All` と各優先度）、`id: "filter-assignee"` の `input`、`id: "filter-search"` の `input`、ボタン `Clear filters`。各タスクはタイトルをそのページへのリンクとして表示し、ステータスと優先度も表示する。ボードでは各タスクにボタン `Advance` もある。表示するタスクが無いときはテキスト `No tasks`。
- **`/projects/:id/new-task`**：`id: "task-title"` の `input`、`id: "task-description"` の `textarea`、`id: "task-priority"` の `select`、`id: "task-assignee"` の `input`、`id: "task-tags"` の `input`、`id: "task-due"` の `input`、送信ボタン `Create task`、ボタン `Cancel`。
- **`/projects/:id/tasks/:taskId`**：タイトル、説明、期日、`id: "detail-status"` の `select` と `id: "detail-priority"` の `select`、各タグとそのボタン `Remove tag`、`id: "tag-input"` の `input` とボタン `Add tag`、ボタン `Add subtask`、サブタスクのタイトル（リンク）、`id: "comment-input"` の `input` とボタン `Add comment`、各コメントの本文とボタン `Delete comment`、プロジェクトに戻るボタン `Delete task`、プロジェクトに戻るボタン `Back`。

新規：

- ステータス `Blocked`（`detail-status`、`filter-status`、ボードの列）。
- 削除後のプロジェクトページ：テキスト `Task deleted` とボタン `Undo`。
- `/`：ボタン `Show archived` と `Hide archived`。

## 制約

- 渡されたファイルをその場で編集する。結果は 1 つの `.kumiki` ファイルのまま
- TypeScript / JSX / React syntax を使わない
- 副作用は effect 経由

## 評価

- parse / typecheck / build と `kumiki smoke`（`benchmarks/learning-cost/eval.mjs`）。変更で追加・削除した行数も記録する
- 受け入れシナリオ（`benchmarks/learning-cost/acceptance.mjs`）。既存の振る舞いを採点するものと、3 つの変更を採点するもの。合格した条件の数が得点になる
