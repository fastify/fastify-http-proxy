'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const proxy = require('../')
const WebSocket = require('ws')
const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once } = require('node:events')
const qs = require('fast-querystring')

const subprotocolValue = 'foo-subprotocol'

test('websocket proxy with object queryString', async (t) => {
  t.plan(7)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.teardown(wss.close.bind(wss))
  t.teardown(origin.close.bind(origin))

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    t.equal(ws.protocol, subprotocolValue)
    t.equal(request.url, '/?q=test')
    ws.on('message', (message, binary) => {
      serverMessages.push([message.toString(), binary])
      // echo
      ws.send(message, { binary })
    })
  })

  await promisify(origin.listen.bind(origin))({ port: 0, host: '127.0.0.1' })

  const server = Fastify()
  server.register(proxy, {
    upstream: `ws://127.0.0.1:${origin.address().port}`,
    websocket: true,
    wsClientOptions: {
      queryString: { q: 'test' }
    }
  })

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.teardown(server.close.bind(server))

  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}`, [subprotocolValue])
  await once(ws, 'open')

  ws.send('hello', { binary: false })
  const [reply0, binary0] = await once(ws, 'message')
  t.equal(reply0.toString(), 'hello')
  t.equal(binary0, false)

  ws.send(Buffer.from('fastify'), { binary: true })
  const [reply1, binary1] = await once(ws, 'message')
  t.equal(reply1.toString(), 'fastify')
  t.equal(binary1, true)

  t.strictSame(serverMessages, [
    ['hello', false],
    ['fastify', true]
  ])

  await Promise.all([
    once(ws, 'close'),
    server.close()
  ])
})

test('websocket proxy with function queryString', async (t) => {
  t.plan(7)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.teardown(wss.close.bind(wss))
  t.teardown(origin.close.bind(origin))

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    t.equal(ws.protocol, subprotocolValue)
    t.equal(request.url, '/?q=test')
    ws.on('message', (message, binary) => {
      serverMessages.push([message.toString(), binary])
      // echo
      ws.send(message, { binary })
    })
  })

  await promisify(origin.listen.bind(origin))({ port: 0, host: '127.0.0.1' })

  const server = Fastify()
  server.register(proxy, {
    upstream: `ws://127.0.0.1:${origin.address().port}`,
    websocket: true,
    wsClientOptions: {
      queryString: () => qs.stringify({ q: 'test' })
    }
  })

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.teardown(server.close.bind(server))

  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}`, [subprotocolValue])
  await once(ws, 'open')

  ws.send('hello', { binary: false })
  const [reply0, binary0] = await once(ws, 'message')
  t.equal(reply0.toString(), 'hello')
  t.equal(binary0, false)

  ws.send(Buffer.from('fastify'), { binary: true })
  const [reply1, binary1] = await once(ws, 'message')
  t.equal(reply1.toString(), 'fastify')
  t.equal(binary1, true)

  t.strictSame(serverMessages, [
    ['hello', false],
    ['fastify', true]
  ])

  await Promise.all([
    once(ws, 'close'),
    server.close()
  ])
})
