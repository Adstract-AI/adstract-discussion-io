import type { ChatMessage } from '../types/chat'
import { DISCUSSION_ASSISTANT_SYSTEM_PROMPT } from './prompts/systemPrompt'

const OPENAI_MODEL = 'gpt50-mini'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

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

async function requestJsonObject(apiKey: string, userPrompt: string): Promise<Record<string, unknown>> {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: DISCUSSION_ASSISTANT_SYSTEM_PROMPT,
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

export async function inferQuestionFromResponses(messages: ChatMessage[], apiKey: string): Promise<string> {
  const contextBlock = toContextBlock(messages)
  const json = await requestJsonObject(
    apiKey,
    `TASK: infer_question\n\nContext messages:\n${contextBlock || 'No context messages provided.'}`,
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
): Promise<string> {
  const contextBlock = toContextBlock(contextMessages)
  const json = await requestJsonObject(
    apiKey,
    `TASK: suggest_participation\n\nInferred question:\n${question}\n\nContext messages:\n${contextBlock || 'No context messages provided.'}`,
  )
  const participationText = (json.participationText ?? '').toString().trim()
  if (!participationText) {
    throw new Error('OpenAI did not return participationText.')
  }
  return participationText
}
