import type { RequestHandler } from 'express';
import type { ParsedQs } from 'qs';
import type { ParamsDictionary } from 'express-serve-static-core';
import { z } from 'zod';

export type ValidationSource = 'body' | 'query' | 'params';

export interface ValidatedRequestLocals {
  validated?: Partial<Record<ValidationSource, unknown>>;
}

export function validate<T extends z.ZodObject>(
  schema: T,
  source: ValidationSource,
): RequestHandler<
  ParamsDictionary,
  unknown,
  unknown,
  ParsedQs,
  ValidatedRequestLocals
> {
  const strictSchema = schema.strict();

  return (request, response, next) => {
    const result = strictSchema.safeParse(request[source]);

    if (!result.success) {
      next(result.error);
      return;
    }

    response.locals.validated = {
      ...response.locals.validated,
      [source]: result.data,
    };
    next();
  };
}
