import {
  MESSAGE_TYPES,
  type AutofillTextResult,
  type ChatMessage,
  type DiscussionRecord,
  type DiscussionAnalysisResult,
  type ParticipationResult,
  type PopupViewState,
  type RuntimeMessage,
  type StoredData,
} from '../types/chat'
import { generateParticipationText, generateSimilarQuestion, inferQuestionFromResponses } from './summarizer'
import {
  appendDiscussion,
  deleteSession,
  endSession,
  getActiveSession,
  loadStore,
  restoreSession,
  saveStore,
  setDiscussionParticipation,
  startSession,
} from './storage'

const LOG_PREFIX = '[Background]'
const DEV_MODE = import.meta.env.DEV
const DEFAULT_MESSAGE_WINDOW = 20
const DEFAULT_CONTEXT_WINDOW = 20
const DEFAULT_DEBUG_WINDOW = 20
const MAX_DEBUG_LOGS = 30
const STATE_STORAGE_KEY = 'discussionAssistantManualState'
const OPENAI_API_KEY_STORAGE_KEY = 'discussionAssistantOpenAIApiKey'
const CONTEXT_WINDOW_STORAGE_KEY = 'discussionAssistantContextWindow'
const ALLOWED_BBB_HOSTS = new Set([
  'bbb-23.finki.ukim.mk',
  'bbb-24.finki.ukim.mk',
])

