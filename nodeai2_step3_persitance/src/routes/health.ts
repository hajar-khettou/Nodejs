import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

export const healthRoute: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/health', {
    schema: {
      response: { 200: Type.Object({ status: Type.String() }) }
    }
  }, async () => ({ status: 'ok' }))
}
