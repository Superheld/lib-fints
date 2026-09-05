import type { BankAnswer } from '../bankAnswer.js';
import type { FinTSConfig } from '../config.js';
import type { Dialog } from '../dialog.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HITAN, type HITANSegment } from '../segments/HITAN.js';
import { HNHBK, type HNHBKSegment } from '../segments/HNHBK.js';
import type { Statement } from '../statement.js';

export interface PhotoTan {
	mimeType: string;
	image: Uint8Array;
}

/**
 * The response from the client after a customer interaction
 * @property dialogId The dialog ID of the current dialog
 * @property success Whether the interaction was successful
 * @property bankingInformationUpdated Whether the banking information were updated
 * @property bankAnswers The answers from the bank
 * @property requiresTan Whether security approval is required to continue the transaction (a user entered TAN or decoupled approval)
 * @property tanReference A reference for the TAN which needs to be provided in the continuation method
 * @property tanChallenge A prompt provided by the bank which should be displayed to the user to enter the TAN
 * @property tanMediaName The name of the TAN media to use for the TAN input
 */
export interface ClientResponse {
	dialogId: string;
	success: boolean;
	bankingInformationUpdated: boolean;
	bankAnswers: BankAnswer[];
	requiresTan: boolean;
	tanReference?: string;
	tanChallenge?: string;
	tanPhoto?: PhotoTan;
	tanMediaName?: string;
}

/**
 * The payload of a response is present only when the order went through: with
 * `success` false, or `requiresTan` true, the bank has not answered the order yet
 * and there is nothing to parse. The field is absent then — not an empty list,
 * which would read as "no transactions in this period".
 */
export interface StatementResponse extends ClientResponse {
	/**
	 * Which format the statements were parsed from. `getAccountStatements` picks the
	 * format from what the bank offers for the account and falls back to MT940 when
	 * there is no CAMT — the caller cannot tell which branch ran, and the two put
	 * different vocabularies into `transactionCode` and `bookingText` (the numeric
	 * business transaction code and a short label from MT940; the ISO sub-family code
	 * and the free-text entry information from CAMT). Set by the interaction that did
	 * the parsing, present whenever `statements` is.
	 */
	format?: AccountStatementFormat;
	/** The booked transactions, as statements. */
	statements?: Statement[];
	/**
	 * The text `statements` was parsed from, as the bank sent it: the CAMT documents
	 * (one per booking day, decoded to a readable string) or the one MT940 stream. A
	 * field the parser leaves empty can mean two things — the bank did not send it, or
	 * the parser did not read it — and only the raw text tells them apart. These are
	 * the same strings the decoded message already holds, not a copy.
	 */
	rawStatements?: string[];
	/**
	 * The transactions the bank has noted but not booked yet — pending ones — where
	 * the bank sends them. Kept apart from `statements`: a caller that counts these
	 * as booked overstates the balance, and the bank may still drop or change them.
	 * Absent when the bank sent none; not every bank does, and MT940 rarely carries
	 * them.
	 */
	notedStatements?: Statement[];
	/**
	 * Why `notedStatements` is absent although the bank sent noted transactions: the
	 * document could not be parsed. Kept apart from the booked statements on purpose.
	 * A booked statement that cannot be parsed fails the call — a caller fetching
	 * incrementally would otherwise move on past bookings it never saw. A noted one
	 * is a preview, not a record; what it shows, the next fetch delivers as a
	 * booked line. Dropping it loses nothing, failing the call would lose the
	 * booked statements parsed a moment before.
	 */
	notedStatementsError?: Error;
	/**
	 * The text the noted transactions came in, like `rawStatements`. Present whenever
	 * the bank sent noted transactions — also when parsing them failed, so that what
	 * `notedStatementsError` complains about can be looked at.
	 */
	rawNotedStatements?: string[];
}

/**
 * A statement the bank sent could not be parsed. Carries the text it failed on, so the
 * caller can look at what the parser saw: a booked statement that fails takes the whole
 * response down (see `StatementResponse.notedStatementsError` for why), and without this
 * the document was gone with it — leaving a message, and no way to tell a parser gap
 * from a bank sending something odd. `cause` is the parser's own error.
 */
