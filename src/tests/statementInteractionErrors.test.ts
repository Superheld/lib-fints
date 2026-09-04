import { describe, expect, it } from 'vitest';
import { StatementInteractionCAMT } from '../interactions/statementInteractionCAMT.js';
import { StatementInteractionMT940 } from '../interactions/statementInteractionMT940.js';
import { Message } from '../message.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

// What a statement interaction does when the payload the bank sent cannot be parsed.
// It used to catch the error, log it, and answer with an empty list — indistinguishable
// from "no transactions in this period" for a caller looking at the response.

const CAMT_DESCRIPTOR = 'urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.08';

function hicaz(...docs: string[]): string {
	const booked = docs.map((doc) => `@${doc.length}@${doc}`).join(':');
	return `HICAZ:5:1+DE991234567123456:BANK12+${CAMT_DESCRIPTOR}+${booked}'`;
}

function hikaz(mt940: string): string {
	return `HIKAZ:5:7+@${mt940.length}@${mt940}'`;
}

const ANSWERS = "HIRMG:3:2+0010::Entgegengenommen.+0020::Abfrage erfolgreich.'";

const VALID_MT940 =
	':20:STARTUMS\r\n:25:12345678/1234567890\r\n:28C:1\r\n:60F:C260819EUR100,00\r\n' +
	':61:2608190819C10,00NMSCNONREF\r\n:62F:C260819EUR110,00\r\n';

// A `:61:` line whose amount lacks the mandatory decimal comma.
const BROKEN_MT940 =
	':20:STARTUMS\r\n:25:12345678/1234567890\r\n:28C:2\r\n:60F:C260820EUR110,00\r\n' +
	':61:2608200820C10NMSCNONREF\r\n:62F:C260820EUR120,00\r\n';

const camt = (id: string, entry: string) =>
	`<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08">` +
	`<BkToCstmrAcctRpt><Rpt><Id>${id}</Id><Acct><Id><IBAN>DE991234567123456</IBAN></Id></Acct>` +
	`<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">990.00</Amt>` +
	`<CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-07-01</Dt></Dt></Bal>${entry}</Rpt></BkToCstmrAcctRpt></Document>`;

const VALID_CAMT = camt(
	'A',
	'<Ntry><Amt>10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-07-01</Dt></BookgDt></Ntry>',
);
// Not well-formed: the closing tag of the entry is missing.
const BROKEN_CAMT = camt('B', '<Ntry><Amt>10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>');

describe('a statement interaction faced with a payload it cannot parse', () => {
	it('MT940: throws instead of answering with an empty list', () => {
		const message = Message.decode(`${ANSWERS}${hikaz(VALID_MT940 + BROKEN_MT940)}`);
		const interaction = new StatementInteractionMT940('1234567890');
		const clientResponse = {} as never;

		expect(() => interaction.handleResponse(message, clientResponse)).toThrow(SyntaxError);
		expect((clientResponse as { statements?: unknown }).statements).toBeUndefined();
	});

	it('CAMT: throws instead of answering with an empty list', () => {
		const message = Message.decode(`${ANSWERS}${hicaz(VALID_CAMT)}${hicaz(BROKEN_CAMT)}`);
		const interaction = new StatementInteractionCAMT('1234567890');
		const clientResponse = {} as never;

		expect(() => interaction.handleResponse(message, clientResponse)).toThrow(
			/Invalid CAMT XML structure/,
		);
		expect((clientResponse as { statements?: unknown }).statements).toBeUndefined();
	});

	it('still parses intact payloads', () => {
		const mt940 = Message.decode(`${ANSWERS}${hikaz(VALID_MT940)}`);
		const mt940Response = { statements: [] } as never;
		new StatementInteractionMT940('1234567890').handleResponse(mt940, mt940Response);
		expect((mt940Response as { statements: unknown[] }).statements).toHaveLength(1);

		const camtMessage = Message.decode(`${ANSWERS}${hicaz(VALID_CAMT)}`);
		const camtResponse = { statements: [] } as never;
		new StatementInteractionCAMT('1234567890').handleResponse(camtMessage, camtResponse);
		expect((camtResponse as { statements: unknown[] }).statements).toHaveLength(1);
	});
});
