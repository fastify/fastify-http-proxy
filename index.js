'use strict'

const From = require('fastify-reply-from')

module.exports = async function (fastify, opts) {
  if (!opts.upstream) {
    throw new Error('upstream must be specified')
  }

  const preHandler = opts.preHandler || opts.beforeHandler
  const rewritePrefix = opts.rewritePrefix || ''

  const fromOpts = Object.assign({}, opts)
  fromOpts.base = opts.upstream
  fromOpts.prefix = undefined

  const oldRewriteHeaders = (opts.replyOptions || {}).rewriteHeaders
  const replyOpts = Object.assign({}, opts.replyOptions, {
    rewriteHeaders
  })
  fromOpts.rewriteHeaders = rewriteHeaders

  fastify.register(From, fromOpts)

  fastify.addContentTypeParser('application/json', bodyParser)
  fastify.addContentTypeParser('*', bodyParser)

  function rewriteHeaders (headers) {
    const location = headers.location
    if (location) {
      headers.location = location.replace(rewritePrefix, fastify.prefix)
    }
    if (oldRewriteHeaders) {
      headers = oldRewriteHeaders(headers)
    }
    return headers
  }

  function bodyParser (req, done) {
    done(null, req)
  }

  fastify.all('/', { preHandler, config: opts.config || {} }, reply)
  fastify.all('/*', { preHandler, config: opts.config || {} }, reply)

  function reply (request, reply) {
    var dest = request.req.url
    dest = dest.replace(this.prefix, rewritePrefix)
    reply.from(dest || '/', replyOpts)
  }
}
