import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

const OLLAMA_URL = process.env.OLLAMA_URL  ?? 'http://localhost:11434'
const MODEL      = process.env.OLLAMA_MODEL ?? 'llama3.2'

interface ConvRow          { id: number; title: string; createdAt: string }
interface ConvWithCount extends ConvRow { messageCount: number }
interface MessageRow       { id: number; conversationId: number; role: string; content: string; createdAt: string }
type OllamaChunk = { message?: { content: string }; done?: boolean }

const MessageSchema = Type.Object({
  id:             Type.Integer(),
  conversationId: Type.Integer(),
  role:           Type.String(),
  content:        Type.String(),
  createdAt:      Type.String()
})

const ConversationSchema = Type.Object({
  id:           Type.Integer(),
  title:        Type.String(),
  createdAt:    Type.String(),
  messageCount: Type.Optional(Type.Integer())
})

const IdParams = Type.Object({ id: Type.Integer() })
const MsgBody  = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 4096 })
}, { additionalProperties: false })

export const conversationsRoute: FastifyPluginAsyncTypebox = async (app) => {

  app.post('/conversations', {
    schema: { response: { 201: ConversationSchema } }
  }, async (_request, reply) => {
    const conv = app.stmts.createConv.get('Nouvelle conversation') as ConvRow
    return reply.status(201).send(conv)
  })

  app.get('/conversations', {
    schema: { response: { 200: Type.Array(ConversationSchema) } }
  }, async () => app.stmts.listConvs.all() as ConvWithCount[])

  app.get('/conversations/:id', {
    schema: {
      params: IdParams,
      response: {
        200: Type.Object({
          id:        Type.Integer(),
          title:     Type.String(),
          createdAt: Type.String(),
          messages:  Type.Array(MessageSchema)
        })
      }
    }
  }, async (request, reply) => {
    const conv = app.stmts.getConv.get(request.params.id) as ConvRow | undefined
    if (!conv) return reply.notFound(`Conversation ${request.params.id} introuvable`)
    const messages = app.stmts.getMessages.all(conv.id) as MessageRow[]
    return { ...conv, messages }
  })

  app.delete('/conversations/:id', {
    schema: { params: IdParams }
  }, async (request, reply) => {
    const result = app.stmts.deleteConv.run(request.params.id)
    if (result.changes === 0) return reply.notFound(`Conversation ${request.params.id} introuvable`)
    return reply.status(204).send()
  })

  app.post('/conversations/:id/messages', {
    schema: { params: IdParams, body: MsgBody }
  }, async (request, reply) => {
    const convId = request.params.id
    const conv   = app.stmts.getConv.get(convId) as ConvRow | undefined
    if (!conv) return reply.notFound(`Conversation ${convId} introuvable`)

    const { message } = request.body

    const history = app.stmts.getMessages.all(convId) as MessageRow[]
    if (history.length === 0) {
      app.db.prepare('UPDATE conversations SET title = ? WHERE id = ?')
        .run(message.slice(0, 60), convId)
    }

    app.stmts.addMessage.get(convId, 'user', message)

    const updatedHistory = app.stmts.getMessages.all(convId) as MessageRow[]
    const ollamaMessages = updatedHistory.map(m => ({ role: m.role, content: m.content }))

    const controller = new AbortController()
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model: MODEL, messages: ollamaMessages, stream: true })
    })

    if (!res.ok) {
      const text = await res.text()
      request.log.error({ status: res.status, body: text }, 'Ollama error')
      return reply.status(502).send({ error: 'Ollama request failed' })
    }

    request.raw.once('close', () => controller.abort())

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

    const sendEvent = (payload: unknown) =>
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)

    let fullResponse = ''
    try {
      for await (const chunk of res.body!) {
        const lines = Buffer.from(chunk as Uint8Array).toString('utf8').split('\n').filter(Boolean)
        for (const line of lines) {
          const parsed = JSON.parse(line) as OllamaChunk
          if (parsed.message?.content) {
            fullResponse += parsed.message.content
            sendEvent({ type: 'token', value: parsed.message.content })
          }
          if (parsed.done) {
            app.stmts.addMessage.get(convId, 'assistant', fullResponse)
            sendEvent({ type: 'done' })
          }
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
