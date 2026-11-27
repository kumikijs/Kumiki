---
layout: home

hero:
  name: Kumiki
  text: AI の、AI による、AI のための Web フレームワーク
  tagline: 定義同士は組木のように噛み合うから、AI が並列にアプリを書き・直し・組み替えられる。
  image:
    light: /kumiki-mark-animated.svg
    dark: /kumiki-mark-animated-dark.svg
    alt: Kumiki
  actions:
    - theme: brand
      text: はじめる
      link: /ja/guide/getting-started
    - theme: alt
      text: Playground
      link: /ja/guide/playground
    - theme: alt
      text: 仕様
      link: /ja/spec/

features:
  - title: 7 レイヤ
    details: type / slot / effect / reducer / tile / fn / app。状態・副作用・UI が役割ごとに分かれ、暗黙のルールがありません。
  - title: AI が部分編集しやすい
    details: 各定義が独立し、参照は明示的です。CLI と MCP サーバーが定義単位の list / view / add / replace / fix を提供します。
  - title: 実測された学習しやすさ
    details: Claude / Codex / Gemini で実測しています。仕様書だけを渡した単一パスで、中規模アプリ（〜600 行）はビルドが通ります。大規模なものには編集ループが必要です。
    link: /ja/guide/benchmarks
    linkText: ベンチマークを見る
  - title: 動く例ですべてに答える
    details: 機能別の最小例とサイズ順のアプリを揃えています。質問やバグには、example と test を足して答えます。
---

## 同じアプリを 2 通りで

入力チェック付きのサインアップフォームを両方で書きました。左は Kumiki の [signup example](https://github.com/kumikijs/Kumiki/blob/main/packages/examples/features/293-signup-form.kumiki)、右はその慣用的な React 等価実装です。

<div class="home-compare">
<div class="home-compare-col">

**Kumiki** — 34 行 · 294 トークン

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

**React** — 48 行 · 455 トークン

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

書き換えて試したくなったら [Playground](/ja/guide/playground) へどうぞ。

この 3 つの差は、どのアプリを書いても効いてきます。

- **ルールは型に書きます。** `Text where nonempty`・`Email`・`Int where between(13, 120)` が入力チェックのすべてで、エラーメッセージ、受け付けない入力、送信の差し止めはそこから導かれます。React では同じルールを、判定・メッセージ・`submit` のガードの 3 か所に書き直すことになり、AI が編集するたびにそれらを揃え続ける必要があります。
- **reducer には正しいデータしか届きません。** `submit` はバインドされた全フィールドが通ったときだけ動くので、`form` は `age` が 13〜120 の `Int` である `Signup` です。React の `age` は文字列のままで、不正な値が `setWelcome` に届かないことはガード 1 行だけが支えています。
- **すべての定義がフラットで独立しています。** AI は `type Signup` を厳しくすることも、`tile SignupForm` だけを差し替えることもできます。他は一切動かさなくて済みます。

差はアプリの規模とともに開きます。[ベンチマーク](/ja/guide/benchmarks)では、Kumiki は React 等価実装より**トークンが約 1.4 倍少なく、行数は約 2 倍少なく**なっています。
