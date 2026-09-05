import { TanMediaRequirement, TanProcess } from './codes.js';
import type { FinTSConfig } from './config.js';
import { HttpClient } from './httpClient.js';
import {
	type ClientResponse,
	type CustomerInteraction,
	CustomerOrderInteraction,
} from './interactions/customerInteraction.js';
import { EndDialogInteraction } from './interactions/endDialogInteraction.js';
import { InitDialogInteraction } from './interactions/initDialogInteraction.js';
import { CustomerMessage, CustomerOrderMessage, type Message } from './message.js';
import { PARTED, type PartedSegment } from './partedSegment.js';
import type { Segment, SegmentWithContinuationMark } from './segment.js';
import { decode } from './segment.js';
import { HKEND } from './segments/HKEND.js';
import { HKTAN, type HKTANSegment } from './segments/HKTAN.js';
import { getSegmentDefinition } from './segments/registry.js';

export class Dialog {
	dialogId: string = '0';
	lastMessageNumber = 0;
	interactions: CustomerInteraction[] = [];
	responses: Map<string, ClientResponse> = new Map();
	currentInteractionIndex = 0;
	isInitialized = false;
	hasEnded = false;
	httpClient: HttpClient;
	/**
	 * The order segments of the customer order last sent, kept so a parted response can
	 * be continued from them. The continuation cannot be built from the message last
	 * sent: after a TAN that message is the TAN message, which carries HKTAN and not the
	 * order — and a response the bank splits arrives on exactly that message whenever the
	 * order needed a TAN, which under PSD2 every statement request beyond 90 days does.
	 */
	private currentOrderSegments: Segment[] = [];

	constructor(
		public config: FinTSConfig,
		syncSystemId: boolean = false,
	) {
		if (!this.config) {
			throw new Error('configuration must be provided');
		}

		this.httpClient = this.getHttpClient();
		this.interactions.push(new InitDialogInteraction(this.config, syncSystemId));
		this.interactions.push(new EndDialogInteraction());
		this.interactions.forEach((interaction) => {
			interaction.dialog = this;
		});
	}

	get currentInteraction(): CustomerInteraction {
		return this.interactions[this.currentInteractionIndex];
	}

	async start(): Promise<Map<string, ClientResponse>> {
		if (this.isInitialized) {
			throw new Error('dialog has already been initialized');
		}

		if (this.hasEnded) {
			throw Error('cannot start a dialog that has already ended');
		}

		if (this.lastMessageNumber > 0) {
			throw new Error('dialog start can only be called on a new dialog');
		}

		await this.run(() => this.createCurrentCustomerMessage());

		return this.responses;
	}

	async continue(tanOrderReference: string, tan?: string): Promise<Map<string, ClientResponse>> {
		if (!tanOrderReference) {
			throw Error('tanOrderReference must be provided to continue a customer order with a TAN');
		}

		if (!this.config.selectedTanMethod?.isDecoupled && !tan) {
			throw Error('TAN must be provided for non-decoupled TAN methods');
		}

		if (this.hasEnded) {
			throw Error('cannot continue a customer order when dialog has already ended');
		}

		if (!this.currentInteraction) {
			throw new Error('there is no running customer interaction in this dialog to continue');
		}

		await this.run(() => this.createCurrentTanMessage(tanOrderReference, tan));

		return this.responses;
	}

	/**
	 * Runs the interactions from the current one on, the first with the message given.
	 *
	 * A dialog the bank has opened stays open at the bank until HKEND reaches it. When
	 * an order fails, this used to stop right there: the refusal came back, the dialog
	 * stayed open, and a caller that retried opened another one each time — until the
	 * bank refused those for being too many. The same when handling a response threw.
	 * Both now end the dialog first: a refusal moves straight on to HKEND, an exception
	 * sends HKEND as best it can and is then rethrown. Neither applies while the dialog
	 * is not open yet — a failed initialisation has nothing to end.
	 */
	private async run(firstMessage: () => CustomerMessage): Promise<void> {
		let message = firstMessage();
		let proceed: boolean;

		try {
			do {
				const responseMessage = await this.httpClient.sendMessage(message);
				await this.handlePartedMessages(responseMessage);
				const clientResponse = this.currentInteraction.handleClientResponse(responseMessage);
				this.checkEnded(clientResponse);
				this.dialogId = clientResponse.dialogId;
				this.responses.set(this.currentInteraction.segId, clientResponse);

				proceed = this.advance(clientResponse);
				if (proceed) {
					message = this.createCurrentCustomerMessage();
				}
			} while (proceed);
		} catch (error) {
			await this.endAfterFailure();
			throw error;
		}
	}

