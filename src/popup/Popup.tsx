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

function renderMessageRow(message: ChatMessage) {
  return (
    <li key={message.id} className="message-row">
      <div className="message-row-meta">
        <span>{message.username}</span>
        <span>{formatTimestamp(message.timestamp)}</span>
      </div>
      <p className="message-row-text">{message.text}</p>
      <code className="message-row-id">{message.id}</code>
    </li>
  )
}

export default function Popup() {
  const [state, setState] = useState<PopupViewState>(initialState)
  const [viewMode, setViewMode] = useState<ViewMode>('assistant')
  const [draftText, setDraftText] = useState('')

  const showDebugView = import.meta.env.DEV

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

  return (
    <main className="popup-root">
      <header className="popup-header">
        <h1>Discussion Assistant</h1>
        <p>{assistantStatus}</p>
      </header>

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
          <section className="card">
            <h2>Analyze Discussion</h2>
            <p>Collect the last {DEFAULT_MESSAGE_WINDOW} chat messages and infer the discussion question.</p>
            <button onClick={onAnalyzeDiscussion} type="button" disabled={state.isAnalyzing || state.isGenerating}>
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
            <button onClick={onParticipate} type="button" disabled={state.isAnalyzing || state.isGenerating}>
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
        </section>
      ) : null}

      {showDebugView && viewMode === 'debug' ? (
        <section className="stack">
          <section className="card">
            <h2>Debug Snapshot</h2>
            <p>Total captured messages: {state.debug.messageCount}</p>
            <small>Last analysis at: {formatTimestamp(state.debug.lastAnalysisAt)}</small>
            {state.debug.lastError ? <p className="error-text">Error: {state.debug.lastError}</p> : null}
          </section>

          <section className="card">
            <h2>Captured Messages</h2>
            {state.debug.collectedMessages.length === 0 ? (
              <p>No messages captured yet. Run Analyze Discussion first.</p>
            ) : (
              <ul className="message-list">
                {state.debug.collectedMessages.map((message) => renderMessageRow(message))}
              </ul>
            )}
          </section>
        </section>
      ) : null}
    </main>
  )
}
