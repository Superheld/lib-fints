export interface Statement {
	transactionReference?: string;
	relatedReference?: string;
	account?: string;
	number?: string;
	/**
	 * Absent when the bank did not state one. MT940 always does; a CAMT intraday
	 * report (camt.052) need not, and this library no longer makes one up — it used
	 * to put a zero here, which a caller reconciling balances took for a difference.
	 */
	openingBalance?: Balance;
	transactions: Transaction[];
	/** Absent when the bank did not state one; see {@link openingBalance}. */
	closingBalance?: Balance;
	availableBalance?: Balance;
	forwardBalances?: Balance[];
}

export interface Transaction {
	valueDate: Date;
	entryDate: Date;
	fundsCode: string;
	amount: number;
	transactionType: string;
	customerReference: string;
	bankReference: string;
	transactionCode?: string;
	bookingText?: string;
	primeNotesNr?: string;
	purpose?: string;
	remoteBankId?: string;
	remoteAccountNumber?: string;
	remoteName?: string;
	remoteIdentifier?: string;
	client?: string;
	e2eReference?: string;
	mandateReference?: string;
	textKeyExtension?: string;
	additionalInformation?: string;

	/**
	 * IBAN of the remote account, when the bank states it as such.
	 *
	 * Kept apart from {@link remoteAccountNumber}, which carries whatever the format
	 * offers: an IBAN in CAMT, but the legacy account number in MT940 (subfield ?31).
	 * A caller that wants an IBAN and reads `remoteAccountNumber` gets one of the two
	 * depending on how the statement was fetched — and no error either way.
	 */
	remoteIban?: string;

	/**
	 * SEPA purpose code, e.g. `SALA` (salary), `RENT`, `LOAN`. CAMT only (`Purp.Cd`).
	 *
	 * A classification the bank already made. Without it, the same information has to be
	 * guessed from the remittance text.
	 */
	purposeCode?: string;

	/**
	 * The party the payment is ultimately for, when it differs from the direct one.
	 * CAMT only (`UltmtCdtr` / `UltmtDbtr`).
	 *
	 * Set where a payment service provider sits in between: the direct counterparty is
	 * the provider, this is the merchant behind it.
	 */
	ultimateParty?: string;
}

export interface Balance {
	date: Date;
	currency: string;
	value: number;
}
