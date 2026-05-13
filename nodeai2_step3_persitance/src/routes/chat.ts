import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

const OLLAMA_URL = process.env.OLLAMA_URL  ?? 'http://localhost:11434'
const MODEL      = process.env.OLLAMA_MODEL ?? 'llama3.2'

const ChatBody = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 4096 })
}, { additionalProperties: false })

type OllamaChunk = { message?: { content: string }; done?: boolean }

export const chatRoute: FastifyPluginAsyncTypebox = async (app) => {
  app.post('/chat', {
    schema: {
      body: ChatBody,
      response: {
        200: Type.Object({ response: Type.String() }),
        502: Type.Object({ error: Type.String() })
      }
    }
  }, async (request, reply) => {
    const { message } = request.body

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: message }],
        stream: false
      })
    })

    if (!res.ok) {
      const text = await res.text()
      request.log.error({ status: res.status, body: text }, 'Ollama error')
      return reply.status(502).send({ error: 'Ollama request failed' })
    }

    const data = await res.json() as OllamaChunk
    return { response: data.message!.content }
  })

  app.post('/chat/stream', {
    schema: { body: ChatBody }
  }, async (request, reply) => {
    const { message } = request.body
    const controller = new AbortController()

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: message }],
        stream: true
      })
    })

    if (!res.ok) {
      const text = await res.text()
      request.log.error({ status: res.status, body: text }, 'Ollama error')
      return reply.status(502).send({ error: 'Ollama request failed' })
    }

    request.raw.once('close', () => {
      request.log.info('Client disconnected — aborting Ollama stream')
      controller.abort()
    })

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

    const sendEvent = (payload: unknown) =>
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)

    try {
      for await (const chunk of res.body!) {
        const lines = Buffer.from(chunk as Uint8Array).toString('utf8').split('\n').filter(Boolean)
        for (const line of lines) {
          const parsed = JSON.parse(line) as OllamaChunk
          if (parsed.message?.content) sendEvent({ type: 'token', value: parsed.message.content })
          if (parsed.done)             sendEvent({ type: 'done' })
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        request.log.error(err, 'Streaming error')
        sendEvent({ type: 'error', message: (err as Error).message })
      }
    } finally {
      reply.raw.end()
    }
  })
}
