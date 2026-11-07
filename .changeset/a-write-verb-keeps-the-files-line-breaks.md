---
"@kumikijs/cli": patch
---

The write verbs keep the file's line breaks

`load` split the source on `\r?\n`, and `rename`, `replace`, `edit` and
`remove` joined the lines back with `\n`. On a file saved with CRLF line ends,
the default on Windows, each of them rewrote the end of every line in the file,
so a one-token rename was a whole-file diff. `add` appended its definition with
`\n`, which left the file with both line ends:

```
before:                       11 of 11 lines end in CR
rename reducer.inc bump       0 lines end in CR
add slot extra 'Int = 0'      11 of 13 lines end in CR
```

The verbs now splice the lines they write into the file and leave every other
character where it was, so each line they do not write keeps its own line end.
The line breaks they write, between the lines of a body and around a
definition `add` appends, are the file's: the first one in the file, or `\n`
when it has none. That includes a line break inside the body or patch they are
given, so a body file saved with CRLF no longer brings CRLF into an LF file
through `add` or `edit`. `patch apply`, `patch revert` and the MCP tools write
through the same verbs. Otherwise an LF file is written exactly as before.
