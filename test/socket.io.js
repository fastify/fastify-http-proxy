'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const proxy = require('../')
const ioServer = require('socket.io')
const ioClient = require('socket.io-client')
const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once } = require('node:events')

test('proxy socket.io', async (t) => {
  t.plan(2)

  const srvUpstream = createServer()
  t.after(() => {
    srvUpstream.close()
  })

  const srvSocket = new ioServer.Server(srvUpstream)
  t.after(() => {
    srvSocket.close()
  })

  await promisify(srvUpstream.listen.bind(srvUpstream))(0)

  const srvProxy = Fastify()
  t.after(() => {
    srvProxy.close()
  })

  srvProxy.register(proxy, {
    upstream: `http://127.0.0.1:${srvUpstream.address().port}`,
    websocket: true,
  })

  await srvProxy.listen({ port: 0, host: '127.0.0.1' })

  srvSocket.on('connection', (socket) => {
    socket.on('hello', (data) => {
      t.assert.strictEqual(data, 'world')
      socket.emit('hi', 'socket')
    })
  })

  const cliSocket = ioClient(
    `http://127.0.0.1:${srvProxy.server.address().port}`
  )
  t.after(() => {
    cliSocket.close()
  })

  cliSocket.emit('hello', 'world')

  const [out] = await once(cliSocket, 'hi')
  t.assert.strictEqual(out, 'socket')

  await Promise.all([once(cliSocket, 'disconnect'), srvProxy.close()])
})
