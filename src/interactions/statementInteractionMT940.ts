import { describeAccount, type AccountRef } from '../bankAccount.js';
import type { FinTSConfig } from '../config.js';
import { internationalAccount, nationalAccount } from '../accountDescriptor.js';
import type { Message } from '../message.js';
import { Mt940Parser } from '../mt940parser.js';
import type { Segment } from '../segment.js';
import type { Statement } from '../statement.js';
import { HIKAZ, type HIKAZSegment } from '../segments/HIKAZ.js';
import { HKKAZ, type HKKAZSegment } from '../segments/HKKAZ.js';
import {
	CustomerOrderInteraction,
	StatementParsingError,
	type StatementResponse,
	toError,
} from './customerInteraction.js';

export class StatementInteractionMT940 extends CustomerOrderInteraction {
	constructor(
		public account: AccountRef,
		public from?: Date,
		public to?: Date,
	) {
		super(HKKAZ.Id, HIKAZ.Id);
	}

	createSegments(init: FinTSConfig): Segment[] {
		const bankAccount = init.getBankAccount(this.account);
		const version = init.getMaxSupportedTransactionVersion(HKKAZ.Id);

		if (!version) {
			throw Error(`There is no supported version for business transaction '${HKKAZ.Id}'`);
		}

		const descriptor =
			version <= 6 ? nationalAccount(bankAccount) : internationalAccount(init, bankAccount);

		const hkkaz: HKKAZSegment = {
			header: { segId: HKKAZ.Id, segNr: 0, version: version },
			account: descriptor,
			allAccounts: false,
			from: this.from,
			to: this.to,
		};

		return [hkkaz];
	}

	handleResponse(response: Message, clientResponse: StatementResponse) {
		// A response the bank spread over several messages arrives as several HIKAZ
		// segments. Unlike CAMT these carry one continuous MT940 stream, so their
		// payloads are joined rather than listed.
		const segments = response.findAllSegments<HIKAZSegment>(HIKAZ.Id);
		const bookedTransactions = segments
			.map((segment) => segment.bookedTransactions)
			.filter((booked) => !!booked)
			.join('');
		const notedTransactions = segments
			.map((segment) => segment.notedTransactions)
			.filter((noted) => !!noted)
			.join('');

		clientResponse.format = 'MT940';
		clientResponse.rawStatements = [bookedTransactions];
		if (notedTransactions) {
			clientResponse.rawNotedStatements = [notedTransactions];
		}

		// A parse error propagates. Catching it and answering with an empty list — as
		// this once did — turned a broken statement into "success, no transactions":
		// a caller fetching incrementally moved on, and the bookings were gone with
		// nothing but a console warning to show for it. One bad line in one of twenty
		// statements takes the whole stream down, so the caller has to hear about it.
		clientResponse.statements = bookedTransactions ? parseMt940(bookedTransactions) : [];

		// The second field of HIKAZ, sent alongside the first and until now never read.
		// Its failure must not take the booked statements with it; see `notedStatementsError`.
		if (notedTransactions) {
			try {
				clientResponse.notedStatements = parseMt940(notedTransactions);
			} catch (error) {
				clientResponse.notedStatementsError = toError(error);
			}
		}
	}
}

/** Parses one MT940 stream; a failure carries the stream it happened in. */
function parseMt940(stream: string): Statement[] {
	try {
		return new Mt940Parser(stream).parse();
	} catch (error) {
		throw new StatementParsingError('MT940', stream, toError(error));
	}
}
