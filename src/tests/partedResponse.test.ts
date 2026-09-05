import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankingInformation } from '../bankingInformation.js';
import type { BankTransaction } from '../bankTransaction.js';
import { FinTSConfig } from '../config.js';
import { Dialog } from '../dialog.js';
import type { CustomerOrderInteraction } from '../interactions/customerInteraction.js';
import { ElectronicStatementInteraction } from '../interactions/electronicStatementInteraction.js';
import { StatementInteractionCAMT } from '../interactions/statementInteractionCAMT.js';
import { CustomerOrderMessage, Message } from '../message.js';
import { HICAZ, type HICAZSegment } from '../segments/HICAZ.js';
import { HKCAZ, type HKCAZSegment } from '../segments/HKCAZ.js';
import { registerSegments } from '../segments/registry.js';

vi.mock('../httpClient.js', () => ({
	HttpClient: class MockHttpClient {
		constructor(
			public url: string,
			public debug = false,
			public debugRaw = false,
		) {}
		sendMessage = vi.fn();
	},
}));

registerSegments();

const CAMT_DESCRIPTOR = 'urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.08';

/**
 * A HICAZ segment as the bank sends it. Every portion of a parted response is a
 * COMPLETE segment — it repeats account and descriptor before carrying its own share
 * of the CAMT documents.
 */
function hicazText(...camtDocuments: string[]): string {
	const booked = camtDocuments.map((doc) => `@${doc.length}@${doc}`).join(':');
	return `HICAZ:5:1+DE991234567123456:BANK12+${CAMT_DESCRIPTOR}+${booked}'`;
}

function responseMessage(hicaz: string, withContinuation: boolean): Message {
	const answers = withContinuation
		? "HIRMG:3:2+0010::Entgegengenommen.+3040::Es liegen weitere Umsaetze vor.:AUFSETZ_1'"
		: "HIRMG:3:2+0010::Entgegengenommen.+0020::Abfrage erfolgreich.'";
	return Message.decode(`${answers}${hicaz}`, HICAZ.Id);
}

