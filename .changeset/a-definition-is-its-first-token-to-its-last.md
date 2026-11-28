---
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

The AI-editing verbs and MCP tools take a definition from its first token to its last, so an edit no longer deletes another definition on its line or cuts off a string whose line starts with `#`

The store guessed each definition's lines from where the next one started and
then dropped trailing lines that began with `#`. Two definitions on one line
gave the first an inverted range: `view` printed nothing for it, and `replace`
or `remove` of the second cut the whole line, deleting the first, which
passed validation whenever nothing referenced it. A string literal whose last
line started with `#` was cut there: `view` showed half of it, `replace` left
the old tail in the file as a comment, and `view --hash` failed to lex it.

Each definition is now the span of its own tokens. `view` prints that text,
`list` gives the lines it starts and ends on, `replace` and `edit` write over
that text alone, and `view --hash` reads it, so a definition hashes the same on
a line of its own and on one it shares. `remove` takes the lines a definition
stands on when no other definition shares them, as before, and otherwise its
text and the spaces between it and its neighbour on the line. `rename` finds
the definition's own name as the token after its keyword, also when that is on
the next line. A comment after a definition's last token is no longer part of
what `view` prints, and `replace` leaves it in place. `patch revert` of a
`remove` puts a definition that shared a line back on a line of its own.
