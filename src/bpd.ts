import type { BankTransaction } from './bankTransaction.js';
import type { Language, Service } from './codes.js';
import type { TanMethod } from './tanMethod.js';

export type BPD = {
	version: number;
	countryCode: number;
	bankId: string;
	bankName: string;
	maxTransactionsPerMessage: number;
	supportedLanguages: Language[];
	supportedHbciVersions: number[];
	url?: string;
	supportedTanMethods: TanMethod[];
	availableTanMethodIds: number[];
	allowedTransactions: BankTransaction[];
	/** The largest message the bank accepts, in KB (HIBPA). Absent when the bank did not say. */
	maxMessageSizeInKb?: number;
	/** The language the bank speaks by default (HIKOM). */
	defaultLanguage?: Language;
	/** How the bank is reached (HIKOM); HTTPS for PIN/TAN. */
	communicationService?: Service;
	/** What the bank says about PINs, TANs and the names of its login fields (HIPINS). */
	pinTan?: PinTanParameters;
};

/**
 * From HIPINS. The lengths are for checking input before it goes to the bank; the
 * labels are what the bank calls its user and customer ids, for a login form that
 * wants to use the bank's words — "Anmeldename", "Legitimations-ID", and so on.
 * Every field is optional in the segment.
 */
export type PinTanParameters = {
	minPinLength?: number;
	maxPinLength?: number;
	maxTanLength?: number;
	userIdLabel?: string;
	customerIdLabel?: string;
};
