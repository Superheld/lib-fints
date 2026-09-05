import { describe, expect, it } from 'vitest';
import type { StatementResponse } from '../interactions/customerInteraction.js';
import { StatementInteractionCAMT } from '../interactions/statementInteractionCAMT.js';
import { StatementInteractionMT940 } from '../interactions/statementInteractionMT940.js';
import { Message } from '../message.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

// `getAccountStatements` falls back to MT940 when an account has no CAMT, and the two
// formats fill `transactionCode` and `bookingText` from different vocabularies. The
// response names the format it was parsed from, and carries the text it was parsed
// from — a field left empty by the parser can otherwise not be told from one the
// bank never sent.

const ANSWERS = "HIRMG:3:2+0010::Entgegengenommen.+0020::Abfrage erfolgreich.'";
const CAMT_DESCRIPTOR = 'urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.08';

const mt940 = (reference: string, amount: string) =>
	`:20:${reference}\r\n:25:10020030/1234567\r\n:28C:1\r\n:60F:C260801EUR1000,00\r\n` +
	`:61:2608010801D${amount}NMSCNONREF\r\n:62F:C260801EUR900,00\r\n`;

const camt = (id: string, amount: string, declaration = '<?xml version="1.0"?>', name = '') =>
	`${declaration}<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08">` +
	`<BkToCstmrAcctRpt><Rpt><Id>${id}</Id><Acct><Id><IBAN>DE991234567123456</IBAN></Id></Acct>` +
	`<Ntry><Amt>${amount}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>` +
	`<ValDt><Dt>2026-08-01</Dt></ValDt>${name ? `<AddtlNtryInf>${name}</AddtlNtryInf>` : ''}` +
	`</Ntry></Rpt></BkToCstmrAcctRpt></Document>`;

const binary = (text: string) => `@${text.length}@${text}`;
const hicaz = (...fields: string[]) =>
	`HICAZ:5:1+DE991234567123456:BANK12+${CAMT_DESCRIPTOR}+${fields.join('+')}'`;

function respond(interaction: StatementInteractionMT940 | StatementInteractionCAMT, text: string) {
	const clientResponse = {} as StatementResponse;
	interaction.handleResponse(Message.decode(`${ANSWERS}${text}`), clientResponse);
	return clientResponse;
}

describe('the format of the statements', () => {
	it('is MT940 for HIKAZ', () => {
		const response = respond(
			new StatementInteractionMT940('1234567'),
			`HIKAZ:5:7+${binary(mt940('BOOKED', '100,'))}'`,
		);
		expect(response.format).toBe('MT940');
	});

	it('is CAMT for HICAZ', () => {
		const response = respond(
			new StatementInteractionCAMT('1234567'),
			hicaz(binary(camt('B', '100.00'))),
		);
		expect(response.format).toBe('CAMT');
	});
});

describe('the raw statements', () => {
	it('MT940: are the one stream the statements were parsed from', () => {
		const booked = mt940('BOOKED', '100,');
		const noted = mt940('NOTED', '25,');
		const response = respond(
			new StatementInteractionMT940('1234567'),
			`HIKAZ:5:7+${binary(booked)}+${binary(noted)}'`,
		);
		expect(response.rawStatements).toEqual([booked]);
		expect(response.rawNotedStatements).toEqual([noted]);
	});

	it('MT940: join the portions of a parted response the way the parser saw them', () => {
		const first = mt940('FIRST', '100,');
		const second = mt940('SECOND', '200,');
		const response = respond(
			new StatementInteractionMT940('1234567'),
			`HIKAZ:5:7+${binary(first)}'HIKAZ:6:7+${binary(second)}'`,
		);
		expect(response.rawStatements).toEqual([first + second]);
		expect(response.statements?.map((s) => s.transactionReference)).toEqual(['FIRST', 'SECOND']);
	});

	it('CAMT: list the documents, one per booking day, across the portions of a response', () => {
		const one = camt('ONE', '100.00');
		const two = camt('TWO', '200.00');
		const three = camt('THREE', '300.00');
		const response = respond(
			new StatementInteractionCAMT('1234567'),
			`${hicaz(`${binary(one)}:${binary(two)}`)}${hicaz(binary(three))}`,
		);
		expect(response.rawStatements).toEqual([one, two, three]);
		expect(response.statements?.map((s) => s.number)).toEqual(['ONE', 'TWO', 'THREE']);
	});

	it('CAMT: are readable text, not the latin1 bytes of the message', () => {
		// The message is decoded as latin1, so a UTF-8 document arrives with every
		// umlaut as two characters. The parser gets the readable text; so does the caller.
		const document = camt('B', '100.00', '<?xml version="1.0" encoding="UTF-8"?>', 'Müller');
		const asTransmitted = Buffer.from(document, 'utf8').toString('latin1');
		const response = respond(new StatementInteractionCAMT('1234567'), hicaz(binary(asTransmitted)));
		expect(response.rawStatements).toEqual([document]);
		expect(response.statements?.[0].transactions[0].bookingText).toBe('Müller');
	});

	it('are absent for noted transactions the bank did not send', () => {
		const response = respond(
			new StatementInteractionCAMT('1234567'),
			hicaz(binary(camt('B', '100.00'))),
		);
		expect(response.rawNotedStatements).toBeUndefined();
	});

	it('CAMT: are kept for a noted document that could not be parsed', () => {
		const broken = camt('N', '25.00').replace('<Amt>25.00</Amt>', '');
		const response = respond(
			new StatementInteractionCAMT('1234567'),
			hicaz(binary(camt('B', '100.00')), binary(broken)),
		);
		expect(response.notedStatementsError).toBeDefined();
		expect(response.rawNotedStatements).toEqual([broken]);
	});

	it('MT940: are kept for noted transactions that could not be parsed', () => {
		const broken = mt940('NOTED', '25');
		const response = respond(
			new StatementInteractionMT940('1234567'),
			`HIKAZ:5:7+${binary(mt940('BOOKED', '100,'))}+${binary(broken)}'`,
		);
		expect(response.notedStatementsError).toBeDefined();
		expect(response.rawNotedStatements).toEqual([broken]);
	});
});
