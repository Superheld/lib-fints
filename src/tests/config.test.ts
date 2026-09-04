import { describe, expect, it } from 'vitest';
import type { BankingInformation } from '../bankingInformation.js';
import { FinTSConfig } from '../config.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

function configWithVersions(transId: string, versions: number[]): FinTSConfig {
	const bankingInformation: BankingInformation = {
		systemId: 'X',
		bankMessages: [],
		bpd: {
			version: 1,
			bankId: '12030000',
			bankName: 'Mock',
			countryCode: 280,
			url: 'https://mock.bank.url',
			allowedTransactions: [{ transId, tanRequired: false, versions }],
			supportedTanMethods: [],
			availableTanMethodIds: [],
			maxTransactionsPerMessage: 1,
			supportedLanguages: [],
			supportedHbciVersions: [300],
		},
	};
	return FinTSConfig.fromBankingInformation('PRODUCT', '1.0', bankingInformation);
}

describe('getMaxSupportedTransactionVersion', () => {
	// HKSAL is supported up to version 8 here.

	it('picks the highest version both sides support', () => {
		expect(configWithVersions('HKSAL', [5, 6, 7]).getMaxSupportedTransactionVersion('HKSAL')).toBe(
			7,
		);
		expect(configWithVersions('HKSAL', [7, 8, 9]).getMaxSupportedTransactionVersion('HKSAL')).toBe(
			8,
		);
	});

	it('compares versions as numbers, not as strings', () => {
		// As strings "10" sorts before "7", and the last version below 8 was then 7.
		expect(configWithVersions('HKSAL', [7, 10]).getMaxSupportedTransactionVersion('HKSAL')).toBe(7);
		expect(configWithVersions('HKSAL', [10, 8]).getMaxSupportedTransactionVersion('HKSAL')).toBe(8);
	});

	it('does not reorder the versions in the BPD', () => {
		const config = configWithVersions('HKSAL', [7, 5, 6]);
		config.getMaxSupportedTransactionVersion('HKSAL');
		expect(config.bankingInformation.bpd?.allowedTransactions[0].versions).toEqual([7, 5, 6]);
	});

	it('is undefined when the bank offers only versions this client does not know', () => {
		expect(
			configWithVersions('HKSAL', [9, 10]).getMaxSupportedTransactionVersion('HKSAL'),
		).toBeUndefined();
	});
});
