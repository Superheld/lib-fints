# AI coding guidelines

The guidance for working in this repository lives in [`CLAUDE.md`](../CLAUDE.md) at the
root: commands, the six-layer architecture, the conventions the code relies on (dates at
local noon, absent rather than invented fields, parsers that throw), testing patterns and
the branch model of this fork. Read it before changing anything; keep it the single place
such guidance is written, so two documents cannot drift apart.

One protocol rule worth repeating because it is easy to break: a DataElement with
`maxCount > 1` may only be the **last** element of a DataGroup or segment — the parser
cannot tell where a repeated element ends otherwise.
