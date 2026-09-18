// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: Zod validation of params/query/body; every location strict by construction; operators and dotted keys rejected (SR-6, OD-6)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Chain step 8: validate and replace every piece of client input with Zod.
 *
 * Two principles run through this file.
 *
 * **Routes accept only what they declare.** Every location — params, query, body — is validated on
 * every route, and a location with no schema gets an empty strict object, meaning any key a client
 * sends there is a 400. Schemas are made strict by construction, including nested objects, so a field
 * nobody declared can never be silently stripped and then silently ignored.
 *
 * **Nothing containing a Mongo operator gets through.** Independently of what a schema allows, no key
 * anywhere in client input may begin with `$` or contain `.` (SR-6). That is defence in depth: the
 * repositories are already careful, `sanitizeFilter` is on globally, and this is a third layer.
 *
 * Parsed values (coerced, defaulted) replace the raw ones, so a controller only ever sees data that
 * has been through a schema.
 *
 * Exports: `validate(schemas)` — the middleware factory; `assertNoMongoOperators(value, location)` —
 * the operator-injection guard, exported for direct testing.
 */
import { z } from 'zod';
import { ValidationError } from '../utils/errors.js';

const MAX_DEPTH = 16;

/**
 * Walk a value and reject any key that could become a MongoDB operator or a path traversal.
 *
 * Keys starting with `$` are operators (`$ne`, `$gt`, `$where`); keys containing `.` reach into
 * nested document paths. Either one, reaching a query builder from client input, turns a filter
 * into an attacker-controlled query — the classic `{ password: { $ne: null } }` login bypass.
 *
 * Recursion is bounded by `MAX_DEPTH`, so a deeply nested body is rejected rather than being allowed
 * to exhaust the stack.
 * @param {unknown} value the client-supplied value to inspect
 * @param {string} [location] 'params' | 'query' | 'body', for the error message
 * @param {string[]} [path] internal: the key path walked so far
 * @param {number} [depth] internal: current recursion depth
 * @throws {ValidationError} (400) on a forbidden key or excessive nesting
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

/**
 * Does this Zod object schema reject unknown keys? True when its catchall is `never`, which is how
 * Zod 4 represents `.strict()`.
 * @param {unknown} schema
 * @returns {boolean}
 */
const isStrictObject = (schema) => schema?.def?.catchall?.def?.type === 'never';

/**
 * Boot-time walk asserting that every *nested* object schema is strict.
 *
 * `.strict()` applies only to the object it is called on, so a lax nested object would silently drop
 * unknown keys — leaving a route that appears to validate but accepts anything inside a sub-object.
 * The traversal unwraps the Zod wrappers (optional, nullable, default, pipe, union, array, record,
 * tuple) so the check cannot be evaded by wrapping. The top-level object is exempt because
 * `strictify()` makes it strict itself.
 * @param {unknown} schema
 * @param {string} location 'params' | 'query' | 'body'
 * @param {string[]} path key path, for the error message
 * @throws {TypeError} at boot when a nested object is not `z.strictObject()`
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
 * Make a route schema strict, or refuse it at boot.
 *
 * Accepts an object schema, optionally wrapped in `.optional()`/`.nullable()`, and — for bodies only
 * — an array schema. Anything else is a programming error and throws while routes are being built,
 * so the shape of every route's input is known to be checkable before the server accepts traffic.
 * @param {unknown} schema
 * @param {string} location 'params' | 'query' | 'body'
 * @returns {import('zod').ZodTypeAny} the strict equivalent
 * @throws {TypeError} at boot for an unsupported schema type
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

/**
 * Run the operator guard, then the schema, and return the parsed value.
 *
 * Every Zod issue is reported at once, flattened to `{ location, path, message }`, so a client
 * fixing a form learns about all its problems in one response rather than one per round trip.
 * @param {import('zod').ZodTypeAny} schema
 * @param {unknown} value
 * @param {string} location 'params' | 'query' | 'body'
 * @returns {unknown} the parsed, coerced value
 * @throws {ValidationError} (400) with one entry per failed field
 */
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
 * Build the validation middleware for one route.
 *
 * Schemas are compiled once at registration, so the strictness checks run at boot and the per-request
 * cost is just parsing. An undeclared location becomes `EMPTY`, which accepts nothing — that is what
 * makes "routes accept only what they declare" true by default rather than by vigilance.
 *
 * `req.query` is replaced through `Object.defineProperty` because Express 5 serves it from a
 * prototype getter and a plain assignment would be discarded, leaving the unvalidated query in
 * place. An array body is refused unless the body schema is itself an array, so a handler expecting
 * an object never receives one.
 * @param {{ params?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, body?: import('zod').ZodTypeAny }} [schemas]
 * @returns {import('express').RequestHandler}
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
