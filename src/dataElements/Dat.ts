import { DataElement } from './DataElement.js';

export class Dat extends DataElement {
	constructor(name: string, minCount = 0, maxCount = 1, minVersion?: number, maxVersion?: number) {
		super(name, minCount, maxCount, minVersion, maxVersion);
	}

	/**
	 * A FinTS date is a calendar day, and the Date that stands for it is read in local
	 * time: the day a caller sees is the day the bank named. `toISOString` would give the
	 * UTC day instead, which for a Date at local midnight east of Greenwich is the day
	 * before — a request for June 1st would go out as May 31st.
	 */
	encode(value: Date): string {
		if (!value) {
			return '';
		}
		const year = value.getFullYear().toString().padStart(4, '0');
		const month = (value.getMonth() + 1).toString().padStart(2, '0');
		const day = value.getDate().toString().padStart(2, '0');
		return `${year}${month}${day}`;
	}

	/**
	 * Noon local time, the same convention the statement parsers use. A Date is a point in
	 * time, and a calendar day needs one that stays on that day however it is looked at:
	 * midnight UTC is the evening before in the Americas, midnight local time is the
	 * evening before once `JSON.stringify` has turned it into UTC. Noon survives both.
	 */
	decode(text: string): Date {
		return new Date(
			Number(text.substring(0, 4)),
			Number(text.substring(4, 6)) - 1,
			Number(text.substring(6, 8)),
			12,
		);
	}

	toString(value: Date) {
		return super.toString(value?.toDateString());
	}
}
