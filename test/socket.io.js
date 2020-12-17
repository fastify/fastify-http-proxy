'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const proxy = require('../')
const ioServer = require('socket.io')
const ioClient = require('socket.io-client')
const { createServer } = require('http')
const { promisify } = require('util')
const { once } = require('events')

test('proxy socket.io', async t => {
  t.plan(2)

  const srvUpstream = createServer()
  t.tearDown(srvUpstream.close.bind(srvUpstream))

  const srvSocket = new ioServer.Server(srvUpstream)
  t.tearDown(srvSocket.close.bind(srvSocket))

  await promisify(srvUpstream.listen.bind(srvUpstream))(0)

  const srvProxy = Fastify()
  t.tearDown(srvProxy.close.bind(srvProxy))

  srvProxy.register(proxy, {
    upstream: `http://127.0.0.1:${srvUpstream.address().port}`,
    websocket: true
  })

  await srvProxy.listen(0)

  srvSocket.on('connection', socket => {
    socket.on('hello', data => {
      t.is(data, 'world')
      socket.emit('hi', 'socket')
    })
  })

  const cliSocket = ioClient(`http://127.0.0.1:${srvProxy.server.address().port}`)
  t.tearDown(cliSocket.close.bind(cliSocket))

  cliSocket.emit('hello', 'world')

  const out = await once(cliSocket, 'hi')
  t.is(out[0], 'socket')

  await Promise.all([
    once(cliSocket, 'disconnect'),
    srvProxy.close()
  ])
})
