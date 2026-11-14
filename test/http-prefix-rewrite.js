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
    '/pub/..%2F..%2Fsecret',
    '/pub/dir%5c..%5c..%5csecret',
    '/pub/dir%5C..%5C..%5Csecret',
    '/pub/%5c..%5csecret',
    '/pub/%5C..%5Csecret'
  ]
  for (const path of escapePaths) {
    const escaped = await request(port, path)
    t.assert.strictEqual(escaped.statusCode, 400, path)
    t.assert.strictEqual(escapedPathHit, false, path)
  }

  const regular = await request(port, '/pub/foo')
  t.assert.strictEqual(regular.statusCode, 200)
  t.assert.strictEqual(regular.body, 'internal:/internal/foo')

  // @fastify/reply-from rejects decoded backslashes in the destination path
  // since v12.8.1, so a percent-encoded backslash is no longer forwarded.
  const encodedBackslash = await request(port, '/pub/foo%5Cbar')
  t.assert.strictEqual(encodedBackslash.statusCode, 400)
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

  const escapePaths = [
    '/pub/dir\\..\\..\\secret',
    '/pub/dir\\..\\..\\..\\secret',
    '/pub/dir%5C..%5C..%5Csecret',
    '/pub/dir%5c..%5c..%5csecret',
    '/pub/%5C..%5Csecret',
    '/pub/%5c..%5csecret',
    '/pub/%5C..%5C..%5Csecret',
    '/pub/..%5Csecret'
  ]
  for (const path of escapePaths) {
    const escaped = await request(port, path)
    t.assert.strictEqual(escaped.statusCode, 400, `fromParameters must reject traversal (${path})`)
    t.assert.strictEqual(escapedPathHit, false, `escaped path must not be reached via fromParameters (${path})`)
  }

  const regular = await request(port, '/pub/foo')
  t.assert.strictEqual(regular.statusCode, 200)
  t.assert.strictEqual(regular.body, 'internal:/internal/foo')

  // @fastify/reply-from rejects decoded backslashes in the destination path
  // since v12.8.1, so a percent-encoded backslash is no longer forwarded.
  const encodedBackslash = await request(port, '/pub/foo%5Cbar')
  t.assert.strictEqual(encodedBackslash.statusCode, 400)
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

test('parameterized rewritePrefix cannot amputate a mandatory suffix or add segments', async t => {
  const backend = Fastify()
  const frontend = Fastify()
  const receivedUrls = []
  const sensitiveHits = []

  t.after(async () => {
    await frontend.close()
    await backend.close()
  })

  // Any upstream route is reachable; we record what the proxy actually forwards.
  backend.all('/*', request => {
    receivedUrls.push(request.url)
    if (request.url === '/admin/master-keys' || request.url === '/admin/users') {
      sensitiveHits.push(request.url)
    }
    return request.url
  })
  await backend.listen({ port: 0, host: '127.0.0.1' })

  frontend.register(proxy, {
    upstream: `http://127.0.0.1:${backend.server.address().port}`,
    prefix: '/tenants/:tenantId/public-avatar',
    rewritePrefix: '/:tenantId/public-avatar'
  })
  await frontend.listen({ port: 0, host: '127.0.0.1' })

  const port = frontend.server.address().port

  // Primitive 1A: `%2f` + `%23` must not amputate the mandatory `/public-avatar`
  // suffix by turning it into a URL fragment (`/admin/master-keys`).
  const a = await request(port, '/tenants/admin%2fmaster-keys%23/public-avatar')
  t.assert.strictEqual(a.statusCode, 200)
  t.assert.strictEqual(sensitiveHits.includes('/admin/master-keys'), false,
    'must not forward the amputated /admin/master-keys path')
  t.assert.match(receivedUrls.at(-1), /public-avatar$/, 'must preserve the mandatory suffix')

  // Primitive 1B: `%2f` + `%3f` must not amputate the suffix via a query split
  // (`/admin/users`).
  const b = await request(port, '/tenants/admin%2fusers%3ftruncate=/public-avatar')
  t.assert.strictEqual(b.statusCode, 200)
  t.assert.strictEqual(sensitiveHits.includes('/admin/users'), false,
    'must not forward the amputated /admin/users path')
  t.assert.match(receivedUrls.at(-1), /public-avatar$/, 'must preserve the mandatory suffix')

  // A legitimate request still proxies to the exact rewritePrefix path.
  const ok = await request(port, '/tenants/acme/public-avatar')
  t.assert.strictEqual(ok.statusCode, 200)
  t.assert.strictEqual(ok.body, '/acme/public-avatar')

  // A percent-encoded space in a param round-trips as encoded path data.
  const space = await request(port, '/tenants/acme%20corp/public-avatar')
  t.assert.strictEqual(space.statusCode, 200)
  t.assert.strictEqual(space.body, '/acme%20corp/public-avatar')
})

test('parameterized rewritePrefix wildcard (:*) param cannot amputate a mandatory suffix', async t => {
  const backend = Fastify()
  const frontend = Fastify()
  const receivedUrls = []
  const sensitiveHits = []

  t.after(async () => {
    await frontend.close()
    await backend.close()
  })

  // Any upstream route is reachable; we record what the proxy actually forwards.
  backend.all('/*', request => {
    receivedUrls.push(request.url)
    if (request.url === '/acme/admin/master-keys' || request.url === '/acme/admin/users') {
      sensitiveHits.push(request.url)
    }
    return request.url
  })
  await backend.listen({ port: 0, host: '127.0.0.1' })

  // The wildcard param value reaches rewritePrefix through the default `/*`
  // route, so the same `#`/`?` amputation must be blocked for `:*` as for a
  // named param. Only the segment separator `/` may legitimately pass through.
  frontend.register(proxy, {
    upstream: `http://127.0.0.1:${backend.server.address().port}`,
    prefix: '/tenants/:tenantId',
    rewritePrefix: '/:tenantId/:*/public-avatar'
  })
  await frontend.listen({ port: 0, host: '127.0.0.1' })

  const port = frontend.server.address().port

  // `%2f` + `%23` in the wildcard segment must not amputate the mandatory
  // `/public-avatar` suffix by turning it into a URL fragment.
  const a = await request(port, '/tenants/acme/admin%2fmaster-keys%23')
  t.assert.strictEqual(a.statusCode, 200)
  t.assert.strictEqual(sensitiveHits.includes('/acme/admin/master-keys'), false,
    'must not forward the amputated /acme/admin/master-keys path')
  t.assert.ok(receivedUrls.at(-1).includes('/public-avatar'), 'must preserve the mandatory suffix')

  // `%2f` + `%3f` in the wildcard segment must not amputate the suffix via a
  // query split.
  const b = await request(port, '/tenants/acme/admin%2fusers%3ftruncate=')
  t.assert.strictEqual(b.statusCode, 200)
  t.assert.strictEqual(sensitiveHits.includes('/acme/admin/users'), false,
    'must not forward the amputated /acme/admin/users path')
  t.assert.ok(receivedUrls.at(-1).includes('/public-avatar'), 'must preserve the mandatory suffix')
})
