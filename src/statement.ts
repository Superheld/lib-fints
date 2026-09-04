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

	/**
	 * Whether the bank has booked the entry: `BOOK`, or `PDNG` for one it has only
	 * noted so far, `INFO` for one it will not book. CAMT only (`Sts`). Entries in
	 * `notedStatements` are pending by definition; this says so on the entry itself.
	 */
	status?: string;

	/** Whether the entry reverses an earlier one. CAMT only (`RvslInd`). */
	isReversal?: boolean;

	/**
	 * The charges the bank took for the entry, where it states them separately.
	 * CAMT only (`Chrgs`).
	 */
	charges?: Money;

	/**
	 * The amount as instructed, before conversion — the foreign-currency amount of
	 * an entry booked in the account's currency. CAMT only (`AmtDtls.InstdAmt`).
	 */
	originalAmount?: Money;

	/** The exchange rate applied to {@link originalAmount}. CAMT only (`CcyXchg.XchgRate`). */
	exchangeRate?: number;

	/**
	 * Why a payment came back — the reason code (`AC04`, `MD01`, …) and the text the
	 * bank added. Set on a returned direct debit or transfer. CAMT only (`RtrInf`).
	 */
	returnReason?: {
		code?: string;
		text?: string;
	};

	/**
	 * For an entry that books several payments at once: the batch they came in, and
	 * how many. CAMT only (`NtryDtls.Btch`).
	 */
	batch?: {
		messageId?: string;
		paymentInformationId?: string;
		numberOfTransactions?: number;
	};
}

export interface Money {
	value: number;
	currency: string;
}

export interface Balance {
	date: Date;
	currency: string;
	value: number;
}
