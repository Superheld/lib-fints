import { describe, expect, it } from 'vitest';
import { Dat } from '../dataElements/Dat.js';
import { BankIdentification } from '../dataGroups/BankIdentification.js';

describe('BankIdentification', () => {
	it('encodes correctly', () => {
		const id = new BankIdentification('bank', 1, 1);
		expect(id.encode({ country: 280, bankId: '12030000' }, [], 1)).toBe('280:12030000');
	});
});

describe('Dat', () => {
	// A FinTS date is a calendar day. The Date standing for it has to name that day
	// whichever way it is looked at — local getters, UTC getters, `JSON.stringify`.
	const dat = new Dat('date');

	it('decodes to noon local time, so the day survives serialisation to UTC', () => {
		const date = dat.decode('20260819');
		expect(date.getFullYear()).toBe(2026);
		expect(date.getMonth()).toBe(7);
		expect(date.getDate()).toBe(19);
		expect(date.getHours()).toBe(12);
		expect(JSON.stringify(date)).toContain('2026-08-19');
	});

	it('encodes the local calendar day, not the UTC one', () => {
		// Local midnight: east of Greenwich this is the day before in UTC.
		expect(dat.encode(new Date(2026, 7, 19))).toBe('20260819');
		expect(dat.encode(new Date(2026, 7, 19, 23, 59))).toBe('20260819');
		expect(dat.encode(new Date(2026, 0, 5, 12))).toBe('20260105');
	});

	it('round-trips', () => {
		expect(dat.encode(dat.decode('20251231'))).toBe('20251231');
	});
});
