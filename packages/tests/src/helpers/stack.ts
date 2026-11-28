// CI runs on Linux, where V8 parsed the same modules up to 1.3 times as deep as on Windows, so a
// child that stands in for Windows runs on 77% of V8's default 984 KB stack rather than on the one
// it inherits. On Windows the child keeps the default, which is the room the smaller stack stands
// in for: shrinking it there as well would leave less than any app on Windows gets.
export const WINDOWS_LIKE_STACK_KB = process.platform === "win32" ? 984 : 757;
