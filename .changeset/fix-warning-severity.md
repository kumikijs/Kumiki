---
"@kumikijs/cli": minor
"@kumikijs/mcp": patch
---

Stop `fix` from treating a warning as a file it cannot repair.

The fix-from-test path gated its behavioural tier on "does this file have diagnostics", counting advisory ones. A `W0212` anywhere in a file made `kumiki fix --auto-patch <test>` return `no-patch` without running the test at all — and the second gate did the same after a compile repair had already landed, so a successful repair reported the warning it revealed as what remained.

Warnings stay visible: `planFix` now returns the ones it filtered out, and `fix` reports a clean-but-advisory file the way `check` does (`no errors (1 warning)`, exit 0) rather than as a bare `no errors`. The MCP `kumiki_fix` tool reports the same.
