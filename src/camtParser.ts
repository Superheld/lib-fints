import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { Balance, Money, Statement, Transaction } from './statement.js';

// Type definitions for CAMT XML structure
type GenericXMLObject = Record<string, unknown>;

interface XMLDocument {
	[key: string]: unknown;
	Document?: CamtDocument;
	camt?: CamtDocument;
}

interface CamtDocument extends GenericXMLObject {
	BkToCstmrAcctRpt?: {
		Rpt?: CamtReport | CamtReport[];
	};
}

interface CamtReport extends GenericXMLObject {
	Id?: string | { '#text': string };
	ElctrncSeqNb?: string | { '#text': string };
	Acct?: {
		Id?: {
			IBAN?: string | { '#text': string };
		};
	};
	Bal?: CamtBalance | CamtBalance[];
	Ntry?: CamtEntry | CamtEntry[];
}

interface CamtBalance extends GenericXMLObject {
	Tp?: {
		CdOrPrtry?: {
			Cd?: string | { '#text': string };
		};
	};
	Amt?:
		| {
				'@Ccy'?: string;
				'#text'?: string;
		  }
		| string;
	CdtDbtInd?: string | { '#text': string };
	Dt?:
		| {
				Dt?: string | { '#text': string };
		  }
		| string
		| { '#text': string };
}

interface CamtEntry extends GenericXMLObject {
	Amt?:
		| {
				'#text'?: string;
		  }
		| string;
	CdtDbtInd?: string | { '#text': string };
	BookgDt?:
		| {
				Dt?: string | { '#text': string };
		  }
		| string
		| { '#text': string };
	ValDt?:
		| {
				Dt?: string | { '#text': string };
		  }
		| string
		| { '#text': string };
	AcctSvcrRef?: string | { '#text': string };
	AddtlNtryInf?: string | { '#text': string };
	BkTxCd?: CamtBankTransactionCode;
	NtryDtls?: {
		Btch?: GenericXMLObject;
		TxDtls?: CamtTransactionDetails;
	};
}

interface CamtTransactionDetails extends GenericXMLObject {
	Refs?: {
		EndToEndId?: string | { '#text': string };
		MndtId?: string | { '#text': string };
	};
	RmtInf?: {
		Ustrd?: string | { '#text': string };
	};
	RltdPties?: {
		Dbtr?: CamtParty;
		DbtrAcct?: CamtAccount;
		Cdtr?: CamtParty;
		CdtrAcct?: CamtAccount;
	};
	RltdAgts?: {
		DbtrAgt?: {
			FinInstnId?: CamtBankIdentification;
		};
		CdtrAgt?: {
			FinInstnId?: CamtBankIdentification;
		};
	};
	BkTxCd?: CamtBankTransactionCode;
}

interface CamtParty extends GenericXMLObject {
	Nm?: string | { '#text': string };
	Pty?: {
		Nm?: string | { '#text': string };
	};
	Id?: {
		OrgId?: {
			Nm?: string | { '#text': string };
			Othr?: {
				Id?: string | { '#text': string };
			};
		};
		PrvtId?: {
			Nm?: string | { '#text': string };
		};
	};
	PstlAdr?: {
		AdrLine?: string | { '#text': string };
	};
}

interface CamtAccount extends GenericXMLObject {
	Id?: {
		IBAN?: string | { '#text': string };
	};
}

interface CamtBankIdentification extends GenericXMLObject {
	BIC?: string | { '#text': string };
	BICFI?: string | { '#text': string };
	ClrSysMmbId?: {
		MmbId?: string | { '#text': string };
	};
	Othr?: {
		Id?: string | { '#text': string };
	};
}

interface CamtBankTransactionCode extends GenericXMLObject {
	Domn?: {
		Cd?: string | { '#text': string };
		Fmly?: {
			Cd?: string | { '#text': string };
			SubFmlyCd?: string | { '#text': string };
		};
	};
}

