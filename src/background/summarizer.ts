import type { ChatMessage } from '../types/chat'

function extractTopicHint(messages: ChatMessage[]): string {
  const firstMessage = messages.find((message) => message.text.trim().length > 0)
  if (!firstMessage) {
    return 'the topic discussed in class'
  }

  const words = firstMessage.text
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) {
    return 'the topic discussed in class'
  }

  return words.slice(0, 5).join(' ')
}

export function inferQuestionFromResponses(messages: ChatMessage[]): string {
  const topicHint = extractTopicHint(messages)
  return `Inferred question (placeholder): How does ${topicHint} connect to the core concept from this discussion?`
}

export function generateParticipationText(question: string, contextMessages: ChatMessage[]): string {
  const topicHint = extractTopicHint(contextMessages)
  const responseCount = contextMessages.length

  return `Participation draft (placeholder): Based on ${responseCount} recent responses, one angle I would add is that ${topicHint} should be tied directly to the question \"${question}\" through a practical example.`
}
