'use strict'

const Fastify = require('fastify')
const proxy = require('..')
const { WebSocketServer, WebSocket } = require('ws')
const http = require('http')
const fs = require('fs')
const path = require('path')

async function runIpcWsOrigin (param) {
  const server = http.createServer()
  const ipcSocket = path.join(__dirname, `example-${param}.sock`)
  const serverOptions = { path: ipcSocket }

  removeSocket(ipcSocket)
  const wsServer = new WebSocketServer({ server })
  wsServer.on('connection', (wsClient) => {
    wsClient.on('message', (msg) => {
      if (wsClient.readyState === WebSocket.OPEN) {
        console.log('%s', msg)
        removeSocket(ipcSocket)
        process.exit(0)
      }
    })
  })
  await server.listen(serverOptions)
  return server
}

async function runIpcWsProxy () {
  const wsProxy = Fastify({ logger: true })
  const wsProxyOptions = {
    upstream: '',
    websocket: true,
    replyOptions: {
      getUpstream: (originalReq) => {
        const regex = /^\/(?<param>[^?/]*)/
        const [, param] = originalReq.url.match(regex)
        const filename = path.join(__dirname, `example-${param}.sock`)
        return `ws+unix://${filename}`
      }
    }
  }
  wsProxy.register(proxy, wsProxyOptions)
  await wsProxy.listen({ port: 3021 })
}

function wsClient () {
  const ws = new WebSocket('ws://localhost:3021/smth')
  ws.on('open', function open () {
    ws.send('Hello, websocket proxy!')
  })
}

function removeSocket (ipcSocket) {
  try {
    fs.rmSync(ipcSocket)
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw (e)
    }
  }
}

async function run () {
  await runIpcWsOrigin('smth')
  await runIpcWsProxy()
  wsClient()
}

run()
