'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const proxy = require('../')
const WebSocket = require('ws')
const { createServer } = require('http')
const { promisify } = require('util')
const { once } = require('events')
const cookieValue = 'foo=bar'
const subprotocolValue = 'foo-subprotocol'

test('basic websocket proxy', async (t) => {
  t.plan(4)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.teardown(wss.close.bind(wss))
  t.teardown(origin.close.bind(origin))

  wss.on('connection', (ws, request) => {
    t.equal(ws.protocol, subprotocolValue)
    t.equal(request.headers.cookie, cookieValue)
    ws.on('message', (message) => {
      t.equal(message.toString(), 'hello')
      // echo
      ws.send(message)
    })
  })

  await promisify(origin.listen.bind(origin))({ port: 0 })

  const server = Fastify()
  server.register(proxy, {
    upstream: `ws://localhost:${origin.address().port}`,
    websocket: true
  })

  await server.listen({ port: 0 })
  t.teardown(server.close.bind(server))

  const options = { headers: { cookie: cookieValue } }
  const ws = new WebSocket(`ws://localhost:${server.server.address().port}`, [subprotocolValue], options)

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

test('multiple websocket upstreams', async (t) => {
  t.plan(8)

  const server = Fastify()

  for (const name of ['/A', '/A/B', '/C/D', '/C']) {
    const origin = createServer()
    const wss = new WebSocket.Server({ server: origin })
    t.teardown(wss.close.bind(wss))
    t.teardown(origin.close.bind(origin))

    wss.once('connection', (ws) => {
      ws.once('message', message => {
        t.equal(message.toString(), `hello ${name}`)
        // echo
        ws.send(message)
      })
    })

    await promisify(origin.listen.bind(origin))({ port: 0 })
    server.register(proxy, {
      prefix: name,
      upstream: `ws://localhost:${origin.address().port}`,
      websocket: true
    })
  }

  await server.listen({ port: 0 })
  t.teardown(server.close.bind(server))

  const wsClients = []
  for (const name of ['/A', '/A/B', '/C/D', '/C']) {
    const ws = new WebSocket(`ws://localhost:${server.server.address().port}${name}`)
    await once(ws, 'open')
    ws.send(`hello ${name}`)
    const [reply] = await once(ws, 'message')
    t.equal(reply.toString(), `hello ${name}`)
    wsClients.push(ws)
  }

  await Promise.all([
    ...wsClients.map(ws => once(ws, 'close')),
    server.close()
  ])
})

test('captures errors on start', async (t) => {
  const app = Fastify()
  await app.listen({ port: 0 })

  const app2 = Fastify()
  app2.register(proxy, { upstream: 'ws://localhost', websocket: true })

  const appPort = app.server.address().port

  await t.rejects(app2.listen({ port: appPort }), /EADDRINUSE/)

  t.teardown(app.close.bind(app))
  t.teardown(app2.close.bind(app2))
})
