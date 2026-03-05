import {
  MESSAGE_TYPES,
  type AutofillTextResult,
  type ChatMessage,
  type DiscussionAnalysisResult,
  type PopupViewState,
  type RuntimeMessage,
} from '../types/chat'
import { generateParticipationText, inferQuestionFromResponses } from './summarizer'

const LOG_PREFIX = '[Background]'
const DEV_MODE = import.meta.env.DEV
const DEFAULT_MESSAGE_WINDOW = 20
const DEFAULT_CONTEXT_WINDOW = 20
const STATE_STORAGE_KEY = 'discussionAssistantManualState'
const BBB_MATCHERS = [/bigbluebutton/i, /html5client/i]

let popupState: PopupViewState = {
  isAnalyzing: false,
  isGenerating: false,
  debug: {
    collectedMessages: [],
    messageCount: 0,
  },
}

function log(...args: unknown[]): void {
  if (DEV_MODE) {
    console.debug(LOG_PREFIX, ...args)
  }
}

function setLastError(message: string): void {
  popupState = {
    ...popupState,
    lastError: message,
    debug: {
      ...popupState.debug,
      lastError: message,
    },
  }
}

function clearLastError(): void {
  popupState = {
    ...popupState,
    lastError: undefined,
    debug: {
      ...popupState.debug,
      lastError: undefined,
    },
  }
}

async function safeStorageGet<T>(key: string): Promise<T | undefined> {
  try {
    const sessionStore = await chrome.storage.session.get(key)
    if (sessionStore[key] !== undefined) {
      return sessionStore[key] as T
    }
  } catch {
    // Fall through to local
  }

  try {
    const localStore = await chrome.storage.local.get(key)
    return localStore[key] as T | undefined
  } catch {
    return undefined
  }
}

async function safeStorageSet<T>(key: string, value: T): Promise<void> {
  try {
    await chrome.storage.session.set({ [key]: value })
    return
  } catch {
    // Fall through to local
  }

  await chrome.storage.local.set({ [key]: value })
}

async function persistState(): Promise<void> {
  await safeStorageSet(STATE_STORAGE_KEY, popupState)
}

async function restoreState(): Promise<void> {
  const restored = await safeStorageGet<PopupViewState>(STATE_STORAGE_KEY)
  if (restored) {
    popupState = restored
  }
}

function sendPopupStateUpdate(): void {
  const stateMessage: RuntimeMessage<'POPUP_STATE_UPDATE'> = {
    type: MESSAGE_TYPES.POPUP_STATE_UPDATE,
    payload: popupState,
  }

  chrome.runtime.sendMessage(stateMessage).catch(() => {
    // Popup may not be open.
  })
}

function isBbbUrl(url: string | undefined): boolean {
  if (!url) {
    return false
  }
  return BBB_MATCHERS.some((pattern) => pattern.test(url))
}

async function getActiveBbbTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  const activeTab = tabs.find((tab: { id?: number; url?: string }) => tab.id !== undefined && isBbbUrl(tab.url))
  return activeTab?.id ?? null
}

async function fetchRecentMessages(tabId: number, limit: number): Promise<ChatMessage[]> {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: MESSAGE_TYPES.FETCH_RECENT_MESSAGES,
    payload: {
      limit,
    },
  } satisfies RuntimeMessage<'FETCH_RECENT_MESSAGES'>)

  const typed = response as RuntimeMessage<'RECENT_MESSAGES_RESULT'> | undefined
  if (!typed || typed.type !== MESSAGE_TYPES.RECENT_MESSAGES_RESULT) {
    throw new Error('Invalid response from content script while fetching recent messages.')
  }

  if (typed.payload.error) {
    throw new Error(typed.payload.error)
  }

  return typed.payload.messages
}

async function autofillToChat(tabId: number, text: string): Promise<void> {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: MESSAGE_TYPES.AUTOFILL_TEXT,
    payload: {
      text,
    },
  } satisfies RuntimeMessage<'AUTOFILL_TEXT'>)

  const result = response as AutofillTextResult | undefined
  if (!result?.success) {
    throw new Error(result?.error ?? 'Failed to autofill discussion text.')
  }
}

function sliceContextMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(Math.max(0, messages.length - DEFAULT_CONTEXT_WINDOW))
}

