'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const Fastify = require('fastify')
const proxy = require('../')
const WebSocket = require('ws')
const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once } = require('node:events')
const { waitForLogMessage, createServices } = require('./helper/helper')
const cookieValue = 'foo=bar'
const subprotocolValue = 'foo-subprotocol'

test('basic websocket proxy', async (t) => {
  t.plan(7)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.after(() => { wss.close() })
  t.after(() => { origin.close() })

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    t.assert.strictEqual(ws.protocol, subprotocolValue)
    t.assert.strictEqual(request.headers.cookie, cookieValue)
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
  t.after(() => { server.close() })

  const options = { headers: { cookie: cookieValue } }
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}`, [subprotocolValue], options)
  await once(ws, 'open')

  ws.send('hello', { binary: false })
  const [reply0, binary0] = await once(ws, 'message')
  t.assert.strictEqual(reply0.toString(), 'hello')
  t.assert.strictEqual(binary0, false)

  ws.send(Buffer.from('fastify'), { binary: true })
  const [reply1, binary1] = await once(ws, 'message')
  t.assert.strictEqual(reply1.toString(), 'fastify')
  t.assert.strictEqual(binary1, true)

  t.assert.deepStrictEqual(serverMessages, [
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
    t.after(() => { wss.close() })
    t.after(() => { origin.close() })

    wss.once('connection', (ws) => {
      ws.once('message', message => {
        t.assert.strictEqual(message.toString(), `hello ${name}`)
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
  t.after(() => { server.close() })

  const wsClients = []
  for (const name of ['/A', '/A/B', '/C/D', '/C']) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}${name}`)
    await once(ws, 'open')
    ws.send(`hello ${name}`)
    const [reply] = await once(ws, 'message')
    t.assert.strictEqual(reply.toString(), `hello ${name}`)
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

  await t.assert.rejects(app2.listen({ port: appPort, host: '127.0.0.1' }), /EADDRINUSE/)

  t.after(() => { app.close() })
  t.after(() => { app2.close() })
})

