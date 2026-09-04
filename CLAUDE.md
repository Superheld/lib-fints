# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A TypeScript client for the German FinTS 3.0 online-banking protocol (PIN/TAN, read-only: balances, statements, portfolios, credit cards, electronic statements). This checkout is the **Superheld fork**; see *Branches* below before committing anything.

`docs/` holds the FinTS specification PDFs (Formals, Messages, Security). Segment layouts and return codes come from there, not from memory.

## Commands

```sh
npm run build                      # rm -rf dist && tsc — also type-checks src/tests/, so a type error in a test breaks the build
npx tsc --noEmit                   # type-check only
npx vitest run                     # whole suite once (npm test starts vitest in WATCH mode)
npx vitest run src/tests/mt940parser.test.ts        # one file
npx vitest run -t "interim balances"                # tests whose name matches
TZ=America/New_York npx vitest run                  # date handling is time-zone sensitive; run this before touching any Date code
npx biome check <files>            # lint + format check (tabs, 100 cols, single quotes)
npx biome format --write <files>
```

CI uses pnpm (`pnpm install --frozen-lockfile`, `pnpm run build`); `preprepare` deliberately uses npm so the package builds when installed as a git dependency. Both lock files are present; do not remove either.

There is pre-existing lint noise (unused imports, unsorted imports in a few interactions). Only clean up what you touch.

## Architecture

Six layers, each only knowing the one below:

1. **DataElements / DataGroups** (`src/dataElements`, `src/dataGroups`) — the FinTS primitive and composite types with `encode`/`decode`. Each carries `minCount`/`maxCount` and optional `minVersion`/`maxVersion`, so one definition serves several segment versions.
2. **SegmentDefinition** (`src/segments/*.ts`, `src/segmentDefinition.ts`) — one class per segment (`HKSAL` request, `HISAL` response, `HISALS`… parameter segments extend `BusinessTransactionParameter`). Every definition must be registered in `src/segments/registry.ts`; `registerSegments()` runs from `index.ts` and must be called at the top of every test file.
3. **Message** (`src/message.ts`, `src/segment.ts`, `src/encoder.ts`, `src/decoder.ts`) — splits on `'`/`+`/`:` with `?` escaping and `@len@` binaries, signs with HNSHK/HNSHA (PIN/TAN), and wraps in HNVSK/HNVSD (a protocol envelope, not encryption — TLS does that). `decode()` turns any segment whose id is unknown **or whose version is newer than the definition's** into an `UNKNOW` segment carrying `originalId` and `rawData`; `findAllUnknownSegments(id)` finds those.
4. **CustomerInteraction** (`src/interactions`) — one per business transaction: `createSegments(config)` builds the request, `handleResponse(message, clientResponse)` fills the payload. `handleClientResponse` (the base) evaluates return codes first — 30/3955–3957 with a HITAN mean `requiresTan`, highest code ≥ 9000 means `success: false` — and calls `handleResponse` **only** when `success && !requiresTan`. Payload fields are therefore optional on every response type.
5. **Dialog** (`src/dialog.ts`) — runs `[InitDialogInteraction, …customer interactions…, EndDialogInteraction]` in order; `continue()` resumes after a TAN. `handlePartedMessages` collects a response the bank splits over several messages (return code 3040 + continuation mark): each portion is a complete segment, held as a `PARTED` placeholder until all are in, and the interaction joins the payloads (`findAllSegments`). A refused order or an exception after initialisation still sends HKEND; a failed initialisation does not.
6. **FinTSClient** (`src/client.ts`) — the public API. Every `get*` opens a **new** Dialog; `*WithTan` continues the current one.

`FinTSConfig` (`src/config.ts`) holds `bankingInformation` (systemId, BPD, UPD) which the **caller** persists between sessions. `getBankAccount` resolves a caller's account reference and throws when a bare number is ambiguous; `matchBankAccount` is the tolerant variant for accounts the *bank* names.

Statement payloads are parsed by `src/mt940parser.ts` (regex tokenizer over the `:61:`/`:86:` lines, SEPA tags split out in `parsePurpose`), `src/camtParser.ts` (fast-xml-parser; reads **camt.052** `BkToCstmrAcctRpt/Rpt` only — the intraday report, which is why balances may be absent), and `src/mt535parser.ts`.

## Conventions the code relies on

- **A calendar day is a `Date` at local noon.** All three parsers and the `Dat` element decode to 12:00 local; `Dat.encode` uses local getters. This keeps the day stable through `JSON.stringify`. In tests write `new Date('2026-06-01T12:00')` or `new Date(2026, 5, 1)` — never `new Date('2026-06-01')` (UTC midnight, the previous day west of Greenwich).
- **Absent, not invented.** A field the bank did not send is `undefined` — no zero balances, no `new Date()` for a missing date, no empty list standing in for a failed parse.
- **Parse errors throw.** MT940/CAMT parsing failures propagate out of `getAccountStatements`; they used to return `success: true, statements: []`, which callers read as "no transactions". (`.github/copilot-instructions.md` still says errors never surface as exceptions — that is out of date.)
- **Parameter segments:** `bpd.allowedTransactions[].params` are those of the highest version this client supports; versions it cannot decode are kept raw in `unparsedParameters`.
- **DataElement `maxCount > 1` only as the last element** of a DataGroup or segment — the parser cannot tell where a repeated element ends otherwise.
- Amounts are `number` (IEEE double). Credit/debit sign is applied in the parsers; `RC` is negative, `RD` positive.
- Comments explain *why* a line exists, often what went wrong before it; match that density. Commit messages are short explanatory prose, not bullet lists.

## Testing patterns

- Segment tests decode raw FinTS text (`decode("HISAL:5:7:3+…'")`) and assert the round trip.
- Interaction tests call `handleResponse(Message.decode(text), clientResponse)` directly; build the response text from a `HIRMG` answers segment plus the payload segment, binaries as `@len@…`.
- Dialog/client tests `vi.mock('../httpClient.js')` and `vi.spyOn(interaction, 'handleClientResponse')`; they never mock protocol internals.
- Mocks that build a `ClientResponse` literal need `as ClientResponse`; ones that omit payload fields are the norm.

## Branches

- `main` mirrors upstream `robocode13/lib-fints` and is never committed to; sync with `git fetch origin && git push fork origin/main:main`.
- `workshop` is this fork's integration line. The consuming app pins a `workshop` commit (`github:Superheld/lib-fints#<sha>`).
- One branch per bug or feature (`fix/…`, `feature/…`), one explanatory commit, merged into `workshop` with `--no-ff -m "Merge: <lowercase summary>"`. Branches are also pushed to `fork` so they can become upstream PRs; for that they must be cherry-picked onto `origin/main`, since they branch from `workshop`.
- Pure bug fixes are upstream candidates; API changes (optional payloads, throwing parsers, absent balances) are fork decisions — raise an issue upstream first.
