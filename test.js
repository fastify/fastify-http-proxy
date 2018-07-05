'use strict'

const { tearDown, test } = require('tap')
const Fastify = require('fastify')
const proxy = require('.')
const got = require('got')
const { Unauthorized } = require('http-errors')

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

  tearDown(origin.close.bind(origin))

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

    const withoutSlash = await got(`http://localhost:${server.server.address().port}/my-prefix`)
    t.equal(withoutSlash.body, 'this is root')

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

  test('beforeHandler', async (t) => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      async beforeHandler (request, reply) {
        throw new Unauthorized()
      }
    })

    await server.listen(0)
    t.tearDown(server.close.bind(server))

    var errored = false
    try {
      await got(`http://localhost:${server.server.address().port}`)
    } catch (err) {
      t.equal(err.statusCode, 401)
      errored = true
    }
    t.ok(errored)

    errored = false
    try {
      await got(`http://localhost:${server.server.address().port}/a`)
    } catch (err) {
      t.equal(err.statusCode, 401)
      errored = true
    }
    t.ok(errored)
  })
}

run()
