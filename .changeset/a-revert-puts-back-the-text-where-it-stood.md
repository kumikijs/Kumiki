---
"@kumikijs/cli": patch
---

`patch revert` of a `replace`, an `edit` or a `remove` puts back the text the op changed where it stood, so the file reads as it did before the op, also for definitions written by hand

The op log recorded only bodies, and `patch revert` wrote a definition back
from its body as `add` writes one: `slot   count  : N    = 0` came back as
`slot count : N    = 0`, a comment after a name was dropped, and a removed
definition went to the end of the file. Reverting a cascade `remove` of a
hand-written `tile.ResetBtn` put back all four definitions it took, but after
everything else, with their spacing gone.

`replace` and `edit` now record the definition's text before the op as `prev`,
and `remove` records, for each definition it deletes, its text, the definition
it followed (`after`) and how many lines lay between the two (`gap`).
`patch revert` writes that text back in place, so reverting the latest op
leaves the file as it was before it. A removed definition goes back `gap` lines
after the one it followed, under that one's name now; right before the next
definition when fewer lines lie between them now; and at the end of the file,
as `add` writes one, when the one it followed is gone. Ops logged without the
text revert as before.
