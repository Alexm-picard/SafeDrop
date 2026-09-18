// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: validate middleware unit tests: strict-by-construction schemas, unknown keys, operator-shaped values, coercion (SR-6)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Unit tests for the validation middleware (SR-6).
 *
 * Covers the two rules the middleware exists to enforce. *Routes accept only what they declare*:
 * unknown keys are a 400 — including inside optional and nullable schemas — a location with no schema
 * accepts nothing, and a nested non-strict object is refused at boot rather than at request time.
 * *Nothing containing a Mongo operator gets through*: `{"$ne": null}` is rejected even where a string
 * is expected, and an operator key nested anywhere fails before the schema runs at all.
 *
 * The Express 5 query getter is also pinned here: the parsed value must actually shadow it, or the
 * unvalidated query would survive.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assertNoMongoOperators, validate } from '../../../src/middleware/validate.js';
import { ValidationError } from '../../../src/utils/errors.js';

const run = (schemas, req) =>
  new Promise((resolve) => {
    validate(schemas)(req, {}, (err) => resolve(err));
  });

describe('validate', () => {
  const body = z.object({ email: z.string().email(), age: z.coerce.number().int().optional() });

  it('replaces req.body with the parsed, coerced value', async () => {
    const req = { body: { email: 'a@b.co', age: '42' } };
    expect(await run({ body }, req)).toBeUndefined();
    expect(req.body).toEqual({ email: 'a@b.co', age: 42 });
  });

  it('rejects unknown keys with 400 and names the key', async () => {
    const err = await run({ body }, { body: { email: 'a@b.co', extra: true } });
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.status).toBe(400);
    expect(err.details[0].message).toMatch(/extra/);
  });

  it('rejects unknown keys even when the body schema is optional or nullable', async () => {
    expect(await run({ body: z.object({}).optional() }, { body: { evil: 1 } })).toBeInstanceOf(
      ValidationError,
    );
    expect(
      await run(
        { body: z.object({ note: z.string().default('') }).nullable() },
        { body: { note: 'x', decidedBy: 'me' } },
      ),
    ).toBeInstanceOf(ValidationError);
    expect(await run({ body: z.object({}).optional() }, {})).toBeUndefined();
  });

  it('refuses at boot a body schema with a nested non-strict object, and accepts z.strictObject', () => {
    expect(() => validate({ body: z.object({ meta: z.object({ a: z.string() }) }) })).toThrow(
      /strictObject/,
    );
    expect(() =>
      validate({ body: z.object({ meta: z.strictObject({ a: z.string() }).optional() }) }),
    ).not.toThrow();
    expect(() =>
      validate({ body: z.object({ items: z.array(z.object({ a: z.string() })) }) }),
    ).toThrow(/strictObject/);
    expect(() => validate({ query: z.string() })).toThrow(/Zod object/);
  });

  it('rejects {"$ne": null} shaped values even where a string is expected', async () => {
    const err = await run({ body }, { body: { email: { $ne: null } } });
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.details.some((d) => d.path.includes('email'))).toBe(true);
  });

  it('rejects operator keys nested anywhere, before the schema even runs', async () => {
    const loose = z.object({ meta: z.record(z.string(), z.any()) });
    const err = await run({ body: loose }, { body: { meta: { deep: { $gt: 'this.x' } } } });
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.details[0].path).toBe('meta.deep.$gt');
    const dotted = await run({ body: loose }, { body: { meta: { 'a.b': 1 } } });
    expect(dotted).toBeInstanceOf(ValidationError);
  });

  it('validates params and query and shadows the Express 5 query getter', async () => {
    const req = { params: { id: 'abc' }, body: undefined };
    Object.defineProperty(req, 'query', { get: () => ({ page: '3' }), configurable: true });
    const err = await run(
      { params: z.object({ id: z.string().min(3) }), query: z.object({ page: z.coerce.number() }) },
      req,
    );
    expect(err).toBeUndefined();
    expect(req.query).toEqual({ page: 3 });
    expect(req.params).toEqual({ id: 'abc' });
  });

  it('accepts nothing for a location without a schema', async () => {
    expect(await run({}, { params: {}, query: {}, body: undefined })).toBeUndefined();
    expect(await run({}, { query: { orgId: 'x' } })).toBeInstanceOf(ValidationError);
    expect(await run({}, { query: { 'a.b': '1' } })).toBeInstanceOf(ValidationError);
    expect(await run({}, { params: { orgId: 'x' } })).toBeInstanceOf(ValidationError);
    expect(await run({}, { body: { anything: 1 } })).toBeInstanceOf(ValidationError);
  });

  it('rejects an array body unless the schema is an array', async () => {
    expect(await run({}, { body: [{ orgId: 'z' }] })).toBeInstanceOf(ValidationError);
    const req = { body: [{ a: 'x' }] };
    expect(await run({ body: z.array(z.strictObject({ a: z.string() })) }, req)).toBeUndefined();
    expect(req.body).toEqual([{ a: 'x' }]);
    expect(
      await run({ body: z.array(z.strictObject({ a: z.string() })) }, { body: [{ a: 'x', b: 1 }] }),
    ).toBeInstanceOf(ValidationError);
  });

  it('treats a missing body as {} when the schema allows it', async () => {
    const strictReq = {};
    const err = await run({ body: z.object({ name: z.string() }) }, strictReq);
    expect(err).toBeInstanceOf(ValidationError);
    const defaults = {};
    expect(
      await run({ body: z.object({ note: z.string().default('') }) }, defaults),
    ).toBeUndefined();
    expect(defaults.body).toEqual({ note: '' });
  });
});

describe('assertNoMongoOperators', () => {
  it('accepts plain data including arrays and nulls', () => {
    expect(() => assertNoMongoOperators({ a: [1, { b: null }], c: 'x' })).not.toThrow();
  });
  it('rejects excessively deep nesting', () => {
    let deep = {};
    for (let i = 0; i < 40; i += 1) {
      deep = { k: deep };
    }
    expect(() => assertNoMongoOperators(deep)).toThrow(ValidationError);
  });
});
