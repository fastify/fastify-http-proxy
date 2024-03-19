'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const proxy = require('../')
const WebSocket = require('ws')
const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once } = require('node:events')
const cookieValue = 'foo=bar'
const subprotocolValue = 'foo-subprotocol'

test('basic websocket proxy', async (t) => {
  t.plan(7)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.teardown(wss.close.bind(wss))
  t.teardown(origin.close.bind(origin))

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    t.equal(ws.protocol, subprotocolValue)
    t.equal(request.headers.cookie, cookieValue)
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
    websocket: true
  })

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.teardown(server.close.bind(server))

  const options = { headers: { cookie: cookieValue } }
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}`, [subprotocolValue], options)
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

    await promisify(origin.listen.bind(origin))({ port: 0, host: '127.0.0.1' })
    server.register(proxy, {
      prefix: name,
      upstream: `ws://127.0.0.1:${origin.address().port}`,
      websocket: true
    })
  }

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.teardown(server.close.bind(server))

  const wsClients = []
  for (const name of ['/A', '/A/B', '/C/D', '/C']) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}${name}`)
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
  await app.listen({ port: 0, host: '127.0.0.1' })

  const app2 = Fastify()
  app2.register(proxy, { upstream: 'ws://127.0.0.1', websocket: true })

  const appPort = app.server.address().port

  await t.rejects(app2.listen({ port: appPort, host: '127.0.0.1' }), /EADDRINUSE/)

  t.teardown(app.close.bind(app))
  t.teardown(app2.close.bind(app2))
})

test('getUpstream', async (t) => {
  t.plan(9)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.teardown(wss.close.bind(wss))
  t.teardown(origin.close.bind(origin))

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    t.equal(ws.protocol, subprotocolValue)
    t.equal(request.headers.cookie, cookieValue)
    ws.on('message', (message, binary) => {
      serverMessages.push([message.toString(), binary])
      // echo
      ws.send(message, { binary })
    })
  })

  await promisify(origin.listen.bind(origin))({ port: 0, host: '127.0.0.1' })

  const server = Fastify()

  let _req

  server.server.on('upgrade', (req) => {
    _req = req
  })
  server.register(proxy, {
    upstream: '',
    replyOptions: {
      getUpstream: function (original) {
        t.not(original, _req)
        t.equal(original.raw, _req)
        return `http://127.0.0.1:${origin.address().port}`
      }
    },
    websocket: true
  })

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.teardown(server.close.bind(server))

  const options = { headers: { cookie: cookieValue } }
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}`, [subprotocolValue], options)
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

test('websocket proxy trigger hooks', async (t) => {
  t.plan(8)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.teardown(wss.close.bind(wss))
  t.teardown(origin.close.bind(origin))

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    t.equal(ws.protocol, subprotocolValue)
    t.equal(request.headers.cookie, cookieValue)
    ws.on('message', (message, binary) => {
      serverMessages.push([message.toString(), binary])
      // echo
      ws.send(message, { binary })
    })
  })

  await promisify(origin.listen.bind(origin))({ port: 0, host: '127.0.0.1' })

  const server = Fastify()
  server.addHook('onRequest', (request, reply, done) => {
    t.pass('onRequest')
    done()
  })
  server.register(proxy, {
    upstream: `ws://127.0.0.1:${origin.address().port}`,
    websocket: true
  })

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.teardown(server.close.bind(server))

  const options = { headers: { cookie: cookieValue } }
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}`, [subprotocolValue], options)
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

test('websocket proxy with rewriteRequestHeaders', async (t) => {
  t.plan(7)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.teardown(wss.close.bind(wss))
  t.teardown(origin.close.bind(origin))

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    t.equal(ws.protocol, subprotocolValue)
    t.equal(request.headers.myauth, 'myauth')
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
      rewriteRequestHeaders: (headers, request) => {
        return {
          ...headers,
          myauth: 'myauth'
        }
      }
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

test('websocket proxy custom headers', async (t) => {
  t.plan(7)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.teardown(wss.close.bind(wss))
  t.teardown(origin.close.bind(origin))

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    t.equal(ws.protocol, subprotocolValue)
    t.equal(request.headers.myauth, 'myauth')
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
      headers: {
        myauth: 'myauth'
      }
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

test('Should gracefully close when clients attempt to connect after calling close', async (t) => {
  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.teardown(wss.close.bind(wss))
  t.teardown(origin.close.bind(origin))

  await promisify(origin.listen.bind(origin))({ port: 0, host: '127.0.0.1' })

  const server = Fastify({ logger: false })
  await server.register(proxy, {
    upstream: `ws://127.0.0.1:${origin.address().port}`,
    websocket: true
  })

  const oldClose = server.server.close
  let p
  server.server.close = function (cb) {
    const ws = new WebSocket('ws://127.0.0.1:' + server.server.address().port)

    p = once(ws, 'unexpected-response').then(([req, res]) => {
      t.equal(res.statusCode, 503)
      oldClose.call(this, cb)
    })
  }

  await server.listen({ port: 0, host: '127.0.0.1' })

  const ws = new WebSocket('ws://127.0.0.1:' + server.server.address().port)

  await once(ws, 'open')
  await server.close()
  await p
})