describe('parted responses (bank answer code 3040)', () => {
	let config: FinTSConfig;
	let dialog: Dialog;

	beforeEach(() => {
		const bankingInformation: BankingInformation = {
			systemId: 'MOCK_SYSTEM_ID',
			bankMessages: [],
			bpd: {
				version: 1,
				bankId: '12030000',
				bankName: 'Mock Bank',
				countryCode: 280,
				url: 'http://mock.bank.url',
				allowedTransactions: [
					{ transId: 'HKCAZ', tanRequired: false, versions: [1] } as BankTransaction,
				],
				supportedTanMethods: [],
				availableTanMethodIds: [],
				maxTransactionsPerMessage: 1,
				supportedLanguages: [],
				supportedHbciVersions: [300],
			},
		} as unknown as BankingInformation;

		config = FinTSConfig.fromBankingInformation(
			'PRODUCT',
			'1.0',
			bankingInformation,
			'user',
			'pin',
		);
		dialog = new Dialog(config);
	});

	it('delivers every portion into the message the caller holds', async () => {
		const first = responseMessage(hicazText('<Doc>one</Doc>'), true);
		const second = responseMessage(hicazText('<Doc>two</Doc>', '<Doc>three</Doc>'), false);

		vi.mocked(dialog.httpClient.sendMessage).mockResolvedValueOnce(second);

		const interaction = new StatementInteractionCAMT('123');
		const request = new CustomerOrderMessage(HKCAZ.Id, HICAZ.Id);
		request.addSegment({
			header: { segId: HKCAZ.Id, segNr: 0, version: 1 },
			account: { iban: 'DE991234567123456', bic: 'BANK12' },
			acceptedCamtFormats: ['urn:iso:std:iso:20022:tech:xsd:camt.052.001.08'],
			allAccounts: false,
		} as HKCAZSegment);

		// biome-ignore lint/suspicious/noExplicitAny: reaching into the private collector on purpose
		(dialog as any).currentOrderSegments = request.segments.filter(
			(s) => s.header.segId === HKCAZ.Id,
		);
		dialog.addCustomerInteraction(interaction);
		dialog.currentInteractionIndex = 1;
		// biome-ignore lint/suspicious/noExplicitAny: reaching into the private collector on purpose
		await (dialog as any).handlePartedMessages(first);

		// The continuation is the order again, with the mark — and an ORDER message, so
		// the HTTP client holds the response segment for the next round.
		const sent = vi.mocked(dialog.httpClient.sendMessage).mock.calls[0][0] as CustomerOrderMessage;
		expect(sent).toBeInstanceOf(CustomerOrderMessage);
		expect(sent.orderResponseSegId).toBe(HICAZ.Id);
		const continued = sent.findSegment<HKCAZSegment & { continuationMark?: string }>(HKCAZ.Id);
		expect(continued?.continuationMark).toBe('AUFSETZ_1');

		// Before the fix this was a single unresolved PARTED segment and everything after
		// the first portion was lost without a trace.
		const segments = first.findAllSegments<HICAZSegment>(HICAZ.Id);
		expect(first.findAllSegments('PARTED')).toHaveLength(0);
		expect(segments).toHaveLength(2);
		expect(segments.flatMap((s) => s.bookedTransactions)).toEqual([
			'<Doc>one</Doc>',
			'<Doc>two</Doc>',
			'<Doc>three</Doc>',
		]);
	});

	it('leaves an unparted response untouched', async () => {
		const only = responseMessage(hicazText('<Doc>one</Doc>'), false);

		const interaction = new StatementInteractionCAMT('123');
		const request = new CustomerOrderMessage(HKCAZ.Id, HICAZ.Id);
		request.addSegment({
			header: { segId: HKCAZ.Id, segNr: 0, version: 1 },
			account: { iban: 'DE991234567123456', bic: 'BANK12' },
			acceptedCamtFormats: ['urn:iso:std:iso:20022:tech:xsd:camt.052.001.08'],
			allAccounts: false,
		} as HKCAZSegment);

		// biome-ignore lint/suspicious/noExplicitAny: reaching into the private collector on purpose
		(dialog as any).currentOrderSegments = request.segments.filter(
			(s) => s.header.segId === HKCAZ.Id,
		);
		dialog.addCustomerInteraction(interaction);
		dialog.currentInteractionIndex = 1;
		// biome-ignore lint/suspicious/noExplicitAny: reaching into the private collector on purpose
		await (dialog as any).handlePartedMessages(only);

		expect(dialog.httpClient.sendMessage).not.toHaveBeenCalled();
		const segments = only.findAllSegments<HICAZSegment>(HICAZ.Id);
		expect(segments).toHaveLength(1);
		expect(segments[0].bookedTransactions).toEqual(['<Doc>one</Doc>']);
	});
});

describe('StatementInteractionCAMT with a parted response', () => {
	it('parses the CAMT documents of every segment, not just the first', () => {
		const camt = (id: string, amount: string) =>
			`<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08">` +
			`<BkToCstmrAcctRpt><GrpHdr><MsgId>${id}</MsgId><CreDtTm>2026-07-01T10:00:00+02:00</CreDtTm></GrpHdr>` +
			`<Rpt><Id>${id}</Id><Acct><Id><IBAN>DE991234567123456</IBAN></Id><Ccy>EUR</Ccy></Acct>` +
			`<Bal><Tp><CdOrPrtry><Cd>PRCD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1000.00</Amt>` +
			`<CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-06-30</Dt></Dt></Bal>` +
			`<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">990.00</Amt>` +
			`<CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-07-01</Dt></Dt></Bal>` +
			`<Ntry><Amt>${amount}</Amt><CdtDbtInd>DBIT</CdtDbtInd>` +
			`<BookgDt><Dt>2026-07-01</Dt></BookgDt><ValDt><Dt>2026-07-01</Dt></ValDt>` +
			`<AcctSvcrRef>TXN${id}</AcctSvcrRef>` +
			`<NtryDtls><TxDtls><RmtInf><Ustrd>Test ${id}</Ustrd></RmtInf></TxDtls></NtryDtls>` +
			`</Ntry></Rpt></BkToCstmrAcctRpt></Document>`;

		const message = Message.decode(
			`${hicazText(camt('A', '10.00'))}${hicazText(camt('B', '20.00'))}`,
		);
		expect(message.findAllSegments(HICAZ.Id)).toHaveLength(2);

		const interaction = new StatementInteractionCAMT('123');
		const clientResponse = { statements: [] } as never;
		interaction.handleResponse(message, clientResponse);

		const transactions = (
			clientResponse as unknown as { statements: { transactions: unknown[] }[] }
		).statements.flatMap((s) => s.transactions);
		expect(transactions).toHaveLength(2);
	});
});

