import { YesNo } from '../dataElements/YesNo.js';
import {
	BusinessTransactionParameter,
	type BusinessTransactionParameterSegment,
} from './businessTransactionParameter.js';

export type HKWPDSegment = BusinessTransactionParameterSegment<HIWPDSParameter>;

export type HIWPDSParameter = {
	/** May the client cap how many holdings come back? — `maxEntries` */
	entryCountAllowed?: boolean;
	/** May the client ask for a particular currency? — `currency` */
	currencySelectable?: boolean;
	/** May the client choose real-time over delayed prices? — `priceQuality` */
	priceQualitySelectable?: boolean;
};

/**
 * Parameters for HKWPD business transaction (securities portfolio).
 *
 * The three flags govern exactly the three optional arguments of
 * `FinTSClient.getPortfolio(account, currency, priceQuality, maxEntries)`. Without
 * them a caller has no way to know whether passing any of the three is allowed, and
 * sends them hoping.
 *
 * They are optional here rather than mandatory as the current specification has them:
 * that text documents version 6 and later, and banks are still answering with version
 * 5, whose field list is no longer published. Declaring them mandatory would make a
 * shorter v5 fail to decode — and a segment that fails to decode is worse than one
 * that decodes to nothing.
 */
export class HIWPDS extends BusinessTransactionParameter {
	static Id = 'HIWPDS';
	version = 6;

	constructor() {
		super(
			HIWPDS.Id,
			[
				new YesNo('entryCountAllowed', 0, 1),
				new YesNo('currencySelectable', 0, 1),
				new YesNo('priceQualitySelectable', 0, 1),
			],
			6,
		);
	}
}
