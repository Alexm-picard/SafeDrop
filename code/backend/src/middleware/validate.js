// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Zod validation of params/query/body; every location strict by construction; operators and dotted keys rejected (SR-6, OD-6)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { z } from 'zod';
import { ValidationError } from '../utils/errors.js';

const MAX_DEPTH = 16;

/**
 * Defence in depth against NoSQL operator injection (SR-6): no key anywhere in client input may
 * start with `$` or contain `.`, regardless of what the route schema allows.
 * @param {unknown} value
 * @param {string} location
 */
export function assertNoMongoOperators(value, location = 'body', path = [], depth = 0) {
  if (depth > MAX_DEPTH) {
    throw new ValidationError('Request nesting too deep', [
      { location, path: path.join('.'), message: 'too deep' },
    ]);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoMongoOperators(item, location, [...path, String(index)], depth + 1),
    );
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.includes('.')) {
        throw new ValidationError('Invalid request', [
          {
            location,
            path: [...path, key].join('.'),
            message: 'keys may not start with "$" or contain "."',
          },
        ]);
      }
      assertNoMongoOperators(value[key], location, [...path, key], depth + 1);
    }
  }
}

const isStrictObject = (schema) => schema?.def?.catchall?.def?.type === 'never';

/**
 * Boot-time walk: every object schema nested anywhere inside a route schema must be strict
 * (`z.strictObject()` / `.strict()`), otherwise unknown keys would be silently stripped.
 */
function assertNestedStrict(schema, location, path) {
  const def = schema?.def;
  if (!def) {
    return;
  }
  switch (def.type) {
    case 'object':
      if (path.length > 0 && !isStrictObject(schema)) {
        throw new TypeError(
          `validate(): nested object at ${location}.${path.join('.')} must be z.strictObject() so unknown keys are rejected`,
        );
      }
      for (const [key, child] of Object.entries(def.shape ?? {})) {
        assertNestedStrict(child, location, [...path, key]);
      }
      return;
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'nonoptional':
    case 'readonly':
    case 'catch':
      assertNestedStrict(def.innerType, location, path);
      return;
    case 'array':
      assertNestedStrict(def.element, location, [...path, '[]']);
      return;
    case 'pipe':
      assertNestedStrict(def.in, location, path);
      assertNestedStrict(def.out, location, path);
      return;
    case 'union':
      (def.options ?? []).forEach((option) => assertNestedStrict(option, location, path));
      return;
    case 'record':
    case 'map':
      assertNestedStrict(def.valueType, location, [...path, '*']);
      return;
    case 'tuple':
      (def.items ?? []).forEach((item, i) =>
        assertNestedStrict(item, location, [...path, String(i)]),
      );
      return;
    default:
      return;
  }
}

/**
 * Make a route schema strict by construction. Accepts an object schema, optionally wrapped in
 * `.optional()` / `.nullable()`, or (for bodies) an array schema. Anything else is a boot error.
 */
function strictify(schema, location) {
  const type = schema?.def?.type;
  if (type === 'object') {
    assertNestedStrict(schema, location, []);
    return schema.strict();
  }
  if (type === 'optional') {
    return strictify(schema.unwrap(), location).optional();
  }
  if (type === 'nullable') {
    return strictify(schema.unwrap(), location).nullable();
  }
  if (type === 'array' && location === 'body') {
    assertNestedStrict(schema, location, []);
    return schema;
  }
  throw new TypeError(
    `validate(): ${location} schema must be a Zod object (optionally .optional()/.nullable())${
      location === 'body' ? ' or array' : ''
    }; got "${type ?? typeof schema}"`,
  );
}

/** Routes that declare nothing for a location accept nothing there. */
const EMPTY = z.strictObject({});

function parse(schema, value, location) {
  assertNoMongoOperators(value, location);
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      'Invalid request',
      result.error.issues.map((issue) => ({
        location,
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/**
 * Chain step 8. `validate({ params, query, body })` with Zod schemas. Every location is validated on
 * every route: a missing schema means "nothing is accepted here". Parsed (coerced, defaulted) values
 * replace the raw ones so controllers only ever see validated data.
 * @param {{ params?: z.ZodTypeAny, query?: z.ZodTypeAny, body?: z.ZodTypeAny }} schemas
 */
export function validate(schemas = {}) {
  const compiled = {
    params: strictify(schemas.params ?? EMPTY, 'params'),
    query: strictify(schemas.query ?? EMPTY, 'query'),
    body: schemas.body ? strictify(schemas.body, 'body') : EMPTY.optional(),
  };
  const bodyAllowsArray = compiled.body?.def?.type === 'array';

  return function validate(req, _res, next) {
    try {
      req.params = parse(compiled.params, req.params ?? {}, 'params');
      Object.defineProperty(req, 'query', {
        value: parse(compiled.query, req.query ?? {}, 'query'),
        writable: true,
        configurable: true,
        enumerable: true,
      });
      if (Array.isArray(req.body) && !bodyAllowsArray) {
        throw new ValidationError('Invalid request', [
          { location: 'body', path: '', message: 'expected an object' },
        ]);
      }
      req.body = parse(compiled.body, req.body ?? (bodyAllowsArray ? [] : {}), 'body');
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
