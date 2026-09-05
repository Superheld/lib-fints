# What to change once this library stands on its own

This fork has stayed a superset of upstream `robocode13/lib-fints`: stricter (parsers
throw, no silent format fallback), richer (some twenty optional fields), but every field
that upstream has still means what it means there. The changes below cross that line —
they alter the meaning or type of existing fields — and were deliberately parked in
September 2026 rather than slipped into a "fork". They are the backlog for the day the
package is renamed and given a major version of its own, with upstream reduced to a
source of bug fixes to cherry-pick.

Everything here comes from comparing the same bookings fetched as MT940 and as CAMT at
one bank (comdirect, via fints-probe). The DK mapping table MT940 → camt is the
authority for what is "the same thing" in both formats; where it says nothing, the
difference is left alone and documented on the field.

Marked **breaking** where a caller storing today's values would have to migrate them.
Unmarked items are additive and could be done in the fork already.

---

## A. One vocabulary for the business transaction — **breaking**

Today the same three fields carry different vocabularies by format:

| field | MT940 | CAMT today | CAMT after |
| --- | --- | --- | --- |
| `transactionType` | `NTRF` (`:61:`) | ISO family, `RCDT` | `NTRF`, from `BkTxCd/Prtry/Cd` |
| `transactionCode` | `117` (`:86:` GVC) | ISO sub-family, `ICDT` | `117`, from `BkTxCd/Prtry/Cd` |
| `fundsCode` | letter after the amount in `:61:`, rarely present | `PMNT`, or `CRDT`/`DBIT` — whatever was there | absent |

The DK code `NTRF+117` in `BkTxCd/Prtry/Cd` is exactly MT940's type plus GVC; the
parser keeps it raw as `proprietaryCode`. Split it (tolerantly: if the shape is not
`[A-Z]{4}\+\d{3}`, leave the raw value in `proprietaryCode` and both fields absent — a
bank outside the DK sends only ISO codes). Move the ISO codes to a field of their own so
nothing is lost:

```ts
bankTransactionCode?: { domain?: string; family?: string; subFamily?: string };
```

`fundsCode` for CAMT is simply mis-filled today; make it optional and leave it absent.

## B. References straightened out — **breaking**

`customerReference` is the `EndToEndId` in CAMT, but in MT940 it is field 7 of `:61:`
overridden by `KREF+`. The DK mapping puts `KREF+` next to `PmtInfId`/`InstrId`, not
`EndToEndId`. CAMT should fill it from `Refs.InstrId ?? Refs.PmtInfId`; the EREF stays in
`e2eReference`. MT940 is itself ambiguous here (many banks put the EREF into `:61:`
field 7), so document that.

At the same time make the four fields that are typed required and carry `''` when
nothing came — `fundsCode`, `transactionType`, `customerReference`, `bankReference` —
optional, absent instead of `''`. This is the last place the library still invents a
value for something the bank did not send.

## C. One field for the deviating party

MT940 `ABWA+` lands in `client`, CAMT `UltmtCdtr`/`UltmtDbtr` in `ultimateParty`. Same
concept, two fields. Let MT940 fill `ultimateParty` too; keep `client` as the legacy
name (or drop it in the standalone version — **breaking** then).

## D. A status for MT940 transactions

CAMT has `status` (`BOOK`, `PDNG`, …); MT940 has none. What comes out of the booked
field of HIKAZ is booked, what comes out of the noted field is pending — derived from
provenance, not invented. Set `status` for MT940 accordingly so a caller has one status
field regardless of format. Additive.

## E. Smaller inconsistencies noticed on the way

- `moneyAt` in the CAMT parser defaults a missing `Ccy` to `EUR` for balances and
  charges. `Transaction.currency` deliberately does not; `Money.currency` should become
  optional and follow suit — **breaking** on the type.
- `remoteAccountNumber` for CAMT is the IBAN again (same as `remoteIban`). In a
  standalone version it should be absent for CAMT and `remoteIban` the only place for an
  IBAN; MT940 keeps the legacy number in `remoteAccountNumber` — **breaking**.
- `CreditCardStatementResponse` has no `format`; the credit-card path (DKKKU) parses
  without the guards the statement paths have (no `StatementParsingError`, no raw
  payload). Bring it in line.
- `Statement.number`/`transactionReference`/`relatedReference` are MT940 notions
  (`:20:`, `:21:`, `:28C:`); CAMT fills `number` from `Rpt/Id` only. Decide whether a
  CAMT report's `CreDtTm`, `FrToDt` and `RptPgntn` deserve fields, or whether the
  MT940-only ones become optional and documented as such.

## F. Not built because no bank has shown it yet

Kept here so the list is complete; each needs a real-bank observation first, not a
design.

- A TAN demanded on the *continuation* of a parted response (3040 → HKKAZ with
  Aufsetzpunkt → 3955/3956/3957). comdirect waives it (3076). The dialog throws
  `requires a TAN to continue the parted response` today.
- camt.053 (`BkToCstmrStmt`) and camt.054 (`BkToCstmrDbtCdtNtfctn`). The parser reads
  `BkToCstmrAcctRpt/Rpt` only; HKCAZ at German banks delivers camt.052.
- `CardTx` details, `RfrdDocInf`/`RfrdDocAmt`/`Invcr`/`Invcee` in structured remittance
  information, `AcctOwnrTxId`/`AcctSvcrTxId`/`MktInfrstrctrTxId`/`PrcgId` in `Refs`.
- The SEPA reference set (`EREF+`/`MREF+`/`CRED+`/`SVWZ+` and their CAMT counterparts,
  the creditor identifier above all) is implemented and unit-tested but has never been
  seen from a real bank: comdirect sends none. The first bank that does will test it.

## G. The package itself

- Rename (`@superheld/…`), major version, `CHANGELOG.md` starting from the last common
  commit with upstream (`origin/main` at the time of the split).
- README: replace the upstream feature table with one that names the fork's
  guarantees (dates at local noon, absent not invented, three grades of strictness,
  `format` on the response, raw payloads, `StatementParsingError`).
- Keep `main` mirroring upstream for as long as cherry-picking is worth it; the
  integration line becomes the default branch.
- Decide what to do with the open upstream PRs (#36, #37) — close them with a pointer,
  or leave them.
