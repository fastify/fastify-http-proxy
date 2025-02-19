'use strict'

const WebSocket = require('ws')

const port = process.env.PORT || 3001

// connect to proxy

const url = `ws://localhost:${port}/`
const ws = new WebSocket(url)
const client = WebSocket.createWebSocketStream(ws, { encoding: 'utf8', objectMode: true })

client.setEncoding('utf8')

let i = 1
setInterval(() => {
  client.write(JSON.stringify({
    message: i
  }))
  i++
}, 1000).unref()
const responses = {}

client.on('data', message => {
  const data = JSON.parse(message)
  console.log('Received', data)
  responses[data.response] = responses[data.response] ? responses[data.response] + 1 : 1
})

client.on('error', error => {
  console.log('Error')
  console.error(error)
})

client.on('close', () => {
  console.log('\n\n\nConnection closed')

  console.log('\n\n\nResponses')
  for (const key in responses) {
    if (!responses[key]) {
      console.log('missing', key)
    } else if (responses[key] !== 1) {
      console.log('extra messages', key, responses[key])
    }
  }
})

client.on('unexpected-response', (error) => {
  console.log('Unexpected response')
  console.error(error)
})

client.on('redirect', (error) => {
  console.log('Redirect')
  console.error(error)
})

client.on('upgrade', (error) => {
  console.log('Upgrade')
  console.error(error)
})

client.on('ping', (error) => {
  console.log('Ping')
  console.error(error)
})

client.on('pong', (error) => {
  console.log('Pong')
  console.error(error)
})

process.on('SIGINT', () => {
  client.end()
})
