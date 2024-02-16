import fastify, {
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
} from 'fastify';
import { expectError, expectType } from 'tsd';
import fastifyHttpProxy from '..';

const app = fastify();

app.register(fastifyHttpProxy, {
  upstream: 'http://origin.asd',
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
  preValidation: (request, reply) => {
    expectType<RawRequestDefaultExpression>(request.raw);
    expectType<RawReplyDefaultExpression>(reply.raw);
  },
  base: 'whatever',
  cacheURLs: 10,
  undici: {
    connections: 128,
    pipelining: 1,
    keepAliveTimeout: 60 * 1000,
    connect: {
      rejectUnauthorized: false,
    },
  },
  http: {
    agentOptions: {
      keepAliveMsecs: 10 * 60 * 1000,
    },
    requestOptions: {
      timeout: 20000,
    },
  },
  constraints: { version: '1.0.2' },
  websocket: true,
  wsUpstream: 'ws://origin.asd/connection',
  internalRewriteLocationHeader: true,
});

expectError(
  app.register(fastifyHttpProxy, {
    thisOptionDoesNotExist: 'triggers a typescript error',
  })
);

expectError(
  app.register(fastifyHttpProxy, {
    upstream: 'http://origin.asd',
    wsUpstream: 'ws://origin.asd',
  })
);

expectError(
  app.register(fastifyHttpProxy, {
    upstream: 'http://origin.asd',
    websocket: false,
    wsUpstream: 'asdf',
  })
);

expectError(
  app.register(fastifyHttpProxy, {
    upstream: 'http://origin.asd',
    websocket: false,
    internalRewriteLocationHeader: 'NON_BOOLEAN_VALUE'
  })
);
