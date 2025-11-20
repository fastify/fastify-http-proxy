'use strict'

const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once } = require('node:events')
const Fastify = require('fastify')
const WebSocket = require('ws')
const pinoTest = require('pino-test')
const pino = require('pino')
const proxyPlugin = require('../../')

function waitForLogMessage (loggerSpy, message, max = 100) {
  return new Promise((resolve, reject) => {
    let count = 0
    const fn = (received) => {
      if (received.msg === message) {
        loggerSpy.off('data', fn)
        resolve()
      }
      count++
      if (count > max) {
        loggerSpy.off('data', fn)
        reject(new Error(`Max message count reached on waitForLogMessage: ${message}`))
      }
    }
    loggerSpy.on('data', fn)
  })
}

async function createTargetServer (t, wsTargetOptions, port = 0) {
  const targetServer = createServer()
  const targetWs = new WebSocket.Server({ server: targetServer, ...wsTargetOptions })
  await promisify(targetServer.listen.bind(targetServer))({ port, host: '127.0.0.1' })

  t.after(() => {
    targetWs.close()
    targetServer.close()
  })

  return { targetServer, targetWs }
}

async function createServices ({ t, wsReconnectOptions, wsTargetOptions, wsServerOptions, wsHooks, targetPort = 0 }) {
  const { targetServer, targetWs } = await createTargetServer(t, wsTargetOptions, targetPort)

  const loggerSpy = pinoTest.sink()
  const logger = pino(loggerSpy)
  const proxy = Fastify({ loggerInstance: logger })
  proxy.register(proxyPlugin, {
    upstream: `ws://127.0.0.1:${targetServer.address().port}`,
    websocket: true,
    wsReconnect: wsReconnectOptions,
    wsServerOptions,
    wsHooks
  })

  await proxy.listen({ port: 0, host: '127.0.0.1' })

  const client = new WebSocket(`ws://127.0.0.1:${proxy.server.address().port}`)
  await once(client, 'open')

  t.after(async () => {
    client.close()
    await proxy.close()
  })

  return {
    target: {
      ws: targetWs,
      server: targetServer
    },
    proxy,
    client,
    loggerSpy,
    logger
  }
}

// Helper function to wrap fetch
async function request (url, options = {}) {
  // Handle got's object format: request({ url: '...', headers: {...} })
  if (typeof url === 'object' && url.url) {
    options = url
    url = options.url
  }

  const fetchOptions = {
    method: options.method || 'GET',
    headers: options.headers || {},
    redirect: options.followRedirect === false ? 'manual' : 'follow'
  }

  if (options.json) {
    fetchOptions.headers['content-type'] = 'application/json'
    fetchOptions.body = JSON.stringify(options.json)
  }

  if (options.retry !== undefined) {
    // Native fetch doesn't have retry, just ignore it
  }

  const response = await fetch(url, fetchOptions)

  // Convert fetch Response to got-like response
  const result = {
    statusCode: response.status,
    statusMessage: response.statusText,
    headers: Object.fromEntries(response.headers.entries())
  }

  // Handle response body based on responseType
  if (options.responseType === 'json') {
    result.body = await response.json()
  } else {
    result.body = await response.text()
  }

  // Throw on HTTP errors like got does
  if (!response.ok && response.status !== 302) {
    const error = new Error(`Response code ${response.status} (${response.statusText})`)
    error.response = result
    throw error
  }

  return result
}

module.exports = {
  waitForLogMessage,
  createTargetServer,
  createServices,
  request
}
