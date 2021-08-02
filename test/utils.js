'use strict'

const t = require('tap')
const { convertUrlToWebSocket } = require('../utils')

t.test('convertUrlToWebSocket', function (t) {
  const expected = [
    { before: 'http://localhost', after: 'ws://localhost' },
    { before: 'https://localhost', after: 'wss://localhost' },
    { before: 'ws://localhost', after: 'ws://localhost' },
    { before: 'wss://localhost', after: 'wss://localhost' }
  ]
  t.plan(expected.length)
  for (const { before, after } of expected) {
    t.equal(convertUrlToWebSocket(before), after)
  }
})
