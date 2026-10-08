import type { RequestHandler } from 'express';

export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    void Promise.resolve()
      .then(() => handler(request, response, next))
      .catch(next);
  };
}
