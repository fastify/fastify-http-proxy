'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { setTimeout: wait } = require('node:timers/promises')
const { once } = require('node:events')
const { waitForLogMessage, createTargetServer, createServices } = require('./helper/helper')

test('should use ping/pong to verify connection is alive - from source (server on proxy) to target', async (t) => {
  const wsReconnectOptions = { pingInterval: 100, reconnectInterval: 100, maxReconnectionRetries: 1 }

  const { target } = await createServices({ t, wsReconnectOptions })

  let counter = 0
  target.ws.on('connection', function connection (socket) {
    socket.on('ping', () => {
      counter++
    })
  })

  await wait(250)

  assert.ok(counter > 0)
})

test('should reconnect on broken connection', async (t) => {
  const wsReconnectOptions = { pingInterval: 500, reconnectInterval: 100, maxReconnectionRetries: 1, reconnectDecay: 2, logs: true }

  const { target, loggerSpy } = await createServices({ t, wsReconnectOptions, wsTargetOptions: { autoPong: false } })

  let breakConnection = true
  target.ws.on('connection', async (socket) => {
    socket.on('ping', async () => {
      // add latency to break the connection once
      if (breakConnection) {
        await wait(wsReconnectOptions.pingInterval * 2)
        breakConnection = false
      }
      socket.pong()
    })
  })

  await waitForLogMessage(loggerSpy, 'proxy ws connection is broken')
  await waitForLogMessage(loggerSpy, 'proxy ws target close event')
  await waitForLogMessage(loggerSpy, 'proxy ws reconnected')
})

test('should not reconnect after max retries', async (t) => {
  const wsReconnectOptions = { pingInterval: 150, reconnectInterval: 100, maxReconnectionRetries: 1, logs: true }

  const { target, loggerSpy } = await createServices({ t, wsReconnectOptions, wsTargetOptions: { autoPong: false } })

  let breakConnection = true

  target.ws.on('connection', async (socket) => {
    socket.on('ping', async () => {
      // add latency to break the connection once
      if (breakConnection) {
        await wait(wsReconnectOptions.pingInterval * 2)
        breakConnection = false
      }
      socket.pong()
    })
  })

  await waitForLogMessage(loggerSpy, 'proxy ws connection is broken')

  target.ws.close()
  target.server.close()

  await waitForLogMessage(loggerSpy, 'proxy ws target close event')
  await waitForLogMessage(loggerSpy, 'proxy ws reconnect error')
  await waitForLogMessage(loggerSpy, 'proxy ws failed to reconnect! No more retries')
})

test('should not reconnect when the target connection is closed and reconnectOnClose is off', async (t) => {
  const wsReconnectOptions = { pingInterval: 200, reconnectInterval: 100, maxReconnectionRetries: 1, reconnectOnClose: false, logs: true }

  const { target, loggerSpy } = await createServices({ t, wsReconnectOptions })

  target.ws.on('connection', async (socket) => {
    socket.on('ping', async () => {
      socket.pong()
    })

    await wait(500)
    socket.close()
  })

  await waitForLogMessage(loggerSpy, 'proxy ws target close event')
  await waitForLogMessage(loggerSpy, 'proxy ws close link')
})

test('should reconnect retrying after a few failures', async (t) => {
  const wsReconnectOptions = { pingInterval: 150, reconnectInterval: 100, reconnectDecay: 2, logs: true, maxReconnectionRetries: Infinity }

  const wsTargetOptions = { autoPong: false }
  const { target, loggerSpy } = await createServices({ t, wsReconnectOptions, wsTargetOptions })

  let breakConnection = true

  target.ws.on('connection', async (socket) => {
    socket.on('ping', async () => {
      // add latency to break the connection once
      if (breakConnection) {
        await wait(wsReconnectOptions.pingInterval * 2)
        breakConnection = false
      }
      socket.pong()
    })
  })

  await waitForLogMessage(loggerSpy, 'proxy ws connection is broken')

  // recreate a new target
  const targetPort = target.server.address().port
  target.ws.close()
  target.server.close()

  await waitForLogMessage(loggerSpy, 'proxy ws target close event')
  // make reconnection fail 2 times
  await waitForLogMessage(loggerSpy, 'proxy ws reconnect error')
  await waitForLogMessage(loggerSpy, 'proxy ws reconnect in 200 ms')

  // recreate the target
  await createTargetServer(t, { autoPong: true }, targetPort)
  await waitForLogMessage(loggerSpy, 'proxy ws reconnected')
})

