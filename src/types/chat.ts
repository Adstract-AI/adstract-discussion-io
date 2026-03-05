export interface ChatMessage {
  id: string
  username: string
  studentIndex?: string
  text: string
  timestamp: number
  rawTimestamp?: string
}

export interface DiscussionAnalysisRequest {
  messageWindow: number
}

export interface AnalyzeFromContextRequest {
  messageWindow: number
  capturedAt: number
  contextMessages: ChatMessage[]
}

export interface DebugGetMessagesRequest {
  limit: number
}

export interface DiscussionAnalysisResult {
  inferredQuestion: string
  contextMessages: ChatMessage[]
  capturedAt: number
}

export interface ParticipationRequest {
  inferredQuestion: string
  contextMessages: ChatMessage[]
  previousSuggestions?: string[]
  previousParticipations?: string[]
}

export interface SimilarQuestionRequest {
  inferredQuestion: string
  contextMessages: ChatMessage[]
  previousQuestions?: string[]
  previousParticipations?: string[]
}

export interface ParticipateWithTextRequest {
  text: string
  autofill?: boolean
  submit?: boolean
}

export interface SetApiKeyRequest {
  apiKey: string
}

export type AiModel = 'gpt-5.2' | 'gpt-5.3-chat-latest' | 'gpt-5-mini' | 'gpt-5-nano'
export type AgentLanguage = 'English' | 'Macedonian'

export interface PromptSemantics {
  general: string
  inferQuestion: string
  participation: string
  similarQuestion: string
}

export interface SetAiConfigRequest {
  model: AiModel
  language: AgentLanguage
  prompts: PromptSemantics
}

export interface SetContextWindowRequest {
  contextWindow: number
}

export interface DeleteSessionRequest {
  sessionId: string
}

export interface RestoreSessionRequest {
  sessionId: string
}

export interface ParticipationResult {
  text: string
  generatedAt: number
}

export interface DiscussionRecord {
  id: string
  createdAt: number
  inferredQuestion: string
  contextMessages: ChatMessage[]
  participations?: ParticipationResult[]
  participation?: ParticipationResult
  source: {
    messageWindow: number
    capturedAt: number
  }
}

export interface SessionRecord {
  id: string
  name: string
  startedAt: number
  endedAt?: number
  status: 'active' | 'ended'
  discussions: DiscussionRecord[]
}

export interface StoredData {
  schemaVersion: 1
  activeSessionId?: string
  sessions: SessionRecord[]
}

export interface FetchRecentMessagesRequest {
  limit: number
  deepFetch?: boolean
}

export interface RecentMessagesResult {
  messages: ChatMessage[]
  capturedAt: number
  error?: string
}

export interface AutofillTextRequest {
  text: string
  submit?: boolean
}

export interface ManualAutofillDraftRequest {
  text: string
}

export interface AutofillTextResult {
  success: boolean
  error?: string
}

export interface DebugSnapshot {
  collectedMessages: ChatMessage[]
  messageCount: number
  lastAnalysisAt?: number
  lastDebugFetchAt?: number
  lastError?: string
  logs?: string[]
}

export interface PopupViewState {
  isAnalyzing: boolean
  isGenerating: boolean
  isCompatibleTarget: boolean
  activeTabUrl?: string
  analysis?: DiscussionAnalysisResult
  participation?: ParticipationResult
  activeDiscussionId?: string
  sessionRequired: boolean
  activeSession?: SessionRecord
  sessionHistoryCount: number
  debug: DebugSnapshot
  lastError?: string
}

