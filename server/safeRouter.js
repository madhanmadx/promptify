import { Router } from 'express';

/**
 * express.Router() with automatic promise rejection handling.
 *
 * Express 4 does not catch errors thrown inside `async` handlers — an
 * unhandled rejection kills the whole process. Wrapping every handler once,
 * here, keeps a single bad request from taking the event offline.
 */
export function safeRouter(...args) {
  const router = Router(...args);

  const guard = (handler) => {
    if (typeof handler !== 'function') return handler;
    if (handler.length === 4) return handler; // error middleware, leave alone
    if (handler.markedSafe) return handler;

    const wrapped = (req, res, next) => {
      try {
        const out = handler(req, res, next);
        return out && typeof out.catch === 'function' ? out.catch(next) : out;
      } catch (err) {
        return next(err);
      }
    };
    wrapped.markedSafe = true;
    return wrapped;
  };

  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
    const original = router[method].bind(router);
    router[method] = (path, ...handlers) => original(path, ...handlers.map(guard));
  }

  const originalUse = router.use.bind(router);
  router.use = (...args) => originalUse(...args.map(guard));

  return router;
}
