'use strict'

const test = require('node:test')

const fastifyHttpProxy = require('..')
const defaultExport = require('..').default
const { fastifyHttpProxy: namedExport } = require('..')

test('module export', function (t) {
  t.plan(1)
  t.assert.strictEqual(typeof fastifyHttpProxy, 'function')
})

test('default export', function (t) {
  t.plan(1)
  t.assert.strictEqual(typeof defaultExport, 'function')
})

test('named export', function (t) {
  t.plan(1)
  t.assert.strictEqual(typeof namedExport, 'function')
})
