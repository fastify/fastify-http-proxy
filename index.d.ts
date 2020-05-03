/// <reference types="node" />
import {
  FastifyRequest,
  Plugin,
  DefaultQuery,
  DefaultParams,
  DefaultHeaders,
  FastifyError,
  FastifyReply
} from "fastify";
import { Server, IncomingMessage, ServerResponse } from "http";
import { Http2ServerRequest, Http2ServerResponse } from "http2";

type HttpRequest = IncomingMessage | Http2ServerRequest;
type HttpResponse = ServerResponse | Http2ServerResponse;

declare const fastifyHttpProxy: Plugin<
  Server,
  IncomingMessage,
  ServerResponse,
  {
    upstream: string;
    prefix?: string;
    rewritePrefix?: string;
    http2?: boolean;
    proxyPayloads?: boolean;
    preHandler?: (
      request: FastifyRequest<
        HttpRequest,
        DefaultQuery,
        DefaultParams,
        DefaultHeaders,
        any
      >,
      reply: FastifyReply<HttpResponse>,
      next: (err?: FastifyError | undefined) => void
    ) => void;
    beforeHandler?: (
      request: FastifyRequest<
        HttpRequest,
        DefaultQuery,
        DefaultParams,
        DefaultHeaders,
        any
      >,
      reply: FastifyReply<HttpResponse>,
      next: (err?: FastifyError | undefined) => void
    ) => void;
    config?: Object;
    replyOptions?: Object;
  }
>;

export = fastifyHttpProxy;
