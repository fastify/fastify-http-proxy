'use strict'

const t = require('tap')
const { convertUrlToWebSocket } = require('../utils')

t.test('convertUrlToWebSocket', function (t) {
  const testData = [
    { input: 'http://localhost', expected: 'ws://localhost' },
    { input: 'https://localhost', expected: 'wss://localhost' },
    { input: 'ws://localhost', expected: 'ws://localhost' },
    { input: 'wss://localhost', expected: 'wss://localhost' },
    { input: 'wronghttp://localhost', expected: 'wronghttp://localhost' },
    { input: 'NOT_AN_URL', expected: 'NOT_AN_URL' }

  ]
  t.plan(testData.length)
  for (const { input, expected } of testData) {
    t.equal(convertUrlToWebSocket(input), expected)
  }
})
