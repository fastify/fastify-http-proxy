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
  replyOptions: { opt: "a" },
  preHandler: (request, reply) => {
    expectType<RawRequestDefaultExpression>(request.raw);
    expectType<RawReplyDefaultExpression>(reply.raw);
  },
  beforeHandler: (request, reply) => {
    expectType<RawRequestDefaultExpression>(request.raw);
    expectType<RawReplyDefaultExpression>(reply.raw);
  }
});
