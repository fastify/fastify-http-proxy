'use strict'

const t = require('tap')

const fastifyHttpProxy = require('..')
const defaultExport = require('..').default
const { fastifyHttpProxy: namedExport } = require('..')

t.test('module export', function (t) {
  t.plan(1)
  t.equal(typeof fastifyHttpProxy, 'function')
})

t.test('default export', function (t) {
  t.plan(1)
  t.equal(typeof defaultExport, 'function')
})

t.test('named export', function (t) {
  t.plan(1)
  t.equal(typeof namedExport, 'function')
})
