import { describe, expect, it } from 'vitest';
import {
	type AccountBalanceResponse,
	BalanceInteraction,
} from '../interactions/balanceInteraction.js';
import { Message } from '../message.js';
import { registerSegments } from '../segments/registry.js';

registerSegments();

const ANSWERS = "HIRMG:3:2+0010::Entgegengenommen.+0020::Abfrage erfolgreich.'";

function balanceFrom(hisal: string) {
	const response = {} as AccountBalanceResponse;
	new BalanceInteraction('1234567890').handleResponse(
		Message.decode(`${ANSWERS}${hisal}`),
		response,
	);
	return response.balance;
}

describe('the account balance response', () => {
	it('names the product and the account the bank answered for', () => {
		const balance = balanceFrom(
			"HISAL:5:7:3+DE89370400440532013000:BANKDEFF:1234567890::280:10020030+Girokonto+EUR+C:1234,56:EUR:20260819+C:1300,:EUR:20260819+500,:EUR+1800,56:EUR'",
		);
		expect(balance?.balance).toBe(1234.56);
		expect(balance?.notedBalance).toBe(1300);
		expect(balance?.product).toBe('Girokonto');
		expect(balance?.account).toEqual({
			iban: 'DE89370400440532013000',
			accountNumber: '1234567890',
			subAccountId: undefined,
		});
	});

	it('names the account of a national-only response', () => {
		const balance = balanceFrom(
			"HISAL:5:5:3+1234567890:Giro:280:10020030+Girokonto+EUR+D:10,:EUR:20260819'",
		);
		expect(balance?.balance).toBe(-10);
		expect(balance?.account).toEqual({
			iban: undefined,
			accountNumber: '1234567890',
			subAccountId: 'Giro',
		});
	});
});
