'use strict'

const Fastify = require('fastify')
const proxyCreator = require('fast-proxy')

async function startProxy (base) {
  const server = Fastify()
  let undici = false

  if (process.env.UNDICI) {
    undici = {
      connections: 100,
      pipelining: 10
    }
  }

  const { proxy } = proxyCreator({ base, undici, http2: !!process.env.HTTP2 })
  server.get('/', (request, reply) => {
    proxy(request.raw, reply.raw, request.url, {})
  })

  await server.listen(3000)
  return server
}

startProxy('http://localhost:3001')
