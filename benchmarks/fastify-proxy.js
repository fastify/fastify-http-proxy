'use strict'

const Fastify = require('fastify')
const proxy = require('..')

async function startProxy (upstream) {
  const server = Fastify()
  server.register(proxy, {
    upstream,
    http2: !!process.env.HTTP2
  })

  await server.listen(3000)
  return server
}

startProxy('http://localhost:3001')