	/** Moves on from the interaction just answered; says whether there is one to run now. */
	private advance(response: ClientResponse): boolean {
		if (response.requiresTan) {
			return false;
		}

		if (response.success) {
			this.currentInteractionIndex++;
			this.isInitialized = true;
			return !this.hasEnded && this.currentInteractionIndex < this.interactions.length;
		}

		if (!this.isOpenAtTheBank()) {
			return false;
		}

		this.currentInteractionIndex = this.interactions.length - 1;
		return true;
	}

	/**
	 * Open at the bank, and this is not already the ending: the initialisation went
	 * through, the bank has not ended it, and the interaction at hand is not HKEND.
	 */
	private isOpenAtTheBank(): boolean {
		return (
			this.isInitialized &&
			!this.hasEnded &&
			this.currentInteractionIndex < this.interactions.length - 1
		);
	}

	/**
	 * Sends HKEND for a dialog an exception left open. Best effort: whatever goes wrong
	 * here is not what the caller needs to hear about — the exception that got us here is.
	 */
	private async endAfterFailure(): Promise<void> {
		if (!this.isOpenAtTheBank()) {
			return;
		}

		this.currentInteractionIndex = this.interactions.length - 1;

		try {
			const message = this.createCurrentCustomerMessage();
			const responseMessage = await this.httpClient.sendMessage(message);
			const clientResponse = this.currentInteraction.handleClientResponse(responseMessage);
			this.checkEnded(clientResponse);
			this.responses.set(this.currentInteraction.segId, clientResponse);
		} catch {
			// The dialog may stay open at the bank; the caller gets the original error.
		}
	}

	addCustomerInteraction(interaction: CustomerInteraction, afterCurrent = false): void {
		if (this.hasEnded) {
			throw Error('cannot queue another customer interaction when dialog has already ended');
		}

		const isCustomerOrder = interaction instanceof CustomerOrderInteraction;

		if (isCustomerOrder && !this.config.isTransactionSupported(interaction.segId)) {
			throw Error(
				`customer order transaction ${interaction.segId} is not supported according to the BPD`,
			);
		}

		interaction.dialog = this;

		if (afterCurrent) {
			this.interactions.splice(this.currentInteractionIndex + 1, 0, interaction);
			return;
		}

		this.interactions.splice(this.interactions.length - 1, 0, interaction);
	}

	/**
	 * The message for the current interaction. The order segments are built by the
	 * interaction unless given — a continuation of a parted response gives the ones
	 * sent before, with the continuation mark set.
	 */
	private createCurrentCustomerMessage(orderSegments?: Segment[]): CustomerMessage {
		this.lastMessageNumber++;

		const isCustomerOrder = this.currentInteraction instanceof CustomerOrderInteraction;
		const message = this.newMessageForCurrentInteraction();

		const tanMethod = this.config.selectedTanMethod;
		const isScaSupported = tanMethod && tanMethod.version >= 6;
		let isTanMethodNeeded = isScaSupported && this.currentInteraction.segId !== HKEND.Id;

		if (isCustomerOrder) {
			const bankTransaction = this.config.bankingInformation.bpd?.allowedTransactions.find(
				(t) => t.transId === this.currentInteraction.segId,
			);

			isTanMethodNeeded = isTanMethodNeeded && bankTransaction?.tanRequired;
		}

		if (this.config.userId && this.config.pin) {
			message.sign(
				this.config.countryCode,
				this.config.bankId,
				this.config.userId,
				this.config.pin,
				this.config.bankingInformation.systemId,
				isScaSupported ? this.config.tanMethodId : undefined,
			);
		}

		const segments = orderSegments ?? this.currentInteraction.getSegments(this.config);
		segments.forEach((segment) => {
			message.addSegment(segment);
		});
		if (isCustomerOrder) {
			this.currentOrderSegments = segments;
		}

		if (this.config.userId && this.config.pin && isTanMethodNeeded) {
			const hktan: HKTANSegment = {
				header: { segId: HKTAN.Id, segNr: 0, version: tanMethod?.version ?? 0 },
				tanProcess: TanProcess.Process4,
				segId: this.currentInteraction.segId,
				tanMedia: this.getTanMediaName(),
			};

			message.addSegment(hktan);
		}

		return message;
	}

