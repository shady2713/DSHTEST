/**
 * Public request and result vocabulary consumed by the generated Client.
 * @module @deepseek-ai/dsh-web-test-conversation/types
 */
export type {
  ActionOutcome, ActionRequest, CommandCatalogue, CommandAvailability, CommandVerb,
  MutatingCommandVerb, StatusSubject, StatusReport, StatusQueryRequest,
  ClarificationRequest, ClarificationCause,
} from './command.ts'
export type {
  ProjectSummary, AttachProjectRequest, ConversationRegistrationRequest, ConversationDeclarationRequest,
  ConversationEntryUrlProbeRequest,
  ConversationProjectUpdateRequest,
} from './commands.ts'
export type { WebTestConversationErrorCode } from './errors.ts'