test('should reconnect when the target connection is closed gracefully and reconnectOnClose is on', async (t) => {
  const wsReconnectOptions = { pingInterval: 200, reconnectInterval: 100, maxReconnectionRetries: 1, reconnectOnClose: true, logs: true }

  const { target, loggerSpy } = await createServices({ t, wsReconnectOptions })

  target.ws.on('connection', async (socket) => {
    socket.on('ping', async () => {
      socket.pong()
    })

    await wait(500)
    socket.close()
  })

  await waitForLogMessage(loggerSpy, 'proxy ws target close event')
  await waitForLogMessage(loggerSpy, 'proxy ws reconnected')
})

test('should call onReconnect hook when the connection is reconnected', async (t) => {
  const onReconnect = (context, source, target) => {
    context.log.info('onReconnect called')
  }
  const wsReconnectOptions = {
    pingInterval: 100,
    reconnectInterval: 100,
    maxReconnectionRetries: 1,
    reconnectOnClose: true,
    logs: true,
  }

  const { target, loggerSpy } = await createServices({ t, wsReconnectOptions, wsHooks: { onReconnect } })

  target.ws.on('connection', async (socket) => {
    socket.on('ping', async () => {
      socket.pong()
    })

    await wait(500)
    socket.close()
  })

  await waitForLogMessage(loggerSpy, 'proxy ws target close event')
  await waitForLogMessage(loggerSpy, 'proxy ws reconnected')
  await waitForLogMessage(loggerSpy, 'onReconnect called')
})

test('should handle throwing an error in onReconnect hook', async (t) => {
  const onReconnect = () => {
    throw new Error('onReconnect error')
  }
  const wsReconnectOptions = {
    pingInterval: 100,
    reconnectInterval: 100,
    maxReconnectionRetries: 1,
    reconnectOnClose: true,
    logs: true,
  }

  const { target, loggerSpy } = await createServices({ t, wsReconnectOptions, wsHooks: { onReconnect } })

  target.ws.on('connection', async (socket) => {
    socket.on('ping', async () => {
      socket.pong()
    })

    await wait(500)
    socket.close()
  })

  await waitForLogMessage(loggerSpy, 'proxy ws target close event')
  await waitForLogMessage(loggerSpy, 'proxy ws reconnected')
  await waitForLogMessage(loggerSpy, 'proxy ws error from onReconnect hook')
})

test('should call onIncomingMessage and onOutgoingMessage hooks, with reconnection', async (t) => {
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
  const wsReconnectOptions = {
    pingInterval: 100,
    reconnectInterval: 100,
    maxReconnectionRetries: 1,
    logs: true,
  }

  const { target, loggerSpy, client } = await createServices({ t, wsReconnectOptions, wsHooks: { onIncomingMessage, onOutgoingMessage } })

  target.ws.on('connection', async (socket) => {
    socket.on('message', async (data, binary) => {
      socket.send(response, { binary })
    })
  })

  client.send(request)

  await waitForLogMessage(loggerSpy, 'onIncomingMessage called')
  await waitForLogMessage(loggerSpy, 'onOutgoingMessage called')
})

test('should handle throwing an error in onIncomingMessage and onOutgoingMessage hooks, with reconnection', async (t) => {
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
  const wsReconnectOptions = {
    pingInterval: 100,
    reconnectInterval: 100,
    maxReconnectionRetries: 1,
    logs: true,
  }

  const { target, loggerSpy, client } = await createServices({ t, wsReconnectOptions, wsHooks: { onIncomingMessage, onOutgoingMessage } })

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

  const wsReconnectOptions = {
    logs: true,
  }

  const { loggerSpy } = await createServices({ t, wsReconnectOptions, wsHooks: { onConnect } })

  await waitForLogMessage(loggerSpy, 'onConnect called')
})

test('should handle throwing an error in onConnect hook', async (t) => {
  const onConnect = () => {
    throw new Error('onConnect error')
  }

  const wsReconnectOptions = {
    logs: true,
  }

  const { loggerSpy } = await createServices({ t, wsReconnectOptions, wsHooks: { onConnect } })

  await waitForLogMessage(loggerSpy, 'proxy ws error from onConnect hook')
})

