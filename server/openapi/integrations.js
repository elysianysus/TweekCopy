import { s, i, b, obj, arr, strings, nullable, row, operation as op, query, upload, media, dynamic, enumString, ok, json } from "./schema.js";

const feed = row("rssFeeds");
const rss = obj({ title: s, siteUrl: s, items: arr(obj(strings("title link pubDate description"))) });
const emailResult = obj({ ok: b, resultType: s, resultId: nullable(i), id: i });
const emailInput = { ...obj(strings("from subject body")), anyOf: [{ required: ["subject"] }, { required: ["body"] }] };
const preferences = obj({ selectedFeedIds: arr(i), windowHours: i, keyword: s });
const webhookPayload = obj({ ...strings("type title subject content body text message date color"), tags: arr(s) });

export const integrations = {
  "GET /api/share-token": op(obj({ token: s })),
  "POST /api/share-token/regenerate": op(obj({ token: s })),
  "GET /api/share-shortcut": { responses: { 200: media("application/x-apple-shortcut", s, "Apple Shortcut plist download.") } },
  "POST /api/share-receive": {
    ...op(obj({ success: b, memoId: i })),
    security: [{ shareToken: [] }],
    requestBody: { required: false, content: {
      ...upload("file", strings("title text url"), false).content,
      "application/json": { schema: obj(strings("title text url")) },
    } },
  },
  "GET /api/rize/sessions": op(obj({
    sessions: arr(obj(strings("id startTime endTime title description type source"))),
    timeEntries: arr(obj({ ...strings("id startTime endTime title description source status"), duration: {} })),
    categories: arr(obj({ name: s, key: s, focus: {}, work: {}, timeSpent: {} })),
  }), null, [query("date", s, true)]),
  "GET /api/push/vapid-key": { ...op(obj({ publicKey: s })), security: [] },
  "POST /api/push/subscribe": op(ok, obj({ subscription: obj({ endpoint: s, keys: obj({ p256dh: s, auth: s }), expirationTime: nullable(i) }, ["endpoint", "keys"]) }, ["subscription"])),
  "POST /api/push/unsubscribe": op(ok, obj({ endpoint: s }, ["endpoint"])),
  "GET /api/rss/feeds": op(arr(feed)),
  "POST /api/rss/feeds": op(feed, obj(strings("url title"), ["url"])),
  "PATCH /api/rss/feeds/:id": op(feed, { ...obj({ autoSummarize: b, title: s }), minProperties: 1 }),
  "DELETE /api/rss/feeds/:id": op(ok),
  "GET /api/rss/hk-pack": op(arr(obj({ ...strings("key title url language category"), bestEffort: b }))),
  "POST /api/rss/feeds/hk-pack": op(obj({ added: i, skipped: i, feeds: arr(feed) })),
  "POST /api/rss/feeds/youtube": op(obj({ feed, created: b, channelId: s }), obj(strings("input title"), ["input"])),
  "POST /api/rss/auto-import/run": op(obj({ feedCount: i, processed: i, errors: i })),
  "GET /api/rss/auto-import/stats": op(obj({ lastTickAt: nullable(s), lastTickFeedCount: i, lastTickProcessed: i, lastTickErrors: i, lastError: nullable(s), lastErrorAt: nullable(s), totalImported: i, totalErrors: i, intervalMs: i })),
  "GET /api/rss/fetch": op(rss, null, [query("url", s, true)]),
  "GET /api/digest/preferences": op(preferences),
  "PUT /api/digest/preferences": op(obj({ ok: b, ...preferences.properties }), preferences),
  "POST /api/email/webhook": {
    ...op(emailResult, { ...emailInput, properties: { ...emailInput.properties, userEmail: s }, allOf: [{ anyOf: [{ required: ["userEmail"] }, { required: ["from"] }] }] }),
    security: [{ emailWebhookHeader: [] }, { emailWebhookQuery: [] }],
  },
  "POST /api/email/inbound": op(emailResult, emailInput),
  "GET /api/email/inbox": op(arr(row("emailInbox"))),
  "DELETE /api/email/:id": op(ok),
  "GET /api/gmail/auth-url": op(obj({ url: s })),
  "GET /api/gmail/callback": {
    security: [], parameters: [query("code", s, true), query("state", s, true, "User ID supplied as OAuth state by the authorization URL endpoint.")],
    responses: { 200: media("text/html", s, "OAuth result page"), 400: media("text/html", s, "Missing code or state"), 500: media("text/html", s, "OAuth error") },
  },
  "GET /api/gmail/status": op(obj({ connected: b, email: s, label: s, enabled: b, lastChecked: nullable(s) })),
  "POST /api/gmail/disconnect": op(ok),
  "PUT /api/gmail/settings": op(ok, obj({ labelName: s, enabled: b })),
  "POST /api/gmail/check-now": op(obj({ ok: b, processed: i, results: arr(obj({ id: i, subject: s, resultType: s, resultId: nullable(i) })) })),
  "GET /api/webhooks": op(arr(row("webhookTokens"))),
  "POST /api/webhooks": op(row("webhookTokens"), obj({ name: s, defaultType: s })),
  "DELETE /api/webhooks/:id": op(ok),
  "POST /api/line/webhook": {
    security: [{ lineSignature: [] }],
    description: "LINE webhook. x-line-signature must be the valid HMAC signature of the exact raw request body, not an API token.",
    requestBody: json(obj({ events: arr(obj({
      type: s, source: obj({ userId: s }), replyToken: s,
      message: obj({ type: enumString("text", "image", "video", "file", "audio"), ...strings("text id fileName") }),
    })) })),
    responses: { 200: { description: "Accepted", content: { "application/json": { schema: ok } } }, 403: media("text/html", s, "Invalid signature") },
  },
  "GET /api/last30days/runs/:id/raw": { responses: { 200: media("text/html", s, "HTML attachment download; only available after the run succeeds.") } },
};

for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "TRACE"]) {
  integrations[`${method} /api/webhook/in/:token`] = {
    ...op(obj({ ok: b, type: s, id: i }), null, Object.entries(webhookPayload.properties).map(([name, schema]) => query(name, schema))),
    ...(method === "GET" || method === "HEAD" ? {} : { requestBody: json(webhookPayload, false) }),
    security: [],
    description: "The path token is the credential. This route creates a memo or task even for GET/HEAD/OPTIONS. Non-GET requests use a non-empty JSON body, otherwise query parameters. Unknown payload fields are preserved in fallback memo content.",
  };
}

export { rss };
