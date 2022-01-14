import fastify, { RawReplyDefaultExpression, RawRequestDefaultExpression } from 'fastify';
import { expectError, expectType } from 'tsd';
import fastifyHttpProxy from '../..';

const app = fastify();

app.register(fastifyHttpProxy, {
  upstream: 'http://origin.asd'
});

app.register(fastifyHttpProxy, {
  upstream: 'http://origin.asd',
  prefix: '/auth',
  rewritePrefix: '/u',
  http2: false,
  config: { key: 1 },
  replyOptions: { contentType: 'application/json' },
  httpMethods: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS'],
  preHandler: (request, reply) => {
    expectType<RawRequestDefaultExpression>(request.raw);
    expectType<RawReplyDefaultExpression>(reply.raw);
  },
  beforeHandler: (request, reply) => {
    expectType<RawRequestDefaultExpression>(request.raw);
    expectType<RawReplyDefaultExpression>(reply.raw);
  },
  base: 'whatever',
  cacheURLs: 10,
  undici: {
    connections: 128,
    pipelining: 1,
    keepAliveTimeout: 60 * 1000,
    tls: {
      rejectUnauthorized: false
    }
  },
  http: {
    agentOptions: {
      keepAliveMsecs: 10 * 60 * 1000
    },
    requestOptions: {
      timeout: 20000
    }
  },
  keepAliveMsecs: 60000,
  maxFreeSockets: 10,
  maxSockets: 20,
  rejectUnauthorized: true,
  sessionTimeout: 30000,
  constraints: { version: '1.0.2' }
});

expectError(
  app.register(fastifyHttpProxy, {
    thisOptionDoesNotExist: 'triggers a typescript error'
  })
);
