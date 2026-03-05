import { MESSAGE_TYPES, type AutofillTextResult, type RecentMessagesResult, type RuntimeMessage } from '../types/chat'
import { extractRecentMessages, findChatContainer, findChatInput, findVirtualizedInnerContainer } from './chatParser'

const LOG_PREFIX = '[ContentScript]'
const DEV_MODE = import.meta.env.DEV

declare global {
  interface Window {
    __discussionAssistantInitialized?: boolean
  }
}

function log(...args: unknown[]): void {
  if (DEV_MODE) {
    console.debug(LOG_PREFIX, ...args)
  }
}

function likelyBigBlueButtonPage(): boolean {
  const url = window.location.href.toLowerCase()
  const title = document.title.toLowerCase()
  return url.includes('bigbluebutton') || url.includes('html5client') || title.includes('bigbluebutton')
}

function setInputValue(input: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')
  descriptor?.set?.call(input, value)
  if (!descriptor?.set) {
    input.value = value
  }
}

function findSendButtonNearInput(input: HTMLTextAreaElement | HTMLInputElement): HTMLButtonElement | null {
  const root = input.closest('[class*="input" i], [class*="footer" i], [class*="chat" i]') ?? input.parentElement ?? document.body
  const localCandidates = [
    'button[class*="sendButton--"]',
    'button[class*="buttonWrapper--"][class*="send"]',
    'button[aria-label*="send" i]',
    'button[title*="send" i]',
  ]

  for (const selector of localCandidates) {
    const button = root.querySelector(selector)
    if (button instanceof HTMLButtonElement) {
      return button
    }
  }

  for (const selector of localCandidates) {
    const button = document.querySelector(selector)
    if (button instanceof HTMLButtonElement) {
      return button
    }
  }

  return null
}

function trySubmit(input: HTMLTextAreaElement | HTMLInputElement): AutofillTextResult | null {
  const sendButton = findSendButtonNearInput(input)
  if (!sendButton) {
    return {
      success: false,
      error: 'Chat send button not found.',
    }
  }

  sendButton.click()
  return null
}

function autofillText(text: string, submit = false): AutofillTextResult {
  const input = findChatInput(document)
  if (!input) {
    return {
      success: false,
      error: 'Chat input not found.',
    }
  }

  setInputValue(input, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.focus()

  if (submit) {
    const submitResult = trySubmit(input)
    if (submitResult) {
      return submitResult
    }
  }

  return { success: true }
}

function buildRecentMessagesResult(limit: number): RecentMessagesResult {
  const container = findChatContainer(document)
  if (!container) {
    log('FETCH_RECENT_MESSAGES failed: chat container not found')
    return {
      messages: [],
      capturedAt: Date.now(),
      error: 'Chat container not found.',
    }
  }

  const innerContainer = findVirtualizedInnerContainer(container)
  if (!innerContainer) {
    log('FETCH_RECENT_MESSAGES failed: inner virtualized container not found')
    return {
      messages: [],
      capturedAt: Date.now(),
      error: 'Virtualized inner chat container not found.',
    }
  }

  const messages = extractRecentMessages(document, limit)
  log(`FETCH_RECENT_MESSAGES parsed ${messages.length} messages (limit=${limit})`)
  return {
    messages,
    capturedAt: Date.now(),
    error: messages.length > 0 ? undefined : 'No chat messages found in the detected container.',
  }
}

function isFetchRecentMessage(message: RuntimeMessage): message is RuntimeMessage<'FETCH_RECENT_MESSAGES'> {
  return message.type === MESSAGE_TYPES.FETCH_RECENT_MESSAGES
}

function isAutofillMessage(message: RuntimeMessage): message is RuntimeMessage<'AUTOFILL_TEXT'> {
  return message.type === MESSAGE_TYPES.AUTOFILL_TEXT
}

function handleRuntimeMessage(
  message: unknown,
  sendResponse: (response?: RuntimeMessage<'RECENT_MESSAGES_RESULT'> | AutofillTextResult) => void,
): void {
  if (!message || typeof message !== 'object') {
    sendResponse(undefined)
    return
  }

  const typed = message as RuntimeMessage

  if (isFetchRecentMessage(typed)) {
    const limit = Math.max(1, Math.min(200, typed.payload.limit))
    const payload = buildRecentMessagesResult(limit)
    if (payload.error) {
      log(`FETCH_RECENT_MESSAGES returning error: ${payload.error}`)
    }
    sendResponse({ type: MESSAGE_TYPES.RECENT_MESSAGES_RESULT, payload })
    return
  }

  if (isAutofillMessage(typed)) {
    log('AUTOFILL_TEXT requested by background')
    sendResponse(autofillText(typed.payload.text, typed.payload.submit === true))
    return
  }

  sendResponse(undefined)
}

function bootstrap(): void {
  if (window.__discussionAssistantInitialized) {
    log('Already initialized in this page context; skipping duplicate init.')
    return
  }

  if (!likelyBigBlueButtonPage()) {
    log('Not a BBB-like page; content handlers are idle.')
    return
  }

  window.__discussionAssistantInitialized = true

  chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
    handleRuntimeMessage(message, sendResponse as (response?: RuntimeMessage<'RECENT_MESSAGES_RESULT'> | AutofillTextResult) => void)
    return true
  })

  log('Manual discussion handlers ready')
}

bootstrap()
