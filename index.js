'use strict'

const From = require('fastify-reply-from')

module.exports = async function (fastify, opts) {
  if (!opts.upstream) {
    throw new Error('upstream must be specified')
  }

  const beforeHandler = opts.beforeHandler

  fastify.register(From, {
    base: opts.upstream
  })

  fastify.addContentTypeParser('*', function (req, done) {
    done(null, req)
  })

  fastify.all('/', { beforeHandler }, reply)
  fastify.all('/*', { beforeHandler }, reply)

  function reply (request, reply) {
    const dest = request.req.url.replace(this.basePath, '')
    reply.from(dest)
  }
}
