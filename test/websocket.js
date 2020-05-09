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

  ws.send('hello')

  const [{ data }] = await once(ws, 'message')

  t.is(data.toString(), 'hello')
})
