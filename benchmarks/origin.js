'use strict'

const Fastify = require('fastify')

async function startOrigin () {
  const origin = Fastify({
    http2: !!process.env.HTTP2
  })
  origin.get('/', async () => {
    return 'this is root'
  })

  origin.get('/a', async () => {
    return 'this is a'
  })

  origin.post('/this-has-data', async (request) => {
    if (request.body.hello === 'world') {
      return { something: 'posted' }
    }
    throw new Error('kaboom')
  })

  await origin.listen({ port: 3001 })

  return origin
}

startOrigin()
