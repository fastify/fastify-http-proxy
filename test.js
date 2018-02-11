'use strict'

const t = require('tap')
const test = t.test
const Fastify = require('fastify')
const proxy = require('.')
const got = require('got')

async function run () {
  const origin = Fastify()
  origin.get('/', async (request, reply) => {
    return 'this is root'
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

  await origin.listen(0)

  t.tearDown(origin.close.bind(origin))

  test('basic proxy', async (t) => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`
    })

    await server.listen(0)
    t.tearDown(server.close.bind(server))

    const resultRoot = await got(`http://localhost:${server.server.address().port}`)
    t.equal(resultRoot.body, 'this is root')

    const resultA = await got(`http://localhost:${server.server.address().port}/a`)
    t.equal(resultA.body, 'this is a')
  })

  test('no upstream will throw', async (t) => {
    const server = Fastify()
    server.register(proxy)
    try {
      await server.ready()
    } catch (err) {
      t.equal(err.message, 'upstream must be specified')
      return
    }
    t.fail()
  })

  test('prefixed proxy', async (t) => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/my-prefix'
    })

    await server.listen(0)
    t.tearDown(server.close.bind(server))

    const resultRoot = await got(`http://localhost:${server.server.address().port}/my-prefix/`)
    t.equal(resultRoot.body, 'this is root')

    const resultA = await got(`http://localhost:${server.server.address().port}/my-prefix/a`)
    t.equal(resultA.body, 'this is a')
  })

  test('posting stuff', async (t) => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`
    })

    await server.listen(0)
    t.tearDown(server.close.bind(server))

    const resultRoot = await got(`http://localhost:${server.server.address().port}/this-has-data`, {
      body: { hello: 'world' },
      json: true
    })
    t.deepEqual(resultRoot.body, { something: 'posted' })
  })
}

run()
