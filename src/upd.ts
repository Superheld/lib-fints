import type { BankAccount } from './bankAccount.js';
import type { UpdUsage } from './codes.js';

export type UPD = {
	version: number;
	usage: UpdUsage;
	bankAccounts: BankAccount[];
	/** The id under which the bank keeps this user (HIUPA). */
	internalUserId?: string;
	/** The user's name as the bank has it (HIUPA), where the bank sends one. */
	userName?: string;
};
