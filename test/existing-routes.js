'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const proxy = require('../')

async function createOrigin (t) {
  const origin = Fastify()
  origin.get('/', async () => 'this is root')
  origin.get('/a', async () => 'this is a')
  origin.options('/a', async (_request, reply) => {
    reply.header('x-from', 'origin')
    return ''
  })
  await origin.listen({ port: 0 })
  t.after(() => origin.close())
  return `http://localhost:${origin.server.address().port}`
}

test('skips OPTIONS when an OPTIONS route is already registered (e.g. @fastify/cors)', async (t) => {
  const upstream = await createOrigin(t)
  const server = Fastify()
  t.after(() => server.close())

  // Same routes @fastify/cors registers to answer preflight requests
  server.options('/*', async (_request, reply) => {
    reply.header('x-from', 'preflight').code(204).send()
  })
  server.options('/', async (_request, reply) => {
    reply.header('x-from', 'preflight').code(204).send()
  })

  await server.register(proxy, { upstream })
  await server.ready()

  const preflight = await server.inject({ method: 'OPTIONS', url: '/a' })
  t.assert.strictEqual(preflight.statusCode, 204)
  t.assert.strictEqual(preflight.headers['x-from'], 'preflight')

  const res = await server.inject({ method: 'GET', url: '/a' })
  t.assert.strictEqual(res.statusCode, 200)
  t.assert.strictEqual(res.body, 'this is a')
})

test('proxies OPTIONS when no OPTIONS route is registered', async (t) => {
  const upstream = await createOrigin(t)
  const server = Fastify()
  t.after(() => server.close())

  await server.register(proxy, { upstream })

  const res = await server.inject({ method: 'OPTIONS', url: '/a' })
  t.assert.strictEqual(res.statusCode, 200)
  t.assert.strictEqual(res.headers['x-from'], 'origin')
})

test('skips a route when all its methods are already registered', async (t) => {
  const upstream = await createOrigin(t)
  const server = Fastify()
  t.after(() => server.close())

  server.get('/*', async () => 'local')

  await server.register(proxy, { upstream, httpMethods: ['GET'] })
  await server.ready()

  const res = await server.inject({ method: 'GET', url: '/a' })
  t.assert.strictEqual(res.body, 'local')

  // '/' is not covered by the local '/*' route, so it is still proxied
  const root = await server.inject({ method: 'GET', url: '/' })
  t.assert.strictEqual(root.body, 'this is root')
})

test('accepts httpMethods as a string', async (t) => {
  const upstream = await createOrigin(t)
  const server = Fastify()
  t.after(() => server.close())

  await server.register(proxy, { upstream, httpMethods: 'GET' })

  const res = await server.inject({ method: 'GET', url: '/a' })
  t.assert.strictEqual(res.body, 'this is a')
})

test('works with a prefix alongside a global OPTIONS route', async (t) => {
  const upstream = await createOrigin(t)
  const server = Fastify()
  t.after(() => server.close())

  server.options('/*', async (_request, reply) => {
    reply.header('x-from', 'preflight').code(204).send()
  })

  await server.register(proxy, { upstream, prefix: '/api' })

  const res = await server.inject({ method: 'GET', url: '/api/a' })
  t.assert.strictEqual(res.body, 'this is a')

  const preflight = await server.inject({ method: 'OPTIONS', url: '/api/a' })
  t.assert.strictEqual(preflight.headers['x-from'], 'origin')
})

test('logs the skipped methods at debug level', async (t) => {
  const upstream = await createOrigin(t)
  const logs = []
  const server = Fastify({
    logger: {
      level: 'debug',
      stream: { write (line) { logs.push(JSON.parse(line)) } }
    }
  })
  t.after(() => server.close())

  server.options('/*', async (_request, reply) => {
    reply.code(204).send()
  })

  await server.register(proxy, { upstream })
  await server.ready()

  const entry = logs.find(l => l.msg === '@fastify/http-proxy: skipping methods already registered for route')
  t.assert.ok(entry, 'a debug log entry is emitted')
  t.assert.strictEqual(entry.level, 20)
  t.assert.strictEqual(entry.url, '/*')
  t.assert.deepStrictEqual(entry.methods, ['OPTIONS'])
})
