'use strict'

const { teardown, test } = require('tap')
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

  origin.get('/redirect', async (request, reply) => {
    return reply.redirect(302, 'https://fastify.io')
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

  teardown(origin.close.bind(origin))

  test('basic proxy', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`
    })

    await server.listen(0)
    t.teardown(server.close.bind(server))

    const resultRoot = await got(
      `http://localhost:${server.server.address().port}`
    )
    t.equal(resultRoot.body, 'this is root')

    const resultA = await got(
      `http://localhost:${server.server.address().port}/a`
    )
    t.equal(resultA.body, 'this is a')
  })

  test('dynamic upstream for basic proxy', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: '',
      replyOptions: {
        getUpstream: function (original, base) {
          return `http://localhost:${origin.server.address().port}`
        }
      }
    })

    await server.listen(0)
    t.teardown(server.close.bind(server))

    const resultRoot = await got(
      `http://localhost:${server.server.address().port}`
    )
    t.equal(resultRoot.body, 'this is root')

    const resultA = await got(
      `http://localhost:${server.server.address().port}/a`
    )
    t.equal(resultA.body, 'this is a')
  })

  test('redirects passthrough', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`
    })

    await server.listen(0)
    t.teardown(server.close.bind(server))

    const {
      headers: { location },
      statusCode
    } = await got(
      `http://localhost:${server.server.address().port}/redirect`, {
        followRedirect: false
      }
    )
    t.equal(location, 'https://fastify.io')
    t.equal(statusCode, 302)
  })

  test('dynamic upstream for redirects passthrough', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: '',
      replyOptions: {
        getUpstream: function (original, base) {
          return `http://localhost:${origin.server.address().port}`
        }
      }
    })

    await server.listen(0)
    t.teardown(server.close.bind(server))

    const {
      headers: { location },
      statusCode
    } = await got(
      `http://localhost:${server.server.address().port}/redirect`, {
        followRedirect: false
      }
    )
    t.equal(location, 'https://fastify.io')
    t.equal(statusCode, 302)
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
    t.teardown(server.close.bind(server))

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

  test('dynamic upstream for prefixed proxy', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: '',
      prefix: '/my-prefix',
      replyOptions: {
        getUpstream: function (original, base) {
          return `http://localhost:${origin.server.address().port}`
        }
      }
    })

    await server.listen(0)
    t.teardown(server.close.bind(server))

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
    t.teardown(server.close.bind(server))

    const resultRoot = await got(
      `http://localhost:${server.server.address().port}/this-has-data`,
      {
        method: 'POST',
        json: { hello: 'world' },
        responseType: 'json'
      }
    )
    t.same(resultRoot.body, { something: 'posted' })
  })

  test('dynamic upstream for posting stuff', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: '',
      replyOptions: {
        getUpstream: function (original, base) {
          return `http://localhost:${origin.server.address().port}`
        }
      }
    })

    await server.listen(0)
    t.teardown(server.close.bind(server))

    const resultRoot = await got(
      `http://localhost:${server.server.address().port}/this-has-data`,
      {
        method: 'POST',
        json: { hello: 'world' },
        responseType: 'json'
      }
    )
    t.same(resultRoot.body, { something: 'posted' })
  })

  test('skip proxying the incoming payload', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      proxyPayloads: false,
      preHandler (request, reply, next) {
        t.same(request.body, { hello: 'world' })
        next()
      }
    })

    await server.listen(0)
    t.teardown(server.close.bind(server))

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
    t.teardown(server.close.bind(server))

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
        t.same(reply.context.config, {
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
    t.teardown(server.close.bind(server))

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

    t.teardown(() => {
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

    t.teardown(() => {
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

    t.teardown(() => {
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

    t.teardown(() => {
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

    t.teardown(() => {
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

    t.teardown(() => {
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
    t.teardown(server.close.bind(server))

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

  test('settings of method types', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      httpMethods: ['POST']
    })

    await server.listen(0)
    t.teardown(server.close.bind(server))

    const resultRoot = await got(
      `http://localhost:${server.server.address().port}/this-has-data`,
      {
        method: 'POST',
        json: { hello: 'world' },
        responseType: 'json'
      }
    )
    t.same(resultRoot.body, { something: 'posted' })

    let errored = false
    try {
      await await got(`http://localhost:${server.server.address().port}/a`)
    } catch (err) {
      t.equal(err.response.statusCode, 404)
      errored = true
    }
    t.ok(errored)
  })

  const getTestConstraint = () => ({
    name: 'testConstraint',
    storage: () => {
      let headerValues = {}
      return {
        get: (value) => { return headerValues[value] || null },
        set: (value, store) => { headerValues[value] = store },
        del: (value) => { delete headerValues[value] },
        empty: () => { headerValues = {} }
      }
    },
    validate (value) { return true },
    deriveConstraint: (req, ctx) => {
      return req.headers['test-header']
    }
  })

  test('constraints', async t => {
    const server = Fastify({
      constraints: {
        testConstraint: getTestConstraint()
      }
    })
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      constraints: { testConstraint: 'valid-value' }
    })

    await server.listen(0)
    t.teardown(server.close.bind(server))
    await got(`http://localhost:${server.server.address().port}/a`, {
      headers: {
        'test-header': 'valid-value'
      }
    })

    try {
      await got(`http://localhost:${server.server.address().port}/a`, {
        headers: {
          'test-header': 'invalid-value'
        }
      })
      t.fail()
    } catch (err) {
      t.equal(err.response.statusCode, 404)
    }

    try {
      await got(`http://localhost:${server.server.address().port}/a`)
      t.fail()
    } catch (err) {
      t.equal(err.response.statusCode, 404)
    }
  })

  test('constraints with unconstrained routes', async t => {
    const server = Fastify({
      constraints: {
        testConstraint: getTestConstraint()
      }
    })
    server.get('/a', {
      constraints: { testConstraint: 'without-proxy' }
    }, async () => 'this is unproxied a')
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      constraints: { testConstraint: 'with-proxy' }
    })

    await server.listen(0)
    t.teardown(server.close.bind(server))

    const resultProxied = await got(`http://localhost:${server.server.address().port}/a`, {
      headers: {
        'test-header': 'with-proxy'
      }
    })
    t.equal(resultProxied.body, 'this is a')

    const resultUnproxied = await got(`http://localhost:${server.server.address().port}/a`, {
      headers: {
        'test-header': 'without-proxy'
      }
    })
    t.equal(resultUnproxied.body, 'this is unproxied a')
  })

  test('prefixed proxy with query search', async t => {
    const appServer = Fastify()

    appServer.get('/second-service', async (request, reply) => {
      return `Hello World - lang = ${request.query.lang}`
    })
    appServer.get('/second-service/foo', async (request, reply) => {
      return `Hello World (foo) - lang = ${request.query.lang}`
    })
    const address = await appServer.listen(0)

    const proxyServer = Fastify()
    proxyServer.register(proxy, {
      upstream: `${address}/second-service`,
      prefix: '/second-service'
    })
    const proxyAddress = await proxyServer.listen(0)

    t.teardown(appServer.close.bind(appServer))
    t.teardown(proxyServer.close.bind(proxyServer))

    const resultRoot = await got(
      `${proxyAddress}/second-service?lang=en`
    )
    t.equal(resultRoot.body, 'Hello World - lang = en')

    const resultFooRoute = await got(
      `${proxyAddress}/second-service/foo?lang=en`
    )
    t.equal(resultFooRoute.body, 'Hello World (foo) - lang = en')
  })
}

run()
