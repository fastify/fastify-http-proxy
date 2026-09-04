'use strict'

const { test } = require('node:test')
const http = require('node:http')
const Fastify = require('fastify')
const proxy = require('../')

function request (port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: '127.0.0.1',
      port,
      path,
      agent: false
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => resolve({ statusCode: response.statusCode, body }))
    })
    req.on('error', reject)
  })
}

test('HTTP paths cannot escape rewritePrefix', async t => {
  const backend = Fastify()
  const frontend = Fastify()
  let escapedPathHit = false

  t.after(async () => {
    await frontend.close()
    await backend.close()
  })

  backend.get('/internal/*', request => `internal:${request.url}`)
  backend.get('/secret', () => {
    escapedPathHit = true
    return 'secret'
  })
  await backend.listen({ port: 0, host: '127.0.0.1' })

  frontend.register(proxy, {
    upstream: `http://127.0.0.1:${backend.server.address().port}`,
    prefix: '/pub',
    rewritePrefix: '/internal'
  })
  await frontend.listen({ port: 0, host: '127.0.0.1' })

  const port = frontend.server.address().port
  const escapePaths = [
    '/pub/dir\\..\\..\\secret',
    '/pub/dir/../../secret',
    '/pub/%2E%2E/secret',
    '/pub/..%2F..%2Fsecret'
  ]
  for (const path of escapePaths) {
    const escaped = await request(port, path)
    t.assert.strictEqual(escaped.statusCode, 400, path)
    t.assert.strictEqual(escapedPathHit, false, path)
  }

  const regular = await request(port, '/pub/foo')
  t.assert.strictEqual(regular.statusCode, 200)
  t.assert.strictEqual(regular.body, 'internal:/internal/foo')

  const encodedBackslashes = await request(port, '/pub/dir%5C..%5C..%5Csecret')
  t.assert.strictEqual(encodedBackslashes.statusCode, 200)
  t.assert.strictEqual(encodedBackslashes.body, 'internal:/internal/dir%5C..%5C..%5Csecret')
})

test('HTTP paths are validated against a dynamic upstream once per request', async t => {
  const backend = Fastify()
  const frontend = Fastify()
  let getUpstreamCalls = 0

  t.after(async () => {
    await frontend.close()
    await backend.close()
  })

  backend.get('/internal/*', request => `internal:${request.url}`)
  await backend.listen({ port: 0, host: '127.0.0.1' })

  frontend.register(proxy, {
    upstream: '',
    prefix: '/pub',
    rewritePrefix: '/internal',
    preRewrite: url => url === '/pub/relative' ? 'internal/file' : url,
    replyOptions: {
      getUpstream (request) {
        getUpstreamCalls++
        const base = `http://127.0.0.1:${backend.server.address().port}`
        return request.url === '/pub/relative' ? `${base}/base/` : base
      }
    }
  })
  await frontend.listen({ port: 0, host: '127.0.0.1' })

  const port = frontend.server.address().port
  const rejected = await request(port, '/pub/relative')
  t.assert.strictEqual(rejected.statusCode, 400)

  const proxied = await request(port, '/pub/foo')
  t.assert.strictEqual(proxied.statusCode, 200)
  t.assert.strictEqual(proxied.body, 'internal:/internal/foo')
  t.assert.strictEqual(getUpstreamCalls, 2)
})

test('reply.fromParameters cannot escape rewritePrefix', async t => {
  const backend = Fastify()
  const frontend = Fastify()
  let escapedPathHit = false

  t.after(async () => {
    await frontend.close()
    await backend.close()
  })

  backend.get('/internal/*', request => `internal:${request.url}`)
  backend.get('/secret', () => {
    escapedPathHit = true
    return 'secret'
  })
  await backend.listen({ port: 0, host: '127.0.0.1' })

  // Documented pattern: reply.fromParameters(...) + reply.from(...) in a preHandler.
  frontend.register(proxy, {
    upstream: `http://127.0.0.1:${backend.server.address().port}`,
    prefix: '/pub',
    rewritePrefix: '/internal',
    preHandler (request, reply, done) {
      if (!request.url.startsWith('/pub')) {
        done()
        return
      }

      const { url, options } = reply.fromParameters(request.url, request.params, '/pub')
      reply.from(url, options)
    }
  })
  await frontend.listen({ port: 0, host: '127.0.0.1' })

  const port = frontend.server.address().port

  const escaped = await request(port, '/pub/dir\\..\\..\\secret')
  t.assert.strictEqual(escaped.statusCode, 400, 'fromParameters must reject backslash traversal')
  t.assert.strictEqual(escapedPathHit, false, 'escaped path must not be reached via fromParameters')

  const regular = await request(port, '/pub/foo')
  t.assert.strictEqual(regular.statusCode, 200)
  t.assert.strictEqual(regular.body, 'internal:/internal/foo')
})

test('HTTP request with a falsy dynamic upstream falls back to the default validation host', async t => {
  const backend = Fastify()
  const frontend = Fastify()

  t.after(async () => {
    await frontend.close()
    await backend.close()
  })

  backend.get('/internal/*', request => `internal:${request.url}`)
  await backend.listen({ port: 0, host: '127.0.0.1' })

  frontend.register(proxy, {
    upstream: '',
    prefix: '/pub',
    rewritePrefix: '/internal',
    replyOptions: {
      // Keep upstream falsy after getUpstream()
      getUpstream () {
        return ''
      }
    }
  })
  await frontend.listen({ port: 0, host: '127.0.0.1' })

  const port = frontend.server.address().port
  const response = await request(port, '/pub/foo')

  t.assert.strictEqual(response.statusCode, 500)
})
