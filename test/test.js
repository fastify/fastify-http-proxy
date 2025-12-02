'use strict'

const { after, test } = require('node:test')
const Fastify = require('fastify')
const proxy = require('../')
const { Unauthorized } = require('http-errors')
const Transform = require('node:stream').Transform
const qs = require('fast-querystring')

async function run () {
  const origin = Fastify()
  origin.get('/', async () => {
    return 'this is root'
  })

  origin.get('/a', async () => {
    return 'this is a'
  })

  origin.get('/redirect', async (_request, reply) => {
    return reply.redirect('https://fastify.dev', 302)
  })

  origin.post('/this-has-data', async (request, reply) => {
    if (request.body.hello === 'world') {
      reply.header('location', '/something')
      return { something: 'posted' }
    }
    throw new Error('kaboom')
  })

  origin.post('/redirect-to-relative-url', async (_request, reply) => {
    reply.header('location', '/relative-url')
    return { status: 'ok' }
  })

  origin.get('/api2/a', async () => {
    return 'this is /api2/a'
  })

  origin.get('/variable-api/:id/endpoint', async (request) => {
    return `this is "variable-api" endpoint with id ${request.params.id}`
  })

  origin.get('/variable-api/:id/endpoint-with-query', async (request) => {
    return `this is "variable-api" endpoint with id ${request.params.id} and query params ${JSON.stringify(request.query)}`
  })

  origin.get('/timeout', async () => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    return 'this is never received'
  })

  await origin.listen({ port: 0 })

  after(() => origin.close())

  test('basic proxy', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`
    })

    await server.listen({ port: 0 })
    t.after(() => server.close())

    const responseRoot = await fetch(`http://localhost:${server.server.address().port}`)
    const bodyRoot = await responseRoot.text()
    t.assert.strictEqual(bodyRoot, 'this is root')

    const responseA = await fetch(`http://localhost:${server.server.address().port}/a`)
    const bodyA = await responseA.text()
    t.assert.strictEqual(bodyA, 'this is a')
  })

  test('dynamic upstream for basic proxy', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: '',
      getWebSocketUpstream () {
        t.fail('should never be called')
      },
      replyOptions: {
        getUpstream: function () {
          return `http://localhost:${origin.server.address().port}`
        }
      }
    })

    await server.listen({ port: 0 })
    t.after(() => server.close())

    const responseRoot = await fetch(`http://localhost:${server.server.address().port}`)
    const bodyRoot = await responseRoot.text()
    t.assert.strictEqual(bodyRoot, 'this is root')

    const responseA = await fetch(`http://localhost:${server.server.address().port}/a`)
    const bodyA = await responseA.text()
    t.assert.strictEqual(bodyA, 'this is a')
  })

  test('redirects passthrough', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`
    })

    await server.listen({ port: 0 })
    t.after(() => server.close())

    const response = await fetch(`http://localhost:${server.server.address().port}/redirect`, {
      redirect: 'manual'
    })
    const location = response.headers.get('location')
    const statusCode = response.status
    t.assert.strictEqual(location, 'https://fastify.dev')
    t.assert.strictEqual(statusCode, 302)
  })

  test('dynamic upstream for redirects passthrough', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: '',
      replyOptions: {
        getUpstream: function () {
          return `http://localhost:${origin.server.address().port}`
        }
      }
    })

    await server.listen({ port: 0 })
    t.after(() => server.close())

    const response = await fetch(`http://localhost:${server.server.address().port}/redirect`, {
      redirect: 'manual'
    })
    const location = response.headers.get('location')
    const statusCode = response.status
    t.assert.strictEqual(location, 'https://fastify.dev')
    t.assert.strictEqual(statusCode, 302)
  })

  test('no upstream will throw', async t => {
    const server = Fastify()
    server.register(proxy)
    try {
      await server.ready()
    } catch (err) {
      t.assert.strictEqual(err.message, 'upstream must be specified')
      return
    }
    t.assert.fail()
  })

  test('prefixed proxy', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/my-prefix'
    })

    await server.listen({ port: 0 })
    t.after(() => server.close())

    const responseRoot = await fetch(`http://localhost:${server.server.address().port}/my-prefix/`)
    const bodyRoot = await responseRoot.text()
    t.assert.strictEqual(bodyRoot, 'this is root')

    const responseWithoutSlash = await fetch(`http://localhost:${server.server.address().port}/my-prefix`)
    const bodyWithoutSlash = await responseWithoutSlash.text()
    t.assert.strictEqual(bodyWithoutSlash, 'this is root')

    const responseA = await fetch(`http://localhost:${server.server.address().port}/my-prefix/a`)
    const bodyA = await responseA.text()
    t.assert.strictEqual(bodyA, 'this is a')
  })

  test('dynamic upstream for prefixed proxy', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: '',
      prefix: '/my-prefix',
      replyOptions: {
        getUpstream: function () {
          return `http://localhost:${origin.server.address().port}`
        }
      }
    })

    await server.listen({ port: 0 })
    t.after(() => server.close())

    const responseRoot = await fetch(`http://localhost:${server.server.address().port}/my-prefix/`)
    const bodyRoot = await responseRoot.text()
    t.assert.strictEqual(bodyRoot, 'this is root')

    const responseWithoutSlash = await fetch(`http://localhost:${server.server.address().port}/my-prefix`)
    const bodyWithoutSlash = await responseWithoutSlash.text()
    t.assert.strictEqual(bodyWithoutSlash, 'this is root')

    const responseA = await fetch(`http://localhost:${server.server.address().port}/my-prefix/a`)
    const bodyA = await responseA.text()
    t.assert.strictEqual(bodyA, 'this is a')
  })

  test('posting stuff', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`
    })

    await server.listen({ port: 0 })
    t.after(() => server.close())

    const response = await fetch(`http://localhost:${server.server.address().port}/this-has-data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    })
    const body = await response.json()
    t.assert.deepStrictEqual(body, { something: 'posted' })
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
    t.after(() => server.close())

    const response = await fetch(`http://localhost:${server.server.address().port}/this-has-data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'invalid' })
    })
    t.assert.strictEqual(response.status, 400)
    const body = await response.json()
    t.assert.deepStrictEqual(body, { message: 'invalid body.hello value' })
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
    t.after(() => server.close())

    const response = await fetch(`http://localhost:${server.server.address().port}/this-has-data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    })
    const body = await response.json()
    t.assert.deepStrictEqual(body, { something: 'posted' })
  })

  test('dynamic upstream for posting stuff', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: '',
      replyOptions: {
        getUpstream: function () {
          return `http://localhost:${origin.server.address().port}`
        }
      }
    })

    await server.listen({ port: 0 })
    t.after(() => server.close())

    const response = await fetch(`http://localhost:${server.server.address().port}/this-has-data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    })
    const body = await response.json()
    t.assert.deepStrictEqual(body, { something: 'posted' })
  })

  test('skip proxying the incoming payload', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      proxyPayloads: false,
      preHandler (request, _reply, next) {
        t.assert.deepStrictEqual(request.body, { hello: 'world' })
        next()
      }
    })

    await server.listen({ port: 0 })
    t.after(() => server.close())

    await fetch(`http://localhost:${server.server.address().port}/this-has-data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    })
  })

  test('preHandler', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      async preHandler () {
        throw new Unauthorized()
      }
    })

    await server.listen({ port: 0 })
    t.after(() => server.close())

    const response1 = await fetch(`http://localhost:${server.server.address().port}`)
    t.assert.strictEqual(response1.status, 401)

    const response2 = await fetch(`http://localhost:${server.server.address().port}/a`)
    t.assert.strictEqual(response2.status, 401)
  })

  test('preHandler gets config', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      config: { foo: 'bar' },
      async preHandler (request) {
        t.assert.deepStrictEqual(request.routeOptions.config, {
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
    t.after(() => server.close())

    const response = await fetch(`http://localhost:${server.server.address().port}`)
    t.assert.strictEqual(response.status, 401)
  })

  test('multiple prefixes with multiple plugins', async t => {
    const origin2 = Fastify()

    origin2.get('/', async () => {
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

    t.after(() => {
      origin2.close()
      proxyServer.close()
    })

    const response1 = await fetch(`http://localhost:${proxyServer.server.address().port}/api`)
    const body1 = await response1.text()
    t.assert.strictEqual(body1, 'this is root')

    const response2 = await fetch(`http://localhost:${proxyServer.server.address().port}/api2`)
    const body2 = await response2.text()
    t.assert.strictEqual(body2, 'this is root for origin2')
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

    t.after(() => {
      proxyServer.close()
    })

    const response = await fetch(`http://localhost:${proxyServer.server.address().port}/api`, {
      headers: {
        'x-req': 'from-header'
      }
    })
    const headers = response.headers
    const expected = { 'x-test': 'test', 'x-req': 'from-header' }

    for (const [key, value] of Object.entries(expected)) {
      t.assert.strictEqual(headers.get(key), value, `Header ${key} does not match`)
    }
  })

  test('rewritePrefix', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api',
      rewritePrefix: '/api2'
    })

    await proxyServer.listen({ port: 0 })

    t.after(() => {
      proxyServer.close()
    })

    const response = await fetch(`http://localhost:${proxyServer.server.address().port}/api/a`)
    const body = await response.text()
    t.assert.strictEqual(body, 'this is /api2/a')
  })

  test('rewritePrefix without prefix', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      rewritePrefix: '/api2'
    })

    await proxyServer.listen({ port: 0 })

    t.after(() => {
      proxyServer.close()
    })

    const response = await fetch(`http://localhost:${proxyServer.server.address().port}/a`)
    const body = await response.text()
    t.assert.strictEqual(body, 'this is /api2/a')
  })

  test('prefix with variables', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api/:id/static',
      rewritePrefix: '/api2'
    })

    await proxyServer.listen({ port: 0 })

    t.after(() => {
      proxyServer.close()
    })

    const response = await fetch(`http://localhost:${proxyServer.server.address().port}/api/123/static/a`)
    const body = await response.text()
    t.assert.strictEqual(body, 'this is /api2/a')
  })

  test('prefix and rewritePrefix with variables', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api/:id',
      rewritePrefix: '/variable-api/:id'
    })

    await proxyServer.listen({ port: 0 })

    t.after(() => {
      proxyServer.close()
    })

    const response = await fetch(`http://localhost:${proxyServer.server.address().port}/api/123/endpoint`)
    const body = await response.text()
    t.assert.strictEqual(body, 'this is "variable-api" endpoint with id 123')
  })

  test('prefix (complete path) and rewritePrefix with variables and similar path', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api/:id/static',
      rewritePrefix: '/variable-api/:id/endpoint'
    })

    await proxyServer.listen({ port: 0 })

    t.after(() => {
      proxyServer.close()
    })

    const response = await fetch(`http://localhost:${proxyServer.server.address().port}/api/123/static`)
    const body = await response.text()
    t.assert.strictEqual(body, 'this is "variable-api" endpoint with id 123')
  })

  test('prefix and rewritePrefix with variables with different paths', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/:id',
      rewritePrefix: '/variable-api/:id/endpoint'
    })

    await proxyServer.listen({ port: 0 })

    t.after(() => {
      proxyServer.close()
    })

    const response = await fetch(`http://localhost:${proxyServer.server.address().port}/123`)
    const body = await response.text()
    t.assert.strictEqual(body, 'this is "variable-api" endpoint with id 123')
  })

  test('rewrite location headers', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api'
    })

    await proxyServer.listen({ port: 0 })

    t.after(() => {
      proxyServer.close()
    })

    const response = await fetch(`http://localhost:${proxyServer.server.address().port}/api/this-has-data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    })
    const location = response.headers.get('location')
    t.assert.strictEqual(location, '/api/something')
  })

  test('location headers is preserved when internalRewriteLocationHeader option is false', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/my-prefix',
      internalRewriteLocationHeader: false
    })

    await proxyServer.listen({ port: 0 })

    t.after(() => {
      proxyServer.close()
    })

    const response = await fetch(`http://localhost:${proxyServer.server.address().port}/my-prefix/redirect-to-relative-url`, {
      method: 'POST'
    })
    const location = response.headers.get('location')
    t.assert.strictEqual(location, '/relative-url')
  })

  test('passes onResponse option to reply.from() calls', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api',
      replyOptions: {
        onResponse (_request, reply, { stream }) {
          return reply.send(
            stream.pipe(
              new Transform({
                transform: function (chunk, _enc, cb) {
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

    t.after(() => {
      proxyServer.close()
    })

    const response = await fetch(`http://localhost:${proxyServer.server.address().port}/api`)
    const body = await response.text()

    t.assert.match(body, /THIS IS ROOT/)
  })

  test('undici POST', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      undici: true
    })

    await proxyServer.listen({ port: 0 })

    t.after(() => {
      proxyServer.close()
    })

    const response = await fetch(`http://localhost:${proxyServer.server.address().port}/this-has-data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    })
    const location = response.headers.get('location')
    t.assert.strictEqual(location, '/something')
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
    t.after(() => server.close())

    const response = await fetch(`http://localhost:${server.server.address().port}/timeout`)
    t.assert.strictEqual(response.status, 504)
    t.assert.strictEqual(response.statusText, 'Gateway Timeout')
  })

  test('settings of routes', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      routes: ['/a']
    })

    await server.listen({ port: 0 })
    t.after(() => server.close())

    const response = await fetch(`http://localhost:${server.server.address().port}/a`)
    t.assert.deepStrictEqual(response.status, 200)

    const response2 = await fetch(`http://localhost:${server.server.address().port}/api2/a`)
    t.assert.strictEqual(response2.status, 404)
  })

  test('settings of method types', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      httpMethods: ['POST']
    })

    await server.listen({ port: 0 })
    t.after(() => server.close())

    const response = await fetch(`http://localhost:${server.server.address().port}/this-has-data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    })
    const body = await response.json()
    t.assert.deepStrictEqual(body, { something: 'posted' })

    const response2 = await fetch(`http://localhost:${server.server.address().port}/a`)
    t.assert.strictEqual(response2.status, 404)
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
    validate () { return true },
    deriveConstraint: (req) => {
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
    t.after(() => server.close())

    const response1 = await fetch(`http://localhost:${server.server.address().port}/a`, {
      headers: {
        'test-header': 'valid-value'
      }
    })
    t.assert.strictEqual(response1.status, 200)

    const response2 = await fetch(`http://localhost:${server.server.address().port}/a`, {
      headers: {
        'test-header': 'invalid-value'
      }
    })
    t.assert.strictEqual(response2.status, 404)

    const response3 = await fetch(`http://localhost:${server.server.address().port}/a`)
    t.assert.strictEqual(response3.status, 404)
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
    t.after(() => server.close())

    const responseProxied = await fetch(`http://localhost:${server.server.address().port}/a`, {
      headers: {
        'test-header': 'with-proxy'
      }
    })
    const bodyProxied = await responseProxied.text()
    t.assert.strictEqual(bodyProxied, 'this is a')

    const responseUnproxied = await fetch(`http://localhost:${server.server.address().port}/a`, {
      headers: {
        'test-header': 'without-proxy'
      }
    })
    const bodyUnproxied = await responseUnproxied.text()
    t.assert.strictEqual(bodyUnproxied, 'this is unproxied a')
  })

  test('prefixed proxy with query search', async t => {
    const appServer = Fastify()

    appServer.get('/second-service', async (request) => {
      return `Hello World - lang = ${request.query.lang}`
    })
    appServer.get('/second-service/foo', async (request) => {
      return `Hello World (foo) - lang = ${request.query.lang}`
    })
    const address = await appServer.listen({ port: 0 })

    const proxyServer = Fastify()
    proxyServer.register(proxy, {
      upstream: `${address}/second-service`,
      prefix: '/second-service'
    })
    const proxyAddress = await proxyServer.listen({ port: 0 })

    t.after(() => { proxyServer.close() })
    t.after(() => { appServer.close() })

    const responseRoot = await fetch(`${proxyAddress}/second-service?lang=en`)
    const bodyRoot = await responseRoot.text()
    t.assert.strictEqual(bodyRoot, 'Hello World - lang = en')

    const responseFoo = await fetch(`${proxyAddress}/second-service/foo?lang=en`)
    const bodyFoo = await responseFoo.text()
    t.assert.strictEqual(bodyFoo, 'Hello World (foo) - lang = en')
  })

  test('keep the query params on proxy', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api/:id/endpoint',
      rewritePrefix: '/variable-api/:id/endpoint-with-query'
    })

    await proxyServer.listen({ port: 0 })

    t.after(() => {
      proxyServer.close()
    })

    const response = await fetch(`http://localhost:${proxyServer.server.address().port}/api/123/endpoint?foo=bar&foo=baz&abc=qux`)
    const body = await response.text()
    const queryParams = JSON.stringify(qs.parse('foo=bar&foo=baz&abc=qux'))
    t.assert.strictEqual(body, `this is "variable-api" endpoint with id 123 and query params ${queryParams}`)
  })

  test('check against traversal attempts', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}/bar/`,
      preHandler (_, reply) {
        reply.from('/foo/%2E%2E/bar')
      }
    })

    await server.listen({ port: 0 })
    t.after(() => server.close())

    {
      const response = await fetch(`http://localhost:${server.server.address().port}/%2e%2e`)
      t.assert.strictEqual(response.status, 400)
      const text = await response.json()
      t.assert.strictEqual(text.error, 'Bad Request')
      t.assert.strictEqual(text.message, 'source/request contain invalid characters')
    }
  })

  test('manual from call via fromParameters', async t => {
    const server = Fastify()
    server.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      preHandler (request, reply, done) {
        if (request.url !== '/fake-a') {
          done()
          return
        }

        const { url, options } = reply.fromParameters('/a')
        reply.from(url, options)
      }
    })

    await server.listen({ port: 0 })
    t.after(() => server.close())

    {
      const response = await fetch(`http://localhost:${server.server.address().port}/`)
      const body = await response.text()
      t.assert.strictEqual(response.status, 200)
      t.assert.strictEqual(body, 'this is root')
    }

    {
      const response = await fetch(`http://localhost:${server.server.address().port}/fake-a`)
      const body = await response.text()
      t.assert.strictEqual(response.status, 200)
      t.assert.strictEqual(body, 'this is a')
    }
  })

  test('preRewrite handler', async t => {
    const proxyServer = Fastify()

    proxyServer.register(proxy, {
      upstream: `http://localhost:${origin.server.address().port}`,
      prefix: '/api',
      rewritePrefix: '/api2/',
      preRewrite (url, params, prefix) {
        t.assert.strictEqual(url, '/api/abc')
        t.assert.ok(typeof params, 'object')
        t.assert.strictEqual(params['*'], 'abc')
        t.assert.strictEqual(prefix, '/api')
        return url.replace('abc', 'a')
      }
    })

    await proxyServer.listen({ port: 0 })

    t.after(() => {
      proxyServer.close()
    })

    const response = await fetch(`http://localhost:${proxyServer.server.address().port}/api/abc`)
    const body = await response.text()
    t.assert.strictEqual(body, 'this is /api2/a')
  })
}

run()
