import type { ChatMessage } from '../types/chat'

export interface ChatParserDebugSnapshot {
  containerFound: boolean
  containerTag?: string
  containerClass?: string
  innerContainerFound: boolean
  candidateCount: number
  parsedCount: number
  systemSkipped: number
  noIndexSkipped: number
  emptySkipped: number
  sampleCandidates: string[]
  sampleMessages: Array<Pick<ChatMessage, 'username' | 'studentIndex' | 'text' | 'rawTimestamp'>>
}

const CHAT_CONTAINER_SELECTORS = [
  '.ReactVirtualized__Grid.ReactVirtualized__List[class*="messageList--"]',
  '[data-test="chatMessages"] .ReactVirtualized__Grid.ReactVirtualized__List',
  '[data-test="chatMessages"]',
  '[data-test="publicChat"] .ReactVirtualized__Grid.ReactVirtualized__List',
  '[data-test="publicChat"]',
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

const VIRTUALIZED_INNER_SELECTOR = '.ReactVirtualized__Grid__innerScrollContainer'

const PRIMARY_MESSAGE_NODE_SELECTORS = [
  ':scope > span > div[class*="item--"]',
  ':scope > span div[class*="item--"]',
  ':scope > span > div > div[class*="item--"]',
  ':scope > span',
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
  '[class*="name--"]',
  '[data-test="chatUserName"]',
  '[data-testid="chatUser"]',
  '[class*="user" i]',
  '[class*="sender" i]',
  '[class*="author" i]',
  'strong',
] as const

const MESSAGE_SELECTORS = [
  'p[data-test="chatUserMessageText"]',
  '[data-test="chatUserMessageText"]',
  '[data-testid="chatMessage"]',
  '[class*="message" i]',
  '[class*="content" i]',
  '[role="article"]',
  'p',
  'span',
] as const

const TIMESTAMP_SELECTORS = [
  'time[class*="time--"]',
  '[data-test="chatMessageTime"]',
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

function firstTimestampValue(root: Element): string | undefined {
  for (const selector of TIMESTAMP_SELECTORS) {
    const found = root.querySelector(selector)
    if (!(found instanceof HTMLElement)) {
      continue
    }

    if (found instanceof HTMLTimeElement) {
      const datetime = normalizeText(found.dateTime)
      if (datetime) {
        return datetime
      }
    }

    const attrDatetime = normalizeText(found.getAttribute('datetime') ?? '')
    if (attrDatetime) {
      return attrDatetime
    }

    const textValue = normalizeText(found.textContent ?? '')
    if (textValue) {
      return textValue
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

function extractStudentIndex(username: string): string | undefined {
  const match = username.match(/\((\d+)\)/)
  if (!match) {
    return undefined
  }
  return match[1]
}

function extractStudentIndexFromAnyText(value: string): string | undefined {
  const match = value.match(/\((\d{4,})\)/)
  if (!match) {
    return undefined
  }
  return match[1]
}

function resolveStudentIndex(username: string, combinedText: string): string {
  return extractStudentIndex(username) ?? extractStudentIndexFromAnyText(combinedText) ?? '-1'
}

function buildMessageId(message: Omit<ChatMessage, 'id'>, index: number): string {
  const raw = `${message.username}|${message.text}|${message.timestamp}|${index}`
  return `msg-${stableHash(raw)}`
}

function collectMessageCandidates(container: Element): Element[] {
  const innerContainer = findVirtualizedInnerContainer(container)

  if (innerContainer) {
    const messageTextAnchors = Array.from(innerContainer.querySelectorAll('[data-test="chatUserMessageText"]'))
      .map((node) => {
        if (!(node instanceof Element)) {
          return null
        }
        return node.closest('div[class*="item--"], span')
      })
      .filter((node): node is Element => node instanceof Element)

    if (messageTextAnchors.length > 0) {
      return messageTextAnchors
    }

    for (const selector of PRIMARY_MESSAGE_NODE_SELECTORS) {
      const primaryNodes = Array.from(innerContainer.querySelectorAll(selector))
        .filter((node): node is Element => node instanceof Element)

      if (primaryNodes.length > 0) {
        return primaryNodes
      }
    }
  }

  const fallbackNodes: Element[] = []
  for (const selector of CHAT_MESSAGE_NODE_SELECTORS) {
    const nodes = container.querySelectorAll(selector)
    for (const node of nodes) {
      if (node instanceof Element) {
        fallbackNodes.push(node)
      }
    }
  }

  if (fallbackNodes.length > 0) {
    return fallbackNodes
  }

  return Array.from(container.children).filter((node): node is Element => node instanceof Element)
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

export function findVirtualizedInnerContainer(root: ParentNode = document): Element | null {
  const direct = root.querySelector(VIRTUALIZED_INNER_SELECTOR)
  if (direct) {
    return direct
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
  const timestampRaw = firstTimestampValue(node)

  const username = usernameRaw && looksLikeUsernameCandidate(usernameRaw) ? usernameRaw : 'Unknown'
  const studentIndex = resolveStudentIndex(username, combinedText)
  const text = normalizeText(messageText)

  if (!text || text.length < 2) {
    return null
  }

  return {
    id: '',
    username,
    studentIndex,
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

  const candidates = collectMessageCandidates(container)
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

export function debugExtractRecentMessages(root: ParentNode = document, limit = 20): ChatParserDebugSnapshot {
  const container = findChatContainer(root)
  const innerContainer = container ? findVirtualizedInnerContainer(container) : null
  const candidates = container ? collectMessageCandidates(container) : []

  let parsedCount = 0
  let systemSkipped = 0
  let emptySkipped = 0
  const sampleMessages: ChatParserDebugSnapshot['sampleMessages'] = []

  candidates.forEach((node) => {
    const parsed = parseChatMessage(node)
    if (!parsed) {
      emptySkipped += 1
      return
    }

    if (isSystemMessage(node, parsed)) {
      systemSkipped += 1
      return
    }

    parsedCount += 1
    if (sampleMessages.length < 5) {
      sampleMessages.push({
        username: parsed.username,
        studentIndex: parsed.studentIndex,
        text: parsed.text,
        rawTimestamp: parsed.rawTimestamp,
      })
    }
  })

  const sampleCandidates = candidates.slice(0, 5).map((node) => {
    const text = normalizeText(node.textContent ?? '')
    return `${node.tagName.toLowerCase()}.${node.className || '(no-class)'} :: ${text.slice(0, 140)}`
  })

  return {
    containerFound: Boolean(container),
    containerTag: container?.tagName.toLowerCase(),
    containerClass: container?.className,
    innerContainerFound: Boolean(innerContainer),
    candidateCount: candidates.length,
    parsedCount: Math.min(parsedCount, limit),
    systemSkipped,
    noIndexSkipped: 0,
    emptySkipped,
    sampleCandidates,
    sampleMessages,
  }
}
