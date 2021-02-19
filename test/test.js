'use strict'

const { tearDown, test } = require('tap')
const Fastify = require('fastify')
const proxy = require('../')
const got = require('got')
const { Unauthorized } = require('http-errors')
const Transform = require('stream').Transform

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
      reply.header('location', '/something')
      return { something: 'posted' }
    }
    throw new Error('kaboom')
  })

  origin.get('/api2/a', async (request, reply) => {
    return 'this is /api2/a'
  })

  origin.get('/timeout', async (request, reply) => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    return 'this is never received'
  })

  await origin.listen(0)

  tearDown(origin.close.bind(origin))

  test('basic proxy', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`
    })

    await server.listen(0)
    t.tearDown(server.close.bind(server))

    const resultRoot = await got(
      `http://localhost:${server.server.address().port}`
    )
    t.equal(resultRoot.body, 'this is root')

    const resultA = await got(
      `http://localhost:${server.server.address().port}/a`
    )
    t.equal(resultA.body, 'this is a')
  })

  test('no upstream will throw', async t => {
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

  test('prefixed proxy', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/my-prefix'
    })

    await server.listen(0)
    t.tearDown(server.close.bind(server))

    const resultRoot = await got(
      `http://localhost:${server.server.address().port}/my-prefix/`
    )
    t.equal(resultRoot.body, 'this is root')

    const withoutSlash = await got(
      `http://localhost:${server.server.address().port}/my-prefix`
    )
    t.equal(withoutSlash.body, 'this is root')

    const resultA = await got(
      `http://localhost:${server.server.address().port}/my-prefix/a`
    )
    t.equal(resultA.body, 'this is a')
  })

  test('posting stuff', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`
    })

    await server.listen(0)
    t.tearDown(server.close.bind(server))

    const resultRoot = await got(
      `http://localhost:${server.server.address().port}/this-has-data`,
      {
        method: 'POST',
        json: { hello: 'world' },
        responseType: 'json'
      }
    )
    t.deepEqual(resultRoot.body, { something: 'posted' })
  })

  test('skip proxying the incoming payload', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      proxyPayloads: false,
      preHandler (request, reply, next) {
        t.deepEqual(request.body, { hello: 'world' })
        next()
      }
    })

    await server.listen(0)
    t.tearDown(server.close.bind(server))

    await got(
      `http://localhost:${server.server.address().port}/this-has-data`,
      {
        method: 'POST',
        json: { hello: 'world' },
        responseType: 'json'
      }
    )
  })

  test('preHandler', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      async preHandler (request, reply) {
        throw new Unauthorized()
      }
    })

    await server.listen(0)
    t.tearDown(server.close.bind(server))

    let errored = false
    try {
      await got(`http://localhost:${server.server.address().port}`)
    } catch (err) {
      t.equal(err.response.statusCode, 401)
      errored = true
    }
    t.ok(errored)

    errored = false
    try {
      await got(`http://localhost:${server.server.address().port}/a`)
    } catch (err) {
      t.equal(err.response.statusCode, 401)
      errored = true
    }
    t.ok(errored)
  })

  test('preHandler gets config', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      config: { foo: 'bar' },
      async preHandler (request, reply) {
        t.deepEqual(reply.context.config, {
          foo: 'bar',
          url: '/',
          method: [
            'DELETE',
            'GET',
            'HEAD',
            'PATCH',
            'POST',
            'PUT',
            'OPTIONS'
          ]
        })
        throw new Unauthorized()
      }
    })

    await server.listen(0)
    t.tearDown(server.close.bind(server))

    let errored = false
    try {
      await got(`http://localhost:${server.server.address().port}`)
    } catch (err) {
      t.equal(err.response.statusCode, 401)
      errored = true
    }
    t.ok(errored)
  })

  test('multiple prefixes with multiple plugins', async t => {
    const origin2 = Fastify()

    origin2.get('/', async (request, reply) => {
      return 'this is root for origin2'
    })

    await origin2.listen(0)

    const proxyServer = Fastify()

    // register first proxy on /api
    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api'
    })

    // register second proxy on /api2
    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin2.server.address().port}`,
      prefix: '/api2'
    })

    await proxyServer.listen(0)

    t.tearDown(() => {
      origin2.close()
      proxyServer.close()
    })

    const firstProxyPrefix = await got(
      `http://localhost:${proxyServer.server.address().port}/api`
    )
    t.equal(firstProxyPrefix.body, 'this is root')

    const secondProxyPrefix = await got(
      `http://localhost:${proxyServer.server.address().port}/api2`
    )
    t.equal(secondProxyPrefix.body, 'this is root for origin2')
  })

  test('passes replyOptions object to reply.from() calls', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api',
      replyOptions: {
        rewriteHeaders: headers => Object.assign({ 'x-test': 'test' }, headers)
      }
    })

    await proxyServer.listen(0)

    t.tearDown(() => {
      proxyServer.close()
    })

    const { headers } = await got(
      `http://localhost:${proxyServer.server.address().port}/api`
    )
    t.match(headers, { 'x-test': 'test' })
  })

  test('rewritePrefix', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api',
      rewritePrefix: '/api2'
    })

    await proxyServer.listen(0)

    t.tearDown(() => {
      proxyServer.close()
    })

    const firstProxyPrefix = await got(
      `http://localhost:${proxyServer.server.address().port}/api/a`
    )
    t.equal(firstProxyPrefix.body, 'this is /api2/a')
  })

  test('rewrite location headers', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api'
    })

    await proxyServer.listen(0)

    t.tearDown(() => {
      proxyServer.close()
    })

    const {
      headers: { location }
    } = await got(
      `http://localhost:${proxyServer.server.address().port}/api/this-has-data`,
      {
        method: 'POST',
        json: { hello: 'world' }
      }
    )
    t.equal(location, '/api/something')
  })

  test('passes onResponse option to reply.from() calls', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api',
      replyOptions: {
        onResponse (request, reply, stream) {
          return reply.send(
            stream.pipe(
              new Transform({
                transform: function (chunk, enc, cb) {
                  this.push(chunk.toString().toUpperCase())
                  cb()
                }
              })
            )
          )
        }
      }
    })

    await proxyServer.listen(0)

    t.tearDown(() => {
      proxyServer.close()
    })

    const { body } = await got(
      `http://localhost:${proxyServer.server.address().port}/api`
    )

    t.match(body, 'THIS IS ROOT')
  })

  test('undici POST', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      undici: true
    })

    await proxyServer.listen(0)

    t.tearDown(() => {
      proxyServer.close()
    })

    const {
      headers: { location }
    } = await got(
      `http://localhost:${proxyServer.server.address().port}/this-has-data`,
      {
        method: 'POST',
        json: { hello: 'world' }
      }
    )
    t.equal(location, '/something')
  })

  test('proxy request timeout', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      http: {
        requestOptions: {
          timeout: 300
        }
      }
    })

    await server.listen(0)
    t.tearDown(server.close.bind(server))

    try {
      await got(
        `http://localhost:${server.server.address().port}/timeout`,
        { retry: 0 }
      )
    } catch (err) {
      t.equal(err.response.statusCode, 504)
      t.equal(err.response.statusMessage, 'Gateway Timeout')
      return
    }
    t.fail()
  })
}

run()
