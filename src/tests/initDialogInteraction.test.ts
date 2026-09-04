import { describe, expect, it } from 'vitest';
import type { BankTransaction } from '../bankTransaction.js';
import { FinTSConfig } from '../config.js';
import { InitDialogInteraction, type InitResponse } from '../interactions/initDialogInteraction.js';
import { Message } from '../message.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

// What the init dialog makes of the BPD the bank sends: which parameter segments end
// up where in `bpd.allowedTransactions`.

const HIBPA = "HIBPA:4:3:3+12+280:12030000+Mock Bank+3+1+300'";
const HIPINS = "HIPINS:5:1:4+1+1+0+5:38:6:USERID:CUSTID:HKKAZ:N:HKCDE:J'";
// HIKAZS in two versions the bank offers side by side. Version 5 has no security
// class yet; the parameters differ in the number of days.
const HIKAZS_V5 = "HIKAZS:6:5:4+20+1+90:J:N'";
const HIKAZS_V7 = "HIKAZS:7:7:4+20+1+1+180:J:N'";

function init(...segments: string[]): BankTransaction[] {
	const config = FinTSConfig.forFirstTimeUse('PRODUCT', '1.0', 'https://mock', '12030000');
	const interaction = new InitDialogInteraction(config);
	const response: InitResponse = {
		dialogId: '1',
		success: true,
		bankingInformationUpdated: false,
		bankAnswers: [],
		requiresTan: false,
	};
	interaction.handleResponse(Message.decode(segments.join('')), response);
	return config.bankingInformation.bpd?.allowedTransactions ?? [];
}

const hkkaz = (transactions: BankTransaction[]) =>
	transactions.find((t) => t.transId === 'HKKAZ') as BankTransaction;

describe('the parameters of a transaction the bank offers in several versions', () => {
	it('are those of the highest version, whichever order the bank sent them in', () => {
		const inOrder = hkkaz(init(HIBPA, HIPINS, HIKAZS_V5, HIKAZS_V7));
		expect(inOrder.versions).toEqual([5, 7]);
		expect(inOrder.params).toMatchObject({ maxDays: 180, allAccountsAllowed: false });

		const reversed = hkkaz(init(HIBPA, HIPINS, HIKAZS_V7, HIKAZS_V5));
		expect(reversed.versions).toEqual([7, 5]);
		expect(reversed.params).toMatchObject({ maxDays: 180, allAccountsAllowed: false });
	});

	it('are those of the highest version this client knows when the bank offers a newer one', () => {
		// HIKAZS version 9 does not exist in this client; the segment decodes as unknown.
		const withNewer = hkkaz(init(HIBPA, HIPINS, HIKAZS_V7, "HIKAZS:8:9:4+20+1+1+360:J:N:X'"));
		expect(withNewer.versions).toEqual([7, 9]);
		expect(withNewer.params).toMatchObject({ maxDays: 180 });
	});
});