test('getUpstream', async (t) => {
  t.plan(9)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.after(() => { wss.close() })
  t.after(() => { origin.close() })

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    t.assert.strictEqual(ws.protocol, subprotocolValue)
    t.assert.strictEqual(request.headers.cookie, cookieValue)
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
        t.assert.notStrictEqual(original, _req)
        t.assert.strictEqual(original.raw, _req)
        return `http://127.0.0.1:${origin.address().port}`
      }
    },
    websocket: true
  })

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => { server.close() })

  const options = { headers: { cookie: cookieValue } }
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}`, [subprotocolValue], options)
  await once(ws, 'open')

  ws.send('hello', { binary: false })
  const [reply0, binary0] = await once(ws, 'message')
  t.assert.strictEqual(reply0.toString(), 'hello')
  t.assert.strictEqual(binary0, false)

  ws.send(Buffer.from('fastify'), { binary: true })
  const [reply1, binary1] = await once(ws, 'message')
  t.assert.strictEqual(reply1.toString(), 'fastify')
  t.assert.strictEqual(binary1, true)

  t.assert.deepStrictEqual(serverMessages, [
    ['hello', false],
    ['fastify', true]
  ])

  await Promise.all([
    once(ws, 'close'),
    server.close()
  ])
})

test('getUpstream with unset wsUpstream', async (t) => {
  t.plan(9)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.after(() => { wss.close() })
  t.after(() => { origin.close() })

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    t.assert.strictEqual(ws.protocol, subprotocolValue)
    t.assert.strictEqual(request.headers.cookie, cookieValue)
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
    wsUpstream: '',
    replyOptions: {
      getUpstream: function (original) {
        t.assert.notStrictEqual(original, _req)
        t.assert.strictEqual(original.raw, _req)
        return `http://127.0.0.1:${origin.address().port}`
      }
    },
    websocket: true
  })

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => { server.close() })

  const options = { headers: { cookie: cookieValue } }
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}`, [subprotocolValue], options)
  await once(ws, 'open')

  ws.send('hello', { binary: false })
  const [reply0, binary0] = await once(ws, 'message')
  t.assert.strictEqual(reply0.toString(), 'hello')
  t.assert.strictEqual(binary0, false)

  ws.send(Buffer.from('fastify'), { binary: true })
  const [reply1, binary1] = await once(ws, 'message')
  t.assert.strictEqual(reply1.toString(), 'fastify')
  t.assert.strictEqual(binary1, true)

  t.assert.deepStrictEqual(serverMessages, [
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
  t.after(() => { wss.close() })
  t.after(() => { origin.close() })

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    t.assert.strictEqual(ws.protocol, subprotocolValue)
    t.assert.strictEqual(request.headers.cookie, cookieValue)
    ws.on('message', (message, binary) => {
      serverMessages.push([message.toString(), binary])
      // echo
      ws.send(message, { binary })
    })
  })

  await promisify(origin.listen.bind(origin))({ port: 0, host: '127.0.0.1' })

  const server = Fastify()
  server.addHook('onRequest', (_request, _reply, done) => {
    t.assert.ok('onRequest')
    done()
  })
  server.register(proxy, {
    upstream: `ws://127.0.0.1:${origin.address().port}`,
    websocket: true
  })

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => { server.close() })

  const options = { headers: { cookie: cookieValue } }
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}`, [subprotocolValue], options)
  await once(ws, 'open')

  ws.send('hello', { binary: false })
  const [reply0, binary0] = await once(ws, 'message')
  t.assert.strictEqual(reply0.toString(), 'hello')
  t.assert.strictEqual(binary0, false)

  ws.send(Buffer.from('fastify'), { binary: true })
  const [reply1, binary1] = await once(ws, 'message')
  t.assert.strictEqual(reply1.toString(), 'fastify')
  t.assert.strictEqual(binary1, true)

  t.assert.deepStrictEqual(serverMessages, [
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
  t.after(() => { wss.close() })
  t.after(() => { origin.close() })

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    t.assert.strictEqual(ws.protocol, subprotocolValue)
    t.assert.strictEqual(request.headers.myauth, 'myauth')
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
      rewriteRequestHeaders: (headers) => {
        return {
          ...headers,
          myauth: 'myauth'
        }
      }
    }
  })

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => { server.close() })

  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}`, [subprotocolValue])
  await once(ws, 'open')

  ws.send('hello', { binary: false })
  const [reply0, binary0] = await once(ws, 'message')
  t.assert.strictEqual(reply0.toString(), 'hello')
  t.assert.strictEqual(binary0, false)

  ws.send(Buffer.from('fastify'), { binary: true })
  const [reply1, binary1] = await once(ws, 'message')
  t.assert.strictEqual(reply1.toString(), 'fastify')
  t.assert.strictEqual(binary1, true)

  t.assert.deepStrictEqual(serverMessages, [
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
  t.after(() => { wss.close() })
  t.after(() => { origin.close() })

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    t.assert.strictEqual(ws.protocol, subprotocolValue)
    t.assert.strictEqual(request.headers.myauth, 'myauth')
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
  t.after(() => { server.close() })

  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}`, [subprotocolValue])
  await once(ws, 'open')

  ws.send('hello', { binary: false })
  const [reply0, binary0] = await once(ws, 'message')
  t.assert.strictEqual(reply0.toString(), 'hello')
  t.assert.strictEqual(binary0, false)

  ws.send(Buffer.from('fastify'), { binary: true })
  const [reply1, binary1] = await once(ws, 'message')
  t.assert.strictEqual(reply1.toString(), 'fastify')
  t.assert.strictEqual(binary1, true)

  t.assert.deepStrictEqual(serverMessages, [
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
  t.after(() => { wss.close() })
  t.after(() => { origin.close() })

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

    p = once(ws, 'unexpected-response').then(([_req, res]) => {
      t.assert.strictEqual(res.statusCode, 503)
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

  t.after(() => { wss.close() })
  t.after(() => { origin.close() })

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
  t.after(() => { server.close() })

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

    t.assert.strictEqual(reply.toString(), msg)
    t.assert.strictEqual(binaryAnswer, binary)
  }
  // Also check "path", must be the same.
  t.assert.deepStrictEqual(serverMessages, [
    ['hello', false, host, path],
    ['fastify', true, host, path]
  ])

  await Promise.all([
    once(ws, 'close'),
    server.close()
  ])
})

test('Proxy websocket with custom upstream url', async (t) => {
  t.plan(5)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })

  t.after(() => { wss.close() })
  t.after(() => { origin.close() })

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
  const prefix = '/prefix'
  const rewritePrefix = '/rewrite'
  const server = Fastify()
  server.register(proxy, {
    prefix,
    rewritePrefix,
    wsUpstream: `ws://${host}:${origin.address().port}`,
    websocket: true
  })

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => { server.close() })

  const path = '/some/path'
  // Start websocket with different upstream for connect, added path.
  const ws = new WebSocket(`ws://${host}:${server.server.address().port}${prefix}${path}`)
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

    t.assert.strictEqual(reply.toString(), msg)
    t.assert.strictEqual(binaryAnswer, binary)
  }
  // Also check "path", must be the same.
  t.assert.deepStrictEqual(serverMessages, [
    ['hello', false, host, rewritePrefix + path],
    ['fastify', true, host, rewritePrefix + path]
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
    t.after(() => { wss.close() })
    t.after(() => { origin.close() })

    wss.once('connection', (ws) => {
      ws.once('message', message => {
        t.assert.strictEqual(message.toString(), `hello ${name}`)
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
  t.after(() => { server.close() })

  const wsClients = []
  for (const name of ['foo', 'bar']) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}`, { headers: { host: name } })
    await once(ws, 'open')
    ws.send(`hello ${name}`)
    const [reply] = await once(ws, 'message')
    t.assert.strictEqual(reply.toString(), `hello ${name}`)
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
    t.after(() => { wss.close() })
    t.after(() => { origin.close() })

    wss.once('connection', (ws, req) => {
      t.assert.strictEqual(req.url, `/?q=${name}`)
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
          t.assert.strictEqual(req.url, `/?q=${name}`)
          return true
        }
      }
    })
  }

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => { server.close() })

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

test('should call onIncomingMessage and onOutgoingMessage hooks', async (t) => {
  const request = 'query () { ... }'
  const response = 'data ...'
  const onIncomingMessage = (context, source, target, { data, binary }) => {
    assert.strictEqual(data.toString(), request)
    assert.strictEqual(binary, false)
    context.log.info('onIncomingMessage called')
  }
  const onOutgoingMessage = (context, source, target, { data, binary }) => {
    assert.strictEqual(data.toString(), response)
    assert.strictEqual(binary, false)
    context.log.info('onOutgoingMessage called')
  }

  const { target, loggerSpy, client } = await createServices({ t, wsHooks: { onIncomingMessage, onOutgoingMessage } })

  target.ws.on('connection', async (socket) => {
    socket.on('message', async (data, binary) => {
      socket.send(response, { binary })
    })
  })

  client.send(request)

  await waitForLogMessage(loggerSpy, 'onIncomingMessage called')
  await waitForLogMessage(loggerSpy, 'onOutgoingMessage called')
})

test('should handle throwing an error in onIncomingMessage and onOutgoingMessage hooks', async (t) => {
  const request = 'query () { ... }'
  const response = 'data ...'
  const onIncomingMessage = (context, source, target, { data, binary }) => {
    assert.strictEqual(data.toString(), request)
    assert.strictEqual(binary, false)
    throw new Error('onIncomingMessage error')
  }
  const onOutgoingMessage = (context, source, target, { data, binary }) => {
    assert.strictEqual(data.toString(), response)
    assert.strictEqual(binary, false)
    throw new Error('onOutgoingMessage error')
  }

  const { target, loggerSpy, client } = await createServices({ t, wsHooks: { onIncomingMessage, onOutgoingMessage } })

  target.ws.on('connection', async (socket) => {
    socket.on('message', async (data, binary) => {
      socket.send(response, { binary })
    })
  })

  client.send(request)

  await waitForLogMessage(loggerSpy, 'proxy ws error from onIncomingMessage hook')
  await waitForLogMessage(loggerSpy, 'proxy ws error from onOutgoingMessage hook')
})

test('should call onConnect hook', async (t) => {
  const onConnect = (context) => {
    context.log.info('onConnect called')
  }

  const { loggerSpy } = await createServices({ t, wsHooks: { onConnect } })

  await waitForLogMessage(loggerSpy, 'onConnect called')
})

test('should handle throwing an error in onConnect hook', async (t) => {
  const onConnect = () => {
    throw new Error('onConnect error')
  }

  const { loggerSpy } = await createServices({ t, wsHooks: { onConnect } })

  await waitForLogMessage(loggerSpy, 'proxy ws error from onConnect hook')
})

test('should call onDisconnect hook', async (t) => {
  const onDisconnect = (context) => {
    context.log.info('onDisconnect called')
  }

  const { loggerSpy, client } = await createServices({ t, wsHooks: { onDisconnect } })
  client.close()

  await waitForLogMessage(loggerSpy, 'onDisconnect called')
})

test('should handle throwing an error in onDisconnect hook', async (t) => {
  const onDisconnect = () => {
    throw new Error('onDisconnect error')
  }

  const { loggerSpy, client } = await createServices({ t, wsHooks: { onDisconnect } })
  client.close()

  await waitForLogMessage(loggerSpy, 'proxy ws error from onDisconnect hook')
})
