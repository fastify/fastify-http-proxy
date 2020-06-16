import fastify from "fastify";
import fastifyHttpProxy from "..";
import { expectType } from "tsd";
import { IncomingMessage, ServerResponse } from "http";
import { Http2ServerRequest, Http2ServerResponse } from "http2";

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
    expectType<IncomingMessage | Http2ServerRequest>(request.raw);
    expectType<ServerResponse | Http2ServerResponse>(reply.raw);
  },
  beforeHandler: (request, reply) => {
    expectType<IncomingMessage | Http2ServerRequest>(request.raw);
    expectType<ServerResponse | Http2ServerResponse>(reply.raw);
  }
});