export interface RuntimeMessageMap {
  ANALYZE_DISCUSSION: DiscussionAnalysisRequest
  ANALYZE_FROM_CONTEXT: AnalyzeFromContextRequest
  DEBUG_GET_MESSAGES: DebugGetMessagesRequest
  DEBUG_CLEAR_MESSAGES: undefined
  DEBUG_CLEAR_LOGS: undefined
  GENERATE_PARTICIPATION: ParticipationRequest
  GENERATE_SIMILAR_QUESTION: SimilarQuestionRequest
  PARTICIPATE_WITH_TEXT: ParticipateWithTextRequest
  MANUAL_AUTOFILL_DRAFT: ManualAutofillDraftRequest
  GET_POPUP_STATE: undefined
  SESSION_GET_STATE: undefined
  SESSION_START: undefined
  SESSION_END: undefined
  SESSION_DELETE: DeleteSessionRequest
  SESSION_RESTORE: RestoreSessionRequest
  SESSION_LIST: undefined
  SETTINGS_CLEAR_SESSIONS: undefined
  SETTINGS_EXPORT_SESSIONS: undefined
  SETTINGS_GET: undefined
  SETTINGS_SET_API_KEY: SetApiKeyRequest
  SETTINGS_SET_AI_CONFIG: SetAiConfigRequest
  SETTINGS_SET_CONTEXT_WINDOW: SetContextWindowRequest
  FETCH_RECENT_MESSAGES: FetchRecentMessagesRequest
  RECENT_MESSAGES_RESULT: RecentMessagesResult
  AUTOFILL_TEXT: AutofillTextRequest
  POPUP_STATE_UPDATE: PopupViewState
}

export type RuntimeMessageType = keyof RuntimeMessageMap

export type RuntimeMessage<T extends RuntimeMessageType = RuntimeMessageType> =
  RuntimeMessageMap[T] extends undefined
    ? { type: T }
    : { type: T; payload: RuntimeMessageMap[T] }

export const MESSAGE_TYPES = {
  ANALYZE_DISCUSSION: 'ANALYZE_DISCUSSION',
  ANALYZE_FROM_CONTEXT: 'ANALYZE_FROM_CONTEXT',
  DEBUG_GET_MESSAGES: 'DEBUG_GET_MESSAGES',
  DEBUG_CLEAR_MESSAGES: 'DEBUG_CLEAR_MESSAGES',
  DEBUG_CLEAR_LOGS: 'DEBUG_CLEAR_LOGS',
  GENERATE_PARTICIPATION: 'GENERATE_PARTICIPATION',
  GENERATE_SIMILAR_QUESTION: 'GENERATE_SIMILAR_QUESTION',
  PARTICIPATE_WITH_TEXT: 'PARTICIPATE_WITH_TEXT',
  MANUAL_AUTOFILL_DRAFT: 'MANUAL_AUTOFILL_DRAFT',
  GET_POPUP_STATE: 'GET_POPUP_STATE',
  SESSION_GET_STATE: 'SESSION_GET_STATE',
  SESSION_START: 'SESSION_START',
  SESSION_END: 'SESSION_END',
  SESSION_DELETE: 'SESSION_DELETE',
  SESSION_RESTORE: 'SESSION_RESTORE',
  SESSION_LIST: 'SESSION_LIST',
  SETTINGS_CLEAR_SESSIONS: 'SETTINGS_CLEAR_SESSIONS',
  SETTINGS_EXPORT_SESSIONS: 'SETTINGS_EXPORT_SESSIONS',
  SETTINGS_GET: 'SETTINGS_GET',
  SETTINGS_SET_API_KEY: 'SETTINGS_SET_API_KEY',
  SETTINGS_SET_AI_CONFIG: 'SETTINGS_SET_AI_CONFIG',
  SETTINGS_SET_CONTEXT_WINDOW: 'SETTINGS_SET_CONTEXT_WINDOW',
  FETCH_RECENT_MESSAGES: 'FETCH_RECENT_MESSAGES',
  RECENT_MESSAGES_RESULT: 'RECENT_MESSAGES_RESULT',
  AUTOFILL_TEXT: 'AUTOFILL_TEXT',
  POPUP_STATE_UPDATE: 'POPUP_STATE_UPDATE',
} as const
