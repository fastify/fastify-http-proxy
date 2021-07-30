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
  t.teardown(wss.close.bind(wss))
  t.teardown(origin.close.bind(origin))

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
    upstream: `ws://localhost:${origin.address().port}`,
    websocket: true
  })

  await server.listen(0)
  t.teardown(server.close.bind(server))

  const ws = new WebSocket(`ws://localhost:${server.server.address().port}`)

  await once(ws, 'open')

  const stream = WebSocket.createWebSocketStream(ws)

  stream.write('hello')

  const [buf] = await once(stream, 'data')

  t.equal(buf.toString(), 'hello')

  await Promise.all([
    once(ws, 'close'),
    server.close()
  ])
})

test('captures errors on start', async (t) => {
  const app = Fastify()
  await app.listen(0)

  const app2 = Fastify()
  app2.register(proxy, { upstream: 'ws://localhost', websocket: true })

  const appPort = app.server.address().port

  await t.rejects(app2.listen(appPort), /EADDRINUSE/)

  t.teardown(app.close.bind(app))
  t.teardown(app2.close.bind(app2))
})
