---
layout: home

hero:
  name: Kumiki
  text: A web framework of AI, by AI, for AI
  tagline: Definitions interlock like Japanese joinery (kumiki) so AI can write, edit, and reassemble an app in parallel.
  image:
    light: /kumiki-mark-animated.svg
    dark: /kumiki-mark-animated-dark.svg
    alt: Kumiki
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Playground
      link: /guide/playground
    - theme: alt
      text: Spec
      link: /spec/

features:
  - title: 7 layers
    details: type / slot / effect / reducer / tile / fn / app. State, side effects, and UI are split by role, with no implicit rules.
  - title: Easy for AI to edit in parts
    details: Each definition is independent and references are explicit. The CLI and MCP server provide per-definition list / view / add / replace / fix.
  - title: Measured ease of learning
    details: Measured on Claude, Codex and Gemini — from the spec alone, in a single pass, apps up to ~1,000 lines build and run.
    link: /guide/benchmarks
    linkText: See the benchmarks
  - title: Answers everything with working examples
    details: Per-feature minimal examples and apps ordered by size. Questions and bugs are answered by adding an example and a test.
---

## The same app, twice

One signup form with validation, written both ways: the [signup example](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/293-signup-form.kumiki) on the left, an idiomatic React equivalent on the right.

<div class="home-compare">
<div class="home-compare-col">

**Kumiki** — 34 lines · 294 tokens

```kumiki
type Signup = {
  name:  Text where nonempty,
  email: Email,
  age:   Int where between(13, 120)
}

slot form    : Signup       = {name: "", email: "", age: 18}
slot welcome : Option(Text) = None

reducer submit on=ui.submit(SignupForm) do= welcome := Some(form.name)

tile SignupForm = form(column(
    label(text="Name") {for: "name"},
    input(bind=form.name, id="name"),
    error(field=form.name) {color: "danger"},
    label(text="Email") {for: "email"},
    input(bind=form.email, id="email"),
    error(field=form.email) {color: "danger"},
    label(text="Age") {for: "age"},
    input(bind=form.age, type="number", id="age"),
    error(field=form.age) {color: "danger"},
    button(text="Sign up", type="submit")) {gap: "sm"})

tile App = column(
    SignupForm,
    match welcome with
      | None    -> text("Fill in the form.")
      | Some(n) -> text("Welcome, " + n + "!"))
  {pad: "lg", gap: "md"}

app SignupDemo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

</div>
<div class="home-compare-col">

**React** — 48 lines · 455 tokens

```tsx
import { type FormEvent, useState } from "react";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(name: string, email: string, age: string) {
  const n = Number(age);
  return {
    name: name === "" ? "Required" : null,
    email: EMAIL.test(email) ? null : "Invalid email format",
    age: age === "" || !Number.isInteger(n) ? "Must be a whole number"
       : n < 13 || n > 120 ? "Must be between 13 and 120" : null,
  };
}

export function App() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [age, setAge] = useState("18");
  const [welcome, setWelcome] = useState<string | null>(null);
  const errors = validate(name, email, age);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (Object.values(errors).some((m) => m !== null)) return;
    setWelcome(name);
  }

  return (
    <div>
      <form onSubmit={submit}>
        <label htmlFor="name">Name</label>
        <input id="name" value={name}
               onChange={(e) => setName(e.target.value)} />
        {errors.name && <p className="error">{errors.name}</p>}
        <label htmlFor="email">Email</label>
        <input id="email" value={email}
               onChange={(e) => setEmail(e.target.value)} />
        {errors.email && <p className="error">{errors.email}</p>}
        <label htmlFor="age">Age</label>
        <input id="age" type="number" value={age}
               onChange={(e) => setAge(e.target.value)} />
        {errors.age && <p className="error">{errors.age}</p>}
        <button type="submit">Sign up</button>
      </form>
      <p>{welcome === null ? "Fill in the form." : `Welcome, ${welcome}!`}</p>
    </div>
  );
}
```

</div>
</div>

<KumikiDemo example="293-signup-form.kumiki" height="460px" />

Want to change it? It's loaded in the [Playground](/guide/playground).

Three differences survive into every app you write:

- **The rules live in the type.** `Text where nonempty`, `Email` and `Int where between(13, 120)` are the whole validation: the messages, the refused input and the held-back submit all follow from them. React restates each rule as a check, a message and a guard in `submit` — three places an AI edit has to keep in step.
- **The reducer only sees valid data.** `submit` runs only when every bound field passes, so `form` is a `Signup` whose `age` is an `Int` between 13 and 120. In React `age` is still a string, and only the guard keeps an invalid one from reaching `setWelcome`.
- **Every definition is flat and independent.** An AI can tighten `type Signup` or replace `tile SignupForm` alone — nothing else needs to move.

The gap grows with app size: on the [Benchmarks](/guide/benchmarks), Kumiki is **~1.4× fewer tokens and ~2× fewer lines** than the React equivalent.