describe('several response segments in one bank message', () => {
	it('resolves every portion, not just the first', async () => {
		// Eine Botschaft mit ZWEI HICAZ-Segmenten. Vorher wurde nur das erste aufgeloest;
		// das zweite blieb als PARTED im Baum und war fuer findAllSegments unsichtbar.
		const answers = "HIRMG:3:2+0010::Entgegengenommen.+0020::Abfrage erfolgreich.'";
		const message = Message.decode(
			`${answers}${hicazText('<Doc>one</Doc>')}${hicazText('<Doc>two</Doc>')}`,
			HICAZ.Id,
		);
		expect(message.findAllSegments('PARTED')).toHaveLength(2);

		const dialog = new Dialog(
			FinTSConfig.fromBankingInformation(
				'PRODUCT',
				'1.0',
				{
					systemId: 'X',
					bankMessages: [],
					bpd: {
						version: 1,
						bankId: '12030000',
						bankName: 'Mock',
						countryCode: 280,
						url: 'http://mock.bank.url',
						allowedTransactions: [{ transId: 'HKCAZ', tanRequired: false, versions: [1] }],
						supportedTanMethods: [],
						availableTanMethodIds: [],
						maxTransactionsPerMessage: 1,
						supportedLanguages: [],
						supportedHbciVersions: [300],
					},
					// biome-ignore lint/suspicious/noExplicitAny: schlanker Mock
				} as any,
				'user',
				'pin',
			),
		);

		const request = new CustomerOrderMessage(HKCAZ.Id, HICAZ.Id);
		request.addSegment({
			header: { segId: HKCAZ.Id, segNr: 0, version: 1 },
			account: { iban: 'DE991234567123456', bic: 'BANK12' },
			acceptedCamtFormats: ['urn:iso:std:iso:20022:tech:xsd:camt.052.001.08'],
			allAccounts: false,
		} as HKCAZSegment);

		// biome-ignore lint/suspicious/noExplicitAny: private Sammelroutine, absichtlich
		(dialog as any).currentOrderSegments = request.segments.filter(
			(s) => s.header.segId === HKCAZ.Id,
		);
		dialog.addCustomerInteraction(new StatementInteractionCAMT('123'));
		dialog.currentInteractionIndex = 1;
		// biome-ignore lint/suspicious/noExplicitAny: private Sammelroutine, absichtlich
		await (dialog as any).handlePartedMessages(message);

		expect(message.findAllSegments('PARTED')).toHaveLength(0);
		const segments = message.findAllSegments<HICAZSegment>(HICAZ.Id);
		expect(segments).toHaveLength(2);
		expect(segments.flatMap((s) => s.bookedTransactions)).toEqual([
			'<Doc>one</Doc>',
			'<Doc>two</Doc>',
		]);
	});

	it('does not mistake a parameter segment for a response segment', () => {
		// HICAZS begins like HICAZ. Without the colon in the comparison it would be held
		// back as PARTED and never decoded — the same for HIEKAS/HIEKA, HIKAZS/HIKAZ.
		const hicazs =
			"HICAZS:16:1:4+1+1+0+450:N:N:urn?:iso?:std?:iso?:20022?:tech?:xsd?:camt.052.001.08'";
		const message = Message.decode(hicazs, HICAZ.Id);
		expect(message.findAllSegments('PARTED')).toHaveLength(0);
		expect(message.findAllSegments('HICAZS')).toHaveLength(1);
	});
});

