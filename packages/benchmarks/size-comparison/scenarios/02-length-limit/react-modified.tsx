// React TodoMVC — equivalent feature set to Kumiki examples/02-todomvc.kumiki.
// Single file so the comparison is apples-to-apples with the single .kumiki file.

import { useEffect, useMemo, useRef, useState } from "react";

// ====== Types ======

type TodoId = string;

type Todo = {
  id: TodoId;
  text: string;
  done: boolean;
  createdAt: number;
};

type Filter = "All" | "Active" | "Done";

// ====== Pure helpers ======

function matchFilter(t: Todo, f: Filter): boolean {
  switch (f) {
    case "All":
      return true;
    case "Active":
      return !t.done;
    case "Done":
      return t.done;
  }
}

function itemsLeft(ts: Record<TodoId, Todo>): number {
  return Object.values(ts).filter((t) => !t.done).length;
}

function sortedIds(ts: Record<TodoId, Todo>): TodoId[] {
  return Object.keys(ts).sort((a, b) => ts[b]!.createdAt - ts[a]!.createdAt);
}

function isFilterActive(current: Filter, f: Filter): "primary" | "ghost" {
  return current === f ? "primary" : "ghost";
}

function freshId(): TodoId {
  return crypto.randomUUID();
}

// ====== Persistence ======

const STORAGE_KEY = "todos";

function loadTodos(): Record<TodoId, Todo> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<TodoId, Todo>;
  } catch {
    return {};
  }
}

function saveTodos(ts: Record<TodoId, Todo>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ts));
  } catch {
    // ignore
  }
}

// ====== Theme ======

const theme = {
  colors: {
    bg: "#fafafa",
    fg: "#1a1a1a",
    muted: "#888",
    primary: "#0070f3",
    surface: "#fff",
    border: "#e0e0e0",
    danger: "#c4222a",
  },
  spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "40px" },
  radius: { sm: "4px", md: "8px" },
};

// ====== Components ======

type FilterTabProps = {
  current: Filter;
  filter: Filter;
  setFilter: (f: Filter) => void;
};

function FilterTab({ current, filter, setFilter }: FilterTabProps) {
  const variant = isFilterActive(current, filter);
  return (
    <button
      type="button"
      onClick={() => setFilter(filter)}
      style={{
        background: variant === "primary" ? theme.colors.primary : "transparent",
        color: variant === "primary" ? theme.colors.surface : theme.colors.fg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radius.md,
        padding: "6px 12px",
        cursor: "pointer",
      }}
    >
      {filter}
    </button>
  );
}

type TodoRowProps = {
  todo: Todo;
  toggle: (id: TodoId) => void;
  remove: (id: TodoId) => void;
};

function TodoRow({ todo, toggle, remove }: TodoRowProps) {
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: theme.spacing.sm, alignItems: "center" }}>
      <label>
        <input
          type="checkbox"
          checked={todo.done}
          onChange={() => toggle(todo.id)}
        />
      </label>
      <span
        style={{
          textDecoration: todo.done ? "line-through" : "none",
          color: todo.done ? theme.colors.muted : theme.colors.fg,
          flex: 1,
        }}
      >
        {todo.text}
      </span>
      <button
        type="button"
        onClick={() => remove(todo.id)}
        style={{ background: "transparent", border: "none", cursor: "pointer", color: theme.colors.muted }}
      >
        x
      </button>
    </div>
  );
}

export function App() {
  const [todos, setTodos] = useState<Record<TodoId, Todo>>({});
  const [filter, setFilter] = useState<Filter>("All");
  const [draft, setDraft] = useState<string>("");
  const [ready, setReady] = useState<boolean>(false);

  // Load once on mount.
  useEffect(() => {
    setTodos(loadTodos());
    setReady(true);
  }, []);

  // Debounced persist on todos change.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveTodos(todos), 300);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [todos, ready]);

  const addTodo = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed.length >= 100) return;
    const id = freshId();
    setTodos((prev) => ({
      ...prev,
      [id]: { id, text: trimmed, done: false, createdAt: Date.now() },
    }));
    setDraft("");
  };

  const toggle = (id: TodoId) => {
    setTodos((prev) => ({
      ...prev,
      [id]: { ...prev[id]!, done: !prev[id]!.done },
    }));
  };

  const remove = (id: TodoId) => {
    setTodos((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const clearDone = () => {
    setTodos((prev) => {
      const next: Record<TodoId, Todo> = {};
      for (const [k, v] of Object.entries(prev)) if (!v.done) next[k] = v;
      return next;
    });
  };

  const visibleIds = useMemo(() => sortedIds(todos), [todos]);

  return (
    <div
      style={{
        padding: theme.spacing.lg,
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.md,
        maxWidth: 640,
        fontFamily: "system-ui, sans-serif",
        background: theme.colors.bg,
        color: theme.colors.fg,
      }}
    >
      <h1 style={{ margin: 0, fontSize: "32px" }}>Todos</h1>
      <form onSubmit={addTodo}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder="What needs to be done?"
          autoFocus
          maxLength={100}
          style={{
            width: "100%",
            padding: "6px 10px",
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radius.sm,
            background: theme.colors.surface,
            color: theme.colors.fg,
            fontSize: "16px",
            boxSizing: "border-box",
          }}
        />
      </form>
      {ready ? (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.md }}>
          <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xs }}>
            {visibleIds
              .filter((id) => matchFilter(todos[id]!, filter))
              .map((id) => (
                <TodoRow key={id} todo={todos[id]!} toggle={toggle} remove={remove} />
              ))}
          </div>
          <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: theme.colors.muted }}>{itemsLeft(todos)} items left</span>
            <div style={{ display: "flex", flexDirection: "row", gap: theme.spacing.xs }}>
              {(["All", "Active", "Done"] as const).map((f) => (
                <FilterTab key={f} current={filter} filter={f} setFilter={setFilter} />
              ))}
            </div>
            <button
              type="button"
              onClick={clearDone}
              style={{
                background: "transparent",
                border: "none",
                color: theme.colors.muted,
                cursor: "pointer",
              }}
            >
              Clear completed
            </button>
          </div>
        </div>
      ) : (
        <span>…</span>
      )}
    </div>
  );
}
