/// <reference types="node" />

import {
  FastifyRequest,
  FastifyPlugin,
  FastifyError,
  FastifyReply
} from "fastify";

export interface FastifyHttpProxyOptions {
  upstream: string;
  prefix?: string;
  rewritePrefix?: string;
  http2?: boolean;
  proxyPayloads?: boolean;
  preHandler?: (
    request: FastifyRequest,
    reply: FastifyReply,
    next: (err?: FastifyError | undefined) => void
  ) => void;
  beforeHandler?: (
    request: FastifyRequest,
    reply: FastifyReply,
    next: (err?: FastifyError | undefined) => void
  ) => void;
  config?: Object;
  replyOptions?: Object;
}

declare const fastifyHttpProxy: FastifyPlugin<FastifyHttpProxyOptions>;
export default fastifyHttpProxy;
