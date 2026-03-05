import { MESSAGE_TYPES, type AutofillTextResult, type RecentMessagesResult, type RuntimeMessage } from '../types/chat'
import { extractRecentMessages, findChatInput } from './chatParser'

const LOG_PREFIX = '[ContentScript]'
const DEV_MODE = import.meta.env.DEV

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

function autofillText(text: string): AutofillTextResult {
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

  return { success: true }
}

function buildRecentMessagesResult(limit: number): RecentMessagesResult {
  const messages = extractRecentMessages(document, limit)
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
    const limit = Math.max(1, Math.min(100, typed.payload.limit))
    const payload = buildRecentMessagesResult(limit)
    sendResponse({ type: MESSAGE_TYPES.RECENT_MESSAGES_RESULT, payload })
    return
  }

  if (isAutofillMessage(typed)) {
    sendResponse(autofillText(typed.payload.text))
    return
  }

  sendResponse(undefined)
}

function bootstrap(): void {
  if (!likelyBigBlueButtonPage()) {
    log('Not a BBB-like page; content handlers are idle.')
    return
  }

  chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
    handleRuntimeMessage(message, sendResponse as (response?: RuntimeMessage<'RECENT_MESSAGES_RESULT'> | AutofillTextResult) => void)
    return true
  })

  log('Manual discussion handlers ready')
}

bootstrap()