describe('a parted response after a TAN', () => {
	// Under PSD2 a statement request beyond 90 days needs a TAN, so the bank's response
	// — and its "more data follows" — arrives on the TAN message. That message used to
	// be a plain CustomerMessage: the HTTP client had no response segment to hold, the
	// 3040 went unheard, and a caller got the first 100 of 185 transactions as a
	// complete success.
	function dialogWithOrder(
		interaction: CustomerOrderInteraction = new StatementInteractionCAMT('123'),
	): Dialog {
		const config = FinTSConfig.fromBankingInformation(
			'PRODUCT',
			'1.0',
			{
				systemId: 'X',
				bankMessages: [],
				bpd: {
					version: 1,
					bankId: '12030000',
					bankName: 'Mock',
					countryCode: 280,
					url: 'http://mock.bank.url',
					allowedTransactions: [
						{ transId: 'HKCAZ', tanRequired: true, versions: [1] },
						{ transId: 'HKEKA', tanRequired: false, versions: [5] },
					],
					supportedTanMethods: [],
					availableTanMethodIds: [],
					maxTransactionsPerMessage: 1,
					supportedLanguages: [],
					supportedHbciVersions: [300],
				},
				// biome-ignore lint/suspicious/noExplicitAny: lean mock
			} as any,
			'user',
			'pin',
		);
		const dialog = new Dialog(config);
		dialog.addCustomerInteraction(interaction);
		dialog.currentInteractionIndex = 1; // the order is waiting for its TAN
		return dialog;
	}

	it('sends the TAN as an order message, so the response segment is held', () => {
		const dialog = dialogWithOrder();
		// biome-ignore lint/suspicious/noExplicitAny: private builder, on purpose
		const tanMessage = (dialog as any).createCurrentTanMessage('REF-1', '123456');
		expect(tanMessage).toBeInstanceOf(CustomerOrderMessage);
		expect((tanMessage as CustomerOrderMessage).orderResponseSegId).toBe(HICAZ.Id);
	});

	it('sends the TAN for the initialisation as a plain message', () => {
		const dialog = dialogWithOrder();
		dialog.currentInteractionIndex = 0;
		// biome-ignore lint/suspicious/noExplicitAny: private builder, on purpose
		const tanMessage = (dialog as any).createCurrentTanMessage('REF-1', '123456');
		expect(tanMessage).not.toBeInstanceOf(CustomerOrderMessage);
	});

	it('refuses to return a partial response when nothing was held for continuation', async () => {
		// Decoded without a segment id to hold — as the response to a plain message is.
		const unheld = Message.decode(
			"HIRMG:3:2+0010::Entgegengenommen.+3040::Es liegen weitere Umsaetze vor.:AUFSETZ_1'" +
				hicazText('<Doc>one</Doc>'),
		);
		const dialog = dialogWithOrder();
		await expect(
			// biome-ignore lint/suspicious/noExplicitAny: private collector, on purpose
			(dialog as any).handlePartedMessages(unheld),
		).rejects.toThrow(/announced more data for HKCAZ .* no response segment was held/);
	});

	it('leaves 3040 to an interaction whose order cannot be continued', async () => {
		// HKEKA announces its next document with 3040 and an offset; the interaction
		// reads that itself. Nothing to hold, nothing to complain about.
		const message = Message.decode(
			"HIRMG:3:2+0010::Entgegengenommen.+3040::Weitere Dokumente.:OFFSET_1'",
		);
		const dialog = dialogWithOrder(new ElectronicStatementInteraction('123'));
		await expect(
			// biome-ignore lint/suspicious/noExplicitAny: private collector, on purpose
			(dialog as any).handlePartedMessages(message),
		).resolves.toBeUndefined();
	});

	it('refuses, not silently truncates, when the bank wants a TAN for the continuation', async () => {
		const dialog = dialogWithOrder();
		// biome-ignore lint/suspicious/noExplicitAny: private state, on purpose
		(dialog as any).currentOrderSegments = [
			{
				header: { segId: HKCAZ.Id, segNr: 0, version: 1 },
				account: { iban: 'DE991234567123456', bic: 'BANK12' },
				acceptedCamtFormats: ['urn:iso:std:iso:20022:tech:xsd:camt.052.001.08'],
				allAccounts: false,
			} as HKCAZSegment,
		];
		const first = responseMessage(hicazText('<Doc>one</Doc>'), true);
		const tanDemand = Message.decode(
			"HIRMG:3:2+0030::Auftrag entgegengenommen. Bitte TAN eingeben.'HITAN:4:6:3+4++REF-2+Bitte TAN'",
			HICAZ.Id,
		);
		vi.mocked(dialog.httpClient.sendMessage).mockResolvedValueOnce(tanDemand);

		await expect(
			// biome-ignore lint/suspicious/noExplicitAny: private collector, on purpose
			(dialog as any).handlePartedMessages(first),
		).rejects.toThrow(/requires a TAN to continue the parted response/);
	});
});
