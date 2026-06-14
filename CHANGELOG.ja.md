# Changelog

[English](./CHANGELOG.md) · 日本語

形式は [Keep a Changelog](https://keepachangelog.com/) に準拠し、[Semantic Versioning](https://semver.org/) を採用する。

## [Unreleased]

### Added

v0.6——**testing DSL の完成**マイルストーン——は、v0.2 で部分出荷した言語内 `test` レイヤ（[spec/testing.md](./spec/testing.md) §8）の言語面を閉じる（`episode-test` は v0.7 に分離——runtime.md §10.5 のランタイム episode ロガーを先に要するため）。

- **v0.6 M4 (#52) — `kumiki test` ランナー仕上げ**（`spec/testing.md` §8.7）：各行に **per-test timings** を表示するようになった（`PASS inc-increments (1ms)`；property-test はケース数も付与し `(100 cases, 23ms)`）。新規 **`--coverage`** は reducer / effect / tile ごとにスイートが何件を exercise したかと未カバー名を表示する——reducer-test/property-test はターゲット reducer とそれが emit する effect をカバーし、モックされた effect 結果はそれが駆動する `.ok`/`.err` reducer もカバー、tile-test はその tile をカバー（codegen が `globalThis.__kumikiCoverage` へ静的に算出）。新規 **`--watch`** は `.kumiki` 変更時に（フィルタ済み）スイートを再実行する（デバウンス付き、Ctrl-C でクリーン終了）。
- **v0.6 M3 (#51) — `property-test`**（`spec/testing.md` §8.3）：reducer 不変条件の生成的テスト。`property-test for-all={n: T, …} given={…} invariant=<bool式> (count=N)? (shrink=bool)?` が型ごとに `count`（既定 100）ケースを生成する——`Int`/`Float`/`Text`/`Bool`/`List`/`Map`/`Set`/`Option`/`Result`、加えてレコード（フィールドごと）・ユニオン（ランダムな variant）。refinement は reject-sampling ではなく基底ジェネレータの**制約**に畳み込む（`between`→範囲、`nonempty`/`len-*`→長さ、`positive`→下限）。`invariant` は `run-reducer(name)` を連鎖でき（各ステップが現在の `{slots}` 状態に `given` イベントで reducer を適用し次状態を返す）、結果を比較する（`run-reducer(toggle).run-reducer(toggle).slots.todos == todos`）。生成は**シード付き**（既定：テスト名のハッシュ）で失敗が厳密に再現し、失敗時はカウンタ例を最小値へ**シュリンク**する（`shrink = false` で無効化）。ランナーはケース数を表示する（`(100 cases)`、§8.7.1）。`for-all` の型参照は解決可能でなければならず、すべての `run-reducer` ターゲットは宣言済み reducer であること（E0102）。`28-tests.kumiki` に `inc-dec-roundtrips` を追加。
- **v0.6 M2 (#50) — `reducer-test` 内の effect 結果モック**（`spec/testing.md` §8.5）：reducer が effect を emit し、その結果が別の reducer を駆動する（`loadUser.ok($u, _)`）多段フローは、これまでブラウザ駆動の scenario ランナーでしかテストできなかった。`reducer-test` が `given.mocks = {effect: ok(v) | err(e) | delay(ms, ok(v))}` を受け付けるようになり、ランナーはトリガを dispatch して emit → 結果 → reducer のループを **headless かつ同期**に駆動する（DOM なし・実時間なし）：モックされた effect はその `.ok`/`.err` reducer に配送され（モックの `value` が reducer の第1バインド）**消費**される（よって `expect.effects` に出ない）。モックの無い emit は**残余**として `expect.effects` で照合。`delay(ms, …)` は即時解決（仮想時間・emit 順）。モックのキーは宣言済み effect 名でなければならず（**E0104**）、`.err` reducer が消費しないモック済み `err` は黙って通さず**失敗**させる（v0.5 #37 の no-silent-failure 契約）。`28-tests.kumiki` に `add-surfaces-persist-error`（`persist` を `err` にモックし `.err` reducer を駆動、設定された status をアサート）を追加。
- **v0.6 M1 (#49) — `reducer-test` の `expect` ワイルドカード**（`spec/testing.md` §8.2.2）：生成された id（`TodoId.fresh()`）など非決定的なフィールドを含む `reducer-test` の結果は、リテラルな `expect` ではアサートできなかった。2 つのワイルドカードがその穴を埋める——`<any-id>` は任意の存在する値に一致（**map キー**位置では、他と一致しないエントリちょうど 1 件と対応；0 件や複数件は失敗）、`<slots.X>` は実行後のスロット `X` の値に一致（例：`effects: [persist(<slots.todos>)]`）。それ以外の一致は**厳密**のまま——レコードは全キー集合で比較し、ワイルドカードは予測不能なフィールド（`createdAt: <any-id>`）だけを潰すので、partial-record マッチで既存アサーションが緩むことはない。`reducer-test` の `expect` 外（本体や test の `given`）のワイルドカードはコンパイルエラー（**新規 E0109 `test-wildcard-misuse`**）。`28-tests.kumiki` に両ワイルドカードを使う `addItem` reducer-test を追加。

- **v0.5 M1 (#39) — example ガードのランタイム真正性検証 tier**：`packages/tests/examples.test.ts` は `compile()` 成功しか、`smoke.test.ts` も例がマウント／描画する（「空でない／throw しない」）ことしか検証しなかったため、「コンパイルは通るが実際は壊れている」例が緑で出荷された——`03-union-and-match` の見出しバグが `_s.show(undefined)` に lower され、空だが存在する見出しを両方すり抜けて描画したのがまさにこれ。新しいコーパスガード（`packages/tests/render-guard.test.ts`）が dropped-expression クラスを狙う：全 example の生成 JS を `_s.show(undefined)` センチネルで静的スキャン（Kumiki ソースに `undefined` リテラルは無く、reducer 読み戻し／selector 無し reducer の偏在する良性 `undefined` とは別物のゼロ誤検出マーカーなので allowlist 不要）し、加えていずれの example もリテラル `"undefined"` に等しいテキストノードを生成しないことを jsdom で描画アサートする。スキャナは `03` の形で発火することを証明済みの単体テスト付き純関数として切り出してあり、再混入した dropped-expression バグは緑で出荷されず `pnpm test` を失敗させる。([spec/testing.md](./spec/testing.md) §8.10)
- **v0.5 M2 (#37) — effect エラーの no-silent-failure 契約**：`localStorage` が使えない（opaque-origin サンドボックスプレビュー、プライベートモード）と storage capability は `err` を返すが、`20-effect-storage` は `.ok` しか配線しておらず、エラーが捨てられアプリが死んで見えた。M2 は v0.3 の live-panic エートス（「失敗は決して黙って失敗してはならない」）を **effect 結果**へ拡張する：対応する `.err` reducer の**無い** `err` outcome は `console.error`（`[kumiki] effect "<name>" returned an error with no .err reducer: …`）で surface され、検証 tier（`console.error` を捕捉する `smoke` / `runScenario`）が検知する——storage に限らず全 capability で一般的。デフォルト契約は **`err` + surface された報告**のまま；プログラムは `.err` reducer（空でもよい）を配線してエラーを処理（または意図的に無視）することを選び、in-memory storage フォールバックは silent なデフォルトには明示的にしない。`20-effect-storage` と `27-custom-capability` は `.err` 分岐（可視の `unavailable` / `no provider` ステータス）をモデル化した。_（実装上の注：チャネルは roadmap が当初スケッチした dev 限定 `console.warn` ではなく `console.error`——live-panic モデルとの一貫性、および検証 tier が `console.error` を捕捉して失敗を無視不能にするため。）_ ([spec/stdlib.md](./spec/stdlib.md) §2.5)
- **v0.5 M3 (#36) — 埋め込み文脈向けの仮想／メモリルータモード**：パスベースルーティングは周辺 document の `location` / `history` を読み書きしていたため、プレイグラウンドの `<iframe srcdoc sandbox>` 内（本物のパスが無く初期マッチが `/404` に落ちる、origin が opaque で `history.pushState` が `SecurityError` を投げる）や、トップレベル URL を所有する任意の埋め込みホスト（Web Component、embed）で初期化もナビゲートもできなかった。M3 は 2 ソースのルータ抽象を導入する：`mount(app, el, { router: "memory", initialPath?: "/" })` は現在のパスをメモリに保持する——初期ルートは（`location` でなく）`initialPath` から解決され、`navigate` / link クリック / `navigate-back` がそれを更新して再描画し `history.*` に触れない；パスパラメータ・query・リダイレクト（`->>`）・`/404` は同一に振る舞う。`router: "history"` がデフォルトのまま（実 origin のアプリは無影響）。プレイグラウンドが opt-in（自動マウントバンドルの前に `globalThis.__kumikiMount = { router: "memory" }` → `18-routing` / `23-lifecycle-route-enter` がプレビューで動く）、自動マウントバンドルは `globalThis.__kumikiMount` を読み、`defineKumikiElement(tag, app, { router: "memory" })` が Web Component へ転送する。([spec/routing.md](./spec/routing.md) §3.3.4)
- **v0.5 M4 (#38) — プレイグラウンドでの決定論的 HTTP ショーケース**：`19-effect-http` は予約済み `api.example.com` を叩くためショーケースが常に失敗状態を描画していた。example は相対 `/api/quote` を要求するようになり（バンドルを実エンドポイントの隣で配信するホストは直接叩ける）、docs プレイグラウンドは決定論的な `http.get` **プロバイダ**（`globalThis.__kumikiProviders` 経由）を登録して quote を返す——プレビュー限定、ランタイム既存の capability-provider シームを使い、`fetch` パッチもサンドボックス弱体化もなし——ので、ショーケースはオフラインで**成功**パスを示し、`.err` パスは到達不能エンドポイントに対して到達可能なまま。

v0.5——**埋め込み堅牢性＆ランタイム真正性検証**のマイルストーン——は完了（4 項目すべて出荷：コンパイルが緑の Kumiki アプリは、埋め込み／サンドボックス文脈でもはや silent に壊れたり機能不全になったりしない）。

## [0.3.0] - 2026-06-04

v0.3——型健全性＆堅牢性のマイルストーン——は完了（2 項目とも出荷）。

### Fixed

- **M2 (#23) — メソッドショートカットディスパッチの受け手型推論**（`spec/stdlib.md` §2.2.3、`spec/errors.md` E0108）：`recv.method`（カッコ無しショートカット）が**名前のみ**で dispatch され、メソッドと同名の record フィールド（`{head, tail}` への `node.head`）がメソッドに暗黙 shadow され、未知の `recv.bogus` が `undefined` にコンパイルされていた。M2 はチェッカに初の**型推論パス**（slot / `fn` 引数 / tile `in` / `let` の名前→型環境 + `inferType`）を入れ、`FieldAccess` を受け手の**推論型**で field-vs-shortcut に dispatch する：同名 record フィールドはフィールドとして読まれ、**既知**の受け手型の未知メンバーは silent `undefined` でなくコンパイルエラー（**新 E0108 `undef-member`**）になる。推論は保守的——決定不能な受け手は従来の名前ベース dispatch を維持（回帰なし）。一部のカッコ無しショートカット（`is-ok` / `is-err` / `values` / `entries` / `lower` / `upper` / `sort` / `ms`）が `KNOWN_METHODS` に欠けていた非対称（`.m()` が E0801 を踏むのに `.m` は通る）も修正。新規 example `examples/features/33-field-vs-method.kumiki`。_注:_ E0108 は意図的な厳格化——従来 `recv.bogus` を `undefined` にコンパイルできたプログラムはコンパイル不能になる。
- **M1 (#24) — live パスのクリーンな panic ハンドリング**（`spec/lifecycle.md` §7.2–7.3、`spec/stdlib.md` §2.2）：**live** パスの panic——`panic(message)`、`Ok` への `Result.get-err`、空ケース（`None` / `Err`）への多相 `.get`——が従来 DOM イベントハンドラ／render を**未捕捉例外**として突き抜け、ディスパッチを中断し DOM を stale にしていた。今後は 1 つの panic モデル：タグ付き `KumikiPanic`（上記すべてが送出）を live reducer ディスパッチの周囲で捕捉して episode を **rollback**（部分 slot 書き込みなし）、`console.error` で surface（`smoke` / scenario tier が検知）、`app.error` reducer へ `PanicInfo` を `$event` として配送する；アプリは生存し続ける。囲う `error-boundary` の無い render panic は throw せず組み込みの**トップレベルフォールバック**を描画する。途中で 2 つの潜在バグも修正：`panic(message)` は未実装だった（未定義関数呼び出しに lower）し、`.get` は `None` / `Err` で値をそのまま返し（サイレント、`.get-err` と正反対）`Ok` の剥がしすらしなかった——`.get` は `Some`/`Ok` を剥がし `None`/`Err` で panic するよう spec に整合。新規 example `examples/features/32-panic-boundary.kumiki`。

## [0.2.1] - 2026-06-04

### Fixed

- **Issue #7 — 引数なし stdlib メソッド**（`spec/stdlib.md` §2.2）：`head` / `tail` / `last` / `to-list` / `get-err` / `to-option` / `parse-int` / `parse-float` / `abs` / `neg` / `to-float` / `to-int` が未実装で、**spec が推奨するカッコ無し形**（`list.head`）はコンパイルも通るのに実行時 `undefined`（サイレントな誤結果）、カッコ付き形（`list.head()`）は **E0801** で硬く弾かれていた。両形とも runtime ヘルパー（`_stdlib.listHead`/`listTail`/`listLast`/`toList`/`getErr`/`toOption`/`parseIntOpt`/`parseFloatOpt`、数値系は `Math.abs`/`Math.trunc`）へ lower し、`KNOWN_METHODS` に追加。新規 example `examples/features/31-argless-methods.kumiki`。#5 のフォローアップ。_（ここに記していた「メソッド省略形が同名フィールドを shadow する」制限は v0.3 M2 / #23 で解消——[0.3.0] を参照。）_

## [0.2.0] - 2026-06-03

spec が繰り延べていた 5 機能（M1–M5）を独立マイルストーンとして出荷。

### Added

- **v0.2 M5 — `motion` レイヤー**：`motion N = {keyframes:{from,to}, duration?, easing?, iteration?, direction?}` で宣言し任意の tile の `motion` プロップから参照する、再利用可能でスコープされたアニメーション。keyframe 文法は**閉じている**（アニメ可能集合 `opacity` / `translate-x` / `translate-y` / `scale` / `rotate`、閉じたタイミングトークン） — 生 CSS の抜け穴は無い。`motion` は `theme` を手本にしたトップレベル定義で、7 つのロジックレイヤーには**数えない**（ADR-001）。body がリテラルのみなので構文的に純粋（slot/effect 不可）。runtime は mount 時にスコープ済み `@keyframes` + クラスを注入し `prefers-reduced-motion` を尊重する。新エラー **E0401**（未知の keyframe プロパティ）、**E0402**（不正なタイミング）、**E0403**（不正な keyframes）、**E0107**（未定義 motion）。`when(...)` や `overlay` と合成可能。新規 example `examples/features/30-motion.kumiki`（＋ jsdom が観測できない「アニメーション稼働」を検証する `@kumikijs/e2e` ブラウザシナリオ。e2e 層に `animating` アサーションを追加）。M5 をもって **v0.2 の 5 マイルストーン（M1–M5）すべてが出荷済み**。（[spec/style.md](./spec/style.md) §4.9.1）
- **v0.2 M4b — `kumiki fix --auto-patch <test-name>`**：`fix` が typecheck エラーだけでなく失敗した `test` からも修復するようになった。2 段構成：ファイルがコンパイル不能なら `planFixes`（did-you-mean / `/404` 欠落）を再利用してテストを走らせる。tile-test / reducer-test が、実際値が*一意の*ソースリテラルである**文字列リーフ**で失敗した場合、そのリテラルを期待値に置換する（§8.7.1 のスナップショット事例）。`--apply` はパッチを書き込みテストを再実行し、通るようになったか・他テストが退行したかを報告。dry-run（`--apply` なし）は提案のみ。リテラルでない乖離（数値 slot、誤った演算子、effect リスト不一致）は推測せず diff として報告する。ランナーはスカラーのリーフを特定できる場合に §8.7.1 の値矢印（`expected -> actual`）も表示する。（[spec/testing.md](./spec/testing.md) §8.7.2）
- **v0.2 M4a — `test` レイヤー + `kumiki test` ランナー**：言語内テストを `kumiki test [name|prefix*]` で実行。`reducer-test R given={slots,event} expect={slots,effects}` は reducer の純粋出力を検証（または `expect={panic:"…"}`）、`tile-test T given={slots} expect=<tile-expr>` は render した tile を構造比較（spec §8.4 通り props/handler は無視）。出力は spec §8.7.1 の PASS/FAIL + `expected`/`actual`/`diff at`、失敗時は非ゼロ終了。テストは `kumiki build` から除外（codegen `includeTests`）。record リテラルがキーワードのフィールド名（`type:` / `in:` 等）を受理するようになった。新規 example `examples/features/28-tests.kumiki`。_未実装_：`property-test`、`episode-test`、`expect` ワイルドカード、reducer-test の effect 結果モック、`--watch`/`--coverage`。（[spec/testing.md](./spec/testing.md) §8）
- **v0.2 M3 — プラグインによる capability 登録**：プロジェクトは `.kumiki` ファイルと同じディレクトリの `kumiki.caps.json` マニフェストで独自 capability を登録できる。登録名は `app.caps` で受理され、その effect は emit 可能になり capability 境界で dispatch される（標準 effect と同様 scenario でモック可能）。併せて spec が長らく定めていた「**未登録 capability はコンパイルエラー**」を実装した — 標準 capability セット + 新 **E0302 `unknown-capability`**（従来は任意の cap 文字列を受理しており `spec/stdlib.md §2.5` と乖離していた）。マニフェストは宣言的な capability 境界であって**新しい構文ではない**（rationale の非ゴールを維持）。CLI・MCP（`capabilities` 引数 / 同居マニフェスト）・テストハーネスが解決する。新規 example `examples/features/27-custom-capability.kumiki` + `kumiki.caps.json`。（[spec/stdlib.md](./spec/stdlib.md) §2.5）
- **v0.2 M2 — `overlay` builtin**：`overlay(...children)` による z 軸重ね。最初の子がベース層（通常フロー）、以降の子はコンテナ上に絶対配置される（ベースのレイアウトは決してずれない）— モーダル / トースト / ドロップダウン / ツールチップの土台。`align` prop が重ねる子を配置（縦 `top`/`bottom` ＋ 横 `left`/`right` を `-` で連結、例 `top-left`、既定 `center`、未知は `center`）。`when(...)` と合成して mount/unmount。CSS は自己完結（グローバル CSS の抜け穴なし）。新規 example `examples/features/26-overlay.kumiki`。（[spec/style.md](./spec/style.md) §4.4.3）
- **v0.2 M1 — `stop-timer(name)`**：タイマートリガーに `timer(d, name=N)` で名前を付与でき、reducer から `stop-timer(N)` 文で停止できる。タイマー名は単一ネームスペースを共有し一意でなければならない（重複は **E0002**）。未宣言の名前への `stop-timer` は **E0106**。`stop-timer` は純粋な制御文 — reducer は `stopTimers` を返し runtime が interval を clear するので、reducer の純粋性は保たれる。全タイマー（稼働中・停止中問わず）は `app` dispose 時に clear される。新規 example `examples/features/25-stop-timer.kumiki`。（[spec/lifecycle.md](./spec/lifecycle.md) §7.1.5）

## [0.1.0]

初期ベースライン（npm 公開済み、git では未タグ）。

### Added

- pnpm + Turborepo モノレポ構成（`@kumikijs/compiler` / `@kumikijs/runtime` / `@kumikijs/cli` / `@kumikijs/mcp`）。
- `@kumikijs/mcp`: コンパイラと AI 編集・仕様検索を MCP ツールとして公開する MCP サーバー。
- **ランタイム smoke テスト**: `@kumikijs/runtime` の `smoke()`、CLI `kumiki smoke <file>`、MCP `kumiki_smoke`。headless DOM に mount して UI を操作し、`check`/`build` では捕まらないランタイム例外・空描画・未処理 rejection を検出。全 example が CI で smoke 検証される（`tests/smoke.test.ts`）。3 層検証モデルは [spec/testing.md](./spec/testing.md) §8.10。
- **シナリオランナーと自律ループ substrate**: `@kumikijs/runtime` の `runScenario()`、CLI `kumiki run <file> <scenario.json>`、MCP `kumiki_run_scenario`。操作列 + slot 状態アサーションでアプリを駆動し、毎ステップの状態・DOM・エラー・emit を trace で返す。effect は capability 境界でモックされ決定論的。状態を oracle にするため「select が常に最後の選択肢になる」等の非例外バグも検出可能。人を介さない生成→実行→観測→修正ループの手順は `.claude/skills/kumiki-iterate`。
- **実ブラウザ検証 tier `@kumikijs/e2e`**（Chromium / Playwright）: jsdom と同じシナリオ形式を実ブラウザで実行し、`focused`（実フォーカス）・`visible`/`hidden`（計算済み可視性）など jsdom では検証できない層を捕捉。opt-in（ブラウザバイナリが重く既定 CI には含めない）。例: `examples/apps/06-expenses/scenario.browser.json`。
- `spec/`: 正規仕様を再編。エラーコードカタログ `spec/errors.md`（E0001..E07xx）を新設。
- `examples/`: 機能別ミニマル例 23 件（`features/`）と規模順アプリ 5 件（`apps/`）。すべて CI でパース・型検査・ビルドを検証。
- `tests/`: 全 example の動作保証テスト。
- `guide/`: はじめに・最初のアプリ・考え方・レシピ。
- `.claude/skills/`: `kumiki-author` / `kumiki-debug` / `kumiki-iterate` スキル。
- **静的メソッド存在チェック (E0801)**: `obj.method(...)` がランタイム未実装のメソッド（綴り間違い、`Option.to-result` のような誤用、未実装の仕様メソッド）を呼ぶと `check` 段階で検出。実装集合は `@kumikijs/compiler` の `KNOWN_METHODS`（codegen と同期）が唯一の正。以前 smoke 層でしか捕まらなかった `.to-result` 級のバグを layer 1 で先取りする。
- **`List.fold` / `Int`・`Float.parse` の修正**（iterate ループのデモ中に検出）: `fold` の codegen + runtime を実装、`Int.parse`/`Float.parse` を数値変換に修正（従来は文字列を返し合計等が壊れた）。例: `examples/features/24-fold.kumiki`, `examples/apps/06-expenses/`。

### Changed

- 1 reducer 1 書き込み規則を、ルート名粒度から **パス形状（lvalue shape）粒度**へ。`tasks[id].status` と `tasks[id].updatedAt` が共存可能に。
- ランタイム: dispose 後の遅延 effect 結果が DOM を触らないようガード（in-flight fetch 起因の `NotFoundError` を解消）。
- AST: `IfStmt` / `IfExpr` / `TileIf` のフィールドを `then`/`else` → `consequent`/`alternate` に改名。

### Notes

- 1.0 未満のベースライン。言語・ランタイム・ツールはマイナーバージョン間で予告なく変わりうる。
