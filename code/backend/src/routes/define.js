// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: defineRoute()/mount() so every route composes authorize → validate → controller; listRoutes() walks the Express stack incl. rogue middleware and sub-apps (SDD §6.4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
//
// The ONLY way routes are registered in this codebase. A route without a permission (or an explicit
// `public: true`) throws here, at boot, before a single request is served. listRoutes() reads the
// real Express router stack, so the security test proves the invariant against what Express will
// actually run rather than against a registry that could drift. Runtime enforcement for anything
// that slips past registration lives in middleware/authorize.js denyByDefault().

/**
 * Route registration: the only way a route enters this codebase, and the boot-time proof that every
 * one of them declares who may call it.
 *
 * `defineRoute()` refuses at boot — before a single request is served — a route that declares no
 * permission, that carries a tenant id in its URL, or that has path parameters without a schema for
 * them. `assertRoutesDeclarePermission()` then walks the *live Express router stack* and re-checks the
 * whole table. Reading the real stack rather than a registry we maintained ourselves is deliberate: a
 * registry can drift from what Express will actually run, and it is what Express runs that decides who
 * gets in.
 *
 * The runtime backstop for anything that slips past registration is `denyByDefault` in
 * middleware/authorize.js.
 *
 * Exports:
 *  - `defineRoute(router, spec, handler)` — register one route with its permission, schemas and controller.
 *  - `createRouter()` — a Router with SafeDrop's defaults.
 *  - `mount(parent, path, router)` — mount a router and record the mount path.
 *  - `listRoutes(app)` — describe everything registered, from the live stack.
 *  - `assertRoutesDeclarePermission(app)` — throw unless the whole table is sound.
 */
import { Router } from 'express';
import { authorize, GATE, markPublic, readDeclaredPermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { ForbiddenError } from '../utils/errors.js';

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
/** Tenant identifiers never travel in the URL (SR-2). */
const TENANT_PARAM = /:(orgId|organizationId|org)(?=[/.?-]|$)/i;

/**
 * Wrap a controller so it cannot run without an authorization decision for this request.
 *
 * Belt and braces alongside `denyByDefault`: that one catches an unauthorized *response*, this one
 * stops the controller from executing at all — so a handler with a side effect cannot do its work
 * and only then be refused.
 * @param {import('express').RequestHandler} handler the controller
 * @returns {import('express').RequestHandler}
 */
function guarded(handler) {
  return async function controller(req, res, next) {
    const gate = res.locals.permissionGate;
    if (gate !== GATE.GRANTED && gate !== GATE.PUBLIC) {
      return next(new ForbiddenError('No authorization decision was made for this route'));
    }
    return handler(req, res, next);
  };
}

/**
 * Register one route, with its authorization, validation and controller in a fixed order.
 *
 * Every rule here fails at boot rather than at request time, which is the whole design: a
 * misconfigured route should stop a deploy, not quietly serve traffic. The rules are
 *
 *  - the method must be one of the five supported verbs, and the path a string starting with `/`;
 *  - the path may not contain a tenant parameter (`:orgId` and friends) — the tenant comes from the
 *    token and nowhere else (SR-2);
 *  - a path with parameters must declare `schemas.params`, so an id is validated before use;
 *  - a route is either `public: true` or declares a permission, never both and never neither.
 *
 * The chain it builds is authorize → validate → guarded(controller): authorization before validation
 * so an unauthorized caller cannot use error messages to probe the schema.
 * @param {import('express').Router} router
 * @param {{ method: string, path: string, permission?: string, public?: boolean, schemas?: { params?: any, query?: any, body?: any } }} spec
 * @param {import('express').RequestHandler} handler controller function
 * @returns {import('express').Router} the router, for chaining
 * @throws {TypeError|Error} at boot when the spec breaks any rule above
 */
export function defineRoute(router, spec, handler) {
  const { method, path, permission, public: isPublic = false, schemas } = spec ?? {};
  const verb = String(method ?? '').toLowerCase();
  const label = `${verb.toUpperCase()} ${path}`;
  if (!METHODS.has(verb)) {
    throw new TypeError(`defineRoute: unsupported method "${method}" for ${path}`);
  }
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new TypeError(
      `defineRoute: path must be a string starting with "/" (got ${String(path)})`,
    );
  }
  if (TENANT_PARAM.test(path)) {
    throw new Error(
      `defineRoute: ${label} carries a tenant id in the URL; orgId comes only from the token (SR-2)`,
    );
  }
  if (path.includes(':') && !schemas?.params) {
    throw new Error(`defineRoute: ${label} has path parameters and must declare schemas.params`);
  }
  if (typeof handler !== 'function') {
    throw new TypeError(`defineRoute: ${label} needs a controller function`);
  }
  if (isPublic && permission) {
    throw new Error(`defineRoute: ${label} is public and cannot also declare a permission`);
  }
  if (!isPublic && !permission) {
    throw new Error(
      `defineRoute: ${label} must declare a permission (SDD §6.4 deny-by-default) or public: true`,
    );
  }
  const chain = [
    isPublic ? markPublic() : authorize(permission),
    validate(schemas ?? {}),
    guarded(handler),
  ];
  router[verb](path, ...chain);
  return router;
}

