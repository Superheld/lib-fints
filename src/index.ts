import { registerSegments } from './segments/registry.js';

registerSegments();

export * from './accountBalance.js';
export * from './bankAccount.js';
export * from './bankAnswer.js';
export * from './bankingInformation.js';
export * from './bpd.js';
export * from './client.js';
export * from './config.js';
export * from './dialog.js';
export * from './electronicStatement.js';
export * from './httpClient.js';
// The interactions themselves, not only their response types.
// `FinTSClient.startCustomerOrderInteraction` is public and takes a
// `CustomerOrderInteraction`, so the door was public while the handle was not:
// building one meant importing from `dist/` by path. Anyone extending an interaction
// to work around a bank quirk — which is how two of the fixes in this library were
// found — needs the classes.
export { AccountBalanceResponse, BalanceInteraction } from './interactions/balanceInteraction.js';
export { CreditCardStatementInteraction } from './interactions/creditcardStatementInteraction.js';
export {
	ClientResponse,
	CustomerOrderInteraction,
	StatementResponse,
} from './interactions/customerInteraction.js';
export {
	ElectronicStatementInteraction,
	ElectronicStatementOptions,
	ElectronicStatementResponse,
} from './interactions/electronicStatementInteraction.js';
export { PortfolioInteraction, PortfolioResponse } from './interactions/portfolioInteraction.js';
export { SepaAccountInteraction, SepaAccountResponse } from './interactions/sepaAccountInteraction.js';
export { StatementInteractionCAMT } from './interactions/statementInteractionCAMT.js';
export { StatementInteractionMT940 } from './interactions/statementInteractionMT940.js';
export * from './message.js';
export * from './mt535parser.js';
export * from './mt940parser.js';
export * from './segment.js';
export { StatementFormat } from './segments/HKEKA.js';
export * from './statement.js';
export * from './upd.js';
