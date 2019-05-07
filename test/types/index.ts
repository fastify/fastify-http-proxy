import * as fastify from "fastify";
import * as fastifyHttpProxy from "../..";

/* eslint-disable */
import { IncomingMessage, ServerResponse } from "http";
import { Http2ServerRequest, Http2ServerResponse } from "http2";

type HttpRequest = IncomingMessage | Http2ServerRequest;
type HttpResponse = ServerResponse | Http2ServerResponse;
/* eslint-enable */

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
  preHandler: (
    request: fastify.FastifyRequest<
      HttpRequest,
      fastify.DefaultQuery,
      fastify.DefaultParams,
      fastify.DefaultHeaders,
      any
    >,
    reply: fastify.FastifyReply<HttpResponse>
  ) => {
    console.log(request.query);
    console.log(reply.context.config);
  },
  beforeHandler: (
    request: fastify.FastifyRequest<
      HttpRequest,
      fastify.DefaultQuery,
      fastify.DefaultParams,
      fastify.DefaultHeaders,
      any
    >,
    reply: fastify.FastifyReply<HttpResponse>
  ) => {
    console.log(request.query);
    console.log(reply.context.config);
  }
});