	private createCurrentTanMessage(tanOrderReference: string, tan?: string): CustomerMessage {
		this.lastMessageNumber++;
		// An order message, not a plain one, when a customer order is waiting for the
		// TAN: the response to this message is the order's response, and the HTTP client
		// needs to know which segment to hold for continuation. As a plain message the
		// bank's "more data follows" went unheard, and a caller got the first 100 of 185
		// transactions as a complete success.
		const message = this.newMessageForCurrentInteraction();

		if (this.config.userId && this.config.pin) {
			message.sign(
				this.config.countryCode,
				this.config.bankId,
				this.config.userId,
				this.config.pin,
				this.config.bankingInformation?.systemId,
				this.config.tanMethodId,
				tan,
			);
		}

		if (this.config.userId && this.config.pin && this.config.tanMethodId) {
			const hktan: HKTANSegment = {
				header: { segId: HKTAN.Id, segNr: 0, version: this.config.selectedTanMethod?.version ?? 0 },
				tanProcess: this.config.selectedTanMethod?.isDecoupled
					? TanProcess.Status
					: TanProcess.Process2,
				segId: this.currentInteraction.segId,
				orderRef: tanOrderReference,
				nextTan: false,
				tanMedia: this.getTanMediaName(),
			};

			message.addSegment(hktan);
		}
		return message;
	}

	private newMessageForCurrentInteraction(): CustomerMessage {
		const interaction = this.currentInteraction;
		return interaction instanceof CustomerOrderInteraction
			? new CustomerOrderMessage(
					interaction.segId,
					interaction.responseSegId,
					this.dialogId,
					this.lastMessageNumber,
				)
			: new CustomerMessage(this.dialogId, this.lastMessageNumber);
	}

	private getTanMediaName(): string | undefined {
		const requirement =
			this.config.selectedTanMethod?.tanMediaRequirement ?? TanMediaRequirement.NotAllowed;

		if (requirement === TanMediaRequirement.NotAllowed) {
			return undefined;
		}

		if (requirement === TanMediaRequirement.Required) {
			return this.config.tanMediaName ?? 'default';
		}

		return this.config.tanMediaName;
	}

