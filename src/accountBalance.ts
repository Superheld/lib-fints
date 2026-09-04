export type AccountBalance = {
	date: Date;
	currency: string;
	balance: number;
	notedBalance?: number;
	creditLimit?: number;
	availableAmount?: number;
	/** The bank's name for the account product, "Girokonto" say (HISAL). */
	product?: string;
	/**
	 * The account the balance is for, as the bank names it in the response. Lets a
	 * caller check that the answer is for the account it asked about.
	 */
	account?: {
		iban?: string;
		accountNumber?: string;
		subAccountId?: string;
	};
};
