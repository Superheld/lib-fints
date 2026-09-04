import { TanMediaClass, TanMediaType } from '../codes.js';
import type { FinTSConfig } from '../config.js';
import type { Message } from '../message.js';
import type { Segment } from '../segment.js';
import { HITAB, type HITABSegment } from '../segments/HITAB.js';
import { HKTAB, type HKTABSegment } from '../segments/HKTAB.js';
import { type ClientResponse, CustomerOrderInteraction } from './customerInteraction.js';

/** `tanMediaList` is absent when the order did not go through — `success` false or `requiresTan` true. */
export interface TanMediaResponse extends ClientResponse {
	tanMediaList?: string[];
}

export class TanMediaInteraction extends CustomerOrderInteraction {
	constructor() {
		super(HKTAB.Id, HITAB.Id);
	}

	createSegments(init: FinTSConfig): Segment[] {
		const version = init.getMaxSupportedTransactionVersion(HKTAB.Id);

		if (!version) {
			throw Error(`There is no supported version for business transaction '${HKTAB.Id}`);
		}

		const hktab: HKTABSegment = {
			header: { segId: HKTAB.Id, segNr: 0, version: version },
			mediaType: TanMediaType.All,
			mediaClass: TanMediaClass.All,
		};

		return [hktab];
	}

	handleResponse(response: Message, clientResponse: TanMediaResponse) {
		const hitab = response.findSegment<HITABSegment>(HITAB.Id);
		if (hitab) {
			const tanMediaList = (hitab.mediaList ?? [])
				.map((media) => media.name)
				.filter((name) => name) as string[];
			clientResponse.tanMediaList = tanMediaList;

			const tanMethod = this.dialog?.config.selectedTanMethod;
			if (tanMethod) {
				tanMethod.activeTanMedia = tanMediaList;
			}
		}
	}
}
