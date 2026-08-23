import { describe, expect, it } from 'vitest';
import { Mt940Parser } from '../mt940parser.js';

describe('parse', () => {
	it('parses a MT940 input string', () => {
		const input =
			':20:1234567\r\n' +
			':21:9876543210\r\n' +
			':25:10020030/1234567\r\n' +
			':28C:5/1\r\n' +
			':60F:C021101EUR2187,95\r\n' +
			':61:0211011102DR800,NSTONONREF//55555\r\n' +
			':86:008?00DAUERAUFTRAG?100599?20Miete Nov\r\n' +
			'ember?3010020030?31234567\r\n' +
			'?32MUELLER?3433\r\n' +
			'9\r\n' +
			':61:0211021102CR3000,NTRFNONREF//55555\r\n' +
			'Additional Information\r\n' +
			':86:051?00UEBERWEISUNG?100599?20EREF+53XA\r\n' +
			'QC7FDN1K2FO1\r\n' +
			'?21SVWZ+Gehalt?22CRED+Arbeitgeber?3050060400?31084\r\n' +
			'7564700?32MUELLER?34339\r\n' +
			':62F:C021131EUR4387,95\r\n';

		const parser = new Mt940Parser(input);
		const statements = parser.parse();
		const statement = statements[0];

		expect(statement.transactionReference).toBe('1234567');
		expect(statement.relatedReference).toBe('9876543210');
		expect(statement.account).toBe('10020030/1234567');
		expect(statement.number).toBe('5/1');
		expect(statement.openingBalance?.date).toEqual(new Date('2002-11-01T00:00'));
		expect(statement.openingBalance?.currency).toBe('EUR');
		expect(statement.openingBalance?.value).toBe(2187.95);
		expect(statement.closingBalance?.date).toEqual(new Date('2002-11-31T00:00'));
		expect(statement.closingBalance?.currency).toBe('EUR');
		expect(statement.closingBalance?.value).toBe(4387.95);
		expect(statement.transactions).toHaveLength(2);
		expect(statement.transactions[0].valueDate).toEqual(new Date('2002-11-01T00:00'));
		expect(statement.transactions[0].entryDate).toEqual(new Date('2002-11-02T00:00'));
		expect(statement.transactions[0].fundsCode).toBe('R');
		expect(statement.transactions[0].amount).toBe(-800);
		expect(statement.transactions[0].transactionType).toBe('NSTO');
		expect(statement.transactions[0].customerReference).toBe('NONREF');
		expect(statement.transactions[0].bankReference).toBe('55555');
		expect(statement.transactions[0].transactionCode).toBe('008');
		expect(statement.transactions[0].bookingText).toBe('DAUERAUFTRAG');
		expect(statement.transactions[0].primeNotesNr).toBe('0599');
		expect(statement.transactions[0].purpose).toBe('Miete November');
		expect(statement.transactions[0].remoteBankId).toBe('10020030');
		expect(statement.transactions[0].remoteAccountNumber).toBe('234567');
		expect(statement.transactions[0].remoteName).toBe('MUELLER');
		expect(statement.transactions[0].textKeyExtension).toBe('339');

		expect(statement.transactions[1].purpose).toBe('Gehalt');
		expect(statement.transactions[1].e2eReference).toBe('53XAQC7FDN1K2FO1');
		expect(statement.transactions[1].remoteIdentifier).toBe('Arbeitgeber');
		expect(statement.transactions[1].additionalInformation).toBe('Additional Information');
	});
});

describe('entry date year', () => {
	/**
	 * The entry date in field :61: carries only MMDD. Its year is derived from the value
	 * date, and the two can straddle a month or year boundary in either direction.
	 */
	function entryDateOf(valueDate: string, entryDate: string): Date {
		const input =
			':20:1234567\r\n' +
			':25:10020030/1234567\r\n' +
			':28C:5/1\r\n' +
			`:61:${valueDate}${entryDate}DR600,NTRFNONREF//55555\r\n` +
			':86:020?00UEBERWEISUNG?20Transfer\r\n';

		const statements = new Mt940Parser(input).parse();
		return statements[0].transactions[0].entryDate;
	}

	it('keeps the value date year when both fall in the same month', () => {
		expect(entryDateOf('250930', '0930')).toEqual(new Date('2025-09-30T00:00'));
	});

	it('keeps the value date year when the entry follows a backdated value date', () => {
		// A transfer settled on the last day of September and posted on the first of
		// October. Comparing the months alone would push this back a full year.
		expect(entryDateOf('250930', '1001')).toEqual(new Date('2025-10-01T00:00'));
	});

	it('takes the previous year when the entry precedes a value date in January', () => {
		expect(entryDateOf('260102', '1230')).toEqual(new Date('2025-12-30T00:00'));
	});

	it('takes the next year when the entry follows a value date in December', () => {
		expect(entryDateOf('251230', '0102')).toEqual(new Date('2026-01-02T00:00'));
	});

	it('falls back to the value date when no entry date is given', () => {
		expect(entryDateOf('250930', '')).toEqual(new Date('2025-09-30T00:00'));
	});
});

describe('remote IBAN (subfield ?38)', () => {
	/**
	 * Without ?38, MT940 only ever offers ?30/?31 — bank code and legacy account number —
	 * while CAMT states the IBAN outright. The same booking then looks different depending
	 * on how the statement was fetched, and nothing about it reads as an error.
	 */
	it('reads the remote IBAN when the bank states it', () => {
		const input =
			':20:1234567\r\n' +
			':25:10020030/1234567\r\n' +
			':28C:5/1\r\n' +
			':60F:C021101EUR2187,95\r\n' +
			':61:0211011102DR800,NSTONONREF//55555\r\n' +
			':86:008?00DAUERAUFTRAG?20Miete?3010020030?31234567\r\n' +
			'?32MUELLER?38DE02100100100006820101\r\n' +
			':62F:C021131EUR1387,95\r\n';

		const transaction = new Mt940Parser(input).parse()[0].transactions[0];

		expect(transaction.remoteIban).toBe('DE02100100100006820101');
		// The legacy fields stay where they were — the IBAN is stated ALONGSIDE them, not
		// instead of them, and a caller may well want either.
		expect(transaction.remoteBankId).toBe('10020030');
		expect(transaction.remoteAccountNumber).toBe('234567');
	});

	it('leaves the IBAN unset when the bank omits the subfield', () => {
		const input =
			':20:1234567\r\n' +
			':25:10020030/1234567\r\n' +
			':28C:5/1\r\n' +
			':60F:C021101EUR2187,95\r\n' +
			':61:0211011102DR800,NSTONONREF//55555\r\n' +
			':86:008?00DAUERAUFTRAG?20Miete?3010020030?31234567?32MUELLER\r\n' +
			':62F:C021131EUR1387,95\r\n';

		const transaction = new Mt940Parser(input).parse()[0].transactions[0];

		expect(transaction.remoteIban).toBeUndefined();
		expect(transaction.remoteBankId).toBe('10020030');
	});
});
