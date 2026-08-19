import { describe, expect, it } from 'vitest';
import { decode, encode } from '../segment.js';
import type { HKWPDSegment } from '../segments/HIWPDS.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

describe('HIWPDS — the parameters for a portfolio request', () => {
	it('reads the three flags that govern getPortfolio’s three optional arguments', () => {
		// The example from FinTS 3.0 Formals, G.2.2: entries yes, currency no, quality yes.
		const text = "HIWPDS:31:6:5+1+2+1+J:N:J'";
		const segment = decode(text) as HKWPDSegment;

		expect(segment.params.entryCountAllowed).toBe(true);
		expect(segment.params.currencySelectable).toBe(false);
		expect(segment.params.priceQualitySelectable).toBe(true);
		expect(encode(segment)).toBe(text);
	});

	it('reads a version 5 segment, which is what banks are still answering with', () => {
		// The security class element only exists from version 6, and the current
		// specification no longer publishes version 5's field list. A bank tested here
		// announces HKWPD 5, so this is the shape that has to work.
		const segment = decode("HIWPDS:31:5:5+1+2+J:N:J'") as HKWPDSegment;

		expect(segment.securityClass).toBeUndefined();
		expect(segment.params.entryCountAllowed).toBe(true);
		expect(segment.params.priceQualitySelectable).toBe(true);
	});

	it('survives a bank that fills none of the flags', () => {
		const segment = decode("HIWPDS:31:5:5+1+2+::'") as HKWPDSegment;
		expect(segment.params?.entryCountAllowed).toBeUndefined();
	});
});