export function toError(thrown: unknown): Error {
	return thrown instanceof Error ? thrown : new Error(String(thrown));
}

export class StatementParsingError extends Error {
	constructor(
		public format: AccountStatementFormat,
		/** The document (CAMT) or stream (MT940) the parser failed on, as the parser saw it. */
		public document: string,
		public cause: Error,
	) {
		super(`Cannot parse the ${format} statements: ${cause.message}`);
		this.name = 'StatementParsingError';
	}
}

/**
 * The format an account statement arrived in; see `StatementResponse.format`. (Not the
 * `StatementFormat` of HKEKA, which names the file formats of electronic statements.)
 */
export type AccountStatementFormat = 'CAMT' | 'MT940';

export abstract class CustomerInteraction {
	dialog?: Dialog;

	constructor(public segId: string) {}

	getSegments(config: FinTSConfig): Segment[] {
		return this.createSegments(config);
	}

	handleClientResponse(message: Message): ClientResponse {
		const clientResponse = this.handleBaseResponse(message);

		const currentBankingInformationSnapshot = JSON.stringify(
			this.dialog?.config.bankingInformation,
		);

		if (clientResponse.success && !clientResponse.requiresTan) {
			this.handleResponse(message, clientResponse);
		}

		clientResponse.bankingInformationUpdated =
			currentBankingInformationSnapshot !== JSON.stringify(this.dialog?.config.bankingInformation);

		return clientResponse;
	}

	protected abstract createSegments(config: FinTSConfig): Segment[];
	protected abstract handleResponse(response: Message, clientResponse: ClientResponse): void;

	private parseHHDUC(tanChallengeHHDUC: string): PhotoTan {
		let offset = 0;
		// convert the string with binary data to a byte array
		const bytes = new Uint8Array(tanChallengeHHDUC.length);
		for (let i = 0; i < tanChallengeHHDUC.length; i++) {
			bytes[i] = tanChallengeHHDUC.charCodeAt(i) & 0xff;
		}
		const countAsString = Array.from(bytes.slice(offset, 2), (b) => String(b)).join('');
		offset += 2;
		const count = parseInt(countAsString, 10);
		const mimeTypeArray = bytes.slice(offset, offset + count);
		const mimeType = new TextDecoder('iso-8859-1').decode(mimeTypeArray);
		offset += count;
		// image size is 2 bytes, little endian
		const hi = bytes[offset];
		const lo = bytes[offset + 1];
		const imageSize = (hi << 8) + lo;
		offset += 2;
		const image = bytes.slice(offset, offset + imageSize);
		return { mimeType, image };
	}

	private handleBaseResponse(response: Message): ClientResponse {
		const hnhbk = response.findSegment<HNHBKSegment>(HNHBK.Id);
		const dialogId = hnhbk?.dialogId ?? '';
		const bankAnswers = response.getBankAnswers();

		if (
			response.hasReturnCode(30) ||
			response.hasReturnCode(3955) ||
			response.hasReturnCode(3956) ||
			response.hasReturnCode(3957)
		) {
			const hitan = response.findSegment<HITANSegment>(HITAN.Id);
			if (hitan) {
				return {
					dialogId,
					success: true,
					bankingInformationUpdated: false,
					bankAnswers: bankAnswers,
					requiresTan: true,
					tanReference: hitan.orderReference,
					tanChallenge:
						hitan.challenge ??
						bankAnswers.find((answer) => answer.code === 3955)?.text ??
						bankAnswers.find((answer) => answer.code === 3956)?.text ??
						bankAnswers.find((answer) => answer.code === 3957)?.text ??
						'',
					tanPhoto: hitan.challengeHhdUc ? this.parseHHDUC(hitan.challengeHhdUc) : undefined,
					tanMediaName: hitan.tanMedia,
				};
			} else {
				throw new Error(
					'HITAN segment not found in response, despite return code indicating security approval',
				);
			}
		}

		return {
			dialogId,
			success: response.getHighestReturnCode() < 9000,
			bankingInformationUpdated: false,
			bankAnswers: bankAnswers,
			requiresTan: false,
		};
	}
}

export abstract class CustomerOrderInteraction extends CustomerInteraction {
	constructor(
		segId: string,
		public responseSegId: string,
	) {
		super(segId);
	}
}
