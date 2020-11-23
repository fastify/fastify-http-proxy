
'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const proxy = require('../')
const WebSocket = require('ws')
const { createServer } = require('http')
const { promisify } = require('util')
const { once } = require('events')

test('basic websocket proxy', async (t) => {
  t.plan(2)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.tearDown(wss.close.bind(wss))
  t.tearDown(origin.close.bind(origin))

  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      t.equal(message.toString(), 'hello')
      // echo
      ws.send(message)
    })
  })

  await promisify(origin.listen.bind(origin))(0)

  const server = Fastify()
  server.register(proxy, {
    upstream: `http://localhost:${origin.address().port}`,
    websocket: true
  })

  await server.listen(0)
  t.tearDown(server.close.bind(server))

  const ws = new WebSocket(`http://localhost:${server.server.address().port}`)

  await once(ws, 'open')

  const stream = WebSocket.createWebSocketStream(ws)

  stream.write('hello')

  const [buf] = await once(stream, 'data')

  t.is(buf.toString(), 'hello')
})

test('querystring websocket proxy', async (t) => {
  t.plan(1)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.tearDown(wss.close.bind(wss))
  t.tearDown(origin.close.bind(origin))

  wss.on('connection', (ws, req) => {
    t.equal(req.url, '/?token=abc')
    ws.close()
  })

  await promisify(origin.listen.bind(origin))(0)

  const server = Fastify()
  server.register(proxy, {
    upstream: `http://localhost:${origin.address().port}`,
    websocket: true
  })

  await server.listen(0)

  t.tearDown(server.close.bind(server))

  const ws = new WebSocket(`http://localhost:${server.server.address().port}?token=abc`)

  await once(ws, 'open')
  await once(ws, 'close')
})

test('rewritePrefix websocket proxy', async (t) => {
  t.plan(1)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin, path: '/internal' })
  t.tearDown(wss.close.bind(wss))
  t.tearDown(origin.close.bind(origin))

  wss.on('connection', (ws, req) => {
    ws.send(req.url)
  })

  await promisify(origin.listen.bind(origin))(0)

  const server = Fastify()
  server.register(proxy, {
    upstream: `http://localhost:${origin.address().port}`,
    websocket: true,
    prefix: '/external',
    rewritePrefix: '/internal'
  })

  await server.listen(0)
  t.tearDown(server.close.bind(server))

  const ws = new WebSocket(`http://localhost:${server.server.address().port}/external?token=abc`)

  await once(ws, 'open')

  const stream = WebSocket.createWebSocketStream(ws)

  const [buf] = await once(stream, 'data')

  console.log(buf.toString())

  t.is(buf.toString(), '/internal?token=abc')
})
