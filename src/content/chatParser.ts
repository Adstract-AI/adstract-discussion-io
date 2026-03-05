import type { ChatMessage } from '../types/chat'

const CHAT_CONTAINER_SELECTORS = [
  '[data-testid="chatMessages"]',
  '[aria-label*="chat" i][role="log"]',
  '[aria-label*="chat" i] [role="list"]',
  '[id*="chat" i][role="log"]',
  '[id*="chat" i] [role="list"]',
  '[class*="chat" i][role="log"]',
  '[class*="chat" i] [role="list"]',
  '[data-testid*="chat" i]',
  '[class*="chat" i]',
] as const

const CHAT_MESSAGE_NODE_SELECTORS = [
  '[data-testid*="chatmessage" i]',
  '[class*="chat-message" i]',
  '[class*="message" i]',
  '[role="listitem"]',
] as const

const CHAT_INPUT_SELECTORS = [
  'textarea[aria-label*="chat" i]',
  'textarea[placeholder*="message" i]',
  'textarea[data-testid*="chat" i]',
  'textarea',
  'input[type="text"][aria-label*="chat" i]',
  'input[type="text"][placeholder*="message" i]',
] as const

const USERNAME_SELECTORS = [
  '[data-testid="chatUser"]',
  '[class*="user" i]',
  '[class*="sender" i]',
  '[class*="author" i]',
  'strong',
] as const

const MESSAGE_SELECTORS = [
  '[data-testid="chatMessage"]',
  '[class*="message" i]',
  '[class*="content" i]',
  '[role="article"]',
  'p',
  'span',
] as const

const TIMESTAMP_SELECTORS = [
  'time',
  '[data-testid="chatTime"]',
  '[class*="time" i]',
  '[class*="timestamp" i]',
] as const

const SYSTEM_KEYWORDS = [
  'joined',
  'left',
  'recording started',
  'recording stopped',
  'system message',
  'you are now connected',
] as const

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stableHash(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function firstTextBySelectors(root: Element, selectors: readonly string[]): string | undefined {
  for (const selector of selectors) {
    const found = root.querySelector(selector)
    if (found?.textContent) {
      const value = normalizeText(found.textContent)
      if (value) {
        return value
      }
    }
  }

  return undefined
}

function parseTimestamp(rawTimestamp: string | undefined): number {
  if (!rawTimestamp) {
    return Date.now()
  }

  const parsed = Date.parse(rawTimestamp)
  if (!Number.isNaN(parsed)) {
    return parsed
  }

  const today = new Date()
  const timeMatch = rawTimestamp.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i)
  if (!timeMatch) {
    return Date.now()
  }

  const hoursFromText = Number(timeMatch[1])
  const minutes = Number(timeMatch[2])
  const amPm = timeMatch[3]?.toLowerCase()

  let hours = hoursFromText
  if (amPm === 'pm' && hours < 12) {
    hours += 12
  }
  if (amPm === 'am' && hours === 12) {
    hours = 0
  }

  today.setHours(hours, minutes, 0, 0)
  return today.getTime()
}

function looksLikeUsernameCandidate(value: string): boolean {
  if (!value || value.length < 2) {
    return false
  }

  return !/[.!?]{2,}/.test(value)
}

function buildMessageId(message: Omit<ChatMessage, 'id'>, index: number): string {
  const raw = `${message.username}|${message.text}|${message.timestamp}|${index}`
  return `msg-${stableHash(raw)}`
}

export function findChatContainer(root: ParentNode = document): Element | null {
  for (const selector of CHAT_CONTAINER_SELECTORS) {
    const candidate = root.querySelector(selector)
    if (candidate) {
      return candidate
    }
  }

  return null
}

export function findChatInput(root: ParentNode = document): HTMLTextAreaElement | HTMLInputElement | null {
  for (const selector of CHAT_INPUT_SELECTORS) {
    const candidate = root.querySelector(selector)
    if (candidate instanceof HTMLTextAreaElement || candidate instanceof HTMLInputElement) {
      return candidate
    }
  }

  return null
}

export function parseChatMessage(node: Element): ChatMessage | null {
  const combinedText = normalizeText(node.textContent ?? '')
  if (!combinedText) {
    return null
  }

  const usernameRaw = firstTextBySelectors(node, USERNAME_SELECTORS)
  const messageText = firstTextBySelectors(node, MESSAGE_SELECTORS) ?? combinedText
  const timestampRaw = firstTextBySelectors(node, TIMESTAMP_SELECTORS)

  const username = usernameRaw && looksLikeUsernameCandidate(usernameRaw) ? usernameRaw : 'Unknown'
  const text = normalizeText(messageText)

  if (!text || text.length < 2) {
    return null
  }

  return {
    id: '',
    username,
    text,
    timestamp: parseTimestamp(timestampRaw),
    rawTimestamp: timestampRaw,
  }
}

export function isSystemMessage(node: Element, parsed: ChatMessage): boolean {
  if (node.getAttribute('role') === 'status') {
    return true
  }

  const ariaLabel = normalizeText(node.getAttribute('aria-label') ?? '').toLowerCase()
  if (ariaLabel.includes('system')) {
    return true
  }

  const lowerText = parsed.text.toLowerCase()
  return SYSTEM_KEYWORDS.some((keyword) => lowerText.includes(keyword))
}

export function extractRecentMessages(root: ParentNode = document, limit = 20): ChatMessage[] {
  const container = findChatContainer(root)
  if (!container) {
    return []
  }

  const candidates: Element[] = []
  for (const selector of CHAT_MESSAGE_NODE_SELECTORS) {
    const nodes = container.querySelectorAll(selector)
    for (const node of nodes) {
      if (node instanceof Element) {
        candidates.push(node)
      }
    }
  }

  if (candidates.length === 0) {
    const directChildren = Array.from(container.children)
    for (const child of directChildren) {
      if (child instanceof Element) {
        candidates.push(child)
      }
    }
  }

  const dedup = new Map<string, ChatMessage>()

  candidates.forEach((node, index) => {
    const parsed = parseChatMessage(node)
    if (!parsed || isSystemMessage(node, parsed)) {
      return
    }

    const id = buildMessageId(parsed, index)
    const withId: ChatMessage = { ...parsed, id }
    const fingerprint = `${withId.username}|${withId.text}|${withId.timestamp}`
    if (!dedup.has(fingerprint)) {
      dedup.set(fingerprint, withId)
    }
  })

  const sorted = Array.from(dedup.values()).sort((a, b) => a.timestamp - b.timestamp)
  return sorted.slice(Math.max(0, sorted.length - limit))
}
