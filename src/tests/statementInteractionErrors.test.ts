import { describe, expect, it } from 'vitest';
import { StatementParsingError } from '../interactions/customerInteraction.js';
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

		expect(() => interaction.handleResponse(message, clientResponse)).toThrow(
			StatementParsingError,
		);
		expect((clientResponse as { statements?: unknown }).statements).toBeUndefined();
	});

	// The response is lost with the exception, and so was the text the parser failed
	// on: a message, and no way to tell a parser gap from a bank sending something odd.
	it('MT940: the error carries the stream and the parser error', () => {
		const message = Message.decode(`${ANSWERS}${hikaz(VALID_MT940 + BROKEN_MT940)}`);
		const interaction = new StatementInteractionMT940('1234567890');

		let thrown: unknown;
		try {
			interaction.handleResponse(message, {} as never);
		} catch (error) {
			thrown = error;
		}
		const parsingError = thrown as StatementParsingError;
		expect(parsingError).toBeInstanceOf(StatementParsingError);
		expect(parsingError.format).toBe('MT940');
		expect(parsingError.document).toBe(VALID_MT940 + BROKEN_MT940);
		expect(parsingError.cause).toBeInstanceOf(SyntaxError);
		expect(parsingError.message).toContain(parsingError.cause.message);
	});

	it('CAMT: the error carries the one document that failed, not the batch', () => {
		const message = Message.decode(`${ANSWERS}${hicaz(VALID_CAMT)}${hicaz(BROKEN_CAMT)}`);
		const interaction = new StatementInteractionCAMT('1234567890');

		let thrown: unknown;
		try {
			interaction.handleResponse(message, {} as never);
		} catch (error) {
			thrown = error;
		}
		const parsingError = thrown as StatementParsingError;
		expect(parsingError).toBeInstanceOf(StatementParsingError);
		expect(parsingError.format).toBe('CAMT');
		expect(parsingError.document).toBe(BROKEN_CAMT);
		expect(parsingError.cause.message).toMatch(/Invalid CAMT XML structure/);
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

describe('a statement interaction whose order the bank refused', () => {
	// `handleResponse` runs only when the order went through. The response then has
	// no `statements` at all — the type says so, and this pins it down: it is NOT an
	// empty list, which would read as "no transactions in this period".
	it('answers without a statements field, not with an empty list', () => {
		const refused = Message.decode("HIRMG:3:2+9010::Auftrag abgelehnt.'");

		const mt940 = new StatementInteractionMT940('1234567890').handleClientResponse(refused);
		expect(mt940.success).toBe(false);
		expect('statements' in mt940).toBe(false);

		const camt = new StatementInteractionCAMT('1234567890').handleClientResponse(refused);
		expect(camt.success).toBe(false);
		expect('statements' in camt).toBe(false);
	});
});
