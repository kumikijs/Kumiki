---
"@kumikijs/cli": minor
"@kumikijs/mcp": minor
---

Stop `fix` from treating a warning as a file it cannot repair, and report the warnings it sets aside.

The fix-from-test path gated its behavioural tier on "does this file have diagnostics", counting advisory ones. A `W0212` anywhere in a file made `kumiki fix --auto-patch <test>` return `no-patch` without running the test at all — and the second gate did the same after a compile repair had already landed, so a successful repair reported the warning it revealed as what remained.

Warnings are now carried rather than dropped: `FixPlan`, `FixApplyResult` and `FixFromTestOutcome` each expose them, both `fix` modes report a clean-but-advisory file the way `check` does (`no errors (1 warning)`, exit 0) and list the warnings under every verdict, and `kumiki_fix` does the same — including on the wire, where the apply envelope now carries a `warnings` array beside `remaining`.
