'use strict'

const Fastify = require('fastify')
const proxy = require('..')

async function startOrigin () {
  const origin = Fastify()

  origin.get('/', async (request, reply) => {
    return 'this is root'
  })

  origin.get('/redirect', async (request, reply) => {
    return reply.redirect(302, 'https://fastify.dev')
  })

  origin.get('/a', async (request, reply) => {
    return 'this is a'
  })

  origin.post('/this-has-data', async (request, reply) => {
    if (request.body.hello === 'world') {
      return { something: 'posted' }
    }
    throw new Error('kaboom')
  })

  await origin.listen()

  return origin
}

async function startProxy (upstream) {
  const server = Fastify()
  server.register(proxy, {
    upstream,
    prefix: '/upstream' // optional
  })

  await server.listen({ port: 3000 })
  return server
}

async function run () {
  const origin = await startOrigin()
  const upstream = `http://localhost:${origin.server.address().port}`

  console.log('origin started', upstream)

  const proxy = await startProxy(upstream)

  console.log('proxy started', `http://localhost:${proxy.server.address().port}/upstream/`)
}

run()
