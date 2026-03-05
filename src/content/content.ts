import { MESSAGE_TYPES, type AutofillTextResult, type RecentMessagesResult, type RuntimeMessage } from '../types/chat'
import { extractRecentMessages, findChatContainer, findChatInput, findVirtualizedInnerContainer } from './chatParser'

const LOG_PREFIX = '[ContentScript]'
const DEV_MODE = import.meta.env.DEV
const MAX_CAPTURE_SCAN = 200
const DEEP_FETCH_MAX_STEPS = 60
const DEEP_FETCH_STEP_MS = 140
const DEEP_FETCH_STAGNANT_LIMIT = 3

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
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

function collectVisibleMessages(captureLimit = MAX_CAPTURE_SCAN): Map<string, ReturnType<typeof extractRecentMessages>[number]> {
  const map = new Map<string, ReturnType<typeof extractRecentMessages>[number]>()
  const visibleMessages = extractRecentMessages(document, captureLimit)
  visibleMessages.forEach((message) => {
    const key = `${message.studentIndex ?? ''}|${message.username}|${message.text}|${message.timestamp}`
    if (!map.has(key)) {
      map.set(key, message)
    }
  })
  return map
}

async function buildRecentMessagesResult(limit: number, deepFetch: boolean): Promise<RecentMessagesResult> {
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

  const dedup = collectVisibleMessages()

  if (deepFetch) {
    const scrollTarget = container instanceof HTMLElement ? container : (innerContainer as HTMLElement)
    const originalScrollTop = scrollTarget.scrollTop
    log('Deep fetch using scroll target:', scrollTarget.className || scrollTarget.tagName)
    let stagnantSteps = 0
    let previousMessageCount = dedup.size

    for (let step = 0; step < DEEP_FETCH_MAX_STEPS; step += 1) {
      const previousTop = scrollTarget.scrollTop
      const scrollDelta = Math.max(80, Math.floor(scrollTarget.clientHeight * 0.8))
      scrollTarget.scrollTop = Math.max(0, previousTop - scrollDelta)
      scrollTarget.dispatchEvent(new Event('scroll', { bubbles: true }))
      container.dispatchEvent(new Event('scroll', { bubbles: true }))

      await sleep(DEEP_FETCH_STEP_MS)

      const snapshot = collectVisibleMessages()
      snapshot.forEach((value, key) => {
        if (!dedup.has(key)) {
          dedup.set(key, value)
        }
      })

      const nowTop = scrollTarget.scrollTop
      if (dedup.size === previousMessageCount || nowTop === previousTop) {
        stagnantSteps += 1
      } else {
        stagnantSteps = 0
      }

      previousMessageCount = dedup.size
      if (nowTop <= 0 && stagnantSteps >= DEEP_FETCH_STAGNANT_LIMIT) {
        break
      }
    }

    scrollTarget.scrollTop = originalScrollTop
    scrollTarget.dispatchEvent(new Event('scroll', { bubbles: true }))
    container.dispatchEvent(new Event('scroll', { bubbles: true }))
  }

  const sorted = Array.from(dedup.values()).sort((a, b) => a.timestamp - b.timestamp)
  const messages = sorted.slice(Math.max(0, sorted.length - limit))
  log(`FETCH_RECENT_MESSAGES parsed ${messages.length} messages (limit=${limit}, deepFetch=${deepFetch})`)
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

async function handleRuntimeMessage(
  message: unknown,
  sendResponse: (response?: RuntimeMessage<'RECENT_MESSAGES_RESULT'> | AutofillTextResult) => void,
): Promise<void> {
  if (!message || typeof message !== 'object') {
    sendResponse(undefined)
    return
  }

  const typed = message as RuntimeMessage

  if (isFetchRecentMessage(typed)) {
    const limit = Math.max(1, Math.min(200, typed.payload.limit))
    const payload = await buildRecentMessagesResult(limit, typed.payload.deepFetch === true)
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
    void handleRuntimeMessage(message, sendResponse as (response?: RuntimeMessage<'RECENT_MESSAGES_RESULT'> | AutofillTextResult) => void)
    return true
  })

  log('Manual discussion handlers ready')
}

bootstrap()
