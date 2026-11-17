/**
 * Job Search runs as the person's own Node service only (`serve --install`).
 * Its rules commit read-then-write transactions with the core's
 * transaction() (src/lib/db.ts), which Cloudflare D1 can't run yet, so the
 * app declares `platforms: ["node"]` and `deploy cloudflare` refuses it. The
 * kit's build still compiles this entry, so it answers plainly instead. See
 * docs/parity.md, "Running, hosting and data".
 */
export default {
  fetch() {
    return new Response("Job Search runs on your own computer as a service, not on Cloudflare. See docs/parity.md in its source.", { status: 501, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
