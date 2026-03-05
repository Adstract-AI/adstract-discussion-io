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
}

export interface RecentMessagesResult {
  messages: ChatMessage[]
  capturedAt: number
  error?: string
}

export interface AutofillTextRequest {
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
  DEBUG_GET_MESSAGES: DebugGetMessagesRequest
  DEBUG_CLEAR_MESSAGES: undefined
  DEBUG_CLEAR_LOGS: undefined
  GENERATE_PARTICIPATION: ParticipationRequest
  GET_POPUP_STATE: undefined
  SESSION_GET_STATE: undefined
  SESSION_START: undefined
  SESSION_END: undefined
  SESSION_LIST: undefined
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
  DEBUG_GET_MESSAGES: 'DEBUG_GET_MESSAGES',
  DEBUG_CLEAR_MESSAGES: 'DEBUG_CLEAR_MESSAGES',
  DEBUG_CLEAR_LOGS: 'DEBUG_CLEAR_LOGS',
  GENERATE_PARTICIPATION: 'GENERATE_PARTICIPATION',
  GET_POPUP_STATE: 'GET_POPUP_STATE',
  SESSION_GET_STATE: 'SESSION_GET_STATE',
  SESSION_START: 'SESSION_START',
  SESSION_END: 'SESSION_END',
  SESSION_LIST: 'SESSION_LIST',
  FETCH_RECENT_MESSAGES: 'FETCH_RECENT_MESSAGES',
  RECENT_MESSAGES_RESULT: 'RECENT_MESSAGES_RESULT',
  AUTOFILL_TEXT: 'AUTOFILL_TEXT',
  POPUP_STATE_UPDATE: 'POPUP_STATE_UPDATE',
} as const
