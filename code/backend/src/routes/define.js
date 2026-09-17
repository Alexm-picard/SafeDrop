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

import { Router } from 'express';
import { authorize, GATE, markPublic, readDeclaredPermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { ForbiddenError } from '../utils/errors.js';

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
/** Tenant identifiers never travel in the URL (SR-2). */
const TENANT_PARAM = /:(orgId|organizationId|org)(?=[/.?-]|$)/i;

/** A controller only runs after an explicit authorization decision for this request. */
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
 * @param {import('express').Router} router
 * @param {{ method: string, path: string, permission?: string, public?: boolean, schemas?: { params?: any, query?: any, body?: any } }} spec
 * @param {import('express').RequestHandler} handler controller function
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

/** Creates a Router with SafeDrop defaults. */
export function createRouter() {
  return Router({ caseSensitive: false, strict: false, mergeParams: true });
}

/**
 * Mounts a router and records the mount path so listRoutes() can rebuild full paths.
 * Always use this instead of app.use(path, router).
 * @param {import('express').Application | import('express').Router} parent
 * @param {string} path
 * @param {import('express').Router} router
 */
export function mount(parent, path, router) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new TypeError(`mount: path must start with "/" (got ${path})`);
  }
  router.mountPath = path;
  parent.use(path, router);
  return router;
}

const joinPath = (prefix, path) => {
  const joined = `${prefix}${path}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
};

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
 * Walk the live Express router stack and describe everything registered:
 *  - routes (method, full path, declared permission / public flag, regexp flag)
 *  - plain middleware layers found INSIDE a mounted router (reported as method 'USE'): resource
 *    routers may only contain routes, so these are always offenders
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
 * Boot-time proof of deny-by-default (SDD §6.4): every /api route must declare a permission or be
 * one of the explicit public routes; no RegExp paths; no plain middleware inside resource routers;
 * no routers mounted without mount().
 * @param {import('express').Application} app
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
