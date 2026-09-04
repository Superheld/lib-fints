import type { HICAZSParameter } from './segments/HICAZS.js';
import type { HIKAZSParameter } from './segments/HIKAZS.js';
import type { HISPASParameter } from './segments/HISPAS.js';

export type BankTransaction = {
	transId: string;
	tanRequired: boolean;
	versions: number[];
	params?: unknown;
	/**
	 * The parameter segments this client could not decode, as the bank sent them:
	 * every version of a transaction it does not implement, and versions newer than
	 * it knows of one it does. `versions` lists them, this keeps what they said.
	 *
	 * The bank states here what it accepts for a transaction — lead times, allowed
	 * formats, limits. Dropping that left a caller who wanted to know with nothing
	 * but a version number to go on.
	 */
	unparsedParameters?: UnparsedParameterSegment[];
};

export type UnparsedParameterSegment = {
	version: number;
	/** The segment body after its header, FinTS syntax as received. */
	data: string;
};

export type SepaBankTransaction = BankTransaction & {
	transId: 'HKSPA';
	params: HISPASParameter;
};

export type StatementTransactionMT940 = BankTransaction & {
	transId: 'HKKAZ';
	params: HIKAZSParameter;
};

export type StatementTransactionCAMT = BankTransaction & {
	transId: 'HKCAZ';
	params: HICAZSParameter;
};
