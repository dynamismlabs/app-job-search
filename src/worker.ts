/**
 * Job Search runs as the person's own Node service only (`serve --install`).
 * Its rules commit read-then-write transactions on a synchronous SQLite
 * handle (src/lib/db.ts), which Cloudflare D1 can't offer, so there is no
 * Worker build. The kit's build still compiles this entry, so it answers
 * plainly instead. See docs/parity.md, "Hosting".
 */
export default {
  fetch() {
    return new Response("Job Search runs on your own computer as a service, not on Cloudflare. See docs/parity.md in its source.", { status: 501, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
