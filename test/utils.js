'use strict'

const { test } = require('node:test')
const { convertUrlToWebSocket } = require('../utils')

test('convertUrlToWebSocket', function (t) {
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
    t.assert.strictEqual(convertUrlToWebSocket(input), expected)
  }
})
