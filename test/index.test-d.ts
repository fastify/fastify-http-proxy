import fastify, { RawReplyDefaultExpression, RawRequestDefaultExpression } from "fastify";
import fastifyHttpProxy from "..";
import { expectType } from "tsd";

const app = fastify();

app.register(fastifyHttpProxy, {
  upstream: "http://origin.asd"
});

app.register(fastifyHttpProxy, {
  upstream: "http://origin.asd",
  prefix: "/auth",
  rewritePrefix: "/u",
  http2: false,
  config: { key: 1 },
  replyOptions: { contentType: "application/json" },
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
  undici: { dummy: true }, // undici has no TS declarations yet
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
  sessionTimeout: 30000
});
