'use strict'

const { teardown, test } = require('tap')
const Fastify = require('fastify')
const proxy = require('../')
const got = require('got')
const { Unauthorized } = require('http-errors')
const Transform = require('node:stream').Transform
const qs = require('fast-querystring')

async function run () {
  const origin = Fastify()
  origin.get('/', async (request, reply) => {
    return 'this is root'
  })

  origin.get('/a', async (request, reply) => {
    return 'this is a'
  })

  origin.get('/redirect', async (request, reply) => {
    return reply.redirect(302, 'https://fastify.dev')
  })

  origin.post('/this-has-data', async (request, reply) => {
    if (request.body.hello === 'world') {
      reply.header('location', '/something')
      return { something: 'posted' }
    }
    throw new Error('kaboom')
  })

  origin.post('/redirect-to-relative-url', async (request, reply) => {
    reply.header('location', '/relative-url')
    return { status: 'ok' }
  })

  origin.get('/api2/a', async (request, reply) => {
    return 'this is /api2/a'
  })

  origin.get('/variable-api/:id/endpoint', async (request, reply) => {
    return `this is "variable-api" endpoint with id ${request.params.id}`
  })

  origin.get('/variable-api/:id/endpoint-with-query', async (request, reply) => {
    return `this is "variable-api" endpoint with id ${request.params.id} and query params ${JSON.stringify(request.query)}`
  })

  origin.get('/timeout', async (request, reply) => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    return 'this is never received'
  })

  await origin.listen({ port: 0 })

  teardown(() => origin.close())

  test('basic proxy', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`
    })

    await server.listen({ port: 0 })
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
      getWebSocketUpstream () {
        t.fail('should never be called')
      },
      replyOptions: {
        getUpstream: function (original, base) {
          return `http://localhost:${origin.server.address().port}`
        }
      }
    })

    await server.listen({ port: 0 })
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

    await server.listen({ port: 0 })
    t.teardown(server.close.bind(server))

    const {
      headers: { location },
      statusCode
    } = await got(
      `http://localhost:${server.server.address().port}/redirect`, {
        followRedirect: false
      }
    )
    t.equal(location, 'https://fastify.dev')
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

    await server.listen({ port: 0 })
    t.teardown(server.close.bind(server))

    const {
      headers: { location },
      statusCode
    } = await got(
      `http://localhost:${server.server.address().port}/redirect`, {
        followRedirect: false
      }
    )
    t.equal(location, 'https://fastify.dev')
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

    await server.listen({ port: 0 })
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

    await server.listen({ port: 0 })
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

    await server.listen({ port: 0 })
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

  test('preValidation post payload contains invalid data', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      preValidation: async (request, reply) => {
        if (request.body.hello !== 'world') {
          reply.code(400).send({ message: 'invalid body.hello value' })
        }
      }
    })

    await server.listen({ port: 0 })
    t.teardown(server.close.bind(server))

    try {
      await got(
      `http://localhost:${server.server.address().port}/this-has-data`,
      {
        method: 'POST',
        json: { hello: 'invalid' },
        responseType: 'json'
      }
      )
    } catch (err) {
      t.equal(err.response.statusCode, 400)
      t.same(err.response.body, { message: 'invalid body.hello value' })
      return
    }
    t.fail()
  })

  test('preValidation post payload contains valid data', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      preValidation: async (request, reply) => {
        if (request.body.hello !== 'world') {
          reply.code(400).send({ message: 'invalid body.hello value' })
        }
      }
    })

    await server.listen({ port: 0 })
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

    await server.listen({ port: 0 })
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

    await server.listen({ port: 0 })
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

    await server.listen({ port: 0 })
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
        t.same(request.routeOptions.config, {
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

    await server.listen({ port: 0 })
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

    await origin2.listen({ port: 0 })

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

    await proxyServer.listen({ port: 0 })

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
        rewriteHeaders: (headers, req) => Object.assign({
          'x-test': 'test',
          'x-req': req.headers['x-req']
        }, headers)
      }
    })

    await proxyServer.listen({ port: 0 })

    t.teardown(() => {
      proxyServer.close()
    })

    const { headers } = await got({
      url: `http://localhost:${proxyServer.server.address().port}/api`,
      headers: {
        'x-req': 'from-header'
      }
    })
    t.match(headers, { 'x-test': 'test', 'x-req': 'from-header' })
  })

  test('rewritePrefix', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api',
      rewritePrefix: '/api2'
    })

    await proxyServer.listen({ port: 0 })

    t.teardown(() => {
      proxyServer.close()
    })

    const firstProxyPrefix = await got(
      `http://localhost:${proxyServer.server.address().port}/api/a`
    )
    t.equal(firstProxyPrefix.body, 'this is /api2/a')
  })

  test('rewritePrefix without prefix', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      rewritePrefix: '/api2'
    })

    await proxyServer.listen({ port: 0 })

    t.teardown(() => {
      proxyServer.close()
    })

    const firstProxyPrefix = await got(
      `http://localhost:${proxyServer.server.address().port}/a`
    )
    t.equal(firstProxyPrefix.body, 'this is /api2/a')
  })

  test('prefix with variables', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api/:id/static',
      rewritePrefix: '/api2'
    })

    await proxyServer.listen({ port: 0 })

    t.teardown(() => {
      proxyServer.close()
    })

    const firstProxyPrefix = await got(
      `http://localhost:${proxyServer.server.address().port}/api/123/static/a`
    )
    t.equal(firstProxyPrefix.body, 'this is /api2/a')
  })

  test('prefix and rewritePrefix with variables', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api/:id',
      rewritePrefix: '/variable-api/:id'
    })

    await proxyServer.listen({ port: 0 })

    t.teardown(() => {
      proxyServer.close()
    })

    const firstProxyPrefix = await got(
      `http://localhost:${proxyServer.server.address().port}/api/123/endpoint`
    )
    t.equal(firstProxyPrefix.body, 'this is "variable-api" endpoint with id 123')
  })

  test('prefix (complete path) and rewritePrefix with variables and similar path', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api/:id/static',
      rewritePrefix: '/variable-api/:id/endpoint'
    })

    await proxyServer.listen({ port: 0 })

    t.teardown(() => {
      proxyServer.close()
    })

    const firstProxyPrefix = await got(
      `http://localhost:${proxyServer.server.address().port}/api/123/static`
    )
    t.equal(firstProxyPrefix.body, 'this is "variable-api" endpoint with id 123')
  })

  test('prefix and rewritePrefix with variables with different paths', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/:id',
      rewritePrefix: '/variable-api/:id/endpoint'
    })

    await proxyServer.listen({ port: 0 })

    t.teardown(() => {
      proxyServer.close()
    })

    const firstProxyPrefix = await got(
      `http://localhost:${proxyServer.server.address().port}/123`
    )
    t.equal(firstProxyPrefix.body, 'this is "variable-api" endpoint with id 123')
  })

  test('rewrite location headers', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api'
    })

    await proxyServer.listen({ port: 0 })

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

  test('location headers is preserved when internalRewriteLocationHeader option is false', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/my-prefix',
      internalRewriteLocationHeader: false
    })

    await proxyServer.listen({ port: 0 })

    t.teardown(() => {
      proxyServer.close()
    })

    const {
      headers: { location }
    } = await got(
      `http://localhost:${proxyServer.server.address().port}/my-prefix/redirect-to-relative-url`,
      {
        method: 'POST'
      }
    )
    t.equal(location, '/relative-url')
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

    await proxyServer.listen({ port: 0 })

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

    await proxyServer.listen({ port: 0 })

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

    await server.listen({ port: 0 })
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

    await server.listen({ port: 0 })
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

    await server.listen({ port: 0 })
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

    await server.listen({ port: 0 })
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
    const address = await appServer.listen({ port: 0 })

    const proxyServer = Fastify()
    proxyServer.register(proxy, {
      upstream: `${address}/second-service`,
      prefix: '/second-service'
    })
    const proxyAddress = await proxyServer.listen({ port: 0 })

    t.teardown(proxyServer.close.bind(proxyServer))
    t.teardown(appServer.close.bind(appServer))

    const resultRoot = await got(
      `${proxyAddress}/second-service?lang=en`
    )
    t.equal(resultRoot.body, 'Hello World - lang = en')

    const resultFooRoute = await got(
      `${proxyAddress}/second-service/foo?lang=en`
    )
    t.equal(resultFooRoute.body, 'Hello World (foo) - lang = en')
  })

  test('keep the query params on proxy', { only: true }, async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api/:id/endpoint',
      rewritePrefix: '/variable-api/:id/endpoint-with-query'
    })

    await proxyServer.listen({ port: 0 })

    t.teardown(() => {
      proxyServer.close()
    })

    const firstProxyPrefix = await got(
      `http://localhost:${proxyServer.server.address().port}/api/123/endpoint?foo=bar&foo=baz&abc=qux`
    )
    const queryParams = JSON.stringify(qs.parse('foo=bar&foo=baz&abc=qux'))
    t.equal(firstProxyPrefix.body, `this is "variable-api" endpoint with id 123 and query params ${queryParams}`)
  })
}

run()
