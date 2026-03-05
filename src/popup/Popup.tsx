import { useEffect, useMemo, useState } from 'react'
import {
  MESSAGE_TYPES,
  type ChatMessage,
  type DiscussionAnalysisResult,
  type PopupViewState,
  type RuntimeMessage,
} from '../types/chat'

const DEFAULT_MESSAGE_WINDOW = 20

type ViewMode = 'assistant' | 'debug'

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

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) {
    return 'N/A'
  }

  return new Date(timestamp).toLocaleString()
}

function formatTimeOnly(timestamp?: number): string {
  if (!timestamp) {
    return 'N/A'
  }

  return new Date(timestamp).toLocaleTimeString()
}

function stripIndexFromUsername(username: string): string {
  return username.replace(/\s*\(\d+\)\s*$/, '').trim()
}

function renderMessageRow(message: ChatMessage) {
  const displayName = stripIndexFromUsername(message.username)

  return (
    <li key={message.id} className="message-row">
      <div className="message-row-meta">
        <strong>{displayName || message.username}</strong>
        <strong className="message-row-index">{message.studentIndex ?? 'N/A'}</strong>
      </div>
      <p className="message-row-text">{message.text}</p>
      <small className="message-row-time">{formatTimeOnly(message.timestamp)}</small>
    </li>
  )
}

export default function Popup() {
  const [state, setState] = useState<PopupViewState>(initialState)
  const [viewMode, setViewMode] = useState<ViewMode>('assistant')
  const [draftText, setDraftText] = useState('')
  const [debugActionStatus, setDebugActionStatus] = useState('')

  const showDebugView = import.meta.env.DEV
  const compatibilityKnown = typeof state.activeTabUrl !== 'undefined'
  const unsupportedOnlyView = compatibilityKnown && !state.isCompatibleTarget

  useEffect(() => {
    const onMessage = (message: unknown): void => {
      const typed = message as RuntimeMessage
      if (typed?.type === MESSAGE_TYPES.POPUP_STATE_UPDATE && typed.payload && typeof typed.payload === 'object') {
        setState(typed.payload as PopupViewState)
      }
    }

    chrome.runtime.onMessage.addListener(onMessage)

    chrome.runtime
      .sendMessage({ type: MESSAGE_TYPES.GET_POPUP_STATE })
      .then((snapshot: PopupViewState | undefined) => {
        if (snapshot) {
          setState(snapshot)
        }
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

  const onAnalyzeDiscussion = (): void => {
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.ANALYZE_DISCUSSION,
      payload: {
        messageWindow: DEFAULT_MESSAGE_WINDOW,
      },
    })
  }

  const onStartSession = (): void => {
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SESSION_START,
    })
  }

  const onEndSession = (): void => {
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SESSION_END,
    })
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
    })
  }

  const onDebugGetMessages = (): void => {
    setDebugActionStatus('Sending debug fetch request...')
    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.DEBUG_GET_MESSAGES,
      payload: {
        limit: DEFAULT_MESSAGE_WINDOW,
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

  return (
    <main className={`popup-root ${unsupportedOnlyView ? 'unsupported' : ''}`}>
      <header className="popup-header">
        {unsupportedOnlyView ? (
          <h1>Discussion Assistant</h1>
        ) : (
          <>
            <div className="popup-header-top">
              <h1>Discussion Assistant</h1>
              <div className="popup-header-right">
                {state.sessionRequired ? (
                  <small className="session-chip">No active session</small>
                ) : (
                  <>
                    <small className="session-chip">
                      {state.activeSession?.name ?? 'Active Session'} · {state.activeSession?.discussions.length ?? 0}
                    </small>
                    <button className="mini-btn" onClick={onEndSession} type="button">
                      End
                    </button>
                  </>
                )}
              </div>
            </div>
            <p>{assistantStatus}</p>
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
          <div className="tabs">
          <button
            className={`tab ${viewMode === 'assistant' ? 'active' : ''}`}
            onClick={() => setViewMode('assistant')}
            type="button"
          >
            Assistant
          </button>
          {showDebugView ? (
            <button
              className={`tab ${viewMode === 'debug' ? 'active' : ''}`}
              onClick={() => setViewMode('debug')}
              type="button"
            >
              Debug
            </button>
          ) : null}
          </div>

          {viewMode === 'assistant' ? (
        <section className="stack">
          {state.sessionRequired ? (
            <section className="card">
              <h2>No Active Session</h2>
              <p>Start a new session to begin analyzing and storing discussions.</p>
              <small>Stored sessions: {state.sessionHistoryCount}</small>
              <button onClick={onStartSession} type="button">
                Start New Session
              </button>
            </section>
          ) : (
            <>
              <section className="card">
                <h2>Analyze Discussion</h2>
                <p>Collect the last {DEFAULT_MESSAGE_WINDOW} chat messages and infer the discussion question.</p>
                <button
                  onClick={onAnalyzeDiscussion}
                  type="button"
                  disabled={!state.isCompatibleTarget || state.isAnalyzing || state.isGenerating}
                >
                  Analyze Discussion
                </button>
              </section>

              <section className="card">
                <h2>Inferred Question</h2>
                <p>{currentAnalysis?.inferredQuestion ?? 'No question inferred yet.'}</p>
                <small>Messages in context: {currentAnalysis?.contextMessages.length ?? 0}</small>
                <small>Captured at: {formatTimestamp(currentAnalysis?.capturedAt)}</small>
              </section>

              <section className="card">
                <h2>Your Draft</h2>
                <textarea
                  value={draftText}
                  onChange={(event) => setDraftText(event.target.value)}
                  placeholder="Write your own answer here (optional)."
                  rows={4}
                />
                <small>Your draft is local to this popup for now.</small>
              </section>

              <section className="card">
                <h2>Participate in Discussion</h2>
                <p>Generate a placeholder participation draft from the inferred question and context.</p>
                <button
                  onClick={onParticipate}
                  type="button"
                  disabled={!state.isCompatibleTarget || state.isAnalyzing || state.isGenerating}
                >
                  Participate in Discussion
                </button>
              </section>

              <section className="card">
                <h2>Generated Draft</h2>
                <p>{state.participation?.text ?? 'No generated draft yet.'}</p>
                <small>Generated at: {formatTimestamp(state.participation?.generatedAt)}</small>
              </section>

              {state.lastError ? (
                <section className="card error">
                  <h2>Last Error</h2>
                  <p>{state.lastError}</p>
                </section>
              ) : null}
            </>
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
    </main>
  )
}
