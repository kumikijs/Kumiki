# Kumiki Specification

This is the **normative specification** of the Kumiki language and runtime. When the implementation (`packages/`) and this specification disagree, this specification is, as a rule, taken as authoritative, and which side to fix is recorded as a design decision in the PR.

Tutorials and how-tos are not specification and live in [Kumiki Guide](../guide/). Working examples are in [Kumiki Examples](https://github.com/kumikijs/Kumiki/tree/main/packages/examples).

## Table of Contents

| Document | Contents |
|---|---|
| [Language Core](./language.md) | the 7 layers (type / slot / effect / reducer / tile / fn / app) and expressions, statements, patterns |
| [Standard Library](./stdlib.md) | List / Map / Set / Option / Result / Time / domain types |
| [Routing](./routing.md) |patterns, parameters, `route.enter` / `route.leave`, redirects |
| [Style](./style.md) | Style, layout, and themes |
| [Forms](./forms.md) | Forms, `bind`, validation |
| [HTTP / Storage](./http.md) | HTTP / Storage effects and policies (latest / debounce / once …) |
| [Lifecycle](./lifecycle.md) | Lifecycle, capabilities, error boundaries, suspense |
| [Runtime](./runtime.md) | Runtime implementation guide (signal graph, mount, dispatch, dispose) |
| [AI Editing](./ai-edit.md) | AI editing API, CRDT ops, referential integrity |
| [Testing](./testing.md) | Testing strategy |
| [Error Codes](./errors.md) | Error code catalog (E0001..E08xx) |

The three indices below are **machine-checked**: `packages/tests/spec-index.test.ts` verifies that every anchor link resolves, that the examples index lists exactly the `.kumiki` files under `packages/examples/features/` (fixtures, READMEs, `.scenario.json` files, and other non-`.kumiki` files are out of scope), that the diagnostic code index matches [Error Codes](./errors.md), and that the English and Japanese indices stay structurally in sync. Together with the compiler-side drift guard (`packages/compiler/test/spec-drift.test.ts`, implementation ⇆ errors.md), the spec ⇆ implementation ⇆ examples triangle is closed mechanically.

## Layer × Feature Matrix

Where each feature dimension touches each of the 7 layers. A cell links to the section that specifies that intersection; `—` means the dimension has no layer-specific rules there.

<!-- matrix:start -->
| Feature | `type` | `slot` | `effect` | `reducer` | `tile` | `fn` | `app` |
|---|---|---|---|---|---|---|---|
| [Language Core](./language.md) | [§1.3](./language.md#_1-3-type-layer-type) | [§1.4](./language.md#_1-4-store-layer-slot) | [§1.5](./language.md#_1-5-side-effect-layer-effect) | [§1.6](./language.md#_1-6-reducer-layer-reducer) | [§1.7](./language.md#_1-7-view-layer-tile) | [§1.8](./language.md#_1-8-function-layer-fn) | [§1.12](./language.md#_1-12-application-entry-app) |
| [Standard Library](./stdlib.md) | [§2.1](./stdlib.md#_2-1-built-in-types) | — | [§2.6](./stdlib.md#_2-6-standard-effects) | — | [§2.3](./stdlib.md#_2-3-tile-primitive-elements) | [§2.2](./stdlib.md#_2-2-collection-methods) [§2.4](./stdlib.md#_2-4-built-in-functions) | [§2.5](./stdlib.md#_2-5-standard-capabilities) |
| [Routing](./routing.md) | — | [§3.2](./routing.md#_3-2-current-route-state) | [§3.3.2](./routing.md#_3-3-2-writing-it-as-an-effect) | [§3.4](./routing.md#_3-4-route-lifecycle) [§3.5](./routing.md#_3-5-guards) | [§3.3.1](./routing.md#_3-3-1-the-link-element-recommended) [§3.6](./routing.md#_3-6-nested-routes) | [§3.3.3](./routing.md#_3-3-3-dynamic-path-construction) | [§3.1](./routing.md#_3-1-declaring-routes) |
| [Style](./style.md) | — | — | — | — | [§4.3](./style.md#_4-3-token-references) [§4.4](./style.md#_4-4-layout) [§4.9](./style.md#_4-9-animation) | — | [§4.2.2](./style.md#_4-2-2-applying-it-to-an-app) [§4.6](./style.md#_4-6-dark-mode) |
| [Forms](./forms.md) | [§5.1.2](./forms.md#_5-1-2-handling-of-refinement) | [§5.1](./forms.md#_5-1-two-way-binding-of-individual-inputs) | — | [§5.4](./forms.md#_5-4-delivering-individual-input-events-to-a-reducer) | [§5.2](./forms.md#_5-2-form-elements) [§5.3](./forms.md#_5-3-common-props-for-input-elements) | [§5.6](./forms.md#_5-6-validation-strategy) | — |
| [HTTP / Storage](./http.md) | [§6.1.3](./http.md#_6-1-3-the-httpbody-type) [§6.1.4](./http.md#_6-1-4-the-decoder-type) | [§6.8](./http.md#_6-8-persistence-patterns) | [§6.1](./http.md#_6-1-http-common) [§6.7](./http.md#_6-7-storage-effects) | [§6.2](./http.md#_6-2-http-usage-examples) | — | — | [§6.1.1](./http.md#_6-1-1-capability) |
| [Lifecycle](./lifecycle.md) | — | [§7.9](./lifecycle.md#_7-9-state-on-hot-reload) | [§7.6](./lifecycle.md#_7-6-confirmation-dialogs) [§7.7](./lifecycle.md#_7-7-toasts) | [§7.1](./lifecycle.md#_7-1-list-of-lifecycle-events) | [§7.3](./lifecycle.md#_7-3-error-boundaries-per-tile) [§7.4](./lifecycle.md#_7-4-suspense-loading-display) | — | [§7.2](./lifecycle.md#_7-2-error-handling) [§7.5](./lifecycle.md#_7-5-404-and-error-pages) |
| [Testing](./testing.md) | — | [§8.2.2](./testing.md#_8-2-2-wildcards) | [§8.5](./testing.md#_8-5-effect-mock) | [§8.2](./testing.md#_8-2-reducer-tests) | [§8.4](./testing.md#_8-4-tile-snapshot-tests) | [§8.3](./testing.md#_8-3-property-tests) | [§8.6](./testing.md#_8-6-episode-replay) |
| [AI Editing](./ai-edit.md) | — | — | — | [§9.9](./ai-edit.md#_9-9-the-relationship-between-episode-and-op) | — | — | [§9.2](./ai-edit.md#_9-2-the-kumiki-cli) [§9.4](./ai-edit.md#_9-4-enforcing-referential-integrity) |
| [Runtime](./runtime.md) | — | [§10.3](./runtime.md#_10-3-signal-graph) | [§10.4](./runtime.md#_10-4-effect-dispatcher) | [§10.5](./runtime.md#_10-5-episode-loop) | [§10.3.4](./runtime.md#_10-3-4-invariants-of-dom-rendering) | — | [§10.6](./runtime.md#_10-6-ssr-edge-client-split) [§10.9](./runtime.md#_10-9-runtime-api-for-embedding) |
| [Errors](./errors.md) | [E02xx](./errors.md#e02xx-—-types) | [E01xx](./errors.md#e01xx-—-name-resolution) | [E03xx](./errors.md#e03xx-—-capabilities-and-purity) | [E06xx](./errors.md#e06xx-—-reducer-write-rules) | [E04xx](./errors.md#e04xx-—-motion) [E07xx](./errors.md#e07xx-—-opt-in-checks-a11y-strict-icons-testing-dsl-invariants) | [E03xx](./errors.md#e03xx-—-capabilities-and-purity) [E08xx](./errors.md#e08xx-—-runtime-hazards) | [E00xx](./errors.md#e00xx-—-structure) |
<!-- matrix:end -->

AI-editing CRDT ops (add / replace / remove / rename, [§9.3.1](./ai-edit.md#_9-3-1-op-kinds)) apply uniformly to definitions of every layer; the matrix row lists only the layer-specific sections.

## Diagnostic Code Index

Every code documented in [Error Codes](./errors.md), cross-classified by the layer it fires on and the feature dimension it belongs to.

<!-- codes:start -->
| Code | Kind | Layer | Feature |
|---|---|---|---|
| [E0001](./errors.md#e0001-missing-404) | `missing-404` | app | routing |
| [E0002](./errors.md#e0002-duplicate-timer-name) | `duplicate-timer-name` | app | lifecycle |
| [E0003](./errors.md#e0003-missing-app) | `missing-app` | app | core |
| [E0102](./errors.md#e0102-undef-reducer) | `undef-reducer` | reducer | core |
| [E0103](./errors.md#e0103-undef-ref-undef-slot) | `undef-ref` / `undef-slot` | slot | core |
| [E0104](./errors.md#e0104-undef-effect) | `undef-effect` | effect | core |
| [E0106](./errors.md#e0106-undef-timer) | `undef-timer` | reducer | lifecycle |
| [E0105](./errors.md#e0105-undef-tile) | `undef-tile` | tile | core |
| [E0107](./errors.md#e0107-undef-motion) | `undef-motion` | tile | style |
| [E0108](./errors.md#e0108-undef-member) | `undef-member` | fn | stdlib |
| [E0110](./errors.md#e0110-unknown-token-group) | `unknown-token-group` | tile | style |
| [E0109](./errors.md#e0109-test-wildcard-misuse) | `test-wildcard-misuse` | reducer | testing |
| [E0111](./errors.md#e0111-orphan-sub-routes) | `orphan-sub-routes` | tile | routing |
| [E0112](./errors.md#e0112-duplicate-sub-route) | `duplicate-sub-route` | tile | routing |
| [E0113](./errors.md#e0113-sub-routes-without-outlet) | `sub-routes-without-outlet` | tile | routing |
| [E0114](./errors.md#e0114-sub-routes-without-wildcard-parent) | `sub-routes-without-wildcard-parent` | tile | routing |
| [E0115](./errors.md#e0115-reserved-slot-name) | `reserved-slot-name` | slot | core |
| [E0201](./errors.md#e0201-type-mismatch) | `type-mismatch` | type | core |
| [E0202](./errors.md#e0202-emit-arg-type-mismatch) | `emit-arg-type-mismatch` | reducer | core |
| [E0204](./errors.md#e0204-effect-id-misuse) | `effect-id-misuse` | effect | http |
| [E0205](./errors.md#e0205-bind-on-file-input) | `bind-on-file-input` | tile | forms |
| [E0206](./errors.md#e0206-file-only-prop) | `file-only-prop` | tile | forms |
| [E0207](./errors.md#e0207-pat-arity-mismatch) | `pat-arity-mismatch` | type | core |
| [E0208](./errors.md#e0208-pat-type-mismatch) | `pat-type-mismatch` | type | core |
| [E0209](./errors.md#e0209-pat-unknown-variant) | `pat-unknown-variant` | type | core |
| [E0210](./errors.md#e0210-type-arity-mismatch) | `type-arity-mismatch` | type | core |
| [E0211](./errors.md#e0211-undef-tile-in-selector) | `undef-tile-in-selector` | reducer | core |
| [E0212](./errors.md#e0212-selector-id-mismatch-opt-in-via-strict-selector-id) | `selector-id-mismatch` | reducer | core |
| [W0212](./errors.md#w0212-ui-event-tile-mismatch-warning) | `ui-event-tile-mismatch` | reducer | core |
| [E0301](./errors.md#e0301-missing-capability) | `missing-capability` | effect | stdlib |
| [E0302](./errors.md#e0302-unknown-capability) | `unknown-capability` | app | stdlib |
| [E0303](./errors.md#e0303-invalid-cancel-target) | `invalid-cancel-target` | effect | http |
| [E0305](./errors.md#e0305-fn-impurity) | `fn-impurity` | fn | core |
| [E0401](./errors.md#e0401-motion-unknown-property) | `motion-unknown-property` | tile | style |
| [E0402](./errors.md#e0402-motion-invalid-timing) | `motion-invalid-timing` | tile | style |
| [E0403](./errors.md#e0403-motion-malformed) | `motion-malformed` | tile | style |
| [E0601](./errors.md#e0601-duplicate-write) | `duplicate-write` | reducer | core |
| [E0701](./errors.md#e0701-a11y-button) | `a11y-button` | tile | lifecycle |
| [E0702](./errors.md#e0702-a11y-image) | `a11y-image` | tile | lifecycle |
| [E0703](./errors.md#e0703-a11y-link) | `a11y-link` | tile | lifecycle |
| [E0704](./errors.md#e0704-unknown-icon) | `unknown-icon` | tile | style |
| [E0712](./errors.md#e0712-episode-mock-invalid) | `episode-mock-invalid` | effect | testing |
| [E0801](./errors.md#e0801-unimplemented-method) | `unimplemented-method` | fn | stdlib |
<!-- codes:end -->

## Feature Examples Index

Each file under [`packages/examples/features/`](https://github.com/kumikijs/Kumiki/tree/main/packages/examples/features) demonstrates one matrix cell (or a small cluster). Layers name the definitions the example centers on; Spec links the section it demonstrates.

<!-- examples:start -->
| Example | Layers | Feature | Spec |
|---|---|---|---|
| `01-slot-and-reducer.kumiki` | slot, reducer | core | [§1.4](./language.md#_1-4-store-layer-slot) [§1.6](./language.md#_1-6-reducer-layer-reducer) |
| `02-nominal-type.kumiki` | type | core | [§1.3](./language.md#_1-3-type-layer-type) |
| `03-union-and-match.kumiki` | type | core | [§1.3](./language.md#_1-3-type-layer-type) |
| `04-record-and-copy.kumiki` | type | core | [§1.3](./language.md#_1-3-type-layer-type) |
| `05-pure-fn.kumiki` | fn | core | [§1.8](./language.md#_1-8-function-layer-fn) |
| `06-if-expression.kumiki` | fn | core | [§1.9](./language.md#_1-9-expression-language) |
| `07-list.kumiki` | fn | stdlib | [§2.2.3](./stdlib.md#_2-2-3-list-t) |
| `08-map.kumiki` | fn | stdlib | [§2.2.1](./stdlib.md#_2-2-1-map-k-v) |
| `09-set.kumiki` | fn | stdlib | [§2.2.2](./stdlib.md#_2-2-2-set-t) |
| `10-option.kumiki` | fn | stdlib | [§2.2.4](./stdlib.md#_2-2-4-option-t) |
| `11-time-and-duration.kumiki` | fn | stdlib | [§2.2.8](./stdlib.md#_2-2-8-time) |
| `12-layout.kumiki` | tile | style | [§4.4](./style.md#_4-4-layout) |
| `13-text-input-bind.kumiki` | slot, tile | forms | [§5.1](./forms.md#_5-1-two-way-binding-of-individual-inputs) |
| `14-select.kumiki` | tile | forms | [§5.5.1](./forms.md#_5-5-1-select) |
| `15-checkbox.kumiki` | tile | forms | [§5.3.1](./forms.md#_5-3-1-by-input-type) |
| `16-conditional-ui.kumiki` | tile | core | [§1.7](./language.md#_1-7-view-layer-tile) |
| `17-theme.kumiki` | app | style | [§4.2](./style.md#_4-2-design-tokens) |
| `18-routing.kumiki` | app, tile | routing | [§3.1](./routing.md#_3-1-declaring-routes) |
| `19-effect-http.kumiki` | effect | http | [§6.2](./http.md#_6-2-http-usage-examples) |
| `20-effect-storage.kumiki` | effect | http | [§6.7](./http.md#_6-7-storage-effects) |
| `21-timer.kumiki` | reducer | lifecycle | [§7.1.5](./lifecycle.md#_7-1-5-timer) |
| `22-result.kumiki` | type | stdlib | [§2.2.5](./stdlib.md#_2-2-5-result-t-e) |
| `23-lifecycle-route-enter.kumiki` | reducer | routing | [§3.4](./routing.md#_3-4-route-lifecycle) |
| `24-fold.kumiki` | fn | stdlib | [§2.2.3](./stdlib.md#_2-2-3-list-t) |
| `25-stop-timer.kumiki` | effect, reducer | lifecycle | [§7.1.5](./lifecycle.md#_7-1-5-timer) |
| `26-overlay.kumiki` | tile | stdlib | [§2.3.7](./stdlib.md#_2-3-7-overlays) |
| `27-custom-capability.kumiki` | app, effect | stdlib | [§2.5](./stdlib.md#_2-5-standard-capabilities) |
| `28-tests.kumiki` | reducer | testing | [§8.1](./testing.md#_8-1-the-test-definition-layer) |
| `30-motion.kumiki` | tile | style | [§4.9](./style.md#_4-9-animation) |
| `31-argless-methods.kumiki` | fn | stdlib | [§2.2](./stdlib.md#_2-2-collection-methods) |
| `32-panic-boundary.kumiki` | tile, app | lifecycle | [§7.3](./lifecycle.md#_7-3-error-boundaries-per-tile) |
| `33-field-vs-method.kumiki` | fn, type | stdlib | [§2.2](./stdlib.md#_2-2-collection-methods) |
| `34-builtin-tiles.kumiki` | tile | stdlib | [§2.3](./stdlib.md#_2-3-tile-primitive-elements) |
| `35-match-and-args.kumiki` | tile, type | core | [§1.9](./language.md#_1-9-expression-language) |
| `36-effect-indexed-db.kumiki` | effect | http | [§6.7.4](./http.md#_6-7-4-sessionstorage-indexeddb) |
| `37-lifecycle-events.kumiki` | reducer | lifecycle | [§7.1](./lifecycle.md#_7-1-list-of-lifecycle-events) |
| `38-confirm-leave-guard.kumiki` | reducer | routing | [§3.5.2](./routing.md#_3-5-2-leave-guard) |
| `39-effect-session.kumiki` | effect | http | [§6.7.4](./http.md#_6-7-4-sessionstorage-indexeddb) |
| `40-nested-routes.kumiki` | app, tile | routing | [§3.6](./routing.md#_3-6-nested-routes) |
| `40-token-refs.kumiki` | tile | style | [§4.3](./style.md#_4-3-token-references) |
| `41-link-prefetch.kumiki` | tile | routing | [§3.8](./routing.md#_3-8-prefetch) |
| `42-scroll-restoration.kumiki` | app | routing | [§3.9](./routing.md#_3-9-scroll-restoration) |
| `43-file-upload-preview.kumiki` | tile | forms | [§5.10](./forms.md#_5-10-file-upload) |
| `44-episode-test.kumiki` | effect | testing | [§8.6](./testing.md#_8-6-episode-replay) |
| `45-ui-key-hover-tuple.kumiki` | reducer, tile | core | [§1.6](./language.md#_1-6-reducer-layer-reducer) |
| `46-stdlib-paren-methods.kumiki` | fn | stdlib | [§2.2](./stdlib.md#_2-2-collection-methods) |
| `47-icon-set.kumiki` | tile | style | [§4.8](./style.md#_4-8-icons) |
| `48-effect-cancel.kumiki` | effect | http | [§6.4](./http.md#_6-4-cancellation) |
| `49-ui-focus-blur.kumiki` | reducer, tile | core | [§1.6](./language.md#_1-6-reducer-layer-reducer) |
| `50-match-pattern-integrity.kumiki` | type | core | [§1.9](./language.md#_1-9-expression-language) |
| `51-selector-id.kumiki` | reducer | core | [§1.6.2](./language.md#_1-6-2-selectors) |
| `52-selector-id-arg.kumiki` | reducer | core | [§1.6.2](./language.md#_1-6-2-selectors) |
| `53-keyed-list-identity.kumiki` | tile | core | [§10.3.10](./runtime.md#_10-3-10-stable-tile-identity) |
| `54-select-preserves-state.kumiki` | tile | core | [§10.3.11](./runtime.md#_10-3-11-identity-preserving-reconciliation-190) |
| `55-video-preserves-currenttime.kumiki` | tile | core | [§10.3.11](./runtime.md#_10-3-11-identity-preserving-reconciliation-190) |
| `56-details-preserves-open.kumiki` | tile | core | [§10.3.11](./runtime.md#_10-3-11-identity-preserving-reconciliation-190) |
| `57-editable-preserves-focus.kumiki` | tile | core | [§10.3.11](./runtime.md#_10-3-11-identity-preserving-reconciliation-190) |
| `58-unkeyed-conditional-rebuild.kumiki` | tile | core | [§10.3.12](./runtime.md#_10-3-12-reconcile-diagnostics) |
| `59-overlay-keyed-layers.kumiki` | tile | core | [§10.3.10](./runtime.md#_10-3-10-stable-tile-identity) |
| `60-empty-state-keyed-list.kumiki` | tile | core | [§10.3.10](./runtime.md#_10-3-10-stable-tile-identity) |
| `61-reserved-identifier-names.kumiki` | fn, reducer | core | [§1.2](./language.md#_1-2-lexical) |
| `62-conditional-inline-tile-handlers.kumiki` | tile, reducer | core | [§10.3.13](./runtime.md#_10-3-13-data-prop-equality) |
| `63-reducer-batch-atomicity.kumiki` | slot, reducer | core | [§10.3.3](./runtime.md#_10-3-3-batching) |
| `64-init-slot-argument.kumiki` | app, effect | core | [§1.12](./language.md#_1-12-application-entry-app) |
<!-- examples:end -->
