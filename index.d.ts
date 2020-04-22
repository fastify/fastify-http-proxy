/// <reference types="node" />

import {
  FastifyRequest,
  RawServerBase,
  FastifyPlugin,
  FastifyError,
  FastifyReply
} from "fastify";

export interface FastifyHttpProxyOptions {
  upstream: string;
  prefix?: string;
  rewritePrefix?: string;
  http2?: boolean;
  preHandler?: (
    request: FastifyRequest<RawServerBase>,
    reply: FastifyReply<RawServerBase>,
    next: (err?: FastifyError | undefined) => void
  ) => void;
  beforeHandler?: (
    request: FastifyRequest<RawServerBase>,
    reply: FastifyReply<RawServerBase>,
    next: (err?: FastifyError | undefined) => void
  ) => void;
  config?: Object;
  replyOptions?: Object;
}

declare const fastifyHttpProxy: FastifyPlugin<FastifyHttpProxyOptions>;
export default fastifyHttpProxy;