export class CamtParsingError extends Error {
	constructor(
		message: string,
		public cause?: Error,
	) {
		super(message);
		this.name = 'CamtParsingError';
	}
}

export class CamtParser {
	private xmlData: string;
	private parser: XMLParser;

	constructor(xmlData: string) {
		this.xmlData = xmlData;
		this.parser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: '@',
			textNodeName: '#text',
			removeNSPrefix: true,
			parseAttributeValue: true,
			trimValues: true,
			parseTagValue: false, // Don't auto-parse values to preserve strings like "00001"
			processEntities: true,
			allowBooleanAttributes: false,
			numberParseOptions: {
				hex: false,
				leadingZeros: true,
				eNotation: true,
			},
		});
	}

	parse(): Statement[] {
		try {
			// Pre-validate XML
			const validationResult = XMLValidator.validate(this.xmlData);
			if (validationResult !== true) {
				throw new CamtParsingError(`Invalid CAMT XML structure: ${validationResult.err.msg}`);
			}

			// Parse XML to JavaScript object
			const document = this.parser.parse(this.xmlData);

			// Navigate to Document/BkToCstmrStmt/Stmt array
			const statements: Statement[] = [];
			const docObj = this.getDocumentObject(document);
			const reports = this.getReports(docObj);

			if (!reports || reports.length === 0) {
				return statements;
			}

			for (let i = 0; i < reports.length; i++) {
				try {
					const statement = this.parseReport(reports[i], i + 1);
					if (statement) {
						statements.push(statement);
					}
				} catch (error) {
					throw new CamtParsingError(
						`Failed to parse CAMT report ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`,
						error instanceof Error ? error : undefined,
					);
				}
			}

			return statements;
		} catch (error) {
			if (error instanceof CamtParsingError) {
				throw error;
			}
			throw new CamtParsingError(
				`Failed to parse CAMT document: ${error instanceof Error ? error.message : 'Unknown error'}`,
				error instanceof Error ? error : undefined,
			);
		}
	}

	private getDocumentObject(document: XMLDocument): CamtDocument {
		// Handle different possible XML root structures
		if (document.Document) {
			return document.Document;
		}
		if (document.camt) {
			return document.camt;
		}
		// Look for any object with BkToCstmrAcctRpt property
		for (const key in document) {
			if (
				document[key] &&
				typeof document[key] === 'object' &&
				(document[key] as CamtDocument)?.BkToCstmrAcctRpt
			) {
				return document[key] as CamtDocument;
			}
		}
		throw new CamtParsingError('No valid CAMT document structure found');
	}

	private getReports(docObj: CamtDocument): CamtReport[] {
		const bkToCstmrAcctRpt = docObj.BkToCstmrAcctRpt;
		if (!bkToCstmrAcctRpt) {
			throw new CamtParsingError('No BkToCstmrAcctRpt element found in CAMT document');
		}

		const rpt = bkToCstmrAcctRpt.Rpt;
		if (!rpt) {
			return [];
		}

		// Handle both single report and array of reports
		return Array.isArray(rpt) ? rpt : [rpt];
	}

	private parseReport(report: CamtReport, reportNumber: number): Statement | null {
		try {
			// Extract account information
			const account = this.getValueFromPath(report, 'Acct.Id.IBAN');

			// Extract statement number/ID
			const number = this.getValueFromPath(report, 'Id');

			// Extract transaction reference
			const transactionReference = this.getValueFromPath(report, 'ElctrncSeqNb');

			// What the bank sent, and nothing in place of what it did not. This once made
			// up an opening balance of zero where the report had none, and passed the
			// opening balance off as the closing one where that was missing — figures a
			// caller checking opening + entries = closing took for a discrepancy. A
			// camt.052 report is an intraday report and need not carry either.
			const { openingBalance, closingBalance, availableBalance } = this.parseBalances(
				report,
				reportNumber,
			);

			// Parse transactions
			const transactions = this.parseTransactions(report, reportNumber);

			return {
				account,
				number,
				transactionReference,
				openingBalance,
				closingBalance,
				availableBalance,
				transactions,
			};
		} catch (error) {
			if (error instanceof CamtParsingError) {
				throw error;
			}
			throw new CamtParsingError(
				`Failed to parse report ${reportNumber} content: ${error instanceof Error ? error.message : 'Unknown error'}`,
				error instanceof Error ? error : undefined,
			);
		}
	}

	private getValueFromPath(obj: GenericXMLObject, path: string): string | undefined {
		const pathParts = path.split('.');
		let current: unknown = obj;

		for (const part of pathParts) {
			if (current && typeof current === 'object' && current !== null && part in current) {
				current = (current as Record<string, unknown>)[part];
			} else {
				return undefined;
			}
		}

		if (typeof current === 'string' || typeof current === 'number') {
			return String(current);
		}
		if (Array.isArray(current)) {
			return String(current.join('\n'));
		}
		if (current && typeof current === 'object' && current !== null && '#text' in current) {
			return String((current as { '#text': unknown })['#text']);
		}

		return undefined;
	}

	private parseBalances(
		report: CamtReport,
		reportNumber: number,
	): {
		openingBalance?: Balance;
		closingBalance?: Balance;
		availableBalance?: Balance;
	} {
		try {
			let openingBalance: Balance | undefined;
			let closingBalance: Balance | undefined;
			let availableBalance: Balance | undefined;

			// Get balance array from report
			const balances = report.Bal;
			if (!balances) {
				return { openingBalance, closingBalance, availableBalance };
			}

			const balanceArray = Array.isArray(balances) ? balances : [balances];

			for (const balanceObj of balanceArray) {
				const typeCode = this.getValueFromPath(balanceObj, 'Tp.CdOrPrtry.Cd');

				// A balance without an amount or without a date is a figure without
				// meaning, and it is left out. Not made up — this once put in a zero for
				// a missing amount and today's date for a missing date — and not fatal
				// either: the balances accompany the entries, which are the record, and
				// one balance the bank got wrong must not cost a caller the entries.
				// Both are optional on a Statement for exactly this reason.
				const money = this.moneyAt(balanceObj, 'Amt');
				// `DtTm` as well as `Dt`: some banks state a balance date as a date-time.
				const dateStr =
					this.getValueFromPath(balanceObj, 'Dt.DtTm') ||
					this.getValueFromPath(balanceObj, 'Dt.Dt') ||
					this.getValueFromPath(balanceObj, 'Dt');
				if (!money || !dateStr) {
					continue;
				}

				const creditDebitInd = this.getValueFromPath(balanceObj, 'CdtDbtInd');
				const balance: Balance = {
					date: this.parseDate(dateStr),
					currency: money.currency,
					value: creditDebitInd === 'DBIT' ? -money.value : money.value,
				};

				switch (typeCode) {
					case 'PRCD': // Previous closing date
					case 'OPBD': // Opening booked
					case 'OPAV': // Opening available
						openingBalance = balance;
						break;
					case 'CLBD': // Closing booked
					case 'CLAV': // Closing available
						closingBalance = balance;
						break;
					case 'ITBD': // Interim booked
					case 'BOOK': // Booked balance
						// An intraday report closes with an interim booked balance rather
						// than a closing one; where there is no CLBD, this is the closing
						// balance of the report. It is also the nearest thing to an
						// available balance such a report offers.
						if (!availableBalance) {
							availableBalance = balance;
						}
						if (!closingBalance) {
							closingBalance = balance;
						}
						break;
					case 'ITAV': // Interim available
					case 'FWAV': // Forward available
						if (!availableBalance) {
							availableBalance = balance;
						}
						break;
					default:
						// A type this parser does not know says nothing about which balance it
						// is; it used to be taken for the closing one. Left out rather than
						// guessed.
						break;
				}
			}

			return { openingBalance, closingBalance, availableBalance };
		} catch (error) {
			throw new CamtParsingError(
				`Failed to parse balances in report ${reportNumber}: ${
					error instanceof Error ? error.message : 'Unknown error'
				}`,
				error instanceof Error ? error : undefined,
			);
		}
	}

	private parseTransactions(report: CamtReport, reportNumber: number): Transaction[] {
		const transactions: Transaction[] = [];
		const entries = report.Ntry;

		if (!entries) {
			return transactions;
		}

		const entryArray = Array.isArray(entries) ? entries : [entries];

		for (let i = 0; i < entryArray.length; i++) {
			try {
				const transaction = this.parseTransaction(entryArray[i], i + 1);
				if (transaction) {
					transactions.push(transaction);
				}
			} catch (error) {
				throw new CamtParsingError(
					`Failed to parse transaction ${i + 1} in report ${reportNumber}: ${
						error instanceof Error ? error.message : 'Unknown error'
					}`,
					error instanceof Error ? error : undefined,
				);
			}
		}

		return transactions;
	}

	private parseTransaction(entry: CamtEntry, entryNumber: number): Transaction | null {
		try {
			// An entry without an amount is not an entry. This once made it one of zero.
			const money = this.moneyAt(entry, 'Amt');
			if (!money) {
				throw new CamtParsingError(
					`Entry ${entryNumber} (${this.accountServicerRefOf(entry)}) has no amount; ` +
						`its elements are: ${Object.keys(entry).join(', ')}`,
				);
			}
			const creditDebitInd = this.getValueFromPath(entry, 'CdtDbtInd');
			const isDebit = creditDebitInd === 'DBIT';
			const amount = isDebit ? -money.value : money.value;

			// Extract dates
			const bookingDate =
				this.getValueFromPath(entry, 'BookgDt.DtTm') ||
				this.getValueFromPath(entry, 'BookgDt.Dt') ||
				this.getValueFromPath(entry, 'BookgDt');
			const valueDate =
				this.getValueFromPath(entry, 'ValDt.DtTm') ||
				this.getValueFromPath(entry, 'ValDt.Dt') ||
				this.getValueFromPath(entry, 'ValDt');

			// Both are optional in camt.052, and an entry the bank has not booked yet — a
			// pending one — commonly has no booking date. Each stands in for the other,
			// and failing both, a date the bank stated on the transaction itself does:
			// when it was settled, accepted or made. None of these is invented. This once
			// put today's date in for a missing booking date, which gave every pending
			// entry the day it was fetched as the day it was booked.
			const relatedDate = this.relatedDateOf(entry);
			const entryDateStr = bookingDate || valueDate || relatedDate;
			if (!entryDateStr) {
				// Naming the elements the entry does have is the one clue a log can give as
				// to where this bank puts the dates instead — one such entry was seen with
				// neither, and without the raw XML that is all there is to go on.
				throw new CamtParsingError(
					`Entry ${entryNumber} (${this.accountServicerRefOf(entry)}) has neither a booking ` +
						`nor a value date; its elements are: ${Object.keys(entry).join(', ')}`,
				);
			}
			const entryDate = this.parseDate(entryDateStr);
			const parsedValueDate = valueDate ? this.parseDate(valueDate) : entryDate;

			// Extract references
			const accountServicerRef = this.getValueFromPath(entry, 'AcctSvcrRef') || '';
			const endToEndId = this.getValueFromPath(entry, 'NtryDtls.TxDtls.Refs.EndToEndId') || '';
			const mandateId = this.getValueFromPath(entry, 'NtryDtls.TxDtls.Refs.MndtId') || '';

			// Extract transaction details
			const additionalEntryInfo = this.getValueFromPath(entry, 'AddtlNtryInf') || '';
			const remittanceInfo = this.getValueFromPath(entry, 'NtryDtls.TxDtls.RmtInf.Ustrd') || '';

			// Extract remote party information based on transaction type
			let remoteName = '';
			let remoteIBAN = '';
			let remoteBankId = '';
			let ultimateParty = '';

			const txDtls = entry.NtryDtls?.TxDtls;
			if (txDtls) {
				if (isDebit) {
					// For debit transactions, we want the creditor (receiving party)
					remoteName = this.extractPartyName(txDtls, 'RltdPties.Cdtr');
					remoteIBAN = this.getValueFromPath(txDtls, 'RltdPties.CdtrAcct.Id.IBAN') || '';
					remoteBankId = this.extractBankId(txDtls, 'RltdAgts.CdtrAgt.FinInstnId');
					// The party the money is ultimately for. Where a payment service provider
					// sits in between, the creditor above is the provider and this is the
					// merchant behind it.
					ultimateParty = this.extractPartyName(txDtls, 'RltdPties.UltmtCdtr');
				} else {
					// For credit transactions, we want the debtor (sending party)
					remoteName = this.extractPartyName(txDtls, 'RltdPties.Dbtr');
					remoteIBAN = this.getValueFromPath(txDtls, 'RltdPties.DbtrAcct.Id.IBAN') || '';
					remoteBankId = this.extractBankId(txDtls, 'RltdAgts.DbtrAgt.FinInstnId');
					ultimateParty = this.extractPartyName(txDtls, 'RltdPties.UltmtDbtr');
				}
			}

			// SEPA purpose code (SALA, RENT, LOAN, …) — a classification the bank already
			// made. It sits at transaction level; some institutes state it structured
			// (`Purp.Cd`), others as their own text (`Purp.Prtry`).
			const purposeCode = txDtls
				? this.getValueFromPath(txDtls, 'Purp.Cd') ||
					this.getValueFromPath(txDtls, 'Purp.Prtry') ||
					''
				: '';

			// Extract bank transaction code structure (BkTxCd) - can be at entry level or TxDtls level
			let bkTxCd = this.parseBankTransactionCode(entry);
			if (!bkTxCd.domainCode && !bkTxCd.familyCode && !bkTxCd.subFamilyCode && txDtls) {
				bkTxCd = this.parseBankTransactionCode(txDtls);
			}

			// Booked, pending or informational. Stated as a code element since
			// camt.052.001.08 (`Sts/Cd`), as plain text before.
			const status =
				this.getValueFromPath(entry, 'Sts.Cd') ||
				this.getValueFromPath(entry, 'Sts.Prtry') ||
				this.getValueFromPath(entry, 'Sts') ||
				undefined;

			const reversalIndicator = this.getValueFromPath(entry, 'RvslInd');
			const isReversal = reversalIndicator === undefined ? undefined : reversalIndicator === 'true';

			// Charges, amount details and the return reason sit on the entry or on its
			// transaction details, depending on the bank; the entry is looked at first.
			const charges = this.parseCharges(entry) ?? (txDtls ? this.parseCharges(txDtls) : undefined);
			const amountDetails =
				this.parseAmountDetails(entry) ?? (txDtls ? this.parseAmountDetails(txDtls) : undefined);
			const returnReason = txDtls ? this.parseReturnReason(txDtls) : undefined;
			const batch = this.parseBatch(entry);

			// The identifier of the other party, where the bank states one: on a direct
			// debit the creditor identifier that goes with the mandate, on a credit
			// whatever the debtor's bank sent. The same field MT940 fills from
			// `CRED+` and `DEBT+`.
			const remoteIdentifier = txDtls
				? this.extractPartyIdentifier(txDtls, isDebit ? 'RltdPties.Cdtr' : 'RltdPties.Dbtr')
				: '';

			return {
				valueDate: parsedValueDate,
				entryDate,
				fundsCode: bkTxCd.domainCode || creditDebitInd || '',
				amount,
				transactionType: bkTxCd.familyCode || '',
				customerReference: endToEndId,
				bankReference: accountServicerRef,
				transactionCode: bkTxCd.subFamilyCode || '',
				purpose: remittanceInfo,
				remoteName,
				remoteAccountNumber: remoteIBAN,
				remoteBankId,
				e2eReference: endToEndId,
				mandateReference: mandateId,
				additionalInformation: additionalEntryInfo,
				bookingText: additionalEntryInfo,
				// Stated separately from `remoteAccountNumber` so a caller can tell an IBAN
				// from whatever the format happened to offer — MT940 puts the legacy account
				// number in that field.
				remoteIban: remoteIBAN,
				purposeCode,
				ultimateParty,
				status,
				isReversal,
				charges,
				originalAmount: amountDetails?.originalAmount,
				exchangeRate: amountDetails?.exchangeRate,
				returnReason,
				batch,
				remoteIdentifier: remoteIdentifier || undefined,
			};
		} catch (error) {
			throw new CamtParsingError(
				`Failed to parse transaction details: ${error instanceof Error ? error.message : 'Unknown error'}`,
				error instanceof Error ? error : undefined,
			);
		}
	}

	/**
	 * Extract party name from various possible CAMT structures
	 * Handles both direct name (<Dbtr><Nm>) and party structure (<Dbtr><Pty><Nm>)
	 */
	private extractPartyName(txDtls: CamtTransactionDetails, partyPath: string): string {
		// Strategy 1: Direct name structure (e.g., RltdPties.Dbtr.Nm)
		let name = this.getValueFromPath(txDtls, `${partyPath}.Nm`);
		if (name) {
			return name;
		}

		// Strategy 2: Party structure (e.g., RltdPties.Dbtr.Pty.Nm)
		name = this.getValueFromPath(txDtls, `${partyPath}.Pty.Nm`);
		if (name) {
			return name;
		}

		// Strategy 3: Organization ID structure (e.g., RltdPties.Dbtr.Id.OrgId.Nm)
		name = this.getValueFromPath(txDtls, `${partyPath}.Id.OrgId.Nm`);
		if (name) {
			return name;
		}

		// Strategy 4: Private ID structure (e.g., RltdPties.Dbtr.Id.PrvtId.Nm)
		name = this.getValueFromPath(txDtls, `${partyPath}.Id.PrvtId.Nm`);
		if (name) {
			return name;
		}

		// Strategy 5: Try postal address line as fallback
		name = this.getValueFromPath(txDtls, `${partyPath}.PstlAdr.AdrLine`);
		if (name) {
			return name;
		}

		// Strategy 6: Try organization identification other
		name = this.getValueFromPath(txDtls, `${partyPath}.Id.OrgId.Othr.Id`);
		if (name) {
			return name;
		}

		return '';
	}

	/**
	 * Extract bank identification code from various possible CAMT structures
	 * Handles both BIC and BICFI elements
	 */
	private extractBankId(txDtls: CamtTransactionDetails, bankPath: string): string {
		// Strategy 1: Standard BIC element
		let bankId = this.getValueFromPath(txDtls, `${bankPath}.BIC`);
		if (bankId) {
			return bankId;
		}

		// Strategy 2: BICFI element (used by some banks)
		bankId = this.getValueFromPath(txDtls, `${bankPath}.BICFI`);
		if (bankId) {
			return bankId;
		}

		// Strategy 3: Try ClrSysMmbId (clearing system member identification)
		bankId = this.getValueFromPath(txDtls, `${bankPath}.ClrSysMmbId.MmbId`);
		if (bankId) {
			return bankId;
		}

		// Strategy 4: Try other identification
		bankId = this.getValueFromPath(txDtls, `${bankPath}.Othr.Id`);
		if (bankId) {
			return bankId;
		}

		return '';
	}

	private parseDate(dateStr: string): Date {
		let processedDateStr = dateStr;
		// Handle date-only with timezone, e.g., "2026-01-22+01:00"
		// The Date constructor may not parse this correctly, so we add a time part.
		if (/^\d{4}-\d{2}-\d{2}[+-]\d{2}:\d{2}$/.test(dateStr)) {
			processedDateStr = `${dateStr.substring(0, 10)}T00:00:00${dateStr.substring(10)}`;
		}

		// Attempt to parse as a full ISO 8601 string first, which `new Date()` handles well.
		// This will correctly handle formats like "2023-10-26T10:00:00+02:00".
		const isoDate = new Date(processedDateStr);
		if (!Number.isNaN(isoDate.getTime())) {
			// Check if the date string contains time or timezone information to avoid misinterpreting YYYY-MM-DD
			if (processedDateStr.includes('T') || /[-+]\d{2}:\d{2}$/.test(processedDateStr)) {
				return isoDate;
			}
		}

		// Fallback for date-only ISO format (YYYY-MM-DD)
		if (dateStr.length === 10 && dateStr.includes('-')) {
			return new Date(`${dateStr}T12:00:00`); // Set time to noon to avoid timezone issues
		}

		// Parse CAMT date format (YYYYMMDD)
		if (/^\d{8}$/.test(dateStr)) {
			const year = parseInt(dateStr.substring(0, 4), 10);
			const month = parseInt(dateStr.substring(4, 6), 10) - 1; // Month is 0-based
			const day = parseInt(dateStr.substring(6, 8), 10);
			return new Date(year, month, day, 12);
		}

		// Anything else used to become `new Date(dateStr)` — an Invalid Date when the
		// string is not one JavaScript knows, which JSON serialises as null and nothing
		// complains about. A date this parser cannot read is an error.
		throw new CamtParsingError(`Cannot read the date '${dateStr}'`);
	}

	/**
	 * An amount element with its currency attribute, `<Amt Ccy="EUR">12.34</Amt>`.
	 */
	private moneyAt(obj: GenericXMLObject, path: string): Money | undefined {
		const text = this.getValueFromPath(obj, path);
		if (text === undefined || text === '') {
			return undefined;
		}
		const node = this.nodeAt(obj, path);
		const currency =
			node && typeof node === 'object' && '@Ccy' in node ? String(node['@Ccy']) : 'EUR';
		return { value: parseFloat(text), currency };
	}

	private nodeAt(obj: GenericXMLObject, path: string): GenericXMLObject | undefined {
		let current: unknown = obj;
		for (const part of path.split('.')) {
			if (current && typeof current === 'object' && part in current) {
				current = (current as Record<string, unknown>)[part];
			} else {
				return undefined;
			}
		}
		return current && typeof current === 'object' ? (current as GenericXMLObject) : undefined;
	}

	/**
	 * The charges of an entry. Stated as a total since camt.052.001.08
	 * (`TtlChrgsAndTaxAmt`), as a single amount before, and by some banks only as
	 * records — those are summed.
	 */
	private parseCharges(obj: GenericXMLObject): Money | undefined {
		const total = this.moneyAt(obj, 'Chrgs.TtlChrgsAndTaxAmt') ?? this.moneyAt(obj, 'Chrgs.Amt');
		if (total) {
			return total;
		}
		const records = this.nodeAt(obj, 'Chrgs')?.Rcrd;
		if (!records) {
			return undefined;
		}
		const amounts = (Array.isArray(records) ? records : [records])
			.map((record) => this.moneyAt(record as GenericXMLObject, 'Amt'))
			.filter((money): money is Money => money !== undefined);
		if (amounts.length === 0) {
			return undefined;
		}
		return {
			value: amounts.reduce((sum, money) => sum + money.value, 0),
			currency: amounts[0].currency,
		};
	}

	/**
	 * The instructed amount and the exchange rate of an entry the bank converted:
	 * `AmtDtls/InstdAmt` is the amount in the currency it was instructed in, and the
	 * rate is on it or on the transaction amount.
	 */
	private parseAmountDetails(
		obj: GenericXMLObject,
	): { originalAmount?: Money; exchangeRate?: number } | undefined {
		const originalAmount = this.moneyAt(obj, 'AmtDtls.InstdAmt.Amt');
		const rate =
			this.getValueFromPath(obj, 'AmtDtls.InstdAmt.CcyXchg.XchgRate') ||
			this.getValueFromPath(obj, 'AmtDtls.TxAmt.CcyXchg.XchgRate') ||
			this.getValueFromPath(obj, 'AmtDtls.CntrValAmt.CcyXchg.XchgRate');
		const exchangeRate = rate ? parseFloat(rate) : undefined;
		if (!originalAmount && exchangeRate === undefined) {
			return undefined;
		}
		return { originalAmount, exchangeRate };
	}

	private parseReturnReason(
		txDtls: CamtTransactionDetails,
	): { code?: string; text?: string } | undefined {
		const code =
			this.getValueFromPath(txDtls, 'RtrInf.Rsn.Cd') ||
			this.getValueFromPath(txDtls, 'RtrInf.Rsn.Prtry');
		const text = this.getValueFromPath(txDtls, 'RtrInf.AddtlInf');
		if (!code && !text) {
			return undefined;
		}
		return { code: code || undefined, text: text || undefined };
	}

	private parseBatch(
		entry: CamtEntry,
	):
		| { messageId?: string; paymentInformationId?: string; numberOfTransactions?: number }
		| undefined {
		const batch = entry.NtryDtls?.Btch;
		if (!batch) {
			return undefined;
		}
		const count = this.getValueFromPath(batch, 'NbOfTxs');
		return {
			messageId: this.getValueFromPath(batch, 'MsgId') || undefined,
			paymentInformationId: this.getValueFromPath(batch, 'PmtInfId') || undefined,
			numberOfTransactions: count ? parseInt(count, 10) : undefined,
		};
	}

	/**
	 * A party's identifier, where the bank states one: `Id/PrvtId/Othr/Id` for a
	 * person — which is where a creditor identifier goes — or `Id/OrgId/Othr/Id`
	 * for an organisation. Since camt.052.001.08 the party sits under `Pty`.
	 */
	private extractPartyIdentifier(txDtls: CamtTransactionDetails, partyPath: string): string {
		for (const base of [partyPath, `${partyPath}.Pty`]) {
			const id =
				this.getValueFromPath(txDtls, `${base}.Id.PrvtId.Othr.Id`) ||
				this.getValueFromPath(txDtls, `${base}.Id.OrgId.Othr.Id`);
			if (id) {
				return id;
			}
		}
		return '';
	}

	/**
	 * A date the bank stated on the transaction behind an entry — settlement,
	 * acceptance, or the transaction's own — for an entry that has neither a booking
	 * nor a value date. Of several transaction details, the first is asked.
	 */
	private relatedDateOf(entry: CamtEntry): string | undefined {
		const details = entry.NtryDtls?.TxDtls;
		const first = (Array.isArray(details) ? details[0] : details) as GenericXMLObject | undefined;
		if (!first) {
			return undefined;
		}
		for (const path of [
			'RltdDts.IntrBkSttlmDt',
			'RltdDts.AccptncDtTm',
			'RltdDts.TxDtTm',
			'RltdDts.TradDt',
			'RltdDts.StartDt',
		]) {
			const value = this.getValueFromPath(first, path);
			if (value) {
				return value;
			}
		}
		return undefined;
	}

	private accountServicerRefOf(entry: CamtEntry): string {
		return this.getValueFromPath(entry, 'AcctSvcrRef') ?? 'no AcctSvcrRef';
	}

	private parseBankTransactionCode(entry: CamtEntry | CamtTransactionDetails): {
		domainCode?: string;
		familyCode?: string;
		subFamilyCode?: string;
	} {
		const bkTxCd = entry.BkTxCd;
		if (!bkTxCd) {
			return {};
		}

		// Extract Domain Code (first level - e.g., "PMNT")
		const domainCode = this.getValueFromPath(bkTxCd, 'Domn.Cd');

		// Extract Family Code (second level - e.g., "CCRD")
		const familyCode = this.getValueFromPath(bkTxCd, 'Domn.Fmly.Cd');

		// Extract SubFamily Code (third level - e.g., "POSD")
		const subFamilyCode = this.getValueFromPath(bkTxCd, 'Domn.Fmly.SubFmlyCd');

		return {
			domainCode,
			familyCode,
			subFamilyCode,
		};
	}
}
