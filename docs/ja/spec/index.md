# Kumiki 仕様

ここは Kumiki 言語とランタイムの**正規（normative）仕様**である。実装（`packages/`）と本仕様が食い違った場合、原則として本仕様を正とし、どちらを直すかを設計判断として PR に記録する。

チュートリアルや how-to は仕様ではなく [Kumiki ガイド](../guide/) に置く。動作する実例は [Kumiki Examples](https://github.com/kumikijs/Kumiki/tree/main/packages/examples) にある。

## 目次

| 文書 | 内容 |
|---|---|
| [言語コア](./language.md) | 7 層（type / slot / effect / reducer / tile / fn / app）と式・文・パターン |
| [標準ライブラリ](./stdlib.md) | List / Map / Set / Option / Result / Time / ドメイン型 |
| [ルーティング](./routing.md) | パターン、パラメータ、`route.enter` / `route.leave`、リダイレクト |
| [スタイル](./style.md) | スタイル・レイアウト・テーマ |
| [フォーム](./forms.md) | フォーム、`bind`、バリデーション |
| [HTTP / Storage](./http.md) | HTTP / Storage effects とポリシー（latest / debounce / once …） |
| [ライフサイクル](./lifecycle.md) | ライフサイクル、ケイパビリティ、エラー境界、サスペンス |
| [ランタイム](./runtime.md) | ランタイム実装ガイド（signal graph・mount・dispatch・dispose） |
| [AI 編集](./ai-edit.md) | AI 編集 API、CRDT op、参照整合性 |
| [テスト](./testing.md) | テスト戦略 |
| [エラーコード](./errors.md) | エラーコードカタログ（E0000..E08xx） |

以下の 3 つの索引は**機械検証されている**。`packages/tests/spec-index.test.ts` が、全 anchor リンクの実在、examples 索引と `packages/examples/features/` 配下の `.kumiki` ファイル群（fixture / README / `.scenario.json` 等は対象外）の一致、診断コード索引と[エラーコード](./errors.md)の一致、そして英語版・日本語版 index の構造同期を検証する。コンパイラ側のドリフトガード（`packages/compiler/test/spec-drift.test.ts`、実装 ⇆ errors.md）と合わせて、spec ⇆ 実装 ⇆ examples の三角関係が機械的に閉じる。

## 層 × 機能マトリクス

各機能次元が 7 層のどこに接するか。セルはその交点を規定するセクションへのリンク。`—` はその次元に層固有の規則が無いことを表す。

<!-- matrix:start -->
| 機能 | `type` | `slot` | `effect` | `reducer` | `tile` | `fn` | `app` |
|---|---|---|---|---|---|---|---|
| [言語コア](./language.md) | [§1.3](./language.md#_1-3-型レイヤ-type) | [§1.4](./language.md#_1-4-ストアレイヤ-slot) | [§1.5](./language.md#_1-5-副作用レイヤ-effect) | [§1.6](./language.md#_1-6-リデューサレイヤ-reducer) | [§1.7](./language.md#_1-7-ビューレイヤ-tile) | [§1.8](./language.md#_1-8-関数レイヤ-fn) | [§1.12](./language.md#_1-12-アプリエントリ-app) |
| [標準ライブラリ](./stdlib.md) | [§2.1](./stdlib.md#_2-1-ビルトイン型) | — | [§2.6](./stdlib.md#_2-6-標準-effect) | — | [§2.3](./stdlib.md#_2-3-tile-プリミティブ要素) | [§2.2](./stdlib.md#_2-2-コレクションメソッド) [§2.4](./stdlib.md#_2-4-ビルトイン関数) | [§2.5](./stdlib.md#_2-5-standard-capabilities) |
| [ルーティング](./routing.md) | — | [§3.2](./routing.md#_3-2-current-route-state) | [§3.3.2](./routing.md#_3-3-2-effect-として書く) | [§3.4](./routing.md#_3-4-ルートライフサイクル) [§3.5](./routing.md#_3-5-ガード) | [§3.3.1](./routing.md#_3-3-1-link-要素-推奨) [§3.6](./routing.md#_3-6-nested-routes) | [§3.3.3](./routing.md#_3-3-3-動的パス構築) | [§3.1](./routing.md#_3-1-ルートの宣言) |
| [スタイル](./style.md) | — | — | — | — | [§4.3](./style.md#_4-3-トークン参照) [§4.4](./style.md#_4-4-レイアウト) [§4.9](./style.md#_4-9-アニメーション) | — | [§4.2.2](./style.md#_4-2-2-app-への適用) [§4.6](./style.md#_4-6-dark-mode) |
| [フォーム](./forms.md) | [§5.1.2](./forms.md#_5-1-2-refinement-の扱い) | [§5.1](./forms.md#_5-1-個別入力の双方向束縛) | — | [§5.4](./forms.md#_5-4-個別入力イベントを-reducer-に届ける) | [§5.2](./forms.md#_5-2-フォーム要素) [§5.3](./forms.md#_5-3-入力要素の共通-props) | [§5.6](./forms.md#_5-6-バリデーション戦略) | — |
| [HTTP / Storage](./http.md) | [§6.1.3](./http.md#_6-1-3-httpbody-型) [§6.1.4](./http.md#_6-1-4-decoder-型) | [§6.8](./http.md#_6-8-永続化のパターン) | [§6.1](./http.md#_6-1-http-共通) [§6.7](./http.md#_6-7-storage-effects) | [§6.2](./http.md#_6-2-http-利用例) | — | — | [§6.1.1](./http.md#_6-1-1-capability) |
| [ライフサイクル](./lifecycle.md) | — | [§7.9](./lifecycle.md#_7-9-ホットリロード時の状態) | [§7.6](./lifecycle.md#_7-6-confirmation-dialogs) [§7.7](./lifecycle.md#_7-7-トースト) | [§7.1](./lifecycle.md#_7-1-list-of-lifecycle-events) | [§7.3](./lifecycle.md#_7-3-エラー境界-タイル単位) [§7.4](./lifecycle.md#_7-4-サスペンス-loading-表示) | — | [§7.2](./lifecycle.md#_7-2-error-handling) [§7.5](./lifecycle.md#_7-5-404-と-error-ページ) |
| [テスト](./testing.md) | — | [§8.2.2](./testing.md#_8-2-2-wildcards) | [§8.5](./testing.md#_8-5-effect-mock) | [§8.2](./testing.md#_8-2-reducer-テスト) | [§8.4](./testing.md#_8-4-tile-snapshot-テスト) | [§8.3](./testing.md#_8-3-property-tests) | [§8.6](./testing.md#_8-6-episode-replay) |
| [AI 編集](./ai-edit.md) | — | — | — | [§9.9](./ai-edit.md#_9-9-episode-と-op-の関係) | — | — | [§9.2](./ai-edit.md#_9-2-kumiki-cli) [§9.4](./ai-edit.md#_9-4-参照整合性の強制) |
| [ランタイム](./runtime.md) | — | [§10.3](./runtime.md#_10-3-signal-graph) | [§10.4](./runtime.md#_10-4-effect-dispatcher) | [§10.5](./runtime.md#_10-5-episode-loop) | [§10.3.4](./runtime.md#_10-3-4-dom-レンダリングの不変条件) | — | [§10.6](./runtime.md#_10-6-ssr-edge-client-分割) [§10.9](./runtime.md#_10-9-ランタイム-api-埋め込み用) |
| [エラー](./errors.md) | [E02xx](./errors.md#e02xx-—-型) | [E01xx](./errors.md#e01xx-—-名前解決) | [E03xx](./errors.md#e03xx-—-ケイパビリティと純粋性) | [E06xx](./errors.md#e06xx-—-reducer-の書き込み規則) | [E04xx](./errors.md#e04xx-—-モーション) [E07xx](./errors.md#e07xx-—-オプトイン検査-a11y-strict-icons-テスト-dsl-不変条件) | [E03xx](./errors.md#e03xx-—-ケイパビリティと純粋性) [E08xx](./errors.md#e08xx-—-ランタイムハザード) | [E00xx](./errors.md#e00xx-—-構造) |
<!-- matrix:end -->

AI 編集の CRDT op（add / replace / remove / rename、[§9.3.1](./ai-edit.md#_9-3-1-op-の種類)）は全層の定義に一様に適用される。マトリクスの行には層固有のセクションのみを載せている。

## 診断コード索引

[エラーコード](./errors.md)に文書化された全コードを、発火する層と所属する機能次元でクロス分類したもの。

<!-- codes:start -->
| コード | kind | 層 | 機能 |
|---|---|---|---|
| [E0000](./errors.md#e0000-parse-error) | `parse-error` | all | コア |
| [E0001](./errors.md#e0001-missing-404) | `missing-404` | app | ルーティング |
| [E0002](./errors.md#e0002-duplicate-timer-name) | `duplicate-timer-name` | app | ライフサイクル |
| [E0003](./errors.md#e0003-missing-app) | `missing-app` | app | コア |
| [E0004](./errors.md#e0004-duplicate-app) | `duplicate-app` | app | コア |
| [E0005](./errors.md#e0005-tile-cycle) | `tile-cycle` | tile | コア |
| [E0006](./errors.md#e0006-fn-cycle) | `fn-cycle` | fn | コア |
| [E0007](./errors.md#e0007-duplicate-definition) | `duplicate-definition` | all | コア |
| [E0008](./errors.md#e0008-duplicate-clause-duplicate-key-duplicate-field-duplicate-param-duplicate-variant) | `duplicate-clause` / `duplicate-key` / `duplicate-field` / `duplicate-param` / `duplicate-variant` | all | コア |
| [E0102](./errors.md#e0102-undef-reducer) | `undef-reducer` | reducer | コア |
| [E0103](./errors.md#e0103-undef-ref-undef-slot) | `undef-ref` / `undef-slot` | slot | コア |
| [E0104](./errors.md#e0104-undef-effect-init-not-effect-call) | `undef-effect` / `init-not-effect-call` | effect | コア |
| [E0106](./errors.md#e0106-undef-timer) | `undef-timer` | reducer | ライフサイクル |
| [E0105](./errors.md#e0105-undef-tile) | `undef-tile` | tile | コア |
| [E0107](./errors.md#e0107-undef-motion) | `undef-motion` | tile | スタイル |
| [E0108](./errors.md#e0108-undef-member) | `undef-member` | fn | 標準ライブラリ |
| [E0110](./errors.md#e0110-unknown-token-group) | `unknown-token-group` | tile | スタイル |
| [E0109](./errors.md#e0109-test-wildcard-misuse) | `test-wildcard-misuse` | reducer | テスト |
| [E0111](./errors.md#e0111-orphan-sub-routes) | `orphan-sub-routes` | tile | ルーティング |
| [E0112](./errors.md#e0112-duplicate-sub-route) | `duplicate-sub-route` | tile | ルーティング |
| [E0113](./errors.md#e0113-sub-routes-without-outlet) | `sub-routes-without-outlet` | tile | ルーティング |
| [E0114](./errors.md#e0114-sub-routes-without-wildcard-parent) | `sub-routes-without-wildcard-parent` | tile | ルーティング |
| [E0115](./errors.md#e0115-reserved-slot-name) | `reserved-slot-name` | slot | コア |
| [E0116](./errors.md#e0116-undef-call) | `undef-call` | fn | コア |
| [E0117](./errors.md#e0117-undef-type) | `undef-type` | type | コア |
| [E0118](./errors.md#e0118-undef-theme) | `undef-theme` | app | スタイル |
| [E0119](./errors.md#e0119-route-bind-out-of-scope) | `route-bind-out-of-scope` | reducer | ルーティング |
| [E0120](./errors.md#e0120-route-in-app-init) | `route-in-app-init` | app | ルーティング |
| [E0201](./errors.md#e0201-type-mismatch) | `type-mismatch` | type | コア |
| [E0202](./errors.md#e0202-emit-arg-type-mismatch) | `emit-arg-type-mismatch` | reducer | コア |
| [E0204](./errors.md#e0204-effect-id-misuse) | `effect-id-misuse` | effect | HTTP/Storage |
| [E0205](./errors.md#e0205-bind-on-file-input) | `bind-on-file-input` | tile | フォーム |
| [E0206](./errors.md#e0206-file-only-prop) | `file-only-prop` | tile | フォーム |
| [E0207](./errors.md#e0207-pat-arity-mismatch) | `pat-arity-mismatch` | type | コア |
| [E0208](./errors.md#e0208-pat-type-mismatch) | `pat-type-mismatch` | type | コア |
| [E0209](./errors.md#e0209-pat-unknown-variant) | `pat-unknown-variant` | type | コア |
| [E0210](./errors.md#e0210-type-arity-mismatch) | `type-arity-mismatch` | type | コア |
| [E0211](./errors.md#e0211-undef-tile-in-selector) | `undef-tile-in-selector` | reducer | コア |
| [E0212](./errors.md#e0212-selector-id-mismatch-strict-selector-id-で-opt-in) | `selector-id-mismatch` | reducer | コア |
| [W0212](./errors.md#w0212-ui-event-tile-mismatch-warning) | `ui-event-tile-mismatch` | reducer | コア |
| [E0213](./errors.md#e0213-call-arity-mismatch) | `call-arity-mismatch` | fn | コア |
| [E0214](./errors.md#e0214-missing-record-field) | `missing-record-field` | type | コア |
| [E0215](./errors.md#e0215-unknown-record-field) | `unknown-record-field` | type | コア |
| [E0216](./errors.md#e0216-unknown-variant) | `unknown-variant` | type | コア |
| [E0217](./errors.md#e0217-int-literal-precision) | `int-literal-precision` | type | コア |
| [E0218](./errors.md#e0218-for-over-non-list) | `for-over-non-list` | type | コア |
| [W0213](./errors.md#w0213-handler-on-inert-tile-warning) | `handler-on-inert-tile` | tile | コア |
| [E0301](./errors.md#e0301-missing-capability) | `missing-capability` | effect | 標準ライブラリ |
| [E0302](./errors.md#e0302-unknown-capability) | `unknown-capability` | app | 標準ライブラリ |
| [E0303](./errors.md#e0303-invalid-cancel-target) | `invalid-cancel-target` | effect | HTTP/Storage |
| [E0304](./errors.md#e0304-derived-slot) | `derived-slot` | slot | コア |
| [E0305](./errors.md#e0305-fn-impurity) | `fn-impurity` | fn | コア |
| [E0401](./errors.md#e0401-motion-unknown-property) | `motion-unknown-property` | tile | スタイル |
| [E0402](./errors.md#e0402-motion-invalid-timing) | `motion-invalid-timing` | tile | スタイル |
| [E0403](./errors.md#e0403-motion-malformed) | `motion-malformed` | tile | スタイル |
| [E0601](./errors.md#e0601-duplicate-write) | `duplicate-write` | reducer | コア |
| [E0701](./errors.md#e0701-a11y-button) | `a11y-button` | tile | ライフサイクル |
| [E0702](./errors.md#e0702-a11y-image) | `a11y-image` | tile | ライフサイクル |
| [E0703](./errors.md#e0703-a11y-link) | `a11y-link` | tile | ライフサイクル |
| [E0704](./errors.md#e0704-unknown-icon) | `unknown-icon` | tile | スタイル |
| [E0705](./errors.md#e0705-a11y-label-for) | `a11y-label-for` | tile | ライフサイクル |
| [E0712](./errors.md#e0712-episode-mock-invalid) | `episode-mock-invalid` | effect | テスト |
| [E0713](./errors.md#e0713-test-shape-invalid) | `test-shape-invalid` | effect | テスト |
| [E0801](./errors.md#e0801-unimplemented-method) | `unimplemented-method` | fn | 標準ライブラリ |
| [E0802](./errors.md#e0802-unimplemented-function) | `unimplemented-function` | fn | 標準ライブラリ |
<!-- codes:end -->

## examples 索引

[`packages/examples/features/`](https://github.com/kumikijs/Kumiki/tree/main/packages/examples/features) の各ファイルは、マトリクスの 1 セル（または近接する数セル）を実演する。「層」はその例の中心となる定義、「仕様」は実演対象のセクション。

<!-- examples:start -->
| Example | 層 | 機能 | 仕様 |
|---|---|---|---|
| `01-slot-and-reducer.kumiki` | slot, reducer | コア | [§1.4](./language.md#_1-4-ストアレイヤ-slot) [§1.6](./language.md#_1-6-リデューサレイヤ-reducer) |
| `02-nominal-type.kumiki` | type | コア | [§1.3](./language.md#_1-3-型レイヤ-type) |
| `03-union-and-match.kumiki` | type | コア | [§1.3](./language.md#_1-3-型レイヤ-type) |
| `04-record-and-copy.kumiki` | type | コア | [§1.3](./language.md#_1-3-型レイヤ-type) |
| `05-pure-fn.kumiki` | fn | コア | [§1.8](./language.md#_1-8-関数レイヤ-fn) |
| `06-if-expression.kumiki` | fn | コア | [§1.9](./language.md#_1-9-式言語) |
| `07-list.kumiki` | fn | 標準ライブラリ | [§2.2.3](./stdlib.md#_2-2-3-list-t) |
| `08-map.kumiki` | fn | 標準ライブラリ | [§2.2.1](./stdlib.md#_2-2-1-map-k-v) |
| `09-set.kumiki` | fn | 標準ライブラリ | [§2.2.2](./stdlib.md#_2-2-2-set-t) |
| `10-option.kumiki` | fn | 標準ライブラリ | [§2.2.4](./stdlib.md#_2-2-4-option-t) |
| `11-time-and-duration.kumiki` | fn | 標準ライブラリ | [§2.2.8](./stdlib.md#_2-2-8-time) |
| `12-layout.kumiki` | tile | スタイル | [§4.4](./style.md#_4-4-レイアウト) |
| `13-text-input-bind.kumiki` | slot, tile | フォーム | [§5.1](./forms.md#_5-1-個別入力の双方向束縛) |
| `14-select.kumiki` | tile | フォーム | [§5.5.1](./forms.md#_5-5-1-select) |
| `15-checkbox.kumiki` | tile | フォーム | [§5.3.1](./forms.md#_5-3-1-input-type-別) |
| `16-conditional-ui.kumiki` | tile | コア | [§1.7](./language.md#_1-7-ビューレイヤ-tile) |
| `17-theme.kumiki` | app | スタイル | [§4.2](./style.md#_4-2-design-tokens) |
| `18-routing.kumiki` | app, tile | ルーティング | [§3.1](./routing.md#_3-1-ルートの宣言) |
| `19-effect-http.kumiki` | effect | HTTP/Storage | [§6.2](./http.md#_6-2-http-利用例) |
| `20-effect-storage.kumiki` | effect | HTTP/Storage | [§6.7](./http.md#_6-7-storage-effects) |
| `21-timer.kumiki` | reducer | ライフサイクル | [§7.1.5](./lifecycle.md#_7-1-5-timer) |
| `22-result.kumiki` | type | 標準ライブラリ | [§2.2.5](./stdlib.md#_2-2-5-result-t-e) |
| `23-lifecycle-route-enter.kumiki` | reducer | ルーティング | [§3.4](./routing.md#_3-4-ルートライフサイクル) |
| `24-fold.kumiki` | fn | 標準ライブラリ | [§2.2.3](./stdlib.md#_2-2-3-list-t) |
| `25-stop-timer.kumiki` | effect, reducer | ライフサイクル | [§7.1.5](./lifecycle.md#_7-1-5-timer) |
| `26-overlay.kumiki` | tile | 標準ライブラリ | [§2.3.7](./stdlib.md#_2-3-7-オーバーレイ) |
| `27-custom-capability.kumiki` | app, effect | 標準ライブラリ | [§2.5](./stdlib.md#_2-5-standard-capabilities) |
| `28-tests.kumiki` | reducer | テスト | [§8.1](./testing.md#_8-1-テスト定義レイヤ) |
| `30-motion.kumiki` | tile | スタイル | [§4.9](./style.md#_4-9-アニメーション) |
| `31-argless-methods.kumiki` | fn | 標準ライブラリ | [§2.2](./stdlib.md#_2-2-コレクションメソッド) |
| `32-panic-boundary.kumiki` | tile, app | ライフサイクル | [§7.3](./lifecycle.md#_7-3-エラー境界-タイル単位) |
| `33-field-vs-method.kumiki` | fn, type | 標準ライブラリ | [§2.2](./stdlib.md#_2-2-コレクションメソッド) |
| `34-builtin-tiles.kumiki` | tile | 標準ライブラリ | [§2.3](./stdlib.md#_2-3-tile-プリミティブ要素) |
| `35-match-and-args.kumiki` | tile, type | コア | [§1.9](./language.md#_1-9-式言語) |
| `36-effect-indexed-db.kumiki` | effect | HTTP/Storage | [§6.7.4](./http.md#_6-7-4-sessionstorage-indexeddb) |
| `37-lifecycle-events.kumiki` | reducer | ライフサイクル | [§7.1](./lifecycle.md#_7-1-list-of-lifecycle-events) |
| `38-confirm-leave-guard.kumiki` | reducer | ルーティング | [§3.5.2](./routing.md#_3-5-2-leave-ガード) |
| `39-effect-session.kumiki` | effect | HTTP/Storage | [§6.7.4](./http.md#_6-7-4-sessionstorage-indexeddb) |
| `40-nested-routes.kumiki` | app, tile | ルーティング | [§3.6](./routing.md#_3-6-nested-routes) |
| `40-token-refs.kumiki` | tile | スタイル | [§4.3](./style.md#_4-3-トークン参照) |
| `41-link-prefetch.kumiki` | tile | ルーティング | [§3.8](./routing.md#_3-8-prefetch) |
| `42-scroll-restoration.kumiki` | app | ルーティング | [§3.9](./routing.md#_3-9-スクロール復元) |
| `43-file-upload-preview.kumiki` | tile | フォーム | [§5.10](./forms.md#_5-10-file-upload) |
| `44-episode-test.kumiki` | effect | テスト | [§8.6](./testing.md#_8-6-episode-replay) |
| `45-ui-key-hover-tuple.kumiki` | reducer, tile | コア | [§1.6](./language.md#_1-6-リデューサレイヤ-reducer) |
| `46-stdlib-paren-methods.kumiki` | fn | 標準ライブラリ | [§2.2](./stdlib.md#_2-2-コレクションメソッド) |
| `47-icon-set.kumiki` | tile | スタイル | [§4.8](./style.md#_4-8-アイコン) |
| `48-effect-cancel.kumiki` | effect | HTTP/Storage | [§6.4](./http.md#_6-4-cancellation) |
| `49-ui-focus-blur.kumiki` | reducer, tile | コア | [§1.6](./language.md#_1-6-リデューサレイヤ-reducer) |
| `50-match-pattern-integrity.kumiki` | type | コア | [§1.9](./language.md#_1-9-式言語) |
| `51-selector-id.kumiki` | reducer | コア | [§1.6.2](./language.md#_1-6-2-セレクタ) |
| `52-selector-id-arg.kumiki` | reducer | コア | [§1.6.2](./language.md#_1-6-2-セレクタ) |
| `53-keyed-list-identity.kumiki` | tile | コア | [§10.3.10](./runtime.md#_10-3-10-安定タイル-identity) |
| `54-select-preserves-state.kumiki` | tile | コア | [§10.3.11](./runtime.md#_10-3-11-要素同一性を保った-reconciliation-190) |
| `55-video-preserves-currenttime.kumiki` | tile | コア | [§10.3.11](./runtime.md#_10-3-11-要素同一性を保った-reconciliation-190) |
| `56-details-preserves-open.kumiki` | tile | コア | [§10.3.11](./runtime.md#_10-3-11-要素同一性を保った-reconciliation-190) |
| `57-editable-preserves-focus.kumiki` | tile | コア | [§10.3.11](./runtime.md#_10-3-11-要素同一性を保った-reconciliation-190) |
| `58-unkeyed-conditional-rebuild.kumiki` | tile | コア | [§10.3.12](./runtime.md#_10-3-12-reconcile-の診断) |
| `59-overlay-keyed-layers.kumiki` | tile | コア | [§10.3.10](./runtime.md#_10-3-10-安定タイル-identity) |
| `60-empty-state-keyed-list.kumiki` | tile | コア | [§10.3.10](./runtime.md#_10-3-10-安定タイル-identity) |
| `61-reserved-identifier-names.kumiki` | fn, reducer | コア | [§1.2](./language.md#_1-2-字句) |
| `62-conditional-inline-tile-handlers.kumiki` | tile, reducer | コア | [§10.3.13](./runtime.md#_10-3-13-data-prop-の等値判定) |
| `63-reducer-batch-atomicity.kumiki` | slot, reducer | コア | [§10.3.3](./runtime.md#_10-3-3-batching) |
| `64-init-slot-argument.kumiki` | app, effect | コア | [§1.12](./language.md#_1-12-アプリエントリ-app) |
| `65-prefers-dark.kumiki` | app, reducer | スタイル | [§4.6.1](./style.md#_4-6-1-os-設定への追従) |
| `66-value-types.kumiki` | type, slot, fn | コア | [§1.9.4](./language.md#_1-9-4-演算子の型) |
| `67-self-reference.kumiki` | tile, slot, fn | コア | [§1.7.2](./language.md#_1-7-2-不変条件) |
| `68-name-uniqueness.kumiki` | type, slot, fn | コア | [§1.3.1](./language.md#_1-3-1-構文) |
| `69-builtin-effect-capabilities.kumiki` | reducer, effect | 標準ライブラリ | [§2.6](./stdlib.md#_2-6-標準-effect) |
| `70-spec-grammar.kumiki` | type, slot, fn, reducer | コア | [§1.2](./language.md#_1-2-字句) |
| `71-button-type.kumiki` | slot, reducer, tile | フォーム | [§5.2.2](./forms.md#_5-2-2-submit-の挙動) |
| `72-time-format.kumiki` | slot, fn, tile | 標準ライブラリ | [§2.2.8](./stdlib.md#_2-2-8-time) |
| `73-effect-policy-queue.kumiki` | slot, effect, reducer | ライフサイクル | [§10.4.3](./runtime.md#_10-4-3-policy-処理) |
| `74-common-tile-props.kumiki` | slot, reducer, tile | スタイル | [§2.3.10](./stdlib.md#_2-3-10-props-の共通仕様) |
| `75-paren-less-stdlib-constants.kumiki` | slot, effect, reducer | HTTP/Storage | [§6.1.4](./http.md#_6-1-4-decoder-型) |
| `76-conditional-adds-a-universal-handler.kumiki` | slot, reducer, tile | コア | [§10.3.11](./runtime.md#_10-3-11-要素同一性を保った-reconciliation-190) |
| `77-int-float-math.kumiki` | slot, reducer, tile | 標準ライブラリ | [§2.2.7](./stdlib.md#_2-2-7-int-float) |
<!-- examples:end -->