test('Proxy websocket with custom upstream url', async (t) => {
  t.plan(5)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })

  t.teardown(wss.close.bind(wss))
  t.teardown(origin.close.bind(origin))

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    ws.on('message', (message, binary) => {
      // Also need save request.url for check from what url the message is coming.
      serverMessages.push([message.toString(), binary, request.headers.host.split(':', 1)[0], request.url])
      ws.send(message, { binary })
    })
  })

  await promisify(origin.listen.bind(origin))({ port: 0, host: '127.0.0.1' })
  // Host for wsUpstream and for later check.
  const host = '127.0.0.1'
  // Path for wsUpstream and for later check.
  const path = '/some/path'
  const server = Fastify()
  server.register(proxy, {
    upstream: `ws://127.0.0.1:${origin.address().port}`,
    // Start proxy with different upstream, added path.
    wsUpstream: `ws://${host}:${origin.address().port}${path}`,
    websocket: true
  })

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.teardown(server.close.bind(server))

  // Start websocket with different upstream for connect, added path.
  const ws = new WebSocket(`ws://${host}:${server.server.address().port}${path}`)
  await once(ws, 'open')

  const data = [{ message: 'hello', binary: false }, { message: 'fastify', binary: true, isBuffer: true }]
  const dataLength = data.length
  let dataIndex = 0

  for (; dataIndex < dataLength; dataIndex++) {
    const { message: msg, binary, isBuffer } = data[dataIndex]
    const message = isBuffer
      ? Buffer.from(msg)
      : msg

    ws.send(message, { binary })

    const [reply, binaryAnswer] = await once(ws, 'message')

    t.equal(reply.toString(), msg)
    t.equal(binaryAnswer, binary)
  }
  // Also check "path", must be the same.
  t.strictSame(serverMessages, [
    ['hello', false, host, path],
    ['fastify', true, host, path]
  ])

  await Promise.all([
    once(ws, 'close'),
    server.close()
  ])
})

test('multiple websocket upstreams with host constraints', async (t) => {
  t.plan(4)

  const server = Fastify()

  for (const name of ['foo', 'bar']) {
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

    await promisify(origin.listen.bind(origin))({ port: 0, host: '127.0.0.1' })
    server.register(proxy, {
      upstream: `ws://127.0.0.1:${origin.address().port}`,
      websocket: true,
      constraints: { host: name }
    })
  }

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.teardown(server.close.bind(server))

  const wsClients = []
  for (const name of ['foo', 'bar']) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}`, { headers: { host: name } })
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

test('multiple websocket upstreams with distinct server options', async (t) => {
  t.plan(4)

  const server = Fastify()

  for (const name of ['foo', 'bar']) {
    const origin = createServer()
    const wss = new WebSocket.Server({ server: origin })
    t.teardown(wss.close.bind(wss))
    t.teardown(origin.close.bind(origin))

    wss.once('connection', (ws, req) => {
      t.equal(req.url, `/?q=${name}`)
      ws.once('message', message => {
        // echo
        ws.send(message)
      })
    })

    await promisify(origin.listen.bind(origin))({ port: 0, host: '127.0.0.1' })
    server.register(proxy, {
      upstream: `ws://127.0.0.1:${origin.address().port}`,
      websocket: true,
      constraints: { host: name },
      wsServerOptions: {
        verifyClient: ({ req }) => {
          t.equal(req.url, `/?q=${name}`)
          return true
        }
      }
    })
  }

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.teardown(server.close.bind(server))

  const wsClients = []
  for (const name of ['foo', 'bar']) {
    const ws = new WebSocket(
      `ws://127.0.0.1:${server.server.address().port}/?q=${name}`,
      { headers: { host: name } }
    )
    await once(ws, 'open')
    ws.send(`hello ${name}`)
    await once(ws, 'message')
    wsClients.push(ws)
  }

  await Promise.all([
    ...wsClients.map(ws => once(ws, 'close')),
    server.close()
  ])
})

test('keep proxy websocket pathname', async (t) => {
  t.plan(5)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })

  t.teardown(wss.close.bind(wss))
  t.teardown(origin.close.bind(origin))

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    ws.on('message', (message, binary) => {
      // Also need save request.url for check from what url the message is coming.
      serverMessages.push([message.toString(), binary, request.headers.host.split(':', 1)[0], request.url])
      ws.send(message, { binary })
    })
  })

  await promisify(origin.listen.bind(origin))({ port: 0, host: '127.0.0.1' })
  // Host for wsUpstream and for later check.
  const host = '127.0.0.1'
  // Path for wsUpstream and for later check.
  const path = '/keep/path'
  const server = Fastify()
  server.register(proxy, {
    upstream: `ws://127.0.0.1:${origin.address().port}`,
    // Start proxy with different upstream, without path
    wsUpstream: `ws://${host}:${origin.address().port}`,
    websocket: true
  })

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.teardown(server.close.bind(server))

  // Start websocket with different upstream for connect, added path.
  const ws = new WebSocket(`ws://${host}:${server.server.address().port}${path}`)
  await once(ws, 'open')

  const data = [{ message: 'hello', binary: false }, { message: 'fastify', binary: true, isBuffer: true }]
  const dataLength = data.length
  let dataIndex = 0

  for (; dataIndex < dataLength; dataIndex++) {
    const { message: msg, binary, isBuffer } = data[dataIndex]
    const message = isBuffer
      ? Buffer.from(msg)
      : msg

    ws.send(message, { binary })

    const [reply, binaryAnswer] = await once(ws, 'message')

    t.equal(reply.toString(), msg)
    t.equal(binaryAnswer, binary)
  }
  // Also check "path", must be the same.
  t.strictSame(serverMessages, [
    ['hello', false, host, path],
    ['fastify', true, host, path]
  ])

  await Promise.all([
    once(ws, 'close'),
    server.close()
  ])
})
