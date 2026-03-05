import type { ChatMessage } from '../types/chat'
import type { AiModel, AgentLanguage, PromptSemantics } from '../types/chat'
import { buildDiscussionAssistantSystemPrompt } from './prompts/systemPrompt'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

export interface AiRuntimeOptions {
  model: AiModel
  language: AgentLanguage
  prompts: PromptSemantics
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

function toContextBlock(messages: ChatMessage[]): string {
  return messages
    .map((message, index) => {
      const name = message.username || 'Unknown'
      const indexText = message.studentIndex ? ` [${message.studentIndex}]` : ''
      return `${index + 1}. ${name}${indexText}: ${message.text}`
    })
    .join('\n')
}

async function requestJsonObject(
  apiKey: string,
  userPrompt: string,
  options: AiRuntimeOptions,
): Promise<Record<string, unknown>> {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: buildDiscussionAssistantSystemPrompt(options.language, options.prompts),
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI request failed (${response.status}): ${errorText}`)
  }

  const data = await response.json() as OpenAIChatCompletionResponse
  const content = data.choices?.[0]?.message?.content

  if (!content) {
    throw new Error('OpenAI returned an empty completion.')
  }

  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    throw new Error(`OpenAI returned non-JSON content: ${content}`)
  }
}

export async function inferQuestionFromResponses(
  messages: ChatMessage[],
  apiKey: string,
  options: AiRuntimeOptions,
): Promise<string> {
  const contextBlock = toContextBlock(messages)
  const json = await requestJsonObject(
    apiKey,
    `TASK: infer_question\n\nContext messages:\n${contextBlock || 'No context messages provided.'}`,
    options,
  )
  const inferredQuestion = (json.inferredQuestion ?? '').toString().trim()
  if (!inferredQuestion) {
    throw new Error('OpenAI did not return inferredQuestion.')
  }
  return inferredQuestion
}

export async function generateParticipationText(
  question: string,
  contextMessages: ChatMessage[],
  apiKey: string,
  options: AiRuntimeOptions,
  previousSuggestions: string[] = [],
  previousParticipations: string[] = [],
): Promise<string> {
  const contextBlock = toContextBlock(contextMessages)
  const avoidBlock = previousSuggestions
    .map((entry, index) => `${index + 1}. ${entry}`)
    .join('\n')
  const participationHistoryBlock = previousParticipations
    .map((entry, index) => `${index + 1}. ${entry}`)
    .join('\n')
  const json = await requestJsonObject(
    apiKey,
    `TASK: suggest_participation\n\nInferred question:\n${question}\n\nContext messages:\n${contextBlock || 'No context messages provided.'}\n\nPrevious participations in this discussion (avoid repeating the same point):\n${participationHistoryBlock || 'None.'}\n\nPreviously suggested participation texts (DO NOT repeat):\n${avoidBlock || 'None.'}`,
    options,
  )
  const participationText = (json.participationText ?? '').toString().trim()
  if (!participationText) {
    throw new Error('OpenAI did not return participationText.')
  }
  return participationText
}

export async function generateSimilarQuestion(
  question: string,
  contextMessages: ChatMessage[],
  apiKey: string,
  options: AiRuntimeOptions,
  previousQuestions: string[] = [],
  previousParticipations: string[] = [],
): Promise<string> {
  const contextBlock = toContextBlock(contextMessages)
  const avoidBlock = previousQuestions
    .map((entry, index) => `${index + 1}. ${entry}`)
    .join('\n')
  const participationHistoryBlock = previousParticipations
    .map((entry, index) => `${index + 1}. ${entry}`)
    .join('\n')
  const json = await requestJsonObject(
    apiKey,
    `TASK: suggest_similar_question\n\nCurrent question:\n${question}\n\nContext messages:\n${contextBlock || 'No context messages provided.'}\n\nPrevious participations in this discussion:\n${participationHistoryBlock || 'None.'}\n\nPreviously suggested similar questions (DO NOT repeat):\n${avoidBlock || 'None.'}`,
    options,
  )
  const similarQuestion = (json.similarQuestion ?? '').toString().trim()
  if (!similarQuestion) {
    throw new Error('OpenAI did not return similarQuestion.')
  }
  return similarQuestion
}
