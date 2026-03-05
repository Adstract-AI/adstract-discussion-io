import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  type DiscussionRecord,
  MESSAGE_TYPES,
  type ChatMessage,
  type DiscussionAnalysisResult,
  type PopupViewState,
  type RuntimeMessage,
  type SessionRecord,
} from '../types/chat'

const DEFAULT_MESSAGE_WINDOW = 20
const DEV_MOCK_BASE = Date.now() - 1000 * 60 * 60

type ViewMode = 'assistant' | 'debug'
type AssistantFlowStage = 'idle' | 'collecting' | 'collected' | 'participating'
type SettingsTab = 'sessions' | 'ai' | 'context'

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
    participation: {
      text: 'One practical way abstraction helps is by defining clear interfaces so teams can change internals without breaking each other’s work.',
      generatedAt: DEV_MOCK_BASE + 1000 * 60 * 8,
    },
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
    participation: {
      text: 'I’d choose composition when flexibility matters, because small interchangeable components are easier to adapt than deep inheritance trees.',
      generatedAt: DEV_MOCK_BASE + 1000 * 60 * 22,
    },
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
  const [sessionSidebarCollapsed, setSessionSidebarCollapsed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('sessions')
  const [settingsApiKey, setSettingsApiKey] = useState('')
  const [settingsHasApiKey, setSettingsHasApiKey] = useState(false)
  const [settingsContextWindow, setSettingsContextWindow] = useState(DEFAULT_MESSAGE_WINDOW)
  const [contextWindow, setContextWindow] = useState(DEFAULT_MESSAGE_WINDOW)
  const [settingsStatus, setSettingsStatus] = useState('')
  const [showMockError, setShowMockError] = useState(false)
  const [sessionPendingDelete, setSessionPendingDelete] = useState<SessionRecord | null>(null)
  const [flowStage, setFlowStage] = useState<AssistantFlowStage>('idle')
  const [capturedContextMessages, setCapturedContextMessages] = useState<ChatMessage[]>([])
  const [capturedContextAt, setCapturedContextAt] = useState<number>()
  const [showCapturedContextModal, setShowCapturedContextModal] = useState(false)
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null)

  const showDebugView = import.meta.env.DEV
  const compatibilityKnown = typeof state.activeTabUrl !== 'undefined'
  const unsupportedOnlyView = compatibilityKnown && !state.isCompatibleTarget

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
        refreshSessionList()
      })
      .catch(() => {
        setState((previous) => ({
          ...previous,
          lastError: 'Unable to connect to extension background worker.',
        }))
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
  const hasInferredQuestion = discussionsForPanel.length > 0 || Boolean(currentAnalysis?.inferredQuestion)
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
        const typed = response as { contextWindow?: number } | undefined
        if (typed?.contextWindow && Number.isFinite(typed.contextWindow)) {
          const bounded = Math.max(5, Math.min(200, Math.round(typed.contextWindow)))
          setContextWindow(bounded)
          setSettingsContextWindow(bounded)
        }
      })
  }, [])

  useEffect(() => {
    if (!isSelectedSessionEditable && flowStage !== 'idle') {
      setFlowStage('idle')
      setCapturedContextMessages([])
      setCapturedContextAt(undefined)
    }
  }, [isSelectedSessionEditable, flowStage])

  const assistantStatus = useMemo(() => {
    if (state.lastError) {
      return 'Error'
    }

    if (state.isAnalyzing) {
      return 'Analyzing discussion...'
    }

    if (state.isGenerating) {
      return 'Generating participation draft...'
    }

    if (state.analysis) {
      return 'Analysis ready'
    }

    return 'Ready'
  }, [state.lastError, state.isAnalyzing, state.isGenerating, state.analysis])

  const assistantStatusClass = useMemo(() => {
    if (state.lastError) {
      return 'error'
    }
    if (state.isAnalyzing) {
      return 'analyzing'
    }
    if (state.isGenerating) {
      return 'generating'
    }
    if (state.analysis) {
      return 'analysis-ready'
    }
    return 'ready'
  }, [state.lastError, state.isAnalyzing, state.isGenerating, state.analysis])

  const sessionHeading = state.sessionRequired
    ? 'No Active Session'
    : (activeSession?.name ?? 'Active Session')

  const onGatherContext = (): void => {
    setFlowStage('collecting')
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
    setFlowStage('idle')
  }

  const onProceedWithContext = (): void => {
    if (capturedContextMessages.length === 0) {
      return
    }

    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.ANALYZE_FROM_CONTEXT,
      payload: {
        messageWindow: contextWindow,
        capturedAt: capturedContextAt ?? Date.now(),
        contextMessages: capturedContextMessages,
      },
    }).then(() => {
      setFlowStage('participating')
      if (activeSession?.id) {
        setSelectedSessionId(activeSession.id)
      }
      refreshSessionList()
    })
  }

  const onStartSession = (): void => {
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SESSION_START,
    }).then((response: unknown) => {
      const typed = response as { session?: SessionRecord } | undefined
      if (typed?.session?.id) {
        setSelectedSessionId(typed.session.id)
      }
      setShowOldSessions(false)
      refreshSessionList()
    })
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

  const onRestartSession = (): void => {
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

  const onParticipate = (): void => {
    const fallback: DiscussionAnalysisResult = {
      inferredQuestion: 'No inferred question available.',
      contextMessages: [],
      capturedAt: Date.now(),
    }

    const analysis = currentAnalysis ?? fallback

    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GENERATE_PARTICIPATION,
      payload: {
        inferredQuestion: analysis.inferredQuestion,
        contextMessages: analysis.contextMessages,
      },
    }).then(() => {
      setFlowStage('idle')
      setCapturedContextMessages([])
      setCapturedContextAt(undefined)
      refreshSessionList()
    })
  }

  const onParticipateWithNothing = (): void => {
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.PARTICIPATE_WITH_TEXT,
      payload: {
        text: 'Nothing to add',
      },
    }).then(() => {
      setFlowStage('idle')
      setCapturedContextMessages([])
      setCapturedContextAt(undefined)
      refreshSessionList()
    })
  }

  const onDiscuss = (): void => {
    draftInputRef.current?.focus()
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

  const onOpenSessionDeleteModal = (event: MouseEvent, session: SessionRecord): void => {
    event.preventDefault()
    if (session.id === DEV_MOCK_PREVIOUS_SESSION.id) {
      return
    }
    setSessionPendingDelete(session)
  }

  const onDeleteSessionConfirm = (): void => {
    if (!sessionPendingDelete) {
      return
    }

    const deletingId = sessionPendingDelete.id
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
      setSessionPendingDelete(null)
      refreshSessionList()
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      setDebugActionStatus(`Delete failed: ${text}`)
    })
  }

  const onTitleClick = (): void => {
    if (state.sessionRequired) {
      setShowOldSessions(false)
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
      const typed = response as { apiKey?: string; hasApiKey?: boolean; error?: string } | undefined
      if (typed?.error) {
        setSettingsStatus(`Failed to load settings: ${typed.error}`)
        return
      }
      setSettingsApiKey(typed?.apiKey ?? '')
      setSettingsHasApiKey(Boolean(typed?.hasApiKey))
      if (typed && typeof (typed as { contextWindow?: number }).contextWindow === 'number') {
        const bounded = Math.max(5, Math.min(200, Math.round((typed as { contextWindow?: number }).contextWindow ?? DEFAULT_MESSAGE_WINDOW)))
        setSettingsContextWindow(bounded)
        setContextWindow(bounded)
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
    const bounded = Math.max(5, Math.min(200, Math.round(settingsContextWindow || DEFAULT_MESSAGE_WINDOW)))
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
    state.sessionRequired && !unsupportedOnlyView && !showOldSessions ? 'compact' : '',
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
            disabled={state.sessionRequired}
          />
          <button
            className="window-btn yellow"
            title="Minimize (Close Popup)"
            onClick={onClosePopup}
            type="button"
          />
          <button
            className="window-btn green"
            title="End Current and Start New Session"
            onClick={onRestartSession}
            type="button"
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
        </div>
        <button
          className="settings-toggle-btn"
          onClick={onOpenSettings}
          type="button"
          title="Settings"
          aria-label="Open settings"
        >
          ⚙
        </button>
      </div>

      <header className="popup-header">
        {unsupportedOnlyView ? (
          <h1>Discussion.IO</h1>
        ) : (
          <>
            <div className="popup-header-top">
              <h1>
                <button
                  className={`title-home-btn ${state.sessionRequired ? 'clickable' : ''}`}
                  onClick={onTitleClick}
                  type="button"
                >
                  Discussion.IO
                </button>
              </h1>
              <div className="session-status-inline">
                <span
                  className={`status-dot ${assistantStatusClass} custom-tooltip-trigger`}
                  data-tooltip={assistantStatus}
                  aria-label={assistantStatus}
                />
                <small className="session-chip session-title-main">{sessionHeading}</small>
              </div>
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
            <section className="stack">
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
                              <div className="bubble bubble-user">
                                {discussion.participation?.text ?? 'No participation.'}
                              </div>
                              <small className="bubble-time-hover">{formatTimeOnly(discussion.createdAt)}</small>
                            </article>
                          ))
                        )}
                      </div>
                      <section className="chat-island history-only-island">
                        <h2>History Only</h2>
                        <p className="muted">Viewing saved sessions. Start a new session to analyze live chat.</p>
                        <div className="chat-island-actions">
                          <button onClick={onStartSession} type="button">
                            Create New Session
                          </button>
                        </div>
                      </section>
                    </section>
                  </section>
                ) : (
                  <section className="card session-gate">
                    <p>Choose an action.</p>
                    <div className="session-gate-actions">
                      <button className="session-gate-btn" onClick={onStartSession} type="button">
                        Create New Session
                      </button>
                      <button
                        className="session-gate-btn"
                        onClick={onViewOldSessions}
                        type="button"
                      >
                        View Old Sessions
                      </button>
                    </div>
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
                              onContextMenu={(event) => onOpenSessionDeleteModal(event, session)}
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
                    {!state.isCompatibleTarget ? (
                      <section className="card error">
                        <h2>Unsupported Page</h2>
                        <p>Open a supported BBB join page to continue.</p>
                      </section>
                    ) : null}

                    <div className="discussion-flow">
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
                            <div className="bubble bubble-user">
                              {discussion.participation?.text ?? 'No participation yet.'}
                            </div>
                            <small className="bubble-time-hover">{formatTimeOnly(discussion.createdAt)}</small>
                          </article>
                        ))
                      )}
                    </div>

                    <section className="chat-island">
                      <div className="chat-input-row">
                        <textarea
                          ref={draftInputRef}
                          value={draftText}
                          onChange={(event) => setDraftText(event.target.value)}
                          placeholder={isSelectedSessionEditable
                            ? (hasInferredQuestion
                              ? 'Write your participation message here...'
                              : 'Analyze discussion first to unlock input.')
                            : 'This session is read-only.'}
                          rows={2}
                          disabled={!hasInferredQuestion || !isSelectedSessionEditable}
                        />
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
                            <div className="flow-icon-row">
                              <button className="flow-icon-btn custom-tooltip-trigger" data-tooltip="Cancel" aria-label="Cancel" onClick={onCancelContextFlow} type="button">
                                <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                  <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                  <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                              </button>
                              <button
                                className="flow-icon-btn custom-tooltip-trigger"
                                data-tooltip={isContextFull ? 'Proceed' : 'Proceed Partly'}
                                aria-label={isContextFull ? 'Proceed' : 'Proceed Partly'}
                                onClick={onProceedWithContext}
                                type="button"
                                disabled={contextCount === 0}
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
                              <button className="flow-icon-btn custom-tooltip-trigger" data-tooltip="Discuss" aria-label="Discuss" onClick={onDiscuss} type="button">
                                <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                  <rect x="4" y="5" width="16" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                                  <path d="M8 19l3-3h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                              <button className="flow-icon-btn custom-tooltip-trigger" data-tooltip="Give Suggestion" aria-label="Give Suggestion" onClick={onParticipate} type="button">
                                <svg className="icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M6 12L20 4L14 20L11 13L6 12Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
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

      {sessionPendingDelete ? (
        <div className="modal-backdrop" onClick={() => setSessionPendingDelete(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <h2>Delete Session</h2>
            </div>
            <p className="muted">Delete "{sessionPendingDelete.name}" and all its discussions?</p>
            <div className="confirm-actions">
              <button className="ghost-btn" type="button" onClick={() => setSessionPendingDelete(null)}>
                No
              </button>
              <button className="settings-danger-btn" type="button" onClick={onDeleteSessionConfirm}>
                Yes
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
                    <p className="muted settings-note">Configure OpenAI key for question/suggestion generation.</p>
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
                  </>
                ) : (
                  <>
                    <p className="muted settings-note">Set how many latest messages are captured as context.</p>
                    <div className="settings-field">
                      <label htmlFor="context-window-size">Context size (messages)</label>
                      <input
                        id="context-window-size"
                        type="number"
                        min={5}
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
