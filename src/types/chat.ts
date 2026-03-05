export interface ChatMessage {
  id: string
  username: string
  text: string
  timestamp: number
  rawTimestamp?: string
}

export interface DiscussionAnalysisRequest {
  messageWindow: number
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
  lastError?: string
}

export interface PopupViewState {
  isAnalyzing: boolean
  isGenerating: boolean
  analysis?: DiscussionAnalysisResult
  participation?: ParticipationResult
  debug: DebugSnapshot
  lastError?: string
}

export interface RuntimeMessageMap {
  ANALYZE_DISCUSSION: DiscussionAnalysisRequest
  GENERATE_PARTICIPATION: ParticipationRequest
  GET_POPUP_STATE: undefined
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
  GENERATE_PARTICIPATION: 'GENERATE_PARTICIPATION',
  GET_POPUP_STATE: 'GET_POPUP_STATE',
  FETCH_RECENT_MESSAGES: 'FETCH_RECENT_MESSAGES',
  RECENT_MESSAGES_RESULT: 'RECENT_MESSAGES_RESULT',
  AUTOFILL_TEXT: 'AUTOFILL_TEXT',
  POPUP_STATE_UPDATE: 'POPUP_STATE_UPDATE',
} as const
