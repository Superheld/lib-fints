import { Balance, Statement, Transaction } from './statement.js';

export { Statement, Transaction, Balance };

export enum TokenType {
	Tag = 'Tag',
	SubTag = 'SubTag',
	PurposeTag = 'PurposeTag',
	SingleAlpha = 'SingleAlpha',
	StatementNumber = 'StatementNumber',
	CustomerReference = 'CustomerReference',
	BankReference = 'BankReference',
	Date = 'Date',
	ShortDate = 'ShortDate',
	CreditDebit = 'CreditDebit',
	Decimal = 'Decimal',
	Currency = 'Currency',
	TextToEndOfLine = 'TextToEndOfLine',
	TextToNextSubTag = 'TextToNextSubTag',
	TextToNextPurposeTag = 'TextToNextPurposeTag',
	NextNonTagLine = 'NextNonTagLine',
	TransactionType = 'TransactionType',
	TransactionCode = 'TransactionCode',
	WhiteSpace = 'WhiteSpace',
}

const tokens: { [key in TokenType]: RegExp } = {
	Tag: /^:\d\d[A-Z]?:/,
	SubTag: /^\?\d\d/,
	PurposeTag: /^[A-Z]{4}\+/,
	SingleAlpha: /^[A-Z]/,
	StatementNumber: /^\d+\/?\d*/,
	CustomerReference: /^[^/\r\n]+/,
	BankReference: /^\/\/([^\r\n]+)/,
	// Grouped, so the anchor covers every alternative. As `/^C|D|RC|RD/` only `C` was
	// anchored; a `D` anywhere in the rest of the line would have matched, and the
	// tokenizer would have carried on from there.
	CreditDebit: /^(?:RC|RD|C|D)/,
	Date: /^\d{6}/,
	ShortDate: /^\d{4}/,
	Decimal: /^\d+,\d*/,
	Currency: /^[A-Z]{3}/,
	TextToEndOfLine: /^[^\r\n]+/,
	TextToNextSubTag: /^[^?]+/,
	TextToNextPurposeTag: /^(.*?)(?=\s[A-Z]{4}\+|$)/,
	// A continuation line of a field is any line that is not the next tag. MT940 wraps
	// text at 65 characters regardless of content, so a line may well begin with ':' —
	// rejecting every such line, as this once did, ended the field there and silently
	// dropped the rest of it, remote name included.
	NextNonTagLine: /^\r\n(?!:\d\d[A-Z]?:)([^\r\n]+)/,
	TransactionType: /^[A-Z][0-9A-Z]{3}/,
	TransactionCode: /^\d{3}/,
	WhiteSpace: /^\s+/,
};

/**
 * A calendar day as a Date: noon local time, the convention the CAMT and MT535 parsers
 * already follow. Local midnight — what this used to be — is the evening before in
 * UTC, so `JSON.stringify` moved every MT940 booking a day back while the same booking
 * fetched as CAMT stayed put.
 */
function calendarDay(year: number, month: number, day: number): Date {
	return new Date(year, month - 1, day, 12);
}

export class Mt940Parser {
	tokenizer: Mt940Tokenizer;

	statements: Statement[] = [];
	currentStatement: Partial<Statement> = {
		transactions: [],
	};
	currentTransaction: Transaction | undefined;

	constructor(input: string) {
		this.tokenizer = new Mt940Tokenizer(input);
	}