/**
 * Create a Router with SafeDrop's defaults: case-insensitive, non-strict about trailing slashes,
 * and inheriting parent params.
 *
 * Centralised so that `/api/Assets` and `/api/assets/` cannot resolve differently from `/api/assets`
 * — a difference that would otherwise give an attacker two spellings to test a guard against.
 * @returns {import('express').Router}
 */
export function createRouter() {
  return Router({ caseSensitive: false, strict: false, mergeParams: true });
}

/**
 * Mount a router under a path and record that path on the router.
 *
 * Always use this instead of `parent.use(path, router)`. Express does not expose a layer's mount
 * path in a usable form, so `listRoutes()` would report the children as `<unmounted-router>` and the
 * boot assertion would reject them — which is exactly how a bypass of this function is caught.
 * @param {import('express').Application | import('express').Router} parent
 * @param {string} path mount path, starting with `/`
 * @param {import('express').Router} router
 * @returns {import('express').Router} the mounted router
 */
export function mount(parent, path, router) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new TypeError(`mount: path must start with "/" (got ${path})`);
  }
  router.mountPath = path;
  parent.use(path, router);
  return router;
}

/**
 * Join a mount prefix and a route path into one clean path: collapsing repeated slashes and dropping
 * a trailing one (except at the root).
 * @param {string} prefix
 * @param {string} path
 * @returns {string}
 */
const joinPath = (prefix, path) => {
  const joined = `${prefix}${path}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
};

/**
 * Get the layer stack of a mounted handle, whether it is a `Router` or a full `express()` sub-app.
 *
 * The two store their stack in different places, and a sub-app mounted without being recognised here
 * would hide every route inside it from the boot assertion.
 * @param {unknown} handle a layer's handle
 * @returns {unknown[]|null} the stack, or null when the handle is not a router
 */
const routerStackOf = (handle) => {
  if (!handle) {
    return null;
  }
  if (Array.isArray(handle.stack)) {
    return handle.stack; // express.Router()
  }
  if (handle.router && Array.isArray(handle.router.stack)) {
    return handle.router.stack; // a mounted express() sub-app
  }
  return null;
};

/**
 * Walk the live Express router stack and describe everything registered on it.
 *
 * Returns one entry per method/path pair with the permission or public flag read back from the
 * middleware that declared it. Two kinds of entry are findings rather than routes: a `regexp` flag
 * marks a path that is not a plain string (its reach is hard to reason about), and a `USE` entry
 * marks plain middleware found *inside* a mounted resource router — those routers may contain only
 * routes, so any middleware there is running outside the declare-a-permission discipline.
 * @param {import('express').Application} app
 * @returns {Array<{ method: string, path: string, permission: string|null, public: boolean, regexp?: boolean, middleware?: string }>}
 */
export function listRoutes(app) {
  const out = [];
  const walk = (stack, prefix, insideRouter) => {
    for (const layer of stack ?? []) {
      if (layer.route) {
        const { route } = layer;
        const methods = Object.keys(route.methods)
          .filter((m) => route.methods[m])
          .map((m) => m.toUpperCase());
        const declaring = route.stack.find(
          (l) => l.handle && (l.handle.permission || l.handle.isPublic),
        );
        const { permission, isPublic } = readDeclaredPermission(declaring?.handle);
        for (const path of [].concat(route.path)) {
          const regexp = typeof path !== 'string';
          for (const method of methods) {
            out.push({
              method,
              path: regexp ? `${prefix}<regexp:${String(path)}>` : joinPath(prefix, path),
              permission,
              public: isPublic,
              ...(regexp ? { regexp: true } : {}),
            });
          }
        }
        continue;
      }
      const childStack = routerStackOf(layer.handle);
      if (childStack) {
        const mountPath = layer.handle.mountPath;
        walk(childStack, joinPath(prefix, mountPath ?? '/<unmounted-router>'), true);
        continue;
      }
      if (insideRouter && typeof layer.handle === 'function') {
        out.push({
          method: 'USE',
          path: joinPath(prefix, '/*'),
          permission: null,
          public: false,
          middleware: layer.name || '<anonymous>',
        });
      }
    }
  };
  walk(app.router?.stack, '', false);
  return out;
}

/**
 * Prove deny-by-default across the whole route table, at boot (SDD §6.4).
 *
 * Called by `createApp()`, so the server refuses to start when anything is off: an `/api` route with
 * neither permission nor public flag, a RegExp path, plain middleware inside a resource router, or a
 * router mounted without `mount()`. The error names every offender at once, so one restart shows all
 * of them.
 *
 * A failure here is a security defect, not a style complaint — it means a route exists that nobody
 * said who may call.
 * @param {import('express').Application} app
 * @throws {Error} listing every offending route
 */
export function assertRoutesDeclarePermission(app) {
  const offenders = listRoutes(app).filter(
    (r) =>
      r.regexp ||
      r.method === 'USE' ||
      ((r.path.startsWith('/api') || r.path.includes('<unmounted-router>')) &&
        !r.permission &&
        !r.public),
  );
  if (offenders.length > 0) {
    const list = offenders
      .map((r) => `  ${r.method} ${r.path}${r.middleware ? ` (${r.middleware})` : ''}`)
      .join('\n');
    throw new Error(
      `Routes without a declared permission (use defineRoute/mount from routes/define.js; resource routers may only contain routes):\n${list}`,
    );
  }
}
