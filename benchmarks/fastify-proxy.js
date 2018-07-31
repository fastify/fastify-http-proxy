'use strict'

const Fastify = require('fastify')
const proxy = require('..')

async function startProxy (upstream) {
  const server = Fastify()
  let undici = false

  if (process.env.UNDICI) {
    undici = {
      connections: 100,
      pipelining: 10
    }
  }

  server.register(proxy, {
    upstream,
    http2: !!process.env.HTTP2,
    undici
  })

  await server.listen(3000)
  return server
}

startProxy('http://localhost:3001')