let popupState: PopupViewState = {
  isAnalyzing: false,
  isGenerating: false,
  isCompatibleTarget: false,
  sessionRequired: true,
  sessionHistoryCount: 0,
  debug: {
    collectedMessages: [],
    messageCount: 0,
    logs: [],
  },
}
let store: StoredData = {
  schemaVersion: 1,
  sessions: [],
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
  addDebugLog(`ERROR: ${message}`)
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

function addDebugLog(message: string): void {
  const entry = `${new Date().toLocaleTimeString()}: ${message}`
  const logs = [...(popupState.debug.logs ?? []), entry].slice(-MAX_DEBUG_LOGS)

  popupState = {
    ...popupState,
    debug: {
      ...popupState.debug,
      logs,
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

async function loadOpenAiApiKey(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(OPENAI_API_KEY_STORAGE_KEY)
    const value = result[OPENAI_API_KEY_STORAGE_KEY]
    if (typeof value !== 'string') {
      return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

async function saveOpenAiApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    await chrome.storage.local.remove(OPENAI_API_KEY_STORAGE_KEY)
    return
  }
  await chrome.storage.local.set({
    [OPENAI_API_KEY_STORAGE_KEY]: trimmed,
  })
}

async function loadContextWindow(): Promise<number> {
  try {
    const result = await chrome.storage.local.get(CONTEXT_WINDOW_STORAGE_KEY)
    const raw = result[CONTEXT_WINDOW_STORAGE_KEY]
    const numeric = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(numeric)) {
      return DEFAULT_CONTEXT_WINDOW
    }
    return Math.max(1, Math.min(200, Math.round(numeric)))
  } catch {
    return DEFAULT_CONTEXT_WINDOW
  }
}

async function saveContextWindow(contextWindow: number): Promise<void> {
  const bounded = Math.max(1, Math.min(200, Math.round(contextWindow)))
  await chrome.storage.local.set({
    [CONTEXT_WINDOW_STORAGE_KEY]: bounded,
  })
}

async function restoreState(): Promise<void> {
  const restored = await safeStorageGet<PopupViewState>(STATE_STORAGE_KEY)
  if (restored) {
    popupState = {
      ...popupState,
      ...restored,
      debug: {
        ...popupState.debug,
        ...restored.debug,
      },
    }
  }
}

function createDiscussionId(): string {
  return `disc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function refreshStore(): Promise<void> {
  store = await loadStore()
}

function syncSessionStateToPopup(): void {
  const activeSession = getActiveSession(store)
  popupState = {
    ...popupState,
    sessionRequired: !activeSession,
    activeSession,
    sessionHistoryCount: store.sessions.length,
    activeDiscussionId: activeSession?.discussions.at(-1)?.id,
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

  try {
    const parsed = new URL(url)
    return ALLOWED_BBB_HOSTS.has(parsed.hostname) && parsed.pathname.startsWith('/html5client/join')
  } catch {
    return false
  }
}

async function getActiveBbbTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  const activeTab = tabs.find((tab: { id?: number; url?: string }) => tab.id !== undefined && isBbbUrl(tab.url))
  return activeTab?.id ?? null
}

async function hasAnyBbbTabs(): Promise<boolean> {
  const tabs = await chrome.tabs.query({})
  return tabs.some((tab: { url?: string }) => isBbbUrl(tab.url))
}

async function maybeAutoEndSession(): Promise<void> {
  const activeSession = getActiveSession(store)
  if (!activeSession) {
    return
  }

  const hasBbbTab = await hasAnyBbbTabs()
  if (hasBbbTab) {
    return
  }

  addDebugLog(`Auto-ending session ${activeSession.id} because no BBB tabs remain.`)
  await endSession(activeSession.id)
  await refreshStore()
  syncSessionStateToPopup()
  popupState = {
    ...popupState,
    analysis: undefined,
    participation: undefined,
    activeDiscussionId: undefined,
  }
  sendPopupStateUpdate()
  await persistState()
}

async function refreshCompatibilityState(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  const activeTab = tabs.find((tab: { id?: number }) => tab.id !== undefined)
  const activeTabUrl = activeTab?.url

  popupState = {
    ...popupState,
    isCompatibleTarget: isBbbUrl(activeTabUrl),
    activeTabUrl,
  }
}

async function fetchRecentMessages(tabId: number, limit: number): Promise<ChatMessage[]> {
  addDebugLog(`Requesting last ${limit} messages from tab ${tabId}.`)
  let response: unknown

  try {
    response = await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.FETCH_RECENT_MESSAGES,
      payload: {
        limit,
      },
    } satisfies RuntimeMessage<'FETCH_RECENT_MESSAGES'>)
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error)
    addDebugLog(`Initial sendMessage failed: ${errorText}`)

    if (!errorText.includes('Receiving end does not exist')) {
      throw error
    }

    addDebugLog('Using direct scripting fallback for message fetch.')
    return fetchRecentMessagesViaScripting(tabId, limit)
  }

  const typed = response as RuntimeMessage<'RECENT_MESSAGES_RESULT'> | undefined
  if (!typed || typed.type !== MESSAGE_TYPES.RECENT_MESSAGES_RESULT) {
    throw new Error('Invalid response from content script while fetching recent messages.')
  }

  if (typed.payload.error) {
    throw new Error(typed.payload.error)
  }

  addDebugLog(`Content returned ${typed.payload.messages.length} parsed messages.`)
  return typed.payload.messages
}

async function autofillToChat(tabId: number, text: string, submit = false): Promise<void> {
  let response: unknown

  try {
    response = await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.AUTOFILL_TEXT,
      payload: {
        text,
        submit,
      },
    } satisfies RuntimeMessage<'AUTOFILL_TEXT'>)
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error)
    addDebugLog(`Initial AUTOFILL sendMessage failed: ${errorText}`)

    if (!errorText.includes('Receiving end does not exist')) {
      throw error
    }

    addDebugLog('Using direct scripting fallback for autofill.')
    await autofillViaScripting(tabId, text, submit)
    return
  }

  const result = response as AutofillTextResult | undefined
  if (!result?.success) {
    throw new Error(result?.error ?? 'Failed to autofill discussion text.')
  }
}

async function fetchRecentMessagesViaScripting(tabId: number, limit: number): Promise<ChatMessage[]> {
  const execution = await chrome.scripting.executeScript({
    target: { tabId },
    func: (fetchLimit: number) => {
      const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim()
      const selectors = [
        '.ReactVirtualized__Grid.ReactVirtualized__List[class*="messageList--"]',
        '[data-testid="chatMessages"]',
        '[class*="chat" i]',
      ]
      const container = selectors.map((s) => document.querySelector(s)).find((el) => el)
      if (!container) {
        return { messages: [], error: 'Chat container not found.' }
      }

      const inner = container.querySelector('.ReactVirtualized__Grid__innerScrollContainer')
      if (!inner) {
        return { messages: [], error: 'Virtualized inner chat container not found.' }
      }

      const nodes = Array.from(inner.querySelectorAll(':scope > span > div[class*="item--"]'))
      const messages: Array<{
        id: string
        username: string
        studentIndex?: string
        text: string
        timestamp: number
        rawTimestamp?: string
      }> = []

      nodes.forEach((node, index) => {
        const username =
          normalizeText(node.querySelector('[class*="name--"]')?.textContent ?? '') || 'Unknown'
        const studentIndexMatch = username.match(/\((\d+)\)/)
        const studentIndex = studentIndexMatch?.[1]
        const text =
          normalizeText(node.querySelector('p[data-test="chatUserMessageText"]')?.textContent ?? '') ||
          normalizeText(node.textContent ?? '')
        const timeEl = node.querySelector('time[class*="time--"], time')
        const rawTimestamp =
          normalizeText((timeEl as HTMLTimeElement | null)?.dateTime ?? '') ||
          normalizeText(timeEl?.getAttribute('datetime') ?? '') ||
          normalizeText(timeEl?.textContent ?? '')
        const parsedTimestamp = Date.parse(rawTimestamp)
        const timestamp = Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp

        if (!text || !studentIndex) {
          return
        }

        messages.push({
          id: `fallback-${index}-${timestamp}`,
          username,
          studentIndex,
          text,
          timestamp,
          rawTimestamp: rawTimestamp || undefined,
        })
      })

      const dedup = new Map<string, typeof messages[number]>()
      messages.forEach((m) => {
        const key = `${m.username}|${m.text}|${m.timestamp}`
        if (!dedup.has(key)) {
          dedup.set(key, m)
        }
      })

      const sorted = Array.from(dedup.values()).sort((a, b) => a.timestamp - b.timestamp)
      return { messages: sorted.slice(Math.max(0, sorted.length - fetchLimit)) }
    },
    args: [limit],
  })

  const result = execution[0]?.result as { messages?: ChatMessage[]; error?: string } | undefined
  if (!result) {
    throw new Error('Fallback scripting did not return a result.')
  }
  if (result.error) {
    throw new Error(result.error)
  }

  addDebugLog(`Scripting fallback returned ${result.messages?.length ?? 0} messages.`)
  return result.messages ?? []
}

async function autofillViaScripting(tabId: number, text: string, submit = false): Promise<void> {
  const execution = await chrome.scripting.executeScript({
    target: { tabId },
    func: (value: string, shouldSubmit: boolean) => {
      const selectors = [
        'textarea[aria-label*="chat" i]',
        'textarea[placeholder*="message" i]',
        'textarea[data-testid*="chat" i]',
        'textarea',
        'input[type="text"][aria-label*="chat" i]',
        'input[type="text"][placeholder*="message" i]',
      ]

      const input = selectors
        .map((selector) => document.querySelector(selector))
        .find((node) => node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) as
        | HTMLTextAreaElement
        | HTMLInputElement
        | undefined

      if (!input) {
        return { success: false, error: 'Chat input not found.' }
      }

      const descriptor = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')
      descriptor?.set?.call(input, value)
      if (!descriptor?.set) {
        input.value = value
      }
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      input.focus()

      if (shouldSubmit) {
        const sendSelectors = [
          'button[class*="sendButton--"]',
          'button[class*="buttonWrapper--"][class*="send"]',
          'button[aria-label*="send" i]',
          'button[title*="send" i]',
        ]
        const root = input.closest('[class*="input" i], [class*="footer" i], [class*="chat" i]') ?? input.parentElement ?? document.body
        const localSendButton = sendSelectors
          .map((selector) => root.querySelector(selector))
          .find((node) => node instanceof HTMLButtonElement) as HTMLButtonElement | undefined
        const sendButton = localSendButton ?? sendSelectors
          .map((selector) => document.querySelector(selector))
          .find((node) => node instanceof HTMLButtonElement) as HTMLButtonElement | undefined

        if (!sendButton) {
          return { success: false, error: 'Chat send button not found.' }
        }
        sendButton.click()
      }

      return { success: true }
    },
    args: [text, submit],
  })

  const result = execution[0]?.result as AutofillTextResult | undefined
  if (!result?.success) {
    throw new Error(result?.error ?? 'Fallback scripting autofill failed.')
  }

  addDebugLog('Scripting fallback autofill succeeded.')
}

function sliceContextMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(Math.max(0, messages.length - DEFAULT_CONTEXT_WINDOW))
}

async function handleAnalyzeDiscussion(messageWindow: number): Promise<DiscussionAnalysisResult> {
  await refreshStore()
  syncSessionStateToPopup()

  const activeSession = getActiveSession(store)
  if (!activeSession) {
    const errorText = 'No active session. Start a new session first.'
    setLastError(errorText)
    sendPopupStateUpdate()
    await persistState()
    throw new Error(errorText)
  }

  await refreshCompatibilityState()
  popupState = {
    ...popupState,
    isAnalyzing: true,
  }
  clearLastError()
  sendPopupStateUpdate()

  try {
    const apiKey = await loadOpenAiApiKey()
    if (!apiKey) {
      throw new Error('OpenAI API key is missing. Add it in Settings.')
    }

    const tabId = await getActiveBbbTabId()
    if (tabId === null) {
      throw new Error('No active BigBlueButton tab found. Open BBB and try again.')
    }

    const recentMessages = await fetchRecentMessages(tabId, messageWindow)
    const inferredQuestion = await inferQuestionFromResponses(recentMessages, apiKey)

    const analysis: DiscussionAnalysisResult = {
      inferredQuestion,
      contextMessages: recentMessages,
      capturedAt: Date.now(),
    }

    const discussion: DiscussionRecord = {
      id: createDiscussionId(),
      createdAt: Date.now(),
      inferredQuestion: analysis.inferredQuestion,
      contextMessages: analysis.contextMessages,
      participations: [],
      source: {
        messageWindow,
        capturedAt: analysis.capturedAt,
      },
    }
    await appendDiscussion(activeSession.id, discussion)
    await refreshStore()
    syncSessionStateToPopup()

    popupState = {
      ...popupState,
      analysis,
      activeDiscussionId: discussion.id,
      debug: {
        ...popupState.debug,
        collectedMessages: recentMessages,
        messageCount: recentMessages.length,
        lastAnalysisAt: analysis.capturedAt,
      },
    }

    log('Discussion analyzed', { messageCount: recentMessages.length })
    return analysis
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error)
    setLastError(errorText)
    throw error
  } finally {
    popupState = {
      ...popupState,
      isAnalyzing: false,
    }
    sendPopupStateUpdate()
    await persistState()
  }
}

async function handleAnalyzeFromContext(
  messageWindow: number,
  capturedAt: number,
  contextMessages: ChatMessage[],
): Promise<DiscussionAnalysisResult> {
  await refreshStore()
  syncSessionStateToPopup()

  const activeSession = getActiveSession(store)
  if (!activeSession) {
    const errorText = 'No active session. Start a new session first.'
    setLastError(errorText)
    sendPopupStateUpdate()
    await persistState()
    throw new Error(errorText)
  }

  popupState = {
    ...popupState,
    isAnalyzing: true,
  }
  clearLastError()
  sendPopupStateUpdate()

  try {
    const apiKey = await loadOpenAiApiKey()
    if (!apiKey) {
      throw new Error('OpenAI API key is missing. Add it in Settings.')
    }
    const inferredQuestion = await inferQuestionFromResponses(contextMessages, apiKey)
    const analysis: DiscussionAnalysisResult = {
      inferredQuestion,
      contextMessages,
      capturedAt,
    }

    const discussion: DiscussionRecord = {
      id: createDiscussionId(),
      createdAt: Date.now(),
      inferredQuestion: analysis.inferredQuestion,
      contextMessages: analysis.contextMessages,
      participations: [],
      source: {
        messageWindow,
        capturedAt,
      },
    }
    await appendDiscussion(activeSession.id, discussion)
    await refreshStore()
    syncSessionStateToPopup()

    popupState = {
      ...popupState,
      analysis,
      activeDiscussionId: discussion.id,
      debug: {
        ...popupState.debug,
        collectedMessages: contextMessages,
        messageCount: contextMessages.length,
        lastAnalysisAt: Date.now(),
      },
    }

    return analysis
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error)
    setLastError(errorText)
    throw error
  } finally {
    popupState = {
      ...popupState,
      isAnalyzing: false,
    }
    sendPopupStateUpdate()
    await persistState()
  }
}

async function handleDebugGetMessages(limit: number): Promise<ChatMessage[]> {
  await refreshCompatibilityState()
  addDebugLog(`Debug fetch triggered with limit=${limit}.`)
  clearLastError()
  sendPopupStateUpdate()

  const tabId = await getActiveBbbTabId()
  if (tabId === null) {
    const error = 'No active BigBlueButton tab found. Open BBB and try again.'
    setLastError(error)
    sendPopupStateUpdate()
    await persistState()
    throw new Error(error)
  }

  const recentMessages = await fetchRecentMessages(tabId, limit)
  popupState = {
    ...popupState,
    debug: {
      ...popupState.debug,
      collectedMessages: recentMessages,
      messageCount: recentMessages.length,
      lastDebugFetchAt: Date.now(),
      lastError: undefined,
    },
  }

  addDebugLog(`Debug fetch completed. Stored ${recentMessages.length} messages.`)
  sendPopupStateUpdate()
  await persistState()
  log('Debug fetched messages', { messageCount: recentMessages.length })
  return recentMessages
}

async function handleGenerateParticipation(
  inferredQuestion: string,
  contextMessages: ChatMessage[],
  previousSuggestions: string[],
  previousParticipations: string[],
): Promise<string> {
  await refreshStore()
  syncSessionStateToPopup()

  const activeSession = getActiveSession(store)
  if (!activeSession) {
    const errorText = 'No active session. Start a new session first.'
    setLastError(errorText)
    sendPopupStateUpdate()
    await persistState()
    throw new Error(errorText)
  }

  await refreshCompatibilityState()
  popupState = {
    ...popupState,
    isGenerating: true,
  }
  clearLastError()
  sendPopupStateUpdate()

  try {
    const apiKey = await loadOpenAiApiKey()
    if (!apiKey) {
      throw new Error('OpenAI API key is missing. Add it in Settings.')
    }

    const tabId = await getActiveBbbTabId()
    if (tabId === null) {
      throw new Error('No active BigBlueButton tab found for autofill.')
    }

    const boundedContext = sliceContextMessages(contextMessages)
    const generatedText = await generateParticipationText(
      inferredQuestion,
      boundedContext,
      apiKey,
      previousSuggestions,
      previousParticipations,
    )
    await autofillToChat(tabId, generatedText)

    return generatedText
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error)
    setLastError(errorText)
    throw error
  } finally {
    popupState = {
      ...popupState,
      isGenerating: false,
    }
    sendPopupStateUpdate()
    await persistState()
  }
}

async function handleParticipateWithText(text: string, shouldAutofill: boolean, shouldSubmit: boolean): Promise<string> {
  await refreshStore()
  syncSessionStateToPopup()

  const activeSession = getActiveSession(store)
  if (!activeSession) {
    const errorText = 'No active session. Start a new session first.'
    setLastError(errorText)
    sendPopupStateUpdate()
    await persistState()
    throw new Error(errorText)
  }

  await refreshCompatibilityState()
  popupState = {
    ...popupState,
    isGenerating: true,
  }
  clearLastError()
  sendPopupStateUpdate()

  try {
    if (shouldAutofill) {
      const tabId = await getActiveBbbTabId()
      if (tabId === null) {
        throw new Error('No active BigBlueButton tab found for autofill.')
      }
      await autofillToChat(tabId, text, shouldSubmit)
    }
    const participation: ParticipationResult = {
      text,
      generatedAt: Date.now(),
    }

    const discussionId =
      popupState.activeDiscussionId ||
      activeSession.discussions.at(-1)?.id

    if (discussionId) {
      await setDiscussionParticipation(activeSession.id, discussionId, participation)
      await refreshStore()
      syncSessionStateToPopup()
    }

    popupState = {
      ...popupState,
      participation,
    }

    return text
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error)
    setLastError(errorText)
    throw error
  } finally {
    popupState = {
      ...popupState,
      isGenerating: false,
    }
    sendPopupStateUpdate()
    await persistState()
  }
}

async function handleManualAutofillDraft(text: string): Promise<void> {
  const tabId = await getActiveBbbTabId()
  if (tabId === null) {
    throw new Error('No active BigBlueButton tab found for autofill.')
  }

  await autofillToChat(tabId, text)
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

function isGenerateSimilarQuestionMessage(message: RuntimeMessage): message is RuntimeMessage<'GENERATE_SIMILAR_QUESTION'> {
  return message.type === MESSAGE_TYPES.GENERATE_SIMILAR_QUESTION
}

function isAnalyzeFromContext(message: RuntimeMessage): message is RuntimeMessage<'ANALYZE_FROM_CONTEXT'> {
  return message.type === MESSAGE_TYPES.ANALYZE_FROM_CONTEXT
}

function isParticipateWithText(message: RuntimeMessage): message is RuntimeMessage<'PARTICIPATE_WITH_TEXT'> {
  return message.type === MESSAGE_TYPES.PARTICIPATE_WITH_TEXT
}

function isManualAutofillDraftMessage(message: RuntimeMessage): message is RuntimeMessage<'MANUAL_AUTOFILL_DRAFT'> {
  return message.type === MESSAGE_TYPES.MANUAL_AUTOFILL_DRAFT
}

function isDebugGetMessages(message: RuntimeMessage): message is RuntimeMessage<'DEBUG_GET_MESSAGES'> {
  return message.type === MESSAGE_TYPES.DEBUG_GET_MESSAGES
}

function isSettingsSetApiKey(message: RuntimeMessage): message is RuntimeMessage<'SETTINGS_SET_API_KEY'> {
  return message.type === MESSAGE_TYPES.SETTINGS_SET_API_KEY
}

function isSettingsSetContextWindow(message: RuntimeMessage): message is RuntimeMessage<'SETTINGS_SET_CONTEXT_WINDOW'> {
  return message.type === MESSAGE_TYPES.SETTINGS_SET_CONTEXT_WINDOW
}

function isSessionDeleteMessage(message: RuntimeMessage): message is RuntimeMessage<'SESSION_DELETE'> {
  return message.type === MESSAGE_TYPES.SESSION_DELETE
}

function isSessionRestoreMessage(message: RuntimeMessage): message is RuntimeMessage<'SESSION_RESTORE'> {
  return message.type === MESSAGE_TYPES.SESSION_RESTORE
}

async function handleRuntimeMessage(message: unknown): Promise<unknown> {
  if (!isRuntimeMessage(message)) {
    return undefined
  }

  if (message.type === MESSAGE_TYPES.GET_POPUP_STATE || message.type === MESSAGE_TYPES.SESSION_GET_STATE) {
    await refreshStore()
    await refreshCompatibilityState()
    syncSessionStateToPopup()
    return popupState
  }

  if (message.type === MESSAGE_TYPES.SESSION_START) {
    try {
      const newSession = await startSession()
      await refreshStore()
      syncSessionStateToPopup()
      popupState = {
        ...popupState,
        analysis: undefined,
        participation: undefined,
        activeDiscussionId: undefined,
      }
      addDebugLog(`Started session ${newSession.id}.`)
      sendPopupStateUpdate()
      await persistState()
      return { session: newSession }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error)
      setLastError(errorText)
      sendPopupStateUpdate()
      await persistState()
      return { error: errorText }
    }
  }

  if (message.type === MESSAGE_TYPES.SESSION_END) {
    try {
      await refreshStore()
      const activeSession = getActiveSession(store)
      if (!activeSession) {
        return { error: 'No active session to end.' }
      }

      await endSession(activeSession.id)
      await refreshStore()
      syncSessionStateToPopup()
      popupState = {
        ...popupState,
        analysis: undefined,
        participation: undefined,
        activeDiscussionId: undefined,
      }
      addDebugLog(`Ended session ${activeSession.id}.`)
      sendPopupStateUpdate()
      await persistState()
      return { success: true }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error)
      setLastError(errorText)
      sendPopupStateUpdate()
      await persistState()
      return { error: errorText }
    }
  }

  if (isSessionDeleteMessage(message)) {
    try {
      const sessionId = message.payload?.sessionId?.trim()
      if (!sessionId) {
        return { error: 'Missing session id.' }
      }

      await refreshStore()
      const targetSession = store.sessions.find((session) => session.id === sessionId)
      if (!targetSession) {
        return { error: 'Session not found.' }
      }
      const deletingActiveSession = store.activeSessionId === sessionId

      await deleteSession(sessionId)
      await refreshStore()
      syncSessionStateToPopup()

      if (deletingActiveSession) {
        popupState = {
          ...popupState,
          analysis: undefined,
          participation: undefined,
          activeDiscussionId: undefined,
          debug: {
            ...popupState.debug,
            collectedMessages: [],
            messageCount: 0,
          },
        }
      } else {
        popupState = {
          ...popupState,
          activeDiscussionId: popupState.activeSession?.discussions.at(-1)?.id,
        }
      }

      addDebugLog(`Deleted session ${sessionId}.`)
      clearLastError()
      sendPopupStateUpdate()
      await persistState()
      return { success: true }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error)
      setLastError(errorText)
      sendPopupStateUpdate()
      await persistState()
      return { error: errorText }
    }
  }

  if (isSessionRestoreMessage(message)) {
    try {
      const sessionId = message.payload?.sessionId?.trim()
      if (!sessionId) {
        return { error: 'Missing session id.' }
      }

      await refreshStore()
      const targetSession = store.sessions.find((session) => session.id === sessionId)
      if (!targetSession) {
        return { error: 'Session not found.' }
      }

      await restoreSession(sessionId)
      await refreshStore()
      syncSessionStateToPopup()
      popupState = {
        ...popupState,
        analysis: undefined,
        participation: undefined,
        activeDiscussionId: popupState.activeSession?.discussions.at(-1)?.id,
      }

      addDebugLog(`Restored session ${sessionId} as active.`)
      clearLastError()
      sendPopupStateUpdate()
      await persistState()
      return { success: true }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error)
      setLastError(errorText)
      sendPopupStateUpdate()
      await persistState()
      return { error: errorText }
    }
  }

  if (message.type === MESSAGE_TYPES.SESSION_LIST) {
    await refreshStore()
    return {
      sessions: store.sessions,
      activeSessionId: store.activeSessionId,
    }
  }

  if (message.type === MESSAGE_TYPES.SETTINGS_CLEAR_SESSIONS) {
    store = {
      schemaVersion: 1,
      sessions: [],
      activeSessionId: undefined,
    }
    await saveStore(store)
    syncSessionStateToPopup()
    popupState = {
      ...popupState,
      analysis: undefined,
      participation: undefined,
      activeDiscussionId: undefined,
      debug: {
        ...popupState.debug,
        collectedMessages: [],
        messageCount: 0,
      },
    }
    clearLastError()
    sendPopupStateUpdate()
    await persistState()
    return { success: true }
  }

  if (message.type === MESSAGE_TYPES.SETTINGS_EXPORT_SESSIONS) {
    await refreshStore()
    return { store }
  }

  if (message.type === MESSAGE_TYPES.SETTINGS_GET) {
    const apiKey = await loadOpenAiApiKey()
    const contextWindow = await loadContextWindow()
    return {
      apiKey: apiKey ?? '',
      hasApiKey: Boolean(apiKey),
      contextWindow,
    }
  }

  if (isSettingsSetApiKey(message)) {
    try {
      await saveOpenAiApiKey(message.payload.apiKey ?? '')
      return { success: true }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (isSettingsSetContextWindow(message)) {
    try {
      await saveContextWindow(message.payload.contextWindow)
      const contextWindow = await loadContextWindow()
      return { success: true, contextWindow }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (isAnalyzeMessage(message)) {
    try {
      const limit = Math.max(1, Math.min(200, message.payload.messageWindow || DEFAULT_MESSAGE_WINDOW))
      const analysis = await handleAnalyzeDiscussion(limit)
      return analysis
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (isAnalyzeFromContext(message)) {
    try {
      const limit = Math.max(1, Math.min(200, message.payload.messageWindow || DEFAULT_MESSAGE_WINDOW))
      const analysis = await handleAnalyzeFromContext(
        limit,
        message.payload.capturedAt || Date.now(),
        message.payload.contextMessages ?? [],
      )
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
      const previousSuggestions = (message.payload.previousSuggestions ?? []).filter((entry) => entry.trim().length > 0)
      const previousParticipations = (message.payload.previousParticipations ?? []).filter((entry) => entry.trim().length > 0)

      if (!question) {
        throw new Error('No inferred question available. Analyze discussion first.')
      }

      const text = await handleGenerateParticipation(question, context, previousSuggestions, previousParticipations)
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

  if (isGenerateSimilarQuestionMessage(message)) {
    try {
      const question = message.payload.inferredQuestion || popupState.analysis?.inferredQuestion
      const context = message.payload.contextMessages?.length
        ? message.payload.contextMessages
        : popupState.analysis?.contextMessages ?? []
      const previousQuestions = (message.payload.previousQuestions ?? []).filter((entry) => entry.trim().length > 0)
      const previousParticipations = (message.payload.previousParticipations ?? []).filter((entry) => entry.trim().length > 0)

      if (!question) {
        throw new Error('No inferred question available. Analyze discussion first.')
      }

      popupState = {
        ...popupState,
        isGenerating: true,
      }
      clearLastError()
      sendPopupStateUpdate()

      const apiKey = await loadOpenAiApiKey()
      if (!apiKey) {
        throw new Error('OpenAI API key is missing. Add it in Settings.')
      }

      const similarQuestion = await generateSimilarQuestion(
        question,
        context,
        apiKey,
        previousQuestions,
        previousParticipations,
      )
      popupState = {
        ...popupState,
        isGenerating: false,
      }
      sendPopupStateUpdate()
      await persistState()

      return {
        text: similarQuestion,
        generatedAt: Date.now(),
      }
    } catch (error) {
      popupState = {
        ...popupState,
        isGenerating: false,
      }
      const errorText = error instanceof Error ? error.message : String(error)
      setLastError(errorText)
      sendPopupStateUpdate()
      await persistState()
      return {
        error: errorText,
      }
    }
  }

  if (isParticipateWithText(message)) {
    try {
      const text = (message.payload.text ?? '').trim()
      if (!text) {
        throw new Error('Participation text is empty.')
      }
      const shouldAutofill = message.payload.autofill !== false
      const shouldSubmit = message.payload.submit === true
      const committed = await handleParticipateWithText(text, shouldAutofill, shouldSubmit)
      return {
        text: committed,
        generatedAt: Date.now(),
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (isManualAutofillDraftMessage(message)) {
    try {
      const draftText = message.payload.text ?? ''
      await handleManualAutofillDraft(draftText)
      return { success: true }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (isDebugGetMessages(message)) {
    try {
      const limit = Math.max(1, Math.min(200, message.payload.limit || DEFAULT_DEBUG_WINDOW))
      const messages = await handleDebugGetMessages(limit)
      return {
        messages,
        fetchedAt: Date.now(),
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (message.type === MESSAGE_TYPES.DEBUG_CLEAR_MESSAGES) {
    popupState = {
      ...popupState,
      debug: {
        ...popupState.debug,
        collectedMessages: [],
        messageCount: 0,
        lastDebugFetchAt: undefined,
        lastError: undefined,
      },
    }
    sendPopupStateUpdate()
    await persistState()
    return { success: true }
  }

  if (message.type === MESSAGE_TYPES.DEBUG_CLEAR_LOGS) {
    popupState = {
      ...popupState,
      debug: {
        ...popupState.debug,
        logs: [],
      },
    }
    sendPopupStateUpdate()
    await persistState()
    return { success: true }
  }

  return undefined
}

chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
  addDebugLog('Background received runtime message.')
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

chrome.tabs.onRemoved.addListener(() => {
  void maybeAutoEndSession()
})

chrome.windows.onRemoved.addListener(() => {
  void maybeAutoEndSession()
})

void restoreState()
  .then(async () => {
    await refreshStore()
    await maybeAutoEndSession()
    await refreshCompatibilityState()
    syncSessionStateToPopup()
    sendPopupStateUpdate()
  })
  .catch((error: unknown) => {
    setLastError(error instanceof Error ? error.message : String(error))
    sendPopupStateUpdate()
  })