	parse(): Statement[] {
		while (!this.tokenizer.isAtEnd()) {
			if (this.tokenizer.parseNextToken(TokenType.WhiteSpace, false)) {
				continue;
			}

			const tag = this.tokenizer.parseNextToken(TokenType.Tag, false);

			if (tag) {
				switch (tag) {
					case ':20:':
						this.currentStatement = {
							transactions: [],
						};
						this.statements.push(this.currentStatement as Statement);
						this.currentStatement.transactionReference = this.tokenizer.parseNextToken(
							TokenType.TextToEndOfLine,
							true,
						);
						break;
					case ':21:':
						this.currentStatement.relatedReference = this.tokenizer.parseNextToken(
							TokenType.TextToEndOfLine,
							false,
						);
						break;
					case ':25:':
						this.currentStatement.account = this.tokenizer.parseNextToken(
							TokenType.TextToEndOfLine,
							true,
						);
						break;
					case ':28C:':
						this.currentStatement.number = this.tokenizer.parseNextToken(
							TokenType.StatementNumber,
							true,
						);
						break;
					// F for the final balance of a statement, M for the intermediate one that
					// opens or closes a page of a statement spread over several (`:28C:1/2`).
					// Each page is its own Statement here, so to it the intermediate balance
					// IS the opening or closing balance. Without the M cases those pages came
					// back with both balances undefined — and a type that promised otherwise.
					case ':60F:':
					case ':60M:':
						this.currentStatement.openingBalance = this.parseBalance();
						break;
					case ':62F:':
					case ':62M:':
						this.currentStatement.closingBalance = this.parseBalance();
						break;
					case ':64:':
						this.currentStatement.availableBalance = this.parseBalance();
						break;
					case ':65:':
						if (!this.currentStatement.forwardBalances) {
							this.currentStatement.forwardBalances = [];
						}
						this.currentStatement.forwardBalances.push(this.parseBalance());
						break;
					case ':61:': {
						const valueDate = this.parseDate(true);
						const entryDateString = this.tokenizer.parseNextToken(TokenType.ShortDate, false);
						const entryDate = entryDateString
							? this.parseEntryDate(entryDateString, valueDate)
							: valueDate;

						const creditDebit = this.tokenizer.parseNextToken(TokenType.CreditDebit, true);
						const fundsCode = this.tokenizer.parseNextToken(TokenType.SingleAlpha, false);
						const amount = this.parseAmount(creditDebit, true);
						const transactionType = this.tokenizer.parseNextToken(TokenType.TransactionType, true);
						const customerReference = this.tokenizer.parseNextToken(
							TokenType.CustomerReference,
							true,
						);
						const bankReference = this.tokenizer.parseNextToken(TokenType.BankReference, false);
						const additionalInformation = this.tokenizer.parseNextToken(
							TokenType.NextNonTagLine,
							false,
						);

						this.currentTransaction = {
							valueDate: valueDate,
							entryDate: entryDate,
							fundsCode: fundsCode,
							amount: amount,
							transactionType: transactionType,
							customerReference: customerReference,
							bankReference: bankReference,
							additionalInformation: additionalInformation,
						};

						this.currentStatement.transactions?.push(this.currentTransaction);
						break;
					}
					case ':86:': {
						let infoToAccountOwner = this.tokenizer.parseNextToken(TokenType.TextToEndOfLine, true);

						let nextLine: string;
						do {
							nextLine = this.tokenizer.parseNextToken(TokenType.NextNonTagLine, false);
							if (nextLine) {
								infoToAccountOwner += nextLine;
							}
						} while (nextLine);

						this.parseInfoToAccountOwner(infoToAccountOwner);
						break;
					}
					default:
						this.tokenizer.parseNextToken(TokenType.TextToEndOfLine, false);
						break;
				}
			} else {
				this.tokenizer.parseNextToken(TokenType.TextToEndOfLine, false);
			}
		}

		return this.statements;
	}

	parseInfoToAccountOwner(infoToAccountOwner: string) {
		if (!this.currentTransaction) {
			return;
		}

		const subFieldTokenizer = new Mt940Tokenizer(infoToAccountOwner);

		this.currentTransaction.transactionCode = subFieldTokenizer.parseNextToken(
			TokenType.TransactionCode,
			false,
		);

		let subTag: string;
		do {
			subTag = subFieldTokenizer.parseNextToken(TokenType.SubTag, false);
			if (subTag) {
				switch (subTag) {
					case '?00':
						this.currentTransaction.bookingText = subFieldTokenizer.parseNextToken(
							TokenType.TextToNextSubTag,
							true,
						);
						break;
					case '?10':
						this.currentTransaction.primeNotesNr = subFieldTokenizer.parseNextToken(
							TokenType.TextToNextSubTag,
							true,
						);
						break;
					case '?20':
					case '?21':
					case '?22':
					case '?23':
					case '?24':
					case '?25':
					case '?26':
					case '?27':
					case '?28':
					case '?29':
					case '?60':
					case '?61':
					case '?62':
					case '?63': {
						if (!this.currentTransaction.purpose) {
							this.currentTransaction.purpose = '';
						}

						const purposeTag = subFieldTokenizer.parseNextToken(TokenType.PurposeTag, false);

						if (purposeTag) {
							if (this.currentTransaction.purpose) {
								this.currentTransaction.purpose += ' ';
							}
							this.currentTransaction.purpose += purposeTag;
						}

						this.currentTransaction.purpose += subFieldTokenizer.parseNextToken(
							TokenType.TextToNextSubTag,
							true,
						);
						break;
					}
					case '?30':
						this.currentTransaction.remoteBankId = subFieldTokenizer.parseNextToken(
							TokenType.TextToNextSubTag,
							true,
						);
						break;
					case '?31':
						this.currentTransaction.remoteAccountNumber = subFieldTokenizer.parseNextToken(
							TokenType.TextToNextSubTag,
							true,
						);
						break;
					case '?32':
					case '?33':
						if (!this.currentTransaction.remoteName) {
							this.currentTransaction.remoteName = '';
						}
						this.currentTransaction.remoteName += subFieldTokenizer.parseNextToken(
							TokenType.TextToNextSubTag,
							true,
						);
						break;
					case '?34':
						this.currentTransaction.textKeyExtension = subFieldTokenizer.parseNextToken(
							TokenType.TextToNextSubTag,
							true,
						);
						break;
					// The remote IBAN. Without it, MT940 offers only ?30/?31 — bank code and
					// legacy account number — while CAMT states the IBAN outright, so the same
					// booking looks different depending on how it was fetched.
					case '?38':
						this.currentTransaction.remoteIban = subFieldTokenizer.parseNextToken(
							TokenType.TextToNextSubTag,
							true,
						);
						break;
					default:
						subFieldTokenizer.parseNextToken(TokenType.TextToNextSubTag, false);
						break;
				}
			}
		} while (subTag);

		this.parsePurpose(this.currentTransaction);
	}

