/** Project commands validate scope; the URL probe reaches only registered addresses and never dispatches a test. */
const CONVERSATION_METADATA_TOOLS: ReadonlySet<string> = new Set([
  'web_test_query',
  'web_test_register_project',
  'web_test_update_project',
  'web_test_probe_entry_urls',
  'web_test_attach',
  'web_test_declare_environment',
  'web_test_action',
  'web_test_submit_report',
  'ask_user_question',
])

/**
 * Recognize the application's closed metadata and question-tool set, separate from I/O capability masks.
 * @param name - globally registered tool name.
 * @returns whether the validated handler may run before a project is confirmed.
 */
export function isConversationMetadataTool(name: string): boolean {
  return CONVERSATION_METADATA_TOOLS.has(name)
}
