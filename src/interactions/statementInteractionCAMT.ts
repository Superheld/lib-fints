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
import { CustomerOrderInteraction, type StatementResponse } from './customerInteraction.js';

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

		// A parse error propagates: catching it and answering with an empty list — as
		// this once did — turned one broken document out of twenty into "success, no
		// transactions", and a caller fetching incrementally moved on past bookings it
		// never saw.
		clientResponse.statements = parseCamtDocuments(booked);

		// The second field of HICAZ — a complete CAMT document of the pending entries,
		// sent alongside the first and until now never read. Its failure must not take
		// the booked statements with it; see `notedStatementsError`.
		if (noted.length > 0) {
			try {
				clientResponse.notedStatements = parseCamtDocuments(noted);
			} catch (error) {
				clientResponse.notedStatementsError =
					error instanceof Error ? error : new Error(String(error));
			}
		}
	}
}

/** Parses CAMT documents (one per booking day) and combines their statements. */
function parseCamtDocuments(camtMessages: string[]): Statement[] {
	const allStatements: Statement[] = [];
	for (const camtMessage of camtMessages) {
		// The regex looks for the XML declaration `<?xml ... ?>`
		// and checks if it contains the attribute encoding="UTF-8".
		// The 'i' flag makes the match case-insensitive (e.g., for "utf-8").
		const isUtf8Encoded = /<\?xml[^>]*encoding="UTF-8"[^>]*\?>/i.test(camtMessage);

		let xmlString: string = camtMessage;
		if (isUtf8Encoded) {
			// camtMessage is initially encoded as 'latin1' (ISO-8859-1), but actually contains UTF-8 data.
			// Therefore, we need to first convert it back to a buffer using 'latin1', and then decode it as 'utf8'.
			const intermediateBuffer = Buffer.from(camtMessage, 'latin1');
			xmlString = intermediateBuffer.toString('utf8');
		}

		allStatements.push(...new CamtParser(xmlString).parse());
	}
	return allStatements;
}
