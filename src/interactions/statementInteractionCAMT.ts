import { CamtParser } from '../camtParser.js';
import { internationalAccount } from '../accountDescriptor.js';
import { describeAccount, type AccountRef } from '../bankAccount.js';
import type { FinTSConfig } from '../config.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HICAZ, type HICAZSegment } from '../segments/HICAZ.js';
import type { HICAZSParameter } from '../segments/HICAZS.js';
import { HKCAZ, type HKCAZSegment } from '../segments/HKCAZ.js';
import type { Statement } from '../statement.js';
import {
	CustomerOrderInteraction,
	StatementParsingError,
	type StatementResponse,
	toError,
} from './customerInteraction.js';

export class StatementInteractionCAMT extends CustomerOrderInteraction {
	constructor(
		public account: AccountRef,
		public from?: Date,
		public to?: Date,
	) {
		super(HKCAZ.Id, HICAZ.Id);
	}

	createSegments(init: FinTSConfig): Segment[] {
		const bankAccount = init.getBankAccount(this.account);
		const version = init.getMaxSupportedTransactionVersion(HKCAZ.Id);
		if (!version) {
			throw Error(`There is no supported version for business transaction '${HKCAZ.Id}'`);
		}

		let acceptedCamtFormats = ['urn:iso:std:iso:20022:tech:xsd:camt.052.001.08'];

		const params = init.getTransactionParameters<HICAZSParameter>(HKCAZ.Id);

		if (params && params.supportedCamtFormats.length > 0) {
			acceptedCamtFormats = params.supportedCamtFormats.filter((format) =>
				format.startsWith('urn:iso:std:iso:20022:tech:xsd:camt.052.001.'),
			);
		}

		const hkcaz: HKCAZSegment = {
			header: { segId: HKCAZ.Id, segNr: 0, version: version },
			account: internationalAccount(init, bankAccount),
			acceptedCamtFormats: acceptedCamtFormats,
			allAccounts: false,
			from: this.from,
			to: this.to,
		};

		return [hkcaz];
	}

	handleResponse(response: Message, clientResponse: StatementResponse) {
		// A response the bank spread over several messages arrives as several HICAZ
		// segments, each carrying its own share of the CAMT documents. Taking only the
		// first one would silently drop everything after it.
		const segments = response.findAllSegments<HICAZSegment>(HICAZ.Id);
		const booked = segments.flatMap((segment) => segment.bookedTransactions ?? []);
		const noted = segments.flatMap((segment) => segment.notedTransactions ?? []);

		// The documents come out of the message as latin1 text that actually holds UTF-8;
		// decoded once here so that the parser and the caller see the same readable XML.
		const bookedDocuments = booked.map(decodeCamtDocument);
		const notedDocuments = noted.map(decodeCamtDocument);

		clientResponse.format = 'CAMT';
		clientResponse.rawStatements = bookedDocuments;
		if (notedDocuments.length > 0) {
			clientResponse.rawNotedStatements = notedDocuments;
		}

		// A parse error propagates: catching it and answering with an empty list — as
		// this once did — turned one broken document out of twenty into "success, no
		// transactions", and a caller fetching incrementally moved on past bookings it
		// never saw.
		clientResponse.statements = parseCamtDocuments(bookedDocuments);

		// The second field of HICAZ — a complete CAMT document of the pending entries,
		// sent alongside the first and until now never read. Its failure must not take
		// the booked statements with it; see `notedStatementsError`.
		if (notedDocuments.length > 0) {
			try {
				clientResponse.notedStatements = parseCamtDocuments(notedDocuments);
			} catch (error) {
				clientResponse.notedStatementsError = toError(error);
			}
		}
	}
}

/**
 * The binary field of HICAZ arrives as latin1 text (that is how the whole message is
 * decoded), but the document itself is usually UTF-8. If its XML declaration says so,
 * the bytes are read again as UTF-8; otherwise the text is taken as it is.
 */
function decodeCamtDocument(camtMessage: string): string {
	// The 'i' flag makes the match case-insensitive (e.g., for "utf-8").
	const isUtf8Encoded = /<\?xml[^>]*encoding="UTF-8"[^>]*\?>/i.test(camtMessage);
	return isUtf8Encoded ? Buffer.from(camtMessage, 'latin1').toString('utf8') : camtMessage;
}

/**
 * Parses CAMT documents (one per booking day) and combines their statements. A failure
 * names the document it happened in, not the whole batch.
 */
function parseCamtDocuments(documents: string[]): Statement[] {
	return documents.flatMap((document) => {
		try {
			return new CamtParser(document).parse();
		} catch (error) {
			throw new StatementParsingError('CAMT', document, toError(error));
		}
	});
}
