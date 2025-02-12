'use strict'

const { test } = require('node:test')
const { once } = require('node:events')

const Fastify = require('fastify')
const fastifyWebSocket = require('@fastify/websocket')
const proxy = require('..')
const WebSocket = require('ws')
const got = require('got')

const level = 'warn'

async function proxyServer (t, backendURL, backendPath, proxyOptions, wrapperOptions) {
  const frontend = Fastify({ logger: { level } })
  const registerProxy = async fastify => {
    fastify.register(proxy, {
      upstream: backendURL + backendPath,
      ...proxyOptions
    })
  }

  if (wrapperOptions) {
    await frontend.register(registerProxy, wrapperOptions)
  } else {
    await registerProxy(frontend)
  }

  return [frontend, await frontend.listen({ port: 0 })]
}

async function processRequest (t, frontendURL, path, expected) {
  const url = new URL(path, frontendURL)
  const wsUrl = url.href.replace('http:', 'ws:')
  const ws = new WebSocket(wsUrl)
  let wsResult, gotResult

  try {
    await once(ws, 'open')
    t.assert.ok('socket connected')

    const [buf] = await Promise.race([once(ws, 'message'), once(ws, 'close')])
    if (buf instanceof Buffer) {
      wsResult = buf.toString()
    } else {
      wsResult = 'error'
    }
  } catch {
    wsResult = 'error'
    ws.terminate()
  }

  try {
    const result = await got(url)
    gotResult = result.body
  } catch {
    gotResult = 'error'
  }

  t.assert.strictEqual(wsResult, expected)
  t.assert.strictEqual(gotResult, expected)
}

async function handleProxy (info, { backendPath, proxyOptions, wrapperOptions }, expected, ...paths) {
  test(info, async function (t) {
    const backend = Fastify({ logger: { level } })
    await backend.register(fastifyWebSocket)

    backend.get('/*', {
      handler: (req, reply) => {
        reply.send(req.url)
      },
      wsHandler: (socket, req) => {
        socket.send(req.url)

        socket.once('message', () => {
          socket.close()
        })
      }
    })

    const backendURL = await backend.listen({ port: 0 })

    const [frontend, frontendURL] = await proxyServer(t, backendURL, backendPath, proxyOptions, wrapperOptions)

    t.after(async () => {
      // Close the frontend before the backend to avoid timeouts
      await frontend.close()
      await backend.close()
    })

    for (const path of paths) {
      await processRequest(t, frontendURL, path, expected(path))
    }
  })
}

handleProxy(
  'no prefix to `/`',
  {
    backendPath: '/',
    proxyOptions: { websocket: true }
  },
  path => path,
  '/',
  '/pub',
  '/pub/'
)

handleProxy(
  '`/pub/` to `/`',
  {
    backendPath: '/',
    proxyOptions: { websocket: true, prefix: '/pub/' }
  },
  path => path.startsWith('/pub/') ? path.replace('/pub/', '/') : 'error',
  '/',
  '/pub/',
  '/pub/test'
)

handleProxy(
  '`/pub/` to `/public/`',
  {
    backendPath: '/public/',
    proxyOptions: { websocket: true, prefix: '/pub/' }
  },
  path => path.startsWith('/pub/') ? path.replace('/pub/', '/public/') : 'error',
  '/',
  '/pub/',
  '/pub/test'
)

handleProxy(
  'wrapped `/pub/` to `/public/`',
  {
    backendPath: '/public/',
    proxyOptions: { websocket: true },
    wrapperOptions: { prefix: '/pub/' }
  },
  path => path.startsWith('/pub/') ? path.replace('/pub/', '/public/') : 'error',
  '/',
  '/pub/',
  '/pub/test'
)