test('should call onDisconnect hook', async (t) => {
  const onDisconnect = (context) => {
    context.log.info('onDisconnect called')
  }

  const wsReconnectOptions = {
    logs: true,
  }

  const { loggerSpy, client } = await createServices({ t, wsReconnectOptions, wsHooks: { onDisconnect } })
  client.close()

  await waitForLogMessage(loggerSpy, 'onDisconnect called')
})

test('should handle throwing an error in onDisconnect hook', async (t) => {
  const onDisconnect = () => {
    throw new Error('onDisconnect error')
  }

  const wsReconnectOptions = {
    logs: true,
  }

  const { loggerSpy, client } = await createServices({ t, wsReconnectOptions, wsHooks: { onDisconnect } })
  client.close()

  await waitForLogMessage(loggerSpy, 'proxy ws error from onDisconnect hook')
})

test('should call onDisconnect hook once per connection', async (t) => {
  let calls = 0
  let onFirstCall
  const firstCall = new Promise((resolve) => { onFirstCall = resolve })
  const onDisconnect = () => {
    calls++
    onFirstCall()
  }

  const wsReconnectOptions = {
    logs: true,
  }

  const { client } = await createServices({ t, wsReconnectOptions, wsHooks: { onDisconnect } })
  client.close()

  await firstCall
  // close() closes the target and is also bound to the target's own close
  // event, so the teardown can re-enter and report a second disconnect.
  await wait(500)

  assert.strictEqual(calls, 1)
})

test('should not leave a target connection open when the client leaves during the reconnection', async (t) => {
  const wsReconnectOptions = { pingInterval: 60_000, reconnectInterval: 100, reconnectOnClose: true, logs: true }

  const { target, client, loggerSpy } = await createServices({ t, wsReconnectOptions })

  if (target.ws.clients.size === 0) {
    await once(target.ws, 'connection')
  }
  const [first] = target.ws.clients
  const later = []
  target.ws.on('connection', (socket) => { later.push(socket) })

  // the target closes: the proxy waits before reconnecting, and the client leaves meanwhile
  const reconnecting = waitForLogMessage(loggerSpy, 'proxy ws reconnect in 100 ms')
  first.close()
  await reconnecting

  const aborted = waitForLogMessage(loggerSpy, 'proxy ws abort reconnect due to source is closed')
  client.terminate()
  await aborted

  // whether or not the proxy got to connect again, nothing is left open
  for (const socket of later) {
    if (socket.readyState !== socket.CLOSED) {
      await once(socket, 'close')
    }
  }
  assert.strictEqual(target.ws.clients.size, 0)
})

test('should not keep the source listeners of the previous target connections after a reconnection', async (t) => {
  const reconnections = 3
  const wsReconnectOptions = { pingInterval: 60_000, reconnectInterval: 100, reconnectOnClose: true }

  let incoming = 0
  let disconnects = 0
  let onReconnected
  let onDisconnected
  const disconnected = new Promise((resolve) => { onDisconnected = resolve })
  const wsHooks = {
    onIncomingMessage: () => { incoming++ },
    onReconnect: () => onReconnected(),
    onDisconnect: () => {
      disconnects++
      onDisconnected()
    }
  }

  const { target, client } = await createServices({ t, wsReconnectOptions, wsHooks })

  if (target.ws.clients.size === 0) {
    await once(target.ws, 'connection')
  }
  let [socket] = target.ws.clients

  for (let i = 0; i < reconnections; i++) {
    const reconnected = new Promise((resolve) => { onReconnected = resolve })
    const connection = once(target.ws, 'connection')
    socket.close()
    ;[socket] = await connection
    await reconnected
  }

  // the proxy listens to the client once, whatever the number of reconnections
  socket.on('message', (data, binary) => socket.send(data, { binary }))
  const echoed = once(client, 'message')
  client.send('hello')
  const [data] = await echoed
  assert.strictEqual(data.toString(), 'hello')
  assert.strictEqual(incoming, 1)

  const closed = once(socket, 'close')
  client.close()
  await disconnected
  await closed
  assert.strictEqual(disconnects, 1)
})
