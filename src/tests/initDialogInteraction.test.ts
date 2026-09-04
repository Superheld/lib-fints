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

describe('the parameter segments this client cannot decode', () => {
	// The bank names the transaction in HIPINS and sends its parameters alongside.
	// A transaction this client does not implement still has its parameters — the
	// caller may be able to use them, and can at least see what the bank offers.
	it('are kept as the bank sent them, one per version', () => {
		const transactions = init(
			HIBPA,
			HIPINS,
			"HICDES:9:1:4+1+1+1+2:14:30:J:J:urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.008.001.02'",
		);
		const hkcde = transactions.find((t) => t.transId === 'HKCDE') as BankTransaction;

		expect(hkcde.versions).toEqual([1]);
		expect(hkcde.params).toBeUndefined();
		expect(hkcde.unparsedParameters).toEqual([
			{
				version: 1,
				data: '1+1+1+2:14:30:J:J:urn?:iso?:std?:iso?:20022?:tech?:xsd?:pain.008.001.02',
			},
		]);
	});

	it('is not set for a transaction whose parameters were decoded', () => {
		const transaction = hkkaz(init(HIBPA, HIPINS, HIKAZS_V7));
		expect(transaction.params).toBeDefined();
		expect(transaction.unparsedParameters).toBeUndefined();
	});
});

describe('what the init dialog passes on from the BPD and UPD segments', () => {
	// Every field here was decoded by its segment and read by nobody.
	const HIBPA_FULL = "HIBPA:4:3:3+12+280:12030000+Mock Bank+3+1+300+1200+60+600'";
	const HIKOM = "HIKOM:5:4:3+280:12030000+1+3:https?://mock.bank.url::MIM:1'";
	const HIPINS_FULL = "HIPINS:6:1:4+1+1+0+5:38:6:Anmeldename:Legitimations-ID:HKKAZ:N:HKSAL:N'";
	const HITANS =
		"HITANS:7:6:4+1+1+1+J:N:0:910:2:HHD1.3.0:::chipTAN manuell:6:1:TAN-Nummer:3:J:2:N:0:0:N:N:00:0:N:1'";
	const HIUPA = "HIUPA:8:4:4+1197651234+0+0+Erika Muster'";

	function bankingInformation(...segments: string[]) {
		const config = FinTSConfig.forFirstTimeUse('PRODUCT', '1.0', 'https://mock', '12030000');
		const response: InitResponse = {
			dialogId: '1',
			success: true,
			bankingInformationUpdated: false,
			bankAnswers: [],
			requiresTan: false,
		};
		new InitDialogInteraction(config).handleResponse(Message.decode(segments.join('')), response);
		return config.bankingInformation;
	}

	it('the message size limit, default language and communication service', () => {
		const { bpd } = bankingInformation(HIBPA_FULL, HIKOM, HIPINS_FULL);
		expect(bpd?.maxMessageSizeInKb).toBe(1200);
		expect(bpd?.defaultLanguage).toBe(1);
		expect(bpd?.communicationService).toBe(3);
	});

	it('the PIN/TAN lengths and the labels of the login fields', () => {
		const { bpd } = bankingInformation(HIBPA_FULL, HIPINS_FULL);
		expect(bpd?.pinTan).toEqual({
			minPinLength: 5,
			maxPinLength: 38,
			maxTanLength: 6,
			userIdLabel: 'Anmeldename',
			customerIdLabel: 'Legitimations-ID',
		});
	});

	it('no pinTan when HIPINS states nothing beyond the transactions', () => {
		const { bpd } = bankingInformation(HIBPA, "HIPINS:6:1:4+1+1+0+:::::HKKAZ:N'");
		expect(bpd?.pinTan).toBeUndefined();
	});

	it('what HITANS says for all its methods', () => {
		const { bpd } = bankingInformation(HIBPA_FULL, HIPINS_FULL, HITANS);
		const [method] = bpd?.supportedTanMethods ?? [];
		expect(method.id).toBe(910);
		expect(method.oneStepAllowed).toBe(true);
		expect(method.multipleOrdersAllowed).toBe(false);
		expect(method.hashMethod).toBe(0);
	});

	it('the internal user id and the user name', () => {
		const { upd } = bankingInformation(HIBPA_FULL, HIPINS_FULL, HIUPA);
		expect(upd?.internalUserId).toBe('1197651234');
		expect(upd?.userName).toBe('Erika Muster');
	});
});