	/**
	 * Collects a response that the bank spreads over several messages.
	 *
	 * When the bank cannot fit a response into one message it answers with code 3040 plus
	 * a continuation mark. Repeating the order with that mark yields the next portion —
	 * as a COMPLETE, self-contained response segment, not as a byte-wise continuation of
	 * the previous one. A HICAZ follow-up, for example, repeats the account and the CAMT
	 * descriptor before carrying its own share of the statements.
	 *
	 * Every portion is therefore decoded on its own and all of them are placed into the
	 * response message the caller holds. Combining their payloads needs to know what the
	 * payload means — one MT940 stream continues, a list of CAMT documents is appended —
	 * so that step belongs to the interaction, which does it via `findAllSegments`.
	 */
	private async handlePartedMessages(responseMessage: Message) {
		const interaction = this.currentInteraction;
		// ALL of them, not just the first: one bank message may well carry several
		// response segments. Taking only the first left the rest sitting in the tree as
		// PARTED, where `findAllSegments` cannot see them — lost without a trace.
		const partedSegments = responseMessage.findAllSegments<PartedSegment>(PARTED.Id);

		if (partedSegments.length === 0) {
			// Nothing held for continuation — yet the bank says more follows, and the order
			// is one that can be continued. Returning here left the caller with a partial
			// list and a success. An order that cannot be continued (HKEKA announces its
			// next document with 3040 as well) is the interaction's business.
			if (responseMessage.hasReturnCode(3040) && this.canBeContinued(interaction)) {
				throw new Error(
					`The bank announced more data for ${interaction.segId} (code 3040), but no response ` +
						`segment was held for continuation — the response cannot be completed`,
				);
			}
			return;
		}

		// The message the caller holds — every portion has to end up in THIS one, not in
		// the last one we happen to receive.
		const callersMessage = responseMessage;
		const rawPortions = partedSegments.map((segment) => segment.rawData);
		const marksSeen = new Set<string>();

		while (responseMessage.hasReturnCode(3040)) {
			const answer = responseMessage.getBankAnswers().find((a) => a.code === 3040);
			const mark = answer?.params?.[0];
			if (!mark) {
				throw new Error('Expected bank answer to contain continuation mark parameters (code 3040)');
			}
			if (marksSeen.has(mark)) {
				throw new Error(
					`The bank repeated continuation mark '${mark}' — giving up to avoid a loop`,
				);
			}
			marksSeen.add(mark);

			// The continuation is the order again, with the mark — built from the order
			// segments kept when the order went out, since the message last sent may have
			// been the TAN message. Signed and, where the order needs one, with HKTAN, as
			// the first request was.
			const orderSegment = this.currentOrderSegments.find(
				(s) => s.header.segId === interaction.segId,
			) as SegmentWithContinuationMark | undefined;
			if (!orderSegment) {
				throw new Error(
					`The bank announced more data for ${interaction.segId} (code 3040), but the order ` +
						`segment to continue with is not at hand`,
				);
			}
			orderSegment.continuationMark = mark;

			const nextResponseMessage = await this.httpClient.sendMessage(
				this.createCurrentCustomerMessage(this.currentOrderSegments),
			);

			// A TAN demand on a continuation is more than this handles: the portions so far
			// would have to survive a round trip through the caller. Not silent, though.
			if ([30, 3955, 3956, 3957].some((code) => nextResponseMessage.hasReturnCode(code))) {
				throw new Error(
					`The bank requires a TAN to continue the parted response of ${interaction.segId}; ` +
						`continuing across a TAN is not supported`,
				);
			}

			rawPortions.push(
				...nextResponseMessage
					.findAllSegments<PartedSegment>(PARTED.Id)
					.map((segment) => segment.rawData),
			);

			responseMessage = nextResponseMessage;
		}

		// Every PARTED placeholder gives way to the decoded portions, at the position of
		// the first one so the segment order stays intact.
		const index = callersMessage.segments.indexOf(partedSegments[0]);
		const withoutPlaceholders = callersMessage.segments.filter(
			(segment) => segment.header.segId !== PARTED.Id,
		);
		withoutPlaceholders.splice(index, 0, ...rawPortions.map((raw) => decode(raw)));
		callersMessage.segments = withoutPlaceholders;
	}

	/** Whether the order segment carries a continuation mark, i.e. the bank may split its response. */
	private canBeContinued(interaction: CustomerInteraction): boolean {
		return (
			getSegmentDefinition(interaction.segId)?.elements.some(
				(element) => element.name === 'continuationMark',
			) ?? false
		);
	}

	private checkEnded(response: ClientResponse) {
		if (
			response.bankAnswers.some((answer) => answer.code === 100) ||
			response.bankAnswers.some((answer) => answer.code === 9000)
		) {
			this.hasEnded = true;
		}
	}

	private getHttpClient(): HttpClient {
		return new HttpClient(this.config.bankingUrl, this.config.debugEnabled);
	}
}
