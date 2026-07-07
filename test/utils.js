'use strict'

const { test } = require('node:test')
const { convertUrlToWebSocket, sanitizeHeaderValue, sanitizeHeaders } = require('../utils')

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

test('sanitizeHeaderValue', function (t) {
  const testData = [
    { input: 'application/json', expected: 'application/json' },
    { input: 'a\tb', expected: 'a\tb' },
    { input: 'café', expected: 'café' },
    { input: 'a\x01b', expected: 'ab' },
    { input: 'hi😀there', expected: 'hithere' },
    { input: '€9', expected: '9' }
  ]
  t.plan(testData.length)
  for (const { input, expected } of testData) {
    t.assert.strictEqual(sanitizeHeaderValue(input), expected)
  }
})

test('sanitizeHeaders', function (t) {
  t.plan(3)
  // string values are sanitized; array values (e.g. set-cookie) map element-wise;
  // non-string values (numbers, non-string array items) are left untouched.
  t.assert.deepStrictEqual(
    sanitizeHeaders({ 'content-type': 'text/html😀', 'set-cookie': ['a=1\x01', 'b=2'] }),
    { 'content-type': 'text/html', 'set-cookie': ['a=1', 'b=2'] }
  )
  t.assert.deepStrictEqual(sanitizeHeaders({ 'content-length': 42 }), { 'content-length': 42 })
  t.assert.deepStrictEqual(sanitizeHeaders({ mixed: ['x\x01', 7] }), { mixed: ['x', 7] })
})
