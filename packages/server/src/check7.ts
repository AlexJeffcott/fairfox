// Step 0c, check 7: a push to the page on the iPhone's home screen while the
// app is closed. A measurement only: what the phone does is written down, and
// the result stops nothing (A3). The server serves the page and keeps the
// subscriptions; it does not send. scripts/check-7-push.ts sends from the
// laptop, which holds the private key, so no secret is set on Fly. The page
// has no sign-in, so the last deploy of step 0c removes this file,
// check7-page.ts and the setting FAIRFOX_CHECK7_PUSH_KEY (L2).
//
//   GET  /check/7                  redirects to /check/7/app
//   GET  /check/7/app              the page
//   GET  /check/7/sw.js            the service worker, scope /check/7/
//   GET  /check/7/manifest.webmanifest
//   POST /check/7/subscription     the page gives its push subscription
//   GET  /check/7/subscription     the subscriptions, newest first
//
// A subscription alone does not let anyone push: the push service takes only
// pushes signed with the private key whose public half the page subscribed with.
import { Elysia, t } from 'elysia';
import { CHECK7_MANIFEST, CHECK7_WORKER, check7Page } from './check7-page.ts';

/** Kept in memory only; a deploy empties it, and the page subscribes again. */
const SUBSCRIPTIONS = 10;

type Subscription = { device: string; at: string; subscription: { endpoint: string; keys: { p256dh: string; auth: string } } };

export function check7Routes(pushKey: string) {
  const subscriptions: Subscription[] = [];
  const page = check7Page(pushKey);
  return new Elysia()
    .get('/check/7', ({ redirect }) => redirect('/check/7/app', 302))
    .get('/check/7/app', () => new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    .get(
      '/check/7/sw.js',
      () => new Response(CHECK7_WORKER, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' } }),
    )
    .get('/check/7/manifest.webmanifest', () => new Response(JSON.stringify(CHECK7_MANIFEST), { headers: { 'content-type': 'application/manifest+json' } }))
    .post(
      '/check/7/subscription',
      ({ body }) => {
        subscriptions.unshift({ device: body.device, at: new Date().toISOString(), subscription: body.subscription });
        subscriptions.splice(SUBSCRIPTIONS);
        return new Response(null, { status: 204 });
      },
      {
        body: t.Object({
          device: t.String({ maxLength: 32 }),
          subscription: t.Object({
            endpoint: t.String({ maxLength: 1000, pattern: '^https://' }),
            expirationTime: t.Optional(t.Nullable(t.Number())),
            keys: t.Object({ p256dh: t.String({ maxLength: 200 }), auth: t.String({ maxLength: 100 }) }),
          }),
        }),
      },
    )
    .get('/check/7/subscription', () => subscriptions);
}
