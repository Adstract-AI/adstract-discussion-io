import type { DiscussionRecord, ParticipationResult, SessionRecord, StoredData } from '../types/chat'

const STORE_KEY = 'discussionAssistantStoreV1'

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8)
}

function sessionNameFromNow(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `Session ${year}-${month}-${day} ${hours}:${minutes}`
}

function createEmptyStore(): StoredData {
  return {
    schemaVersion: 1,
    sessions: [],
  }
}

function validateStore(value: unknown): StoredData {
  if (!value || typeof value !== 'object') {
    return createEmptyStore()
  }

  const store = value as Partial<StoredData>
  if (store.schemaVersion !== 1 || !Array.isArray(store.sessions)) {
    return createEmptyStore()
  }

  const normalizedSessions = store.sessions.map((session) => ({
    ...session,
    discussions: (session.discussions ?? []).map((discussion) => {
      const existing = Array.isArray(discussion.participations)
        ? discussion.participations
        : []
      const legacy = discussion.participation ? [discussion.participation] : []
      const participations = [...existing, ...legacy]

      return {
        ...discussion,
        participations,
      }
    }),
  }))

  return {
    schemaVersion: 1,
    activeSessionId: store.activeSessionId,
    sessions: normalizedSessions,
  }
}

export async function loadStore(): Promise<StoredData> {
  const raw = await chrome.storage.local.get(STORE_KEY)
  return validateStore(raw[STORE_KEY])
}

export async function saveStore(store: StoredData): Promise<void> {
  await chrome.storage.local.set({
    [STORE_KEY]: store,
  })
}

export function getActiveSession(store: StoredData): SessionRecord | undefined {
  if (!store.activeSessionId) {
    return undefined
  }

  return store.sessions.find((session) => session.id === store.activeSessionId)
}

export async function startSession(): Promise<SessionRecord> {
  const store = await loadStore()
  const now = Date.now()
  const session: SessionRecord = {
    id: `sess-${now}-${randomSuffix()}`,
    name: sessionNameFromNow(now),
    startedAt: now,
    status: 'active',
    discussions: [],
  }

  const nextStore: StoredData = {
    ...store,
    activeSessionId: session.id,
    sessions: [session, ...store.sessions],
  }

  await saveStore(nextStore)
  return session
}

export async function endSession(sessionId: string): Promise<void> {
  const store = await loadStore()
  const now = Date.now()

  const sessions = store.sessions.map((session) => {
    if (session.id !== sessionId) {
      return session
    }

    return {
      ...session,
      status: 'ended' as const,
      endedAt: session.endedAt ?? now,
    }
  })

  const nextStore: StoredData = {
    ...store,
    activeSessionId: store.activeSessionId === sessionId ? undefined : store.activeSessionId,
    sessions,
  }

  await saveStore(nextStore)
}

export async function deleteSession(sessionId: string): Promise<void> {
  const store = await loadStore()
  const sessions = store.sessions.filter((session) => session.id !== sessionId)

  const nextStore: StoredData = {
    ...store,
    activeSessionId: store.activeSessionId === sessionId ? undefined : store.activeSessionId,
    sessions,
  }

  await saveStore(nextStore)
}

export async function restoreSession(sessionId: string): Promise<void> {
  const store = await loadStore()
  const now = Date.now()
  const target = store.sessions.find((session) => session.id === sessionId)
  if (!target) {
    return
  }

  const sessions = store.sessions.map((session) => {
    if (session.id === sessionId) {
      return {
        ...session,
        status: 'active' as const,
        endedAt: undefined,
      }
    }

    if (store.activeSessionId && session.id === store.activeSessionId) {
      return {
        ...session,
        status: 'ended' as const,
        endedAt: session.endedAt ?? now,
      }
    }

    return session
  })

  const nextStore: StoredData = {
    ...store,
    activeSessionId: sessionId,
    sessions,
  }

  await saveStore(nextStore)
}

export async function appendDiscussion(sessionId: string, discussion: DiscussionRecord): Promise<void> {
  const store = await loadStore()

  const sessions = store.sessions.map((session) => {
    if (session.id !== sessionId) {
      return session
    }

    return {
      ...session,
      discussions: [...session.discussions, discussion],
    }
  })

  await saveStore({
    ...store,
    sessions,
  })
}

export async function setDiscussionParticipation(
  sessionId: string,
  discussionId: string,
  participation: ParticipationResult,
): Promise<void> {
  const store = await loadStore()

  const sessions = store.sessions.map((session) => {
    if (session.id !== sessionId) {
      return session
    }

    const discussions = session.discussions.map((discussion) => {
      if (discussion.id !== discussionId) {
        return discussion
      }

      return {
        ...discussion,
        participations: [...(discussion.participations ?? []), participation],
      }
    })

    return {
      ...session,
      discussions,
    }
  })

  await saveStore({
    ...store,
    sessions,
  })
}
