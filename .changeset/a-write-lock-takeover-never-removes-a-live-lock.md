---
"@kumikijs/cli": patch
---

Several writers that find a lock left by an exited writer no longer lose one another's edit.

Taking over a dead writer's lock moved the lock aside, checked it, and put it back if it turned out to be newer than the one seen. When one waiter had already taken over and a second moved that live lock aside, a third could create the lock in between; the second's put-back then failed and it deleted the live lock it had moved. Two writers held the lock at once, and one `add` was lost while both reported success.

A waiter now touches the lock only once it is known to be the dead one. It first creates a claim file named after the lock it saw (created like the lock, so one waiter at a time holds it), looks at the lock again, and deletes it only if it is still that one. A claim left by a waiter that stopped in between is judged like a lock and passed over. Releasing goes through the same claim. What is taken over, and when, is unchanged.
