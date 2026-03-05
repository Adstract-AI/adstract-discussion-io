import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import {
  type AgentLanguage,
  type AiModel,
  type DiscussionRecord,
  MESSAGE_TYPES,
  type ChatMessage,
  type PopupViewState,
  type PromptSemantics,
  type RuntimeMessage,
  type SessionRecord,
} from '../types/chat'
import TERMS_OF_SERVICE_TEXT from '../../TERMS_OF_SERVICE.md?raw'
import PRIVACY_POLICY_TEXT from '../../PRIVACY_POLICY.md?raw'
import ADSTRACT_TEXT from '../../ADSTRACT.md?raw'

const DEFAULT_MESSAGE_WINDOW = 20
const DEV_MOCK_BASE = Date.now() - 1000 * 60 * 60
const POPUP_UI_STATE_KEY = 'discussionAssistantPopupUiStateV1'
const TERMS_ACCEPTED_KEY = 'discussionAssistantTermsAcceptedV1'
const AI_MODEL_OPTIONS: ReadonlyArray<{ value: AiModel; label: string }> = [
  { value: 'gpt-5.2', label: 'GPT-5.2' },
  { value: 'gpt-5.3-chat-latest', label: 'GPT-5.3 Chat Latest' },
  { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
  { value: 'gpt-5-nano', label: 'GPT-5 Nano' },
]
const LANGUAGE_OPTIONS: readonly AgentLanguage[] = ['Macedonian', 'English']
const DEFAULT_PROMPT_SEMANTICS: PromptSemantics = {
  general: 'Use only provided context. Keep responses concise, practical, and suitable for live class discussion.',
  inferQuestion: 'Infer the likely professor question from student replies. Keep it clear and natural.',
  participation: 'Write a short student-style participation message with a new angle, not repetition.',
  similarQuestion: 'Generate a semantically related follow-up question that keeps discussion moving.',
}

type ViewMode = 'assistant' | 'debug'
type AssistantFlowStage = 'idle' | 'collecting' | 'collected' | 'awaiting-analysis' | 'participating' | 'awaiting-suggestion' | 'awaiting-similar-question'
type SettingsTab = 'sessions' | 'ai' | 'context'
type LegalTab = 'terms' | 'privacy'
type PendingTermsAction =
  | { type: 'start' }
  | { type: 'restore'; sessionId: string }
  | { type: 'restart' }
  | null

interface StoredLegalAcceptance {
  termsAccepted?: boolean
  privacyAccepted?: boolean
  acceptedAt?: number
}

interface PopupUiStateCache {
  flowStage: AssistantFlowStage
  capturedContextMessages: ChatMessage[]
  capturedContextAt?: number
  draftText: string
  previousSuggestedParticipations: string[]
  previousSuggestedQuestions: string[]
  isContinuingPreviousDiscussion: boolean
}

const initialState: PopupViewState = {
  isAnalyzing: false,
  isGenerating: false,
  isCompatibleTarget: false,
  sessionRequired: true,
  sessionHistoryCount: 0,
  debug: {
    collectedMessages: [],
    messageCount: 0,
  },
}

const DEV_MOCK_DISCUSSIONS: DiscussionRecord[] = [
  {
    id: 'mock-disc-1',
    createdAt: DEV_MOCK_BASE + 1000 * 60 * 5,
    inferredQuestion: 'How can abstraction improve maintainability in large software systems?',
    contextMessages: [
      {
        id: 'mock-msg-1',
        username: 'Viktor Kostadinoski (226009)',
        studentIndex: '226009',
        text: 'Abstraction reduces duplicate logic and makes modules easier to test independently.',
        timestamp: DEV_MOCK_BASE + 1000 * 60 * 2,
      },
      {
        id: 'mock-msg-2',
        username: 'Elena Petrova (225112)',
        studentIndex: '225112',
        text: 'It helps teams collaborate because interfaces stay stable while internals evolve.',
        timestamp: DEV_MOCK_BASE + 1000 * 60 * 3,
      },
    ],
    participations: [
      {
        text: 'One practical way abstraction helps is by defining clear interfaces so teams can change internals without breaking each other’s work.',
        generatedAt: DEV_MOCK_BASE + 1000 * 60 * 8,
      },
      {
        text: 'Plus, abstraction reduces merge conflicts because teams touch fewer shared details.',
        generatedAt: DEV_MOCK_BASE + 1000 * 60 * 9,
      },
    ],
    source: {
      messageWindow: 20,
      capturedAt: DEV_MOCK_BASE + 1000 * 60 * 4,
    },
  },
  {
    id: 'mock-disc-2',
    createdAt: DEV_MOCK_BASE + 1000 * 60 * 20,
    inferredQuestion: 'When should we prefer composition over inheritance?',
    contextMessages: [
      {
        id: 'mock-msg-3',
        username: 'Martin Iliev (224501)',
        studentIndex: '224501',
        text: 'Composition is safer because inheritance can create tight coupling and fragile hierarchies.',
        timestamp: DEV_MOCK_BASE + 1000 * 60 * 16,
      },
      {
        id: 'mock-msg-4',
        username: 'Ana Trajkovska (226700)',
        studentIndex: '226700',
        text: 'Composition works well when behavior needs to be swapped at runtime.',
        timestamp: DEV_MOCK_BASE + 1000 * 60 * 18,
      },
    ],
    participations: [
      {
        text: 'I’d choose composition when flexibility matters, because small interchangeable components are easier to adapt than deep inheritance trees.',
        generatedAt: DEV_MOCK_BASE + 1000 * 60 * 22,
      },
    ],
    source: {
      messageWindow: 20,
      capturedAt: DEV_MOCK_BASE + 1000 * 60 * 19,
    },
  },
]

const DEV_MOCK_PREVIOUS_SESSION: SessionRecord = {
  id: 'mock-session-style',
  name: 'Mock Session',
  startedAt: DEV_MOCK_BASE - 1000 * 60 * 60 * 24,
  endedAt: DEV_MOCK_BASE - 1000 * 60 * 60 * 23,
  status: 'ended',
  discussions: DEV_MOCK_DISCUSSIONS,
}

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) {
    return 'N/A'
  }

  return new Date(timestamp).toLocaleString([], {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatTimeOnly(timestamp?: number): string {
  if (!timestamp) {
    return 'N/A'
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`md-strong-${index}`}>{part.slice(2, -2)}</strong>
    }
    return <span key={`md-span-${index}`}>{part}</span>
  })
}

function renderTermsMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.split(/\r?\n/)
  const nodes: ReactNode[] = []
  let listItems: string[] = []
  let paragraphBuffer: string[] = []

  const flushList = (): void => {
    if (listItems.length === 0) {
      return
    }
    nodes.push(
      <ul key={`list-${nodes.length}`} className="terms-list">
        {listItems.map((item, index) => (
          <li key={`li-${nodes.length}-${index}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>,
    )
    listItems = []
  }

  const flushParagraph = (): void => {
    if (paragraphBuffer.length === 0) {
      return
    }
    nodes.push(
      <p key={`p-${nodes.length}`} className="terms-paragraph">
        {renderInlineMarkdown(paragraphBuffer.join(' '))}
      </p>,
    )
    paragraphBuffer = []
  }

  lines.forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) {
      flushList()
      flushParagraph()
      return
    }

    if (line === '---') {
      flushList()
      flushParagraph()
      nodes.push(<hr key={`hr-${nodes.length}`} className="terms-separator" />)
      return
    }

    if (line.startsWith('# ')) {
      flushList()
      flushParagraph()
      nodes.push(<h1 key={`h1-${nodes.length}`}>{renderInlineMarkdown(line.slice(2).trim())}</h1>)
      return
    }

    if (line.startsWith('## ')) {
      flushList()
      flushParagraph()
      nodes.push(<h2 key={`h2-${nodes.length}`}>{renderInlineMarkdown(line.slice(3).trim())}</h2>)
      return
    }

    if (line.startsWith('- ')) {
      flushParagraph()
      listItems.push(line.slice(2).trim())
      return
    }

    flushList()
    paragraphBuffer.push(line)
  })

  flushList()
  flushParagraph()

  return nodes
}

function formatDateOnly(timestamp?: number): string {
  if (!timestamp) {
    return 'N/A'
  }

  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getSessionListTitle(session: SessionRecord): string {
  if (session.name === 'Mock Session') {
    return session.name
  }
  return `Session ${formatDateOnly(session.startedAt)}`
}

function stripIndexFromUsername(username: string): string {
  return username.replace(/\s*\(\d+\)\s*$/, '').trim()
}

function getDiscussionParticipations(discussion: DiscussionRecord): Array<{ text: string; generatedAt: number }> {
  const fromArray = Array.isArray(discussion.participations)
    ? discussion.participations
        .filter((entry) => Boolean(entry?.text?.trim()))
        .map((entry) => ({
          text: entry.text.trim(),
          generatedAt: entry.generatedAt,
        }))
    : []
  const fromLegacy = discussion.participation?.text?.trim()
    ? [{
      text: discussion.participation.text.trim(),
      generatedAt: discussion.participation.generatedAt,
    }]
    : []

  const dedup = new Map<string, { text: string; generatedAt: number }>()
  ;[...fromArray, ...fromLegacy].forEach((entry) => {
    const key = `${entry.text}|${entry.generatedAt}`
    if (!dedup.has(key)) {
      dedup.set(key, entry)
    }
  })

  return Array.from(dedup.values())
}

function renderMessageRow(message: ChatMessage) {
  const displayName = stripIndexFromUsername(message.username)

  return (
    <li key={message.id} className="message-row">
      <div className="message-row-meta message-row-meta-compact">
        <strong>{displayName || message.username}</strong>
        <strong className="message-row-index message-row-hover-only">{message.studentIndex ?? 'N/A'}</strong>
      </div>
      <p className="message-row-text">{message.text}</p>
      <small className="message-row-time message-row-hover-only">{formatTimeOnly(message.timestamp)}</small>
    </li>
  )
}

function renderCapturedContextMessageRow(
  message: ChatMessage,
  index: number,
  onDelete: (rowIndex: number) => void,
) {
  const displayName = stripIndexFromUsername(message.username)

  return (
    <li key={`${message.id}-${index}`} className="message-row captured-context-row">
      <div className="message-row-meta message-row-meta-compact">
        <strong>{displayName || message.username}</strong>
        <strong className="message-row-index message-row-hover-only">{message.studentIndex ?? 'N/A'}</strong>
      </div>
      <p className="message-row-text">{message.text}</p>
      <small className="message-row-time message-row-hover-only">{formatTimeOnly(message.timestamp)}</small>
      <button
        className="context-delete-btn custom-tooltip-trigger"
        data-tooltip="Remove message"
        data-tooltip-pos="left"
        aria-label="Remove message from context"
        type="button"
        onClick={() => onDelete(index)}
      >
        <span className="context-delete-glyph" aria-hidden="true">X</span>
      </button>
    </li>
  )
}

export default function Popup() {
  const [state, setState] = useState<PopupViewState>(initialState)
  const [viewMode, setViewMode] = useState<ViewMode>('assistant')
  const [draftText, setDraftText] = useState('')
  const [debugActionStatus, setDebugActionStatus] = useState('')
  const [sessionList, setSessionList] = useState<SessionRecord[]>([])
  const [selectedDiscussionId, setSelectedDiscussionId] = useState<string>()
  const [selectedSessionId, setSelectedSessionId] = useState<string>()
  const [showOldSessions, setShowOldSessions] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [showWhoWeAreModal, setShowWhoWeAreModal] = useState(false)
  const [sessionSidebarCollapsed, setSessionSidebarCollapsed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showTermsModal, setShowTermsModal] = useState(false)
  const [legalTab, setLegalTab] = useState<LegalTab>('terms')
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false)
  const [pendingTermsAction, setPendingTermsAction] = useState<PendingTermsAction>(null)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('sessions')
  const [settingsApiKey, setSettingsApiKey] = useState('')
  const [settingsHasApiKey, setSettingsHasApiKey] = useState(false)
  const [settingsAiModel, setSettingsAiModel] = useState<AiModel>('gpt-5-mini')
  const [settingsLanguage, setSettingsLanguage] = useState<AgentLanguage>('Macedonian')
  const [settingsPromptSemantics, setSettingsPromptSemantics] = useState<PromptSemantics>(DEFAULT_PROMPT_SEMANTICS)
  const [settingsContextWindow, setSettingsContextWindow] = useState(DEFAULT_MESSAGE_WINDOW)
  const [contextWindow, setContextWindow] = useState(DEFAULT_MESSAGE_WINDOW)
  const [settingsStatus, setSettingsStatus] = useState('')
  const [showMockError, setShowMockError] = useState(false)
  const [sessionActionTarget, setSessionActionTarget] = useState<SessionRecord | null>(null)
  const [flowStage, setFlowStage] = useState<AssistantFlowStage>('idle')
  const [capturedContextMessages, setCapturedContextMessages] = useState<ChatMessage[]>([])
  const [capturedContextAt, setCapturedContextAt] = useState<number>()
  const [showCapturedContextModal, setShowCapturedContextModal] = useState(false)
  const [showEnterConfirm, setShowEnterConfirm] = useState(false)
  const [uiStateHydrated, setUiStateHydrated] = useState(false)
  const [previousSuggestedParticipations, setPreviousSuggestedParticipations] = useState<string[]>([])
  const [previousSuggestedQuestions, setPreviousSuggestedQuestions] = useState<string[]>([])
  const [isContinuingPreviousDiscussion, setIsContinuingPreviousDiscussion] = useState(false)
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null)
  const discussionFlowRef = useRef<HTMLDivElement | null>(null)
  const draftAutofillTimeoutRef = useRef<number | undefined>(undefined)
  const enterConfirmTimeoutRef = useRef<number | undefined>(undefined)

  const showDebugView = import.meta.env.DEV
  const compatibilityKnown = typeof state.activeTabUrl !== 'undefined'
  const unsupportedOnlyView = compatibilityKnown && !state.isCompatibleTarget
  const isWelcomeScreen = state.sessionRequired && !showOldSessions && !unsupportedOnlyView

  const hydratePopupUiState = async (): Promise<void> => {
    try {
      const raw = await chrome.storage.session.get(POPUP_UI_STATE_KEY)
      const cached = raw[POPUP_UI_STATE_KEY] as PopupUiStateCache | undefined
      if (!cached || typeof cached !== 'object') {
        setUiStateHydrated(true)
        return
      }

      if (typeof cached.draftText === 'string') {
        setDraftText(cached.draftText)
      }
      if (Array.isArray(cached.previousSuggestedParticipations)) {
        setPreviousSuggestedParticipations(
          cached.previousSuggestedParticipations.filter((entry): entry is string => typeof entry === 'string'),
        )
      }
      if (Array.isArray(cached.previousSuggestedQuestions)) {
        setPreviousSuggestedQuestions(
          cached.previousSuggestedQuestions.filter((entry): entry is string => typeof entry === 'string'),
        )
      }
      if (typeof cached.isContinuingPreviousDiscussion === 'boolean') {
        setIsContinuingPreviousDiscussion(cached.isContinuingPreviousDiscussion)
      }
      if (Array.isArray(cached.capturedContextMessages)) {
        setCapturedContextMessages(cached.capturedContextMessages)
      }
      if (typeof cached.capturedContextAt === 'number') {
        setCapturedContextAt(cached.capturedContextAt)
      }
      if (
        cached.flowStage === 'idle' ||
        cached.flowStage === 'collecting' ||
        cached.flowStage === 'collected' ||
        cached.flowStage === 'awaiting-analysis' ||
        cached.flowStage === 'participating' ||
        cached.flowStage === 'awaiting-suggestion' ||
        cached.flowStage === 'awaiting-similar-question'
      ) {
        setFlowStage(cached.flowStage)
      }
    } finally {
      setUiStateHydrated(true)
    }
  }

  const refreshSessionList = (): void => {
    void chrome.runtime.sendMessage({ type: MESSAGE_TYPES.SESSION_LIST })
      .then((result: unknown) => {
        const typed = result as { sessions?: SessionRecord[] } | undefined
        if (typed?.sessions) {
          setSessionList(typed.sessions)
        }
      })
  }

  useEffect(() => {
    const onMessage = (message: unknown): void => {
      const typed = message as RuntimeMessage
      if (typed?.type === MESSAGE_TYPES.POPUP_STATE_UPDATE && typed.payload && typeof typed.payload === 'object') {
        setState(typed.payload as PopupViewState)
        refreshSessionList()
      }
    }

    chrome.runtime.onMessage.addListener(onMessage)

    chrome.runtime
      .sendMessage({ type: MESSAGE_TYPES.GET_POPUP_STATE })
      .then((snapshot: PopupViewState | undefined) => {
        if (snapshot) {
          setState(snapshot)
        }
        void hydratePopupUiState()
        refreshSessionList()
      })
      .catch(() => {
        setState((previous) => ({
          ...previous,
          lastError: 'Unable to connect to extension background worker.',
        }))
        void hydratePopupUiState()
      })

    return () => {
      chrome.runtime.onMessage.removeListener(onMessage)
    }
  }, [])

  const currentAnalysis = state.analysis
  const activeSession = state.activeSession
  const sessionsWithoutActive = sessionList.filter((session) => session.id !== activeSession?.id)
  const sessionsWithMock = showDebugView
    ? [DEV_MOCK_PREVIOUS_SESSION, ...sessionsWithoutActive.filter((session) => session.id !== DEV_MOCK_PREVIOUS_SESSION.id)]
    : sessionsWithoutActive
  const sessionsForSidebar = activeSession
    ? [activeSession, ...sessionsWithMock.filter((session) => session.id !== activeSession.id)]
    : sessionsWithMock

  const resolvedSelectedSession =
    (selectedSessionId && sessionsForSidebar.find((session) => session?.id === selectedSessionId)) ||
    activeSession

  const discussionsForPanel = resolvedSelectedSession?.discussions ?? []
  const selectedDiscussion = discussionsForPanel.find((entry) => entry.id === selectedDiscussionId)
  const latestDiscussion = discussionsForPanel.at(-1)
  const hasPendingQuestion = Boolean(latestDiscussion && capturedContextMessages.length > 0)
  const previousParticipations = latestDiscussion
    ? getDiscussionParticipations(latestDiscussion).map((entry) => entry.text)
    : []
  const activeQuestionForParticipation = isContinuingPreviousDiscussion
    ? latestDiscussion?.inferredQuestion
    : (currentAnalysis?.inferredQuestion ?? latestDiscussion?.inferredQuestion)
  const activeContextForParticipation = isContinuingPreviousDiscussion
    ? capturedContextMessages
    : (currentAnalysis?.contextMessages ?? latestDiscussion?.contextMessages ?? capturedContextMessages)
  const canParticipateTarget = Boolean(activeQuestionForParticipation)
  const isSelectedSessionEditable =
    Boolean(activeSession?.id) &&
    resolvedSelectedSession?.id === activeSession?.id &&
    resolvedSelectedSession?.status === 'active'
  const emptyDiscussionsMessage = resolvedSelectedSession?.status === 'ended'
    ? 'No discussions were captured in this session.'
    : 'No discussions yet. Click Analyze Discussion to add one.'
  const contextTarget = contextWindow
  const contextCount = capturedContextMessages.length
  const contextProgress = Math.min(100, Math.round((contextCount / contextTarget) * 100))
  const isContextFull = contextCount >= contextTarget
  const isWaitingForResponse =
    flowStage === 'awaiting-analysis' ||
    flowStage === 'awaiting-suggestion' ||
    flowStage === 'awaiting-similar-question'
  const isParticipationInputEnabled =
    flowStage === 'participating' &&
    canParticipateTarget &&
    isSelectedSessionEditable &&
    !isWaitingForResponse
  const effectiveLastError = showMockError
    ? 'Mock error: Failed to parse 4 messages because chat nodes were malformed.'
    : state.lastError
  const errorPreview = useMemo(() => {
    const text = (effectiveLastError ?? '').trim()
    if (!text) {
      return ''
    }
    return text.length > 42 ? `${text.slice(0, 42)}…` : text
  }, [effectiveLastError])
  useEffect(() => {
    if (activeSession?.id) {
      setSelectedSessionId((prev) => prev ?? activeSession.id)
      setShowOldSessions(false)
      setShowHowItWorks(false)
    }
  }, [activeSession?.id])

  useEffect(() => {
    if (state.sessionRequired) {
      setFlowStage('idle')
      setCapturedContextMessages([])
      setCapturedContextAt(undefined)
    }
  }, [state.sessionRequired])

  useEffect(() => {
    void chrome.runtime.sendMessage({ type: MESSAGE_TYPES.SETTINGS_GET })
      .then((response: unknown) => {
        const typed = response as {
          contextWindow?: number
          apiKey?: string
          hasApiKey?: boolean
          aiModel?: AiModel
          aiLanguage?: AgentLanguage
          promptSemantics?: Partial<PromptSemantics>
        } | undefined
        setSettingsApiKey(typed?.apiKey ?? '')
        setSettingsHasApiKey(Boolean(typed?.hasApiKey))
        if (typed?.aiModel && AI_MODEL_OPTIONS.some((entry) => entry.value === typed.aiModel)) {
          setSettingsAiModel(typed.aiModel)
        }
        if (typed?.aiLanguage && LANGUAGE_OPTIONS.includes(typed.aiLanguage)) {
          setSettingsLanguage(typed.aiLanguage)
        }
        if (typed?.promptSemantics) {
          setSettingsPromptSemantics({
            general: typed.promptSemantics.general?.trim() || DEFAULT_PROMPT_SEMANTICS.general,
            inferQuestion: typed.promptSemantics.inferQuestion?.trim() || DEFAULT_PROMPT_SEMANTICS.inferQuestion,
            participation: typed.promptSemantics.participation?.trim() || DEFAULT_PROMPT_SEMANTICS.participation,
            similarQuestion: typed.promptSemantics.similarQuestion?.trim() || DEFAULT_PROMPT_SEMANTICS.similarQuestion,
          })
        }
        if (typed?.contextWindow && Number.isFinite(typed.contextWindow)) {
          const bounded = Math.max(1, Math.min(200, Math.round(typed.contextWindow)))
          setContextWindow(bounded)
          setSettingsContextWindow(bounded)
        }
      })
  }, [])

  useEffect(() => {
    void chrome.storage.local.get(TERMS_ACCEPTED_KEY)
      .then((raw: Record<string, unknown>) => {
        const value = raw[TERMS_ACCEPTED_KEY] as StoredLegalAcceptance | undefined
        setHasAcceptedTerms(Boolean(value?.termsAccepted && value?.privacyAccepted))
      })
      .catch(() => {
        setHasAcceptedTerms(false)
      })
  }, [])

  useEffect(() => {
    if (!isSelectedSessionEditable && flowStage !== 'idle') {
      setFlowStage('idle')
      setCapturedContextMessages([])
      setCapturedContextAt(undefined)
    }
  }, [isSelectedSessionEditable, flowStage])

  useEffect(() => {
    if (!uiStateHydrated) {
      return
    }
    if (state.sessionRequired || !isSelectedSessionEditable) {
      return
    }

    if (state.isAnalyzing) {
      setFlowStage('awaiting-analysis')
      return
    }

    if (state.isGenerating) {
      setFlowStage((previous) => (
        previous === 'awaiting-similar-question'
          ? 'awaiting-similar-question'
          : 'awaiting-suggestion'
      ))
      return
    }

    if (hasPendingQuestion) {
      setFlowStage((previous) => {
        if (previous === 'collecting' || previous === 'collected') {
          return previous
        }
        return 'participating'
      })
      return
    }

    if (isContinuingPreviousDiscussion) {
      setFlowStage((previous) => {
        if (previous === 'collecting' || previous === 'collected') {
          return previous
        }
        return 'participating'
      })
      return
    }

    setFlowStage((previous) => {
      if (previous === 'collecting' || previous === 'collected') {
        return previous
      }
      return 'idle'
    })
  }, [
    uiStateHydrated,
    state.sessionRequired,
    state.isAnalyzing,
    state.isGenerating,
    hasPendingQuestion,
    isContinuingPreviousDiscussion,
    isSelectedSessionEditable,
  ])

  useEffect(() => {
    if (!uiStateHydrated) {
      return
    }

    const cache: PopupUiStateCache = {
      flowStage,
      capturedContextMessages,
      capturedContextAt,
      draftText,
      previousSuggestedParticipations,
      previousSuggestedQuestions,
      isContinuingPreviousDiscussion,
    }

    void chrome.storage.session.set({
      [POPUP_UI_STATE_KEY]: cache,
    })
  }, [
    uiStateHydrated,
    flowStage,
    capturedContextMessages,
    capturedContextAt,
    draftText,
    previousSuggestedParticipations,
    previousSuggestedQuestions,
    isContinuingPreviousDiscussion,
  ])

  useEffect(() => {
    const panel = discussionFlowRef.current
    if (!panel) {
      return
    }
    const animationFrame = window.requestAnimationFrame(() => {
      panel.scrollTop = panel.scrollHeight
    })
    return () => {
      window.cancelAnimationFrame(animationFrame)
    }
  }, [discussionsForPanel.length, flowStage])

  useEffect(() => {
    return () => {
      if (draftAutofillTimeoutRef.current !== undefined) {
        window.clearTimeout(draftAutofillTimeoutRef.current)
      }
      if (enterConfirmTimeoutRef.current !== undefined) {
        window.clearTimeout(enterConfirmTimeoutRef.current)
      }
    }
  }, [])

  const assistantStatus = useMemo(() => {
    if (state.lastError) {
      return 'Error'
    }

    if (flowStage === 'participating') {
      return 'Participating'
    }

    if (flowStage === 'collecting') {
      return 'Collecting context...'
    }

    if (state.isAnalyzing) {
      return 'Analyzing discussion...'
    }

    if (state.isGenerating) {
      return 'Generating participation draft...'
    }

    if (state.participation) {
      return 'Ready'
    }

    if (state.analysis) {
      return 'Analysis ready'
    }

    return 'Ready'
  }, [flowStage, state.lastError, state.isAnalyzing, state.isGenerating, state.analysis])

  const assistantStatusClass = useMemo(() => {
    if (state.lastError) {
      return 'error'
    }
    if (flowStage === 'participating') {
      return 'participating'
    }
    if (flowStage === 'collecting') {
      return 'analyzing'
    }
    if (state.isAnalyzing) {
      return 'analyzing'
    }
    if (state.isGenerating) {
      return 'generating'
    }
    if (state.participation) {
      return 'ready'
    }
    if (state.analysis) {
      return 'analysis-ready'
    }
    return 'ready'
  }, [flowStage, state.lastError, state.isAnalyzing, state.isGenerating, state.analysis, state.participation])

  const sessionHeading = state.sessionRequired
    ? 'No Active Session'
    : (activeSession?.name ?? 'Active Session')

  const onGatherContext = (): void => {
    setFlowStage('collecting')
    setIsContinuingPreviousDiscussion(false)
    setPreviousSuggestedParticipations([])
    setPreviousSuggestedQuestions([])
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.DEBUG_GET_MESSAGES,
      payload: {
        limit: contextWindow,
      },
    }).then((response: unknown) => {
      const typed = response as { messages?: ChatMessage[]; error?: string } | undefined
      if (typed?.error) {
        setFlowStage('idle')
        setDebugActionStatus(`Context fetch failed: ${typed.error}`)
        return
      }
      const messages = typed?.messages ?? []
      setCapturedContextMessages(messages)
      setCapturedContextAt(Date.now())
      setFlowStage('collected')
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setDebugActionStatus(`Context fetch failed: ${text}`)
      setFlowStage('idle')
    })
  }

  const onCancelContextFlow = (): void => {
    setCapturedContextMessages([])
    setCapturedContextAt(undefined)
    setIsContinuingPreviousDiscussion(false)
    setPreviousSuggestedParticipations([])
    setPreviousSuggestedQuestions([])
    setFlowStage('idle')
  }

  const onProceedWithContext = (): void => {
    if (capturedContextMessages.length === 0 || !settingsHasApiKey) {
      return
    }

    setFlowStage('awaiting-analysis')
    setIsContinuingPreviousDiscussion(false)
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.ANALYZE_FROM_CONTEXT,
      payload: {
        messageWindow: contextWindow,
        capturedAt: capturedContextAt ?? Date.now(),
        contextMessages: capturedContextMessages,
      },
    }).then(() => {
      setFlowStage('participating')
      setIsContinuingPreviousDiscussion(false)
      if (activeSession?.id) {
        setSelectedSessionId(activeSession.id)
      }
      refreshSessionList()
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setDebugActionStatus(`Analyze failed: ${text}`)
      setFlowStage('collected')
    })
  }

  const onContinuePreviousDiscussion = (): void => {
    if (!latestDiscussion?.inferredQuestion || capturedContextMessages.length === 0) {
      setDebugActionStatus('Continue failed: missing previous question or context.')
      return
    }
    setIsContinuingPreviousDiscussion(true)
    setPreviousSuggestedParticipations([])
    setPreviousSuggestedQuestions([])
    setFlowStage('participating')
  }

  const requireTermsAcceptance = (action: PendingTermsAction): boolean => {
    if (hasAcceptedTerms) {
      return false
    }
    setPendingTermsAction(action)
    setShowTermsModal(true)
    return true
  }

  const startSessionInternal = (): void => {
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SESSION_START,
    }).then((response: unknown) => {
      const typed = response as { session?: SessionRecord } | undefined
      if (typed?.session?.id) {
        setSelectedSessionId(typed.session.id)
      }
      setShowOldSessions(false)
      setShowHowItWorks(false)
      refreshSessionList()
    })
  }

  const onStartSession = (): void => {
    if (requireTermsAcceptance({ type: 'start' })) {
      return
    }
    startSessionInternal()
  }

  const onEndSession = (): void => {
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SESSION_END,
    }).then(() => {
      setSelectedDiscussionId(undefined)
      setSelectedSessionId(undefined)
      refreshSessionList()
    })
  }

  const onClosePopup = (): void => {
    window.close()
  }

  const restartSessionInternal = (): void => {
    const restart = async (): Promise<void> => {
      if (!state.sessionRequired) {
        await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.SESSION_END,
        })
      }

      await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SESSION_START,
      })
      setShowOldSessions(false)
      refreshSessionList()
    }

    void restart()
  }

  const onRestartSession = (): void => {
    if (requireTermsAcceptance({ type: 'restart' })) {
      return
    }
    restartSessionInternal()
  }

  const onParticipate = (): void => {
    const inferredQuestion = activeQuestionForParticipation ?? 'No inferred question available.'
    const contextMessages = activeContextForParticipation

    setFlowStage('awaiting-suggestion')
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GENERATE_PARTICIPATION,
      payload: {
        inferredQuestion,
        contextMessages,
        previousSuggestions: previousSuggestedParticipations,
        previousParticipations,
      },
    }).then((response: unknown) => {
      const typed = response as { text?: string; error?: string } | undefined
      if (typed?.error) {
        setDebugActionStatus(`Suggestion failed: ${typed.error}`)
        setFlowStage('participating')
        return
      }
      const generatedSuggestion = (typed?.text ?? '').trim()
      if (!generatedSuggestion) {
        setDebugActionStatus('Suggestion failed: empty response.')
        setFlowStage('participating')
        return
      }

      setDraftText(generatedSuggestion)
      setPreviousSuggestedParticipations((previous) => (
        previous.includes(generatedSuggestion) ? previous : [...previous, generatedSuggestion]
      ))
      void chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.MANUAL_AUTOFILL_DRAFT,
        payload: {
          text: generatedSuggestion,
        },
      })
      setFlowStage('participating')
      draftInputRef.current?.focus()
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setDebugActionStatus(`Suggestion failed: ${text}`)
      setFlowStage('participating')
    })
  }

  const onParticipateWithNothing = (): void => {
    const hasExistingParticipation = Boolean(
      latestDiscussion && getDiscussionParticipations(latestDiscussion).length > 0,
    )

    if (hasExistingParticipation) {
      setDraftText('')
      clearEnterConfirm()
      setIsContinuingPreviousDiscussion(false)
      setPreviousSuggestedParticipations([])
      setPreviousSuggestedQuestions([])
      setFlowStage('idle')
      setCapturedContextMessages([])
      setCapturedContextAt(undefined)
      return
    }

    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.PARTICIPATE_WITH_TEXT,
      payload: {
        text: 'Nothing to add',
        autofill: false,
      },
    }).then(() => {
      setDraftText('')
      clearEnterConfirm()
      setIsContinuingPreviousDiscussion(false)
      setPreviousSuggestedParticipations([])
      setPreviousSuggestedQuestions([])
      setFlowStage('idle')
      setCapturedContextMessages([])
      setCapturedContextAt(undefined)
      refreshSessionList()
    })
  }

  const onDraftTextChange = (value: string): void => {
    if (!isParticipationInputEnabled) {
      return
    }

    setDraftText(value)
    setShowEnterConfirm(false)
    if (enterConfirmTimeoutRef.current !== undefined) {
      window.clearTimeout(enterConfirmTimeoutRef.current)
    }

    if (!state.isCompatibleTarget || !isSelectedSessionEditable) {
      return
    }

    if (draftAutofillTimeoutRef.current !== undefined) {
      window.clearTimeout(draftAutofillTimeoutRef.current)
    }

    draftAutofillTimeoutRef.current = window.setTimeout(() => {
      void chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.MANUAL_AUTOFILL_DRAFT,
        payload: {
          text: value,
        },
      })
    }, 180)
  }

  const clearEnterConfirm = (): void => {
    setShowEnterConfirm(false)
    if (enterConfirmTimeoutRef.current !== undefined) {
      window.clearTimeout(enterConfirmTimeoutRef.current)
      enterConfirmTimeoutRef.current = undefined
    }
  }

  const armEnterConfirm = (): void => {
    setShowEnterConfirm(true)
    if (enterConfirmTimeoutRef.current !== undefined) {
      window.clearTimeout(enterConfirmTimeoutRef.current)
    }
    enterConfirmTimeoutRef.current = window.setTimeout(() => {
      setShowEnterConfirm(false)
      enterConfirmTimeoutRef.current = undefined
    }, 4500)
  }

  const sendManualDraft = (): void => {
    const text = draftText.trim()
    if (!text || !isParticipationInputEnabled) {
      return
    }

    clearEnterConfirm()
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.PARTICIPATE_WITH_TEXT,
      payload: {
        text,
        autofill: true,
        submit: true,
      },
    }).then(() => {
      setDraftText('')
      setFlowStage('idle')
      setIsContinuingPreviousDiscussion(false)
      setPreviousSuggestedParticipations([])
      setPreviousSuggestedQuestions([])
      setCapturedContextMessages([])
      setCapturedContextAt(undefined)
      refreshSessionList()
    }).catch((error: unknown) => {
      const textError = error instanceof Error ? error.message : String(error)
      setDebugActionStatus(`Send failed: ${textError}`)
    })
  }

  const onDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      if (showEnterConfirm) {
        event.preventDefault()
        clearEnterConfirm()
      }
      return
    }

    if (event.key !== 'Enter' || event.shiftKey) {
      return
    }

    const text = draftText.trim()
    if (!text || !isParticipationInputEnabled) {
      return
    }

    event.preventDefault()
    if (!showEnterConfirm) {
      armEnterConfirm()
      return
    }

    sendManualDraft()
  }

  const onGetSimilarQuestion = (): void => {
    const inferredQuestion = activeQuestionForParticipation ?? 'No inferred question available.'
    const contextMessages = activeContextForParticipation

    setFlowStage('awaiting-similar-question')
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GENERATE_SIMILAR_QUESTION,
      payload: {
        inferredQuestion,
        contextMessages,
        previousQuestions: previousSuggestedQuestions,
        previousParticipations,
      },
    }).then((response: unknown) => {
      const typed = response as { text?: string; error?: string } | undefined
      if (typed?.error) {
        setDebugActionStatus(`Similar question failed: ${typed.error}`)
        setFlowStage('participating')
        return
      }
      const generatedQuestion = (typed?.text ?? '').trim()
      if (!generatedQuestion) {
        setDebugActionStatus('Similar question failed: empty response.')
        setFlowStage('participating')
        return
      }

      setDraftText(generatedQuestion)
      setPreviousSuggestedQuestions((previous) => (
        previous.includes(generatedQuestion) ? previous : [...previous, generatedQuestion]
      ))
      void chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.MANUAL_AUTOFILL_DRAFT,
        payload: {
          text: generatedQuestion,
        },
      })
      setFlowStage('participating')
      draftInputRef.current?.focus()
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setDebugActionStatus(`Similar question failed: ${text}`)
      setFlowStage('participating')
    })
  }

  const onOpenDiscussionContext = (discussion: DiscussionRecord): void => {
    setSelectedDiscussionId(discussion.id)
  }

  const onCloseDiscussionContext = (): void => {
    setSelectedDiscussionId(undefined)
  }

  const onDeleteCapturedContextMessage = (rowIndex: number): void => {
    setCapturedContextMessages((previous) => previous.filter((_, index) => index !== rowIndex))
  }

  const onDebugGetMessages = (): void => {
    setDebugActionStatus('Sending debug fetch request...')
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.DEBUG_GET_MESSAGES,
      payload: {
        limit: contextWindow,
      },
    }).then((response: unknown) => {
      const typed = response as { error?: string; messages?: ChatMessage[] } | undefined
      if (typed?.error) {
        setDebugActionStatus(`Request failed: ${typed.error}`)
        return
      }
      const count = typed?.messages?.length ?? 0
      setDebugActionStatus(`Request completed. ${count} messages returned.`)
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setDebugActionStatus(`Request failed: ${text}`)
    })
  }

  const onDebugClear = (): void => {
    setDebugActionStatus('Clearing captured messages...')
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.DEBUG_CLEAR_MESSAGES,
    }).then(() => {
      setDebugActionStatus('Cleared captured messages.')
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setDebugActionStatus(`Clear failed: ${text}`)
    })
  }

  const onDebugClearLogs = (): void => {
    setDebugActionStatus('Clearing debug logs...')
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.DEBUG_CLEAR_LOGS,
    }).then(() => {
      setDebugActionStatus('Cleared debug logs.')
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setDebugActionStatus(`Clear failed: ${text}`)
    })
  }

  const onViewOldSessions = (): void => {
    setShowOldSessions(true)
    if (!selectedSessionId && sessionsForSidebar.length > 0) {
      setSelectedSessionId(sessionsForSidebar[0].id)
    }
  }

  const onOpenHowItWorks = (): void => {
    setShowHowItWorks(true)
  }

  const onOpenWhoWeAre = (): void => {
    setShowWhoWeAreModal(true)
  }

  const onOpenSessionActions = (event: MouseEvent, session: SessionRecord): void => {
    event.preventDefault()
    if (session.id === DEV_MOCK_PREVIOUS_SESSION.id) {
      return
    }
    setSessionActionTarget(session)
  }

  const onDeleteSessionConfirm = (): void => {
    if (!sessionActionTarget) {
      return
    }

    const deletingId = sessionActionTarget.id
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SESSION_DELETE,
      payload: {
        sessionId: deletingId,
      },
    }).then((response: unknown) => {
      const typed = response as { success?: boolean; error?: string } | undefined
      if (typed?.error) {
        setDebugActionStatus(`Delete failed: ${typed.error}`)
        return
      }
      if (selectedSessionId === deletingId) {
        setSelectedSessionId(undefined)
        setSelectedDiscussionId(undefined)
      }
      setSessionActionTarget(null)
      refreshSessionList()
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setDebugActionStatus(`Delete failed: ${text}`)
    })
  }

  const restoreSessionInternal = (restoreId: string): void => {
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SESSION_RESTORE,
      payload: {
        sessionId: restoreId,
      },
    }).then((response: unknown) => {
      const typed = response as { success?: boolean; error?: string } | undefined
      if (typed?.error) {
        setDebugActionStatus(`Restore failed: ${typed.error}`)
        return
      }
      setSelectedSessionId(restoreId)
      setSelectedDiscussionId(undefined)
      setShowOldSessions(false)
      setSessionActionTarget(null)
      refreshSessionList()
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setDebugActionStatus(`Restore failed: ${text}`)
    })
  }

  const onRestoreSessionConfirm = (): void => {
    if (!sessionActionTarget) {
      return
    }

    const restoreId = sessionActionTarget.id
    if (requireTermsAcceptance({ type: 'restore', sessionId: restoreId })) {
      return
    }
    restoreSessionInternal(restoreId)
  }

  const onAcceptTerms = (): void => {
    const pending = pendingTermsAction
    void chrome.storage.local.set({
      [TERMS_ACCEPTED_KEY]: {
        termsAccepted: true,
        privacyAccepted: true,
        acceptedAt: Date.now(),
      } satisfies StoredLegalAcceptance,
    }).then(() => {
      setHasAcceptedTerms(true)
      setShowTermsModal(false)
      setPendingTermsAction(null)
      if (!pending) {
        return
      }
      if (pending.type === 'start') {
        startSessionInternal()
        return
      }
      if (pending.type === 'restart') {
        restartSessionInternal()
        return
      }
      if (pending.type === 'restore') {
        restoreSessionInternal(pending.sessionId)
      }
    })
  }

  const onCloseTermsModal = (): void => {
    setShowTermsModal(false)
    setPendingTermsAction(null)
  }

  const onOpenTerms = (): void => {
    setPendingTermsAction(null)
    setLegalTab('terms')
    setShowTermsModal(true)
  }

  const onDevClearLegalAcceptance = (): void => {
    void chrome.storage.local.remove(TERMS_ACCEPTED_KEY).then(() => {
      setHasAcceptedTerms(false)
      setDebugActionStatus('Legal acceptance cleared (dev).')
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setDebugActionStatus(`Failed to clear legal acceptance: ${text}`)
    })
  }

  const onTitleClick = (): void => {
    if (state.sessionRequired) {
      setShowOldSessions(false)
      setShowHowItWorks(false)
      setSelectedDiscussionId(undefined)
    }
  }

  const onDeleteAllSessionsHistory = (): void => {
    const confirmed = window.confirm('Delete all stored session history? This cannot be undone.')
    if (!confirmed) {
      return
    }

    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SETTINGS_CLEAR_SESSIONS,
    }).then(() => {
      setShowOldSessions(false)
      setSelectedSessionId(undefined)
      setSelectedDiscussionId(undefined)
      setShowSettings(false)
      refreshSessionList()
    })
  }

  const onDownloadSessions = (): void => {
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SETTINGS_EXPORT_SESSIONS,
    }).then((response: unknown) => {
      const typed = response as { store?: unknown; error?: string } | undefined
      if (typed?.error) {
        setDebugActionStatus(`Download failed: ${typed.error}`)
        return
      }

      const payload = {
        exportedAt: Date.now(),
        store: typed?.store ?? { schemaVersion: 1, sessions: [] },
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      link.href = url
      link.download = `discussion-sessions-${stamp}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setShowSettings(false)
    })
  }

  const onOpenSettings = (): void => {
    setShowSettings(true)
    setSettingsTab('sessions')
    setSettingsStatus('')
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SETTINGS_GET,
    }).then((response: unknown) => {
      const typed = response as {
        apiKey?: string
        hasApiKey?: boolean
        contextWindow?: number
        aiModel?: AiModel
        aiLanguage?: AgentLanguage
        promptSemantics?: Partial<PromptSemantics>
        error?: string
      } | undefined
      if (typed?.error) {
        setSettingsStatus(`Failed to load settings: ${typed.error}`)
        return
      }
      setSettingsApiKey(typed?.apiKey ?? '')
      setSettingsHasApiKey(Boolean(typed?.hasApiKey))
      if (typed && typeof typed.contextWindow === 'number') {
        const bounded = Math.max(1, Math.min(200, Math.round(typed.contextWindow ?? DEFAULT_MESSAGE_WINDOW)))
        setSettingsContextWindow(bounded)
        setContextWindow(bounded)
      }
      if (typed?.aiModel && AI_MODEL_OPTIONS.some((entry) => entry.value === typed.aiModel)) {
        setSettingsAiModel(typed.aiModel)
      }
      if (typed?.aiLanguage && LANGUAGE_OPTIONS.includes(typed.aiLanguage)) {
        setSettingsLanguage(typed.aiLanguage)
      }
      if (typed?.promptSemantics) {
        setSettingsPromptSemantics({
          general: typed.promptSemantics.general?.trim() || DEFAULT_PROMPT_SEMANTICS.general,
          inferQuestion: typed.promptSemantics.inferQuestion?.trim() || DEFAULT_PROMPT_SEMANTICS.inferQuestion,
          participation: typed.promptSemantics.participation?.trim() || DEFAULT_PROMPT_SEMANTICS.participation,
          similarQuestion: typed.promptSemantics.similarQuestion?.trim() || DEFAULT_PROMPT_SEMANTICS.similarQuestion,
        })
      }
    })
  }

  const onSaveApiKey = (): void => {
    setSettingsStatus('Saving API key...')
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SETTINGS_SET_API_KEY,
      payload: {
        apiKey: settingsApiKey,
      },
    }).then((response: unknown) => {
      const typed = response as { success?: boolean; error?: string } | undefined
      if (typed?.error) {
        setSettingsStatus(`Save failed: ${typed.error}`)
        return
      }
      setSettingsStatus('API key saved.')
      setSettingsHasApiKey(Boolean(settingsApiKey.trim()))
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setSettingsStatus(`Save failed: ${text}`)
    })
  }

  const onPromptSemanticsChange = (field: keyof PromptSemantics, value: string): void => {
    setSettingsPromptSemantics((previous) => ({
      ...previous,
      [field]: value,
    }))
  }

  const onSaveAiConfig = (): void => {
    setSettingsStatus('Saving AI settings...')
    const payload = {
      model: settingsAiModel,
      language: settingsLanguage,
      prompts: {
        general: settingsPromptSemantics.general.trim() || DEFAULT_PROMPT_SEMANTICS.general,
        inferQuestion: settingsPromptSemantics.inferQuestion.trim() || DEFAULT_PROMPT_SEMANTICS.inferQuestion,
        participation: settingsPromptSemantics.participation.trim() || DEFAULT_PROMPT_SEMANTICS.participation,
        similarQuestion: settingsPromptSemantics.similarQuestion.trim() || DEFAULT_PROMPT_SEMANTICS.similarQuestion,
      },
    }

    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SETTINGS_SET_AI_CONFIG,
      payload,
    }).then((response: unknown) => {
      const typed = response as {
        success?: boolean
        aiModel?: AiModel
        aiLanguage?: AgentLanguage
        promptSemantics?: Partial<PromptSemantics>
        error?: string
      } | undefined
      if (typed?.error) {
        setSettingsStatus(`Save failed: ${typed.error}`)
        return
      }
      if (typed?.aiModel && AI_MODEL_OPTIONS.some((entry) => entry.value === typed.aiModel)) {
        setSettingsAiModel(typed.aiModel)
      }
      if (typed?.aiLanguage && LANGUAGE_OPTIONS.includes(typed.aiLanguage)) {
        setSettingsLanguage(typed.aiLanguage)
      }
      if (typed?.promptSemantics) {
        setSettingsPromptSemantics({
          general: typed.promptSemantics.general?.trim() || DEFAULT_PROMPT_SEMANTICS.general,
          inferQuestion: typed.promptSemantics.inferQuestion?.trim() || DEFAULT_PROMPT_SEMANTICS.inferQuestion,
          participation: typed.promptSemantics.participation?.trim() || DEFAULT_PROMPT_SEMANTICS.participation,
          similarQuestion: typed.promptSemantics.similarQuestion?.trim() || DEFAULT_PROMPT_SEMANTICS.similarQuestion,
        })
      }
      setSettingsStatus('AI settings saved.')
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setSettingsStatus(`Save failed: ${text}`)
    })
  }

  const onDeleteApiKey = (): void => {
    setSettingsStatus('Deleting API key...')
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SETTINGS_SET_API_KEY,
      payload: {
        apiKey: '',
      },
    }).then((response: unknown) => {
      const typed = response as { success?: boolean; error?: string } | undefined
      if (typed?.error) {
        setSettingsStatus(`Delete failed: ${typed.error}`)
        return
      }
      setSettingsApiKey('')
      setSettingsHasApiKey(false)
      setSettingsStatus('API key deleted.')
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setSettingsStatus(`Delete failed: ${text}`)
    })
  }

  const onSaveContextWindow = (): void => {
    const bounded = Math.max(1, Math.min(200, Math.round(settingsContextWindow || DEFAULT_MESSAGE_WINDOW)))
    setSettingsStatus('Saving context size...')
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SETTINGS_SET_CONTEXT_WINDOW,
      payload: {
        contextWindow: bounded,
      },
    }).then((response: unknown) => {
      const typed = response as { success?: boolean; contextWindow?: number; error?: string } | undefined
      if (typed?.error) {
        setSettingsStatus(`Save failed: ${typed.error}`)
        return
      }
      const resolved = typed?.contextWindow ?? bounded
      setContextWindow(resolved)
      setSettingsContextWindow(resolved)
      setSettingsStatus('Context size saved.')
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setSettingsStatus(`Save failed: ${text}`)
    })
  }

  const apiKeyPreview = useMemo(() => {
    const trimmed = settingsApiKey.trim()
    if (!trimmed) {
      return ''
    }
    if (trimmed.length <= 8) {
      return `${trimmed.slice(0, 2)}••••`
    }
    return `${trimmed.slice(0, 6)}••••••${trimmed.slice(-4)}`
  }, [settingsApiKey])

  const popupClassName = [
    'popup-root',
    unsupportedOnlyView ? 'unsupported' : '',
    isWelcomeScreen ? 'welcome-mode' : '',
  ].filter(Boolean).join(' ')

  return (
    <main className={popupClassName}>
      <div className="window-bar">
        <div className="window-controls" aria-label="window controls">
          <button
            className="window-btn red"
            title="End Session"
            onClick={onEndSession}
            type="button"
            disabled={state.sessionRequired || unsupportedOnlyView}
          />
          <button
            className="window-btn yellow"
            title="Minimize (Close Popup)"
            onClick={onClosePopup}
            type="button"
            disabled={unsupportedOnlyView}
          />
          <button
            className="window-btn green"
            title="End Current and Start New Session"
            onClick={onRestartSession}
            type="button"
            disabled={unsupportedOnlyView}
          />
          {showDebugView ? (
            <div className="view-toggle-mini view-toggle-controls">
              <button
                className={`mini-tab ${viewMode === 'assistant' ? 'active' : ''}`}
                onClick={() => setViewMode('assistant')}
                type="button"
                title="Assistant view"
              >
                A
              </button>
              <button
                className={`mini-tab ${viewMode === 'debug' ? 'active' : ''}`}
                onClick={() => setViewMode('debug')}
                type="button"
                title="Debug view"
              >
                D
              </button>
            </div>
          ) : null}
          {showDebugView ? (
            <button
              className="dev-mock-error-btn"
              onClick={() => setShowMockError((prev) => !prev)}
              type="button"
              title="Toggle mock error"
              aria-label="Toggle mock error"
            >
              E
            </button>
          ) : null}
          {showDebugView ? (
            <button
              className="dev-mock-error-btn"
              onClick={onDevClearLegalAcceptance}
              type="button"
              title="Clear legal acceptance"
              aria-label="Clear legal acceptance"
            >
              L
            </button>
          ) : null}
        </div>
        <div className="window-side-controls">
          <button
            className="settings-toggle-btn"
            onClick={onOpenWhoWeAre}
            type="button"
            title="Who we are"
            aria-label="Open who we are"
          >
            <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M6 20c1.2-3 3.4-4.5 6-4.5s4.8 1.5 6 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="settings-toggle-btn"
            onClick={onOpenHowItWorks}
            type="button"
            title="How it works"
            aria-label="Open how it works"
          >
            ?
          </button>
          <button
            className="settings-toggle-btn"
            onClick={onOpenTerms}
            type="button"
            title="Legal"
            aria-label="Open legal documents"
          >
            <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 3h6l5 5v13H8z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M14 3v5h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M11 13h5M11 17h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="settings-toggle-btn"
            onClick={onOpenSettings}
            type="button"
            title="Settings"
            aria-label="Open settings"
            disabled={unsupportedOnlyView}
          >
            ⚙
          </button>
        </div>
      </div>

      <header className="popup-header">
        {unsupportedOnlyView ? (
          <h1 className="title-brand">
            <img className="title-logo" src="/discuss-io-logo.png" alt="" aria-hidden="true" />
            <span className="title-text">Discussion.IO</span>
          </h1>
        ) : (
          <>
            <div className="popup-header-top">
              <h1>
                <button
                  className={`title-home-btn ${state.sessionRequired ? 'clickable' : ''}`}
                  onClick={onTitleClick}
                  type="button"
                >
                  <span className="title-brand">
                    <img className="title-logo" src="/discuss-io-logo.png" alt="" aria-hidden="true" />
                    <span className="title-text">Discussion.IO</span>
                  </span>
                </button>
              </h1>
              {!isWelcomeScreen ? (
                <div className="session-status-inline">
                  <span
                    className={`status-dot ${assistantStatusClass} custom-tooltip-trigger`}
                    data-tooltip={assistantStatus}
                    aria-label={assistantStatus}
                  />
                  <small className="session-chip session-title-main">{sessionHeading}</small>
                </div>
              ) : null}
            </div>
          </>
        )}
      </header>

      {unsupportedOnlyView ? (
        <section className="stack">
          <section className="card unsupported-card">
            <h2>Unsupported Page</h2>
            <p>
              This extension works only on the BBB join pages below.
            </p>
            <small><code>bbb-23.finki.ukim.mk/html5client/join</code></small>
            <small><code>bbb-24.finki.ukim.mk/html5client/join</code></small>
          </section>
        </section>
      ) : (
        <>
          {(!showDebugView || viewMode === 'assistant') ? (
            <section className={isWelcomeScreen ? 'welcome-fullscreen' : 'stack'}>
              {state.sessionRequired ? (
                showOldSessions ? (
                  <section className={`assistant-shell ${sessionSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
                    <aside className="session-sidebar">
                      <div className="session-sidebar-header">
                        {!sessionSidebarCollapsed ? <h3>Sessions</h3> : <h3>Sessions</h3>}
                        <button
                          className="sidebar-toggle-btn"
                          onClick={() => setSessionSidebarCollapsed((prev) => !prev)}
                          type="button"
                          aria-label={sessionSidebarCollapsed ? 'Expand sessions sidebar' : 'Collapse sessions sidebar'}
                        >
                          {sessionSidebarCollapsed ? '›' : '‹'}
                        </button>
                      </div>
                      {!sessionSidebarCollapsed ? (
                        sessionsForSidebar.length === 0 ? (
                          <p className="muted">No saved sessions.</p>
                        ) : (
                          <ul className="session-list">
                            {sessionsForSidebar.map((session) => (
                              <li
                                key={session.id}
                                className={`session-row ${resolvedSelectedSession?.id === session.id ? 'selected' : ''}`}
                                onContextMenu={(event) => onOpenSessionActions(event, session)}
                              >
                                <button
                                  className="session-select-btn"
                                  onClick={() => {
                                    setSelectedSessionId(session.id)
                                    setSelectedDiscussionId(undefined)
                                  }}
                                  type="button"
                                >
                                  <strong>{getSessionListTitle(session)}</strong>
                                  <div className="session-row-footer">
                                    <small
                                      className="session-row-count"
                                      aria-label={`${session.discussions.length} Discussions`}
                                    >
                                      {session.discussions.length}
                                    </small>
                                    <small className="session-row-time">{formatTimeOnly(session.startedAt)}</small>
                                  </div>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )
                      ) : null}
                    </aside>

                    <section className="discussion-pane">
                      <div className="discussion-flow">
                        {discussionsForPanel.length === 0 ? (
                          <p className="muted">No discussions in this session.</p>
                        ) : (
                          discussionsForPanel.map((discussion) => (
                            <article key={discussion.id} className="discussion-entry">
                              <button
                                className="bubble bubble-question"
                                type="button"
                                onClick={() => onOpenDiscussionContext(discussion)}
                              >
                                {discussion.inferredQuestion}
                              </button>
                              {getDiscussionParticipations(discussion).map((participation, index) => (
                                <div
                                  key={`${discussion.id}-participation-${participation.generatedAt}-${index}`}
                                  className="discussion-participation-item"
                                >
                                  <div className="bubble bubble-user">
                                    {participation.text}
                                  </div>
                                  <small className="bubble-time-hover">{formatTimeOnly(participation.generatedAt)}</small>
                                </div>
                              ))}
                            </article>
                          ))
                        )}
                      </div>
                      <section className="chat-island history-only-island">
                        <h2>History Only</h2>
                        <p className="muted">Viewing saved sessions. Start a new session to analyze live chat.</p>
                        <div className="history-action-row">
                          <button
                            className="history-icon-btn custom-tooltip-trigger"
                            data-tooltip="Create New Session"
                            aria-label="Create New Session"
                            onClick={onStartSession}
                            type="button"
                          >
                            <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                      </section>
                    </section>
                  </section>
                ) : (
                  <section className="welcome-shell">
                    <section className="card session-gate">
                      <div className="session-gate-body">
                        <h2>Welcome</h2>
                        <p className="session-gate-description">
                          Discussion.IO helps you participate in live class discussions with less friction.
                          Capture recent chat context, infer the professor question, and draft strong responses fast.
                          You can submit your own message, request multiple suggestions, or continue a previous discussion.
                        </p>
                        <div className="session-gate-actions-icon">
                          <div className="session-gate-option">
                            <button
                              className="session-gate-icon-btn custom-tooltip-trigger"
                              data-tooltip="Create New Session"
                              aria-label="Create New Session"
                              onClick={onStartSession}
                              type="button"
                            >
                              <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            </button>
                            <small>New Session</small>
                          </div>
                          <div className="session-gate-option">
                            <button
                              className="session-gate-icon-btn custom-tooltip-trigger"
                              data-tooltip="View Old Sessions"
                              aria-label="View Old Sessions"
                              onClick={onViewOldSessions}
                              type="button"
                            >
                              <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            </button>
                            <small>Old Sessions</small>
                          </div>
                        </div>
                        <button
                          className="mini-btn session-gate-docs-btn"
                          onClick={onOpenHowItWorks}
                          type="button"
                        >
                          How It Works
                        </button>
                      </div>
                      <button
                        className="session-gate-footer"
                        onClick={onOpenWhoWeAre}
                        type="button"
                      >
                        Adstract 2026 ©
                      </button>
                    </section>
                  </section>
                )
              ) : (
                <section className={`assistant-shell ${sessionSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
                  <aside className="session-sidebar">
                    <div className="session-sidebar-header">
                      {!sessionSidebarCollapsed ? <h3>Sessions</h3> : <h3>Sessions</h3>}
                      <button
                        className="sidebar-toggle-btn"
                        onClick={() => setSessionSidebarCollapsed((prev) => !prev)}
                        type="button"
                        aria-label={sessionSidebarCollapsed ? 'Expand sessions sidebar' : 'Collapse sessions sidebar'}
                      >
                        {sessionSidebarCollapsed ? '›' : '‹'}
                      </button>
                    </div>
                    {!sessionSidebarCollapsed ? (
                      sessionsForSidebar.length === 0 ? (
                        <p className="muted">No sessions.</p>
                      ) : (
                        <ul className="session-list">
                          {sessionsForSidebar.map((session) => (
                            <li
                              key={session.id}
                              className={`session-row ${resolvedSelectedSession?.id === session.id ? 'selected' : ''}`}
                              onContextMenu={(event) => onOpenSessionActions(event, session)}
                            >
                              <button
                                className="session-select-btn"
                                onClick={() => {
                                  setSelectedSessionId(session.id)
                                  setSelectedDiscussionId(undefined)
                                }}
                                type="button"
                              >
                                <div className="session-title-row">
                                  <strong>{getSessionListTitle(session)}</strong>
                                  {session.id === activeSession?.id && activeSession?.status === 'active' ? (
                                    <span className="session-active-dot" aria-label="Active session" title="Active session" />
                                  ) : null}
                                </div>
                                <div className="session-row-footer">
                                  <small
                                    className="session-row-count"
                                    aria-label={`${session.discussions.length} Discussions`}
                                  >
                                    {session.discussions.length}
                                  </small>
                                  <small className="session-row-time">{formatTimeOnly(session.startedAt)}</small>
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )
                    ) : null}
                  </aside>

                  <section className="discussion-pane">
                    {!state.isCompatibleTarget ? (
                      <section className="card error">
                        <h2>Unsupported Page</h2>
                        <p>Open a supported BBB join page to continue.</p>
                      </section>
                    ) : null}

                    <div className="discussion-flow" ref={discussionFlowRef}>
                      {discussionsForPanel.length === 0 ? (
                        <p className="muted empty-discussions-hint">{emptyDiscussionsMessage}</p>
                      ) : (
                        discussionsForPanel.map((discussion) => (
                          <article key={discussion.id} className="discussion-entry">
                            <button
                              className="bubble bubble-question"
                              type="button"
                              onClick={() => onOpenDiscussionContext(discussion)}
                            >
                              {discussion.inferredQuestion}
                            </button>
                            {getDiscussionParticipations(discussion).map((participation, index) => (
                              <div
                                key={`${discussion.id}-participation-${participation.generatedAt}-${index}`}
                                className="discussion-participation-item"
                              >
                                <div className="bubble bubble-user">
                                  {participation.text}
                                </div>
                                <small className="bubble-time-hover">{formatTimeOnly(participation.generatedAt)}</small>
                              </div>
                            ))}
                          </article>
                        ))
                      )}
                      {flowStage === 'awaiting-analysis' ? (
                        <article className="discussion-entry">
                          <div
                            className="bubble bubble-question bubble-question-pending"
                            role="status"
                            aria-label="Waiting for inferred question"
                          >
                            &nbsp;
                          </div>
                        </article>
                      ) : null}
                      {flowStage === 'awaiting-similar-question' ? (
                        <article className="discussion-entry">
                          <div
                            className="bubble bubble-user bubble-user-pending"
                            role="status"
                            aria-label="Waiting for similar question"
                          >
                            &nbsp;
                          </div>
                        </article>
                      ) : null}
                      {flowStage === 'awaiting-suggestion' ? (
                        <article className="discussion-entry">
                          <div
                            className="bubble bubble-user bubble-user-pending"
                            role="status"
                            aria-label="Waiting for suggestion"
                          >
                            &nbsp;
                          </div>
                        </article>
                      ) : null}
                    </div>

                    <section className="chat-island">
                      <div className="chat-input-row">
                        <textarea
                          ref={draftInputRef}
                          value={draftText}
                          onChange={(event) => onDraftTextChange(event.target.value)}
                          onKeyDown={onDraftKeyDown}
                          placeholder={isSelectedSessionEditable
                            ? (flowStage === 'participating'
                              ? (canParticipateTarget
                                ? 'Write your participation message here...'
                                : 'No open question to answer.')
                              : 'Choose a participation action first.')
                            : 'This session is read-only.'}
                          rows={2}
                          disabled={!isParticipationInputEnabled}
                        />
                        {showEnterConfirm ? (
                          <div className="enter-confirm-popup" role="status">
                            Press Enter again to confirm. Press Esc to cancel.
                          </div>
                        ) : null}
                        <div className="flow-actions-panel">
                          {flowStage === 'idle' ? (
                            <div className="flow-icon-stack">
                              <button
                                className="flow-icon-btn custom-tooltip-trigger"
                                data-tooltip="Analyze Discussion"
                                aria-label="Analyze Discussion"
                                onClick={onGatherContext}
                                type="button"
                                disabled={!state.isCompatibleTarget || state.isAnalyzing || state.isGenerating || !isSelectedSessionEditable}
                              >
                                <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                  <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
                                  <line x1="16" y1="16" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                              </button>
                            </div>
                          ) : null}
                          {flowStage === 'collecting' ? (
                            <div className="flow-icon-stack">
                              <button className="flow-icon-btn custom-tooltip-trigger collecting" data-tooltip="Gathering Context" aria-label="Gathering Context" type="button" disabled>
                                <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                  <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="30 16" />
                                </svg>
                              </button>
                            </div>
                          ) : null}
                          {flowStage === 'collected' ? (
                            <div className="flow-icon-row flow-icon-triple">
                              <button className="flow-icon-btn custom-tooltip-trigger" data-tooltip="Cancel" aria-label="Cancel" onClick={onCancelContextFlow} type="button">
                                <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                  <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                  <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                              </button>
                              <button
                                className="flow-icon-btn custom-tooltip-trigger tooltip-multiline"
                                data-tooltip={settingsHasApiKey ? (isContextFull ? 'Proceed to New\nDiscussion' : 'Proceed Partly to New\nDiscussion') : 'Add OpenAI API key\nin Settings'}
                                data-tooltip-pos="top"
                                aria-label={settingsHasApiKey ? (isContextFull ? 'Proceed to New Discussion' : 'Proceed Partly to New Discussion') : 'Add OpenAI API key in Settings'}
                                onClick={onProceedWithContext}
                                type="button"
                                disabled={contextCount === 0 || !settingsHasApiKey}
                              >
                                <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M5 12h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                  <path d="M13 7l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                              <button
                                className="flow-icon-btn custom-tooltip-trigger tooltip-multiline"
                                data-tooltip={'Continue Previous\nDiscussion'}
                                aria-label="Continue Previous Discussion"
                                onClick={onContinuePreviousDiscussion}
                                type="button"
                                disabled={contextCount === 0 || !latestDiscussion?.inferredQuestion}
                              >
                                <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M9 8H5v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M5 12a7 7 0 1 0 2-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            </div>
                          ) : null}
                          {flowStage === 'awaiting-analysis' ? (
                            <div className="flow-icon-row">
                              <button
                                className="flow-icon-btn custom-tooltip-trigger collecting"
                                data-tooltip="Waiting for response"
                                aria-label="Waiting for response"
                                type="button"
                                disabled
                              >
                                <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M5 12h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                  <path d="M13 7l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            </div>
                          ) : null}
                          {flowStage === 'participating' ? (
                            <div className="flow-icon-row flow-icon-triple">
                              <button className="flow-icon-btn custom-tooltip-trigger" data-tooltip="Don’t Participate" aria-label="Don’t Participate" onClick={onParticipateWithNothing} type="button">
                                <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                  <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                  <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                              </button>
                              <button className="flow-icon-btn custom-tooltip-trigger tooltip-multiline" data-tooltip={'Get Similar\nQuestion'} aria-label="Get Similar Question" onClick={onGetSimilarQuestion} type="button">
                                <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                  <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
                                  <path d="M9.4 9.3a2.6 2.6 0 1 1 4.2 2.1c-.9.7-1.4 1.1-1.4 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                  <circle cx="12" cy="17" r="1" fill="currentColor" />
                                </svg>
                              </button>
                              <button className="flow-icon-btn custom-tooltip-trigger tooltip-multiline" data-tooltip={'Get\nSuggestion'} aria-label="Get Suggestion" onClick={onParticipate} type="button">
                                <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M6 12L20 4L14 20L11 13L6 12Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            </div>
                          ) : null}
                          {flowStage === 'awaiting-suggestion' ? (
                            <div className="flow-icon-row">
                              <button
                                className="flow-icon-btn custom-tooltip-trigger collecting"
                                data-tooltip="Generating suggestion"
                                aria-label="Generating suggestion"
                                type="button"
                                disabled
                              >
                                <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M6 12L20 4L14 20L11 13L6 12Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            </div>
                          ) : null}
                          {flowStage === 'awaiting-similar-question' ? (
                            <div className="flow-icon-row">
                              <button
                                className="flow-icon-btn custom-tooltip-trigger collecting"
                                data-tooltip="Generating similar question"
                                aria-label="Generating similar question"
                                type="button"
                                disabled
                              >
                                <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                  <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
                                  <path d="M9.4 9.3a2.6 2.6 0 1 1 4.2 2.1c-.9.7-1.4 1.1-1.4 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                  <circle cx="12" cy="17" r="1" fill="currentColor" />
                                </svg>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </section>

                    <div className="discussion-footer-bar">
                      <div
                        className={`discussion-error-slot ${effectiveLastError ? 'has-error' : ''}`}
                        data-error={effectiveLastError ?? ''}
                      >
                        <span className="discussion-error-preview">{errorPreview || ''}</span>
                      </div>
                      <div className="context-meter-row">
                        <button
                          className={`context-meter custom-tooltip-trigger ${flowStage === 'collecting' ? 'collecting' : ''} ${(flowStage !== 'idle' || contextCount > 0) ? 'visible' : 'hidden'}`}
                          onClick={() => setShowCapturedContextModal(true)}
                          type="button"
                          data-tooltip={`${contextCount}/${contextTarget} messages`}
                          data-tooltip-pos="left"
                          aria-label={`${contextCount} of ${contextTarget} messages gathered`}
                          disabled={contextCount === 0 && flowStage !== 'collecting'}
                        >
                          <svg viewBox="0 0 40 40" className="context-meter-svg" aria-hidden="true">
                            <circle cx="20" cy="20" r="15.5" className="context-meter-bg" />
                            <circle
                              cx="20"
                              cy="20"
                              r="15.5"
                              className="context-meter-fill"
                              style={{ strokeDasharray: `${contextProgress} 100` }}
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </section>
                </section>
              )}
            </section>
          ) : null}

          {showDebugView && viewMode === 'debug' ? (
        <section className="stack">
          <section className="card">
            <h2>Debug Snapshot</h2>
            <button
              onClick={onDebugGetMessages}
              type="button"
              disabled={!state.isCompatibleTarget || state.isAnalyzing || state.isGenerating}
            >
              Get Messages
            </button>
            <small>{debugActionStatus || 'Click "Get Messages" to test parser extraction.'}</small>
            <p>Total captured messages: {state.debug.messageCount}</p>
            <small>Last analysis at: {formatTimestamp(state.debug.lastAnalysisAt)}</small>
            <small>Last debug fetch at: {formatTimestamp(state.debug.lastDebugFetchAt)}</small>
            {state.debug.lastError ? <p className="error-text">Error: {state.debug.lastError}</p> : null}
            {!state.isCompatibleTarget ? (
              <p className="error-text">Open a compatible BBB page to fetch debug messages.</p>
            ) : null}
          </section>

          <section className="card">
            <div className="section-header">
              <h2>Captured Messages</h2>
              <button className="mini-btn" onClick={onDebugClear} type="button">
                Clear
              </button>
            </div>
            {state.debug.collectedMessages.length === 0 ? (
              <p>No messages captured yet. Run Analyze Discussion first.</p>
            ) : (
              <ul className="message-list">
                {state.debug.collectedMessages.map((message) => renderMessageRow(message))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="section-header">
              <h2>Debug Logs</h2>
              <button className="mini-btn" onClick={onDebugClearLogs} type="button">
                Clear
              </button>
            </div>
            {state.debug.logs && state.debug.logs.length > 0 ? (
              <ul className="message-list">
                {state.debug.logs.map((entry) => (
                  <li key={entry} className="message-row">
                    <p className="message-row-text">{entry}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No debug logs yet.</p>
            )}
          </section>
        </section>
          ) : null}
        </>
      )}

      {selectedDiscussion ? (
        <div className="modal-backdrop" onClick={onCloseDiscussionContext}>
          <div className="modal-card discussion-context-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <h2>Discussion Context</h2>
              <button className="mini-btn" onClick={onCloseDiscussionContext} type="button">
                Close
              </button>
            </div>
            <p className="modal-question">{selectedDiscussion.inferredQuestion}</p>
            {selectedDiscussion.contextMessages.length === 0 ? (
              <p className="muted">No context messages were stored for this discussion.</p>
            ) : (
              <ul className="message-list">
                {selectedDiscussion.contextMessages.map((message) => renderMessageRow(message))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {sessionActionTarget ? (
        <div className="modal-backdrop" onClick={() => setSessionActionTarget(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <h2>Session Actions</h2>
            </div>
            <p className="muted">Session: "{sessionActionTarget.name}"</p>
            <div className="confirm-actions">
              <button
                className="ghost-btn"
                type="button"
                onClick={onRestoreSessionConfirm}
                disabled={sessionActionTarget.id === activeSession?.id && activeSession?.status === 'active'}
              >
                Restore
              </button>
              <button className="settings-danger-btn" type="button" onClick={onDeleteSessionConfirm}>
                Delete
              </button>
              <button className="ghost-btn" type="button" onClick={() => setSessionActionTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCapturedContextModal ? (
        <div className="modal-backdrop" onClick={() => setShowCapturedContextModal(false)}>
          <div className="modal-card captured-context-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <h2 className="context-modal-title">
                <span>Captured Context</span>
                <small
                  className="context-count-chip custom-tooltip-trigger"
                  data-tooltip="messages"
                  data-tooltip-pos="right"
                  aria-label={`${contextCount}/${contextTarget} messages`}
                >
                  {contextCount}/{contextTarget}
                </small>
              </h2>
              <button className="mini-btn" onClick={() => setShowCapturedContextModal(false)} type="button">
                Close
              </button>
            </div>
            {capturedContextMessages.length === 0 ? (
              <p className="muted">No messages gathered yet.</p>
            ) : (
              <ul className="message-list">
                {capturedContextMessages.map((message, index) =>
                  renderCapturedContextMessageRow(message, index, onDeleteCapturedContextMessage),
                )}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {showTermsModal ? (
        <div className="modal-backdrop" onClick={onCloseTermsModal}>
          <div className="modal-card terms-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <h2>Legal</h2>
              <button className="mini-btn" onClick={onCloseTermsModal} type="button">
                Close
              </button>
            </div>
            <div className="legal-tabs">
              <button
                className={`legal-tab ${legalTab === 'terms' ? 'active' : ''}`}
                onClick={() => setLegalTab('terms')}
                type="button"
              >
                Terms of Service
              </button>
              <button
                className={`legal-tab ${legalTab === 'privacy' ? 'active' : ''}`}
                onClick={() => setLegalTab('privacy')}
                type="button"
              >
                Privacy Policy
              </button>
            </div>
            <div className="terms-content">
              <div className="terms-markdown">
                {renderTermsMarkdown(legalTab === 'terms' ? TERMS_OF_SERVICE_TEXT : PRIVACY_POLICY_TEXT)}
              </div>
            </div>
            {pendingTermsAction ? (
              <div className="terms-actions">
                <small className="muted">
                  To continue using Adstract Discussion Assistant – Disusion.IO, you must first review and accept the Terms of Service and Privacy Policy.
                </small>
                <div className="terms-actions-buttons">
                  <button className="ghost-btn" onClick={onCloseTermsModal} type="button">
                    Decline
                  </button>
                  <button className="terms-accept-btn" onClick={onAcceptTerms} type="button">
                    Accept
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {showWhoWeAreModal ? (
        <div className="modal-backdrop" onClick={() => setShowWhoWeAreModal(false)}>
          <div className="modal-card about-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <h2>The team behind Discussion.IO</h2>
              <button className="mini-btn" onClick={() => setShowWhoWeAreModal(false)} type="button">
                Close
              </button>
            </div>
            <div className="about-logo-wrap">
              <img className="about-logo" src="/adstract-logo.png" alt="Adstract logo" />
            </div>
            <div className="terms-content">
              <div className="terms-markdown">
                {renderTermsMarkdown(ADSTRACT_TEXT)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showHowItWorks ? (
        <div className="modal-backdrop" onClick={() => setShowHowItWorks(false)}>
          <div className="modal-card how-it-works-modal" onClick={(event) => event.stopPropagation()}>
            <div className="how-it-works-header">
              <div>
                <h2>How Discussion.IO Works</h2>
                <p className="how-it-works-subtitle">
                  A practical flow from context capture to final participation.
                </p>
              </div>
              <button
                className="mini-btn how-it-works-back-btn"
                onClick={() => setShowHowItWorks(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="how-it-works-content">
              <section className="how-it-works-section">
                <h3>Sessions</h3>
                <p>
                  Start each class as a separate session. Sessions store inferred questions, captured context,
                  and every participation message sent from the extension UI.
                </p>
                <ul>
                  <li>Create a new session from the welcome screen.</li>
                  <li>Open Old Sessions to browse history in read-only mode.</li>
                  <li>Right-click a saved session to restore it as the active session.</li>
                  <li>When restoring a session, the current active session is ended automatically.</li>
                </ul>
              </section>

              <section className="how-it-works-section">
                <h3>Discussions</h3>
                <p>
                  Click Analyze Discussion to capture the last X student messages from BBB chat (X is
                  configurable in Settings → Context), then choose how to proceed.
                </p>
                <ul>
                  <li>Cancel: discard captured context and return to idle.</li>
                  <li>Proceed to New Discussion: generate a new inferred question from captured context.</li>
                  <li>Continue Previous Discussion: reuse the latest inferred question and continue with fresh context.</li>
                  <li>Participation actions: Don’t Participate, Give Suggestion, or Get Similar Question.</li>
                  <li>Enter + Enter confirms sending your draft to extension history and BBB chat input/send.</li>
                </ul>
                <p>
                  Clicking any question bubble opens the exact stored context messages used for that discussion.
                </p>
              </section>

              <section className="how-it-works-section">
                <h3>Settings</h3>
                <p>
                  Configure AI, context, and storage controls in Settings. Session history and preferences are
                  stored in extension local storage.
                </p>
                <ul>
                  <li>AI tab: set OpenAI API key, model, language, and prompt semantics.</li>
                  <li>Context tab: set capture size (X messages) used by Analyze Discussion.</li>
                  <li>Sessions tab: export sessions JSON or clear all saved history.</li>
                </ul>
              </section>

              <section className="how-it-works-section">
                <h3>Legal and Compatibility</h3>
                <ul>
                  <li>Before first create/restore/restart session, you must accept both Terms and Privacy.</li>
                  <li>Legal documents are always available from the Legal icon in the top-right controls.</li>
                  <li>Unsupported pages show a compatibility warning and disable action controls.</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {showSettings ? (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal-card settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <h2>Settings</h2>
              <button className="mini-btn" onClick={() => setShowSettings(false)} type="button">
                Close
              </button>
            </div>
            <div className="settings-layout">
              <aside className="settings-tabs">
                <button
                  type="button"
                  className={`settings-tab-btn ${settingsTab === 'sessions' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('sessions')}
                >
                  Sessions
                </button>
                <button
                  type="button"
                  className={`settings-tab-btn ${settingsTab === 'ai' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('ai')}
                >
                  AI
                </button>
                <button
                  type="button"
                  className={`settings-tab-btn ${settingsTab === 'context' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('context')}
                >
                  Context
                </button>
              </aside>
              <section className="settings-panel">
                {settingsTab === 'sessions' ? (
                  <>
                    <p className="muted settings-note">Manage local session history.</p>
                    <div className="settings-actions">
                      <button className="settings-danger-btn" onClick={onDeleteAllSessionsHistory} type="button">
                        Delete All Sessions History
                      </button>
                      <button onClick={onDownloadSessions} type="button">
                        Download Sessions JSON
                      </button>
                    </div>
                  </>
                ) : settingsTab === 'ai' ? (
                  <>
                    <p className="muted settings-note">
                      API key for OpenAI requests. Configure model, language, and prompt semantics.
                    </p>
                    {!settingsHasApiKey ? (
                      <>
                        <div className="settings-field">
                          <label htmlFor="openai-api-key">OpenAI API Key</label>
                          <input
                            id="openai-api-key"
                            type="password"
                            value={settingsApiKey}
                            onChange={(event) => setSettingsApiKey(event.target.value)}
                            placeholder="sk-..."
                            autoComplete="off"
                          />
                        </div>
                        <div className="settings-actions">
                          <button onClick={onSaveApiKey} type="button">
                            Save API Key
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="settings-key-preview">
                          <small>Saved key</small>
                          <code>{apiKeyPreview || '••••••••'}</code>
                        </div>
                        <div className="settings-actions">
                          <button className="settings-danger-btn" onClick={onDeleteApiKey} type="button">
                            Delete API Key
                          </button>
                        </div>
                      </>
                    )}
                    <div className="settings-field">
                      <label htmlFor="ai-model-select">Model</label>
                      <select
                        id="ai-model-select"
                        value={settingsAiModel}
                        onChange={(event) => setSettingsAiModel(event.target.value as AiModel)}
                      >
                        {AI_MODEL_OPTIONS.map((model) => (
                          <option key={model.value} value={model.value}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="settings-field">
                      <label htmlFor="ai-language-select">Response language</label>
                      <select
                        id="ai-language-select"
                        value={settingsLanguage}
                        onChange={(event) => setSettingsLanguage(event.target.value as AgentLanguage)}
                      >
                        {LANGUAGE_OPTIONS.map((language) => (
                          <option key={language} value={language}>
                            {language}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="settings-key-preview">
                      <small>Current runtime</small>
                      <code>{settingsAiModel} · {settingsLanguage}</code>
                    </div>
                    <div className="settings-field">
                      <label htmlFor="prompt-general">Default semantic guidance</label>
                      <textarea
                        id="prompt-general"
                        value={settingsPromptSemantics.general}
                        onChange={(event) => onPromptSemanticsChange('general', event.target.value)}
                        rows={3}
                      />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="prompt-infer">Infer question semantics</label>
                      <textarea
                        id="prompt-infer"
                        value={settingsPromptSemantics.inferQuestion}
                        onChange={(event) => onPromptSemanticsChange('inferQuestion', event.target.value)}
                        rows={3}
                      />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="prompt-participation">Participation semantics</label>
                      <textarea
                        id="prompt-participation"
                        value={settingsPromptSemantics.participation}
                        onChange={(event) => onPromptSemanticsChange('participation', event.target.value)}
                        rows={3}
                      />
                    </div>
                    <div className="settings-field">
                      <label htmlFor="prompt-similar-question">Similar-question semantics</label>
                      <textarea
                        id="prompt-similar-question"
                        value={settingsPromptSemantics.similarQuestion}
                        onChange={(event) => onPromptSemanticsChange('similarQuestion', event.target.value)}
                        rows={3}
                      />
                    </div>
                    <div className="settings-actions">
                      <button onClick={onSaveAiConfig} type="button">
                        Save AI Settings
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="muted settings-note">Set how many latest messages are captured as context.</p>
                    <div className="settings-field">
                      <label htmlFor="context-window-size">Context size (messages)</label>
                      <input
                        id="context-window-size"
                        type="number"
                        min={1}
                        max={200}
                        step={1}
                        value={settingsContextWindow}
                        onChange={(event) => setSettingsContextWindow(Number(event.target.value))}
                      />
                    </div>
                    <div className="settings-actions">
                      <button onClick={onSaveContextWindow} type="button">
                        Save Context Size
                      </button>
                    </div>
                  </>
                )}
              </section>
            </div>
            {settingsStatus ? <small>{settingsStatus}</small> : null}
          </div>
        </div>
      ) : null}
    </main>
  )
}
