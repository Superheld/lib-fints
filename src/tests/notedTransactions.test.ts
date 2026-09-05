import { describe, expect, it } from 'vitest';
import type { StatementResponse } from '../interactions/customerInteraction.js';
import { StatementInteractionCAMT } from '../interactions/statementInteractionCAMT.js';
import { StatementInteractionMT940 } from '../interactions/statementInteractionMT940.js';
import { Message } from '../message.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

// HIKAZ and HICAZ carry a second field next to the booked transactions: the ones the
// bank has noted but not booked yet. It was decoded and never read.

const ANSWERS = "HIRMG:3:2+0010::Entgegengenommen.+0020::Abfrage erfolgreich.'";
const CAMT_DESCRIPTOR = 'urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.08';

const mt940 = (reference: string, amount: string) =>
	`:20:${reference}\r\n:25:10020030/1234567\r\n:28C:1\r\n:60F:C260801EUR1000,00\r\n` +
	`:61:2608010801D${amount}NMSCNONREF\r\n:62F:C260801EUR900,00\r\n`;

const camt = (id: string, status: string, amount: string) =>
	`<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08">` +
	`<BkToCstmrAcctRpt><Rpt><Id>${id}</Id><Acct><Id><IBAN>DE991234567123456</IBAN></Id></Acct>` +
	`<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">900.00</Amt>` +
	`<CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-08-01</Dt></Dt></Bal>` +
	`<Ntry><Amt>${amount}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>${status}</Sts>` +
	`<ValDt><Dt>2026-08-01</Dt></ValDt></Ntry></Rpt></BkToCstmrAcctRpt></Document>`;

const binary = (text: string) => `@${text.length}@${text}`;

function respond(interaction: StatementInteractionMT940 | StatementInteractionCAMT, text: string) {
	const clientResponse = {} as StatementResponse;
	interaction.handleResponse(Message.decode(`${ANSWERS}${text}`), clientResponse);
	return clientResponse;
}

describe('noted transactions', () => {
	it('MT940: are parsed from the second field of HIKAZ, apart from the booked ones', () => {
		const response = respond(
			new StatementInteractionMT940('1234567'),
			`HIKAZ:5:7+${binary(mt940('BOOKED', '100,'))}+${binary(mt940('NOTED', '25,'))}'`,
		);

		expect(response.statements?.map((s) => s.transactionReference)).toEqual(['BOOKED']);
		expect(response.notedStatements?.map((s) => s.transactionReference)).toEqual(['NOTED']);
		expect(response.notedStatements?.[0].transactions[0].amount).toBe(-25);
	});

	it('MT940: are absent when the bank sent none', () => {
		const response = respond(
			new StatementInteractionMT940('1234567'),
			`HIKAZ:5:7+${binary(mt940('BOOKED', '100,'))}'`,
		);
		expect(response.statements).toHaveLength(1);
		expect(response.notedStatements).toBeUndefined();
	});

	it('CAMT: are parsed from the second field of HICAZ, apart from the booked ones', () => {
		const response = respond(
			new StatementInteractionCAMT('1234567'),
			`HICAZ:5:1+DE991234567123456:BANK12+${CAMT_DESCRIPTOR}+${binary(camt('B', 'BOOK', '100.00'))}+${binary(camt('N', 'PDNG', '25.00'))}'`,
		);

		expect(response.statements?.map((s) => s.number)).toEqual(['B']);
		expect(response.notedStatements?.map((s) => s.number)).toEqual(['N']);
		expect(response.notedStatements?.[0].transactions[0].amount).toBe(-25);
	});

	it('CAMT: are absent when the bank sent none', () => {
		const response = respond(
			new StatementInteractionCAMT('1234567'),
			`HICAZ:5:1+DE991234567123456:BANK12+${CAMT_DESCRIPTOR}+${binary(camt('B', 'BOOK', '100.00'))}'`,
		);
		expect(response.statements).toHaveLength(1);
		expect(response.notedStatements).toBeUndefined();
	});
});

describe('a noted document that cannot be parsed', () => {
	// The booked statements had been parsed a moment before; the failure of the noted
	// document must not take them with it. (The case that first showed this — a
	// pending entry without any date — parses now; here an entry without an amount.)
	const broken = camt('N', 'PDNG', '25.00').replace('<Amt>25.00</Amt>', '');

	it('CAMT: keeps the booked statements and reports the failure', () => {
		const response = respond(
			new StatementInteractionCAMT('1234567'),
			`HICAZ:5:1+DE991234567123456:BANK12+${CAMT_DESCRIPTOR}+${binary(camt('B', 'BOOK', '100.00'))}+${binary(broken)}'`,
		);

		expect(response.statements?.map((s) => s.number)).toEqual(['B']);
		expect(response.notedStatements).toBeUndefined();
		expect(response.notedStatementsError?.message).toMatch(/has no amount/);
	});

	it('MT940: keeps the booked statements and reports the failure', () => {
		const response = respond(
			new StatementInteractionMT940('1234567'),
			`HIKAZ:5:7+${binary(mt940('BOOKED', '100,'))}+${binary(mt940('NOTED', '25'))}'`,
		);

		expect(response.statements?.map((s) => s.transactionReference)).toEqual(['BOOKED']);
		expect(response.notedStatements).toBeUndefined();
		expect(response.notedStatementsError?.message).toMatch(/Expected Decimal/);
	});

	it('a booked document that cannot be parsed still fails the call', () => {
		expect(() =>
			respond(
				new StatementInteractionCAMT('1234567'),
				`HICAZ:5:1+DE991234567123456:BANK12+${CAMT_DESCRIPTOR}+${binary(broken)}'`,
			),
		).toThrow(/has no amount/);
	});
});