	/**
	 * Splits the SEPA tags (`EREF+`, `SVWZ+`, …) out of the purpose text.
	 *
	 * Text before the first tag, or between two, is skipped up to the next one. The loop
	 * used to stop at the first thing that was not a tag — so a purpose that opened with
	 * a plain word, as many do, kept all its tags as text and yielded not one reference.
	 */
	parsePurpose(transaction: Transaction) {
		const purposeTokenizer = new Mt940Tokenizer(transaction.purpose ?? '');

		do {
			const purposeTag = purposeTokenizer.parseNextToken(TokenType.PurposeTag, false);
			if (purposeTag) {
				let text = purposeTokenizer.parseNextToken(TokenType.TextToNextPurposeTag, false);
				if (!text) {
					text = purposeTokenizer.parseNextToken(TokenType.TextToEndOfLine, false);
				}

				switch (purposeTag) {
					case 'EREF+':
						transaction.e2eReference = text;
						break;
					case 'KREF+':
						transaction.customerReference = text;
						break;
					case 'MREF+':
						transaction.mandateReference = text;
						break;
					case 'CRED+':
						transaction.remoteIdentifier = text;
						break;
					case 'DEBT+':
						transaction.remoteIdentifier = text;
						break;
					case 'ABWA+':
						transaction.client = text;
						break;
					case 'SVWZ+':
						transaction.purpose = text;
						break;
					default:
						break;
				}
			} else {
				purposeTokenizer.parseNextToken(TokenType.TextToNextPurposeTag, false);
			}
			purposeTokenizer.parseNextToken(TokenType.WhiteSpace, false);
		} while (!purposeTokenizer.isAtEnd());
	}

	parseBalance(): Balance {
		const creditDebit = this.tokenizer.parseNextToken(TokenType.CreditDebit, true);
		const date = this.parseDate(true);
		const currency = this.tokenizer.parseNextToken(TokenType.Currency, true);
		const amount = this.tokenizer.parseNextToken(TokenType.Decimal, true);

		return {
			date: date,
			currency: currency,
			value: parseFloat(amount.replace(',', '.')) * (creditDebit === 'D' ? -1 : 1),
		};
	}

	parseDate(isMandatory = true): Date {
		const date = this.tokenizer.parseNextToken(TokenType.Date, isMandatory);

		const year = parseInt(date.substring(0, 2), 10) + 2000;
		const month = parseInt(date.substring(2, 4), 10);
		const day = parseInt(date.substring(4, 6), 10);

		return calendarDay(year, month, day);
	}

	/**
	 * Resolves the entry date of field :61:, which carries only MMDD.
	 *
	 * The year has to be derived from the value date, and the order of the two dates does
	 * not carry it: a bank posts an entry before its value date around the turn of a year,
	 * and after it whenever the value date is backdated - routine for instant transfers
	 * settled at the end of a month. What does hold is that both dates lie close together,
	 * so of the three possible years the one placing the entry date nearest the value date
	 * is the intended one. This covers a year boundary in either direction.
	 */
	parseEntryDate(entryDateString: string, valueDate: Date): Date {
		const entryMonth = parseInt(entryDateString.substring(0, 2), 10);
		const entryDay = parseInt(entryDateString.substring(2, 4), 10);
		const valueYear = valueDate.getFullYear();

		let entryDate = calendarDay(valueYear, entryMonth, entryDay);
		let smallestDistance = Math.abs(entryDate.getTime() - valueDate.getTime());

		for (const year of [valueYear - 1, valueYear + 1]) {
			const candidate = calendarDay(year, entryMonth, entryDay);
			const distance = Math.abs(candidate.getTime() - valueDate.getTime());
			if (distance < smallestDistance) {
				entryDate = candidate;
				smallestDistance = distance;
			}
		}

		return entryDate;
	}

	parseAmount(creditDebit: string, isMandatory = true): number {
		const amount = this.tokenizer.parseNextToken(TokenType.Decimal, isMandatory);
		return (
			parseFloat(amount.replace(',', '.')) * (creditDebit === 'D' || creditDebit === 'RC' ? -1 : 1)
		);
	}
}

export class Mt940Tokenizer {
	position = 0;
	lastToken: string = '';

	constructor(private input: string) {}

	parseNextToken(type: TokenType, isMandatory: boolean): string {
		const matched = this.match(tokens[type]);
		if (matched) {
			this.position += matched[0].length;
			this.lastToken = matched.length > 1 ? matched[1] : matched[0];
			return this.lastToken;
		}

		if (isMandatory) {
			throw new SyntaxError(
				`Expected ${type} token at position ${this.position}, after '${this.lastToken}'...`,
			);
		}

		return '';
	}

	match(regExp: RegExp): RegExpExecArray | null {
		return regExp.exec(this.input.substring(this.position));
	}

	isAtEnd(): boolean {
		return this.position >= this.input.length;
	}
}