async function handleAnalyzeDiscussion(messageWindow: number): Promise<DiscussionAnalysisResult> {
  popupState = {
    ...popupState,
    isAnalyzing: true,
  }
  clearLastError()
  sendPopupStateUpdate()

  const tabId = await getActiveBbbTabId()
  if (tabId === null) {
    const error = 'No active BigBlueButton tab found. Open BBB and try again.'
    setLastError(error)
    popupState = { ...popupState, isAnalyzing: false }
    sendPopupStateUpdate()
    await persistState()
    throw new Error(error)
  }

  const recentMessages = await fetchRecentMessages(tabId, messageWindow)
  const inferredQuestion = inferQuestionFromResponses(recentMessages)

  const analysis: DiscussionAnalysisResult = {
    inferredQuestion,
    contextMessages: recentMessages,
    capturedAt: Date.now(),
  }

  popupState = {
    ...popupState,
    isAnalyzing: false,
    analysis,
    debug: {
      ...popupState.debug,
      collectedMessages: recentMessages,
      messageCount: recentMessages.length,
      lastAnalysisAt: analysis.capturedAt,
    },
  }

  sendPopupStateUpdate()
  await persistState()
  log('Discussion analyzed', { messageCount: recentMessages.length })

  return analysis
}

async function handleGenerateParticipation(inferredQuestion: string, contextMessages: ChatMessage[]): Promise<string> {
  popupState = {
    ...popupState,
    isGenerating: true,
  }
  clearLastError()
  sendPopupStateUpdate()

  const tabId = await getActiveBbbTabId()
  if (tabId === null) {
    const error = 'No active BigBlueButton tab found for autofill.'
    setLastError(error)
    popupState = { ...popupState, isGenerating: false }
    sendPopupStateUpdate()
    await persistState()
    throw new Error(error)
  }

  const boundedContext = sliceContextMessages(contextMessages)
  const generatedText = generateParticipationText(inferredQuestion, boundedContext)
  await autofillToChat(tabId, generatedText)

  popupState = {
    ...popupState,
    isGenerating: false,
    participation: {
      text: generatedText,
      generatedAt: Date.now(),
    },
  }

  sendPopupStateUpdate()
  await persistState()
  return generatedText
}

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && type in MESSAGE_TYPES
}

function isAnalyzeMessage(message: RuntimeMessage): message is RuntimeMessage<'ANALYZE_DISCUSSION'> {
  return message.type === MESSAGE_TYPES.ANALYZE_DISCUSSION
}

function isGenerateMessage(message: RuntimeMessage): message is RuntimeMessage<'GENERATE_PARTICIPATION'> {
  return message.type === MESSAGE_TYPES.GENERATE_PARTICIPATION
}

async function handleRuntimeMessage(message: unknown): Promise<unknown> {
  if (!isRuntimeMessage(message)) {
    return undefined
  }

  if (message.type === MESSAGE_TYPES.GET_POPUP_STATE) {
    return popupState
  }

  if (isAnalyzeMessage(message)) {
    try {
      const limit = Math.max(1, Math.min(100, message.payload.messageWindow || DEFAULT_MESSAGE_WINDOW))
      const analysis = await handleAnalyzeDiscussion(limit)
      return analysis
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (isGenerateMessage(message)) {
    try {
      const question = message.payload.inferredQuestion || popupState.analysis?.inferredQuestion
      const context = message.payload.contextMessages?.length
        ? message.payload.contextMessages
        : popupState.analysis?.contextMessages ?? []

      if (!question) {
        throw new Error('No inferred question available. Analyze discussion first.')
      }

      const text = await handleGenerateParticipation(question, context)
      return {
        text,
        generatedAt: Date.now(),
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return undefined
}

chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
  handleRuntimeMessage(message)
    .then((result) => {
      sendResponse(result)
    })
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setLastError(text)
      sendPopupStateUpdate()
      void persistState()
      sendResponse({ error: text })
    })

  return true
})

void restoreState()
  .then(() => {
    sendPopupStateUpdate()
  })
  .catch((error: unknown) => {
    setLastError(error instanceof Error ? error.message : String(error))
    sendPopupStateUpdate()
  })
