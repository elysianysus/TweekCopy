import { reply, error, obj, s, row, b } from "./schema.js";

// Status branches explicitly returned in routes.js/auth.js. Keep special
// non-JSON responses and richer error envelopes in their owning contracts.
const errorRoutes = {
  403: `PUT /api/whiteboard-memos/:id
DELETE /api/whiteboard-memos/:id
PUT /api/whiteboard-connections/:id
DELETE /api/whiteboard-connections/:id
PUT /api/whiteboard-sections/:id
DELETE /api/whiteboard-sections/:id
POST /api/muse/chat
POST /api/muse/chat-with-image
POST /api/graph-connections
POST /api/access-code`,
  404: `PUT /api/tasks/:id
DELETE /api/tasks/:id
GET /api/tasks/:id/repeat-exceptions
POST /api/tasks/:id/repeat-exceptions
DELETE /api/tasks/:id/repeat-exceptions/:date
PUT /api/tasks/:id/repeat-anchor
PUT /api/tasks/:id/toggle
PUT /api/memos/:id
DELETE /api/memos/:id
PUT /api/whiteboards/:id
DELETE /api/whiteboards/:id
GET /api/whiteboards/:id
GET /api/whiteboards/:id/memos
POST /api/whiteboards/:id/memos
PUT /api/whiteboard-memos/:id
DELETE /api/whiteboard-memos/:id
POST /api/whiteboards/:id/memos/bulk-move
GET /api/whiteboards/:id/connections
POST /api/whiteboards/:id/connections
PUT /api/whiteboard-connections/:id
DELETE /api/whiteboard-connections/:id
GET /api/whiteboards/:id/sections
POST /api/whiteboards/:id/sections
PUT /api/whiteboard-sections/:id
DELETE /api/whiteboard-sections/:id
GET /api/memos/:id/links
POST /api/podcasts/videos
POST /api/podcasts/shows/:id/refresh
POST /api/podcasts/episodes/:id/summarize
POST /api/podcasts/episodes/:id/transcript
POST /api/podcasts/episodes/:id/notes
PATCH /api/podcasts/notes/:noteId
POST /api/podcasts/episodes/:id/memorize
PATCH /api/podcasts/episodes/:id
PATCH /api/muse/memories/:id
GET /api/muse/agent/runs/:id
POST /api/skills/soulcraft/start
POST /api/skills/soulcraft/answer
POST /api/skills/soulcraft/synthesize
POST /api/skills/soulcraft/tweak
PUT /api/skills/:id
POST /api/skills/:id/correct
POST /api/skills/:id/evolve
DELETE /api/skills/:id
GET /api/rize/sessions
GET /api/push/vapid-key
PATCH /api/rss/feeds/:id
POST /api/email/webhook
DELETE /api/expenses/:id
POST /api/expenses/audit-log/:id/undo
POST /api/food/audit-log/:id/undo
PUT /api/blood-pressure/:id
DELETE /api/blood-pressure/:id
GET /api/career/jobs/:id
PATCH /api/career/jobs/:id
DELETE /api/career/jobs/:id
PUT /api/milestones/:id
DELETE /api/milestones/:id
PUT /api/steps/:id
DELETE /api/steps/:id
DELETE /api/office/memories/:id
DELETE /api/last30days/subscriptions/:id
GET /api/last30days/runs/:id
GET /api/last30days/runs/:id/raw
DELETE /api/last30days/runs/:id
POST /api/last30days/runs/:id/save-as-memo
PUT /api/medicine/:id
DELETE /api/medicine/:id
PATCH /api/sleep/:id
DELETE /api/sleep/:id
PATCH /api/sleep/symptoms/:id
DELETE /api/sleep/symptoms/:id
GET /api/nutrition/lookup
PATCH /api/food/:id
DELETE /api/food/:id
DELETE /api/webhooks/:id
DELETE /api/journal/:id`,
  409: `POST /api/muse/import
POST /api/podcasts/shows
POST /api/podcasts/episodes/:id/summarize
POST /api/muse/memories`,
  422: `POST /api/expenses/auto-capture
POST /api/expenses/parse
POST /api/expenses/import-text
POST /api/expenses/import-image
POST /api/blood-pressure/import-text
POST /api/blood-pressure/import-image
POST /api/steps/import-image
POST /api/steps/import-text
POST /api/sleep/import-image`,
  429: "POST /api/expenses/auto-capture",
  502: `POST /api/video-notes/import
POST /api/skills/soulcraft/synthesize
POST /api/skills/soulcraft/tweak
GET /api/rss/fetch`,
};
const descriptions = {
  403: "Forbidden", 404: "Not found or integration not configured",
  409: "Duplicate or operation already in progress", 422: "Unable to parse supplied content",
  429: "Rate limit exceeded", 502: "Upstream service failure",
};
export function addErrorResponses(details) {
  for (const [status, keys] of Object.entries(errorRoutes)) {
    for (const key of keys.split("\n")) details[key].responses[status] = reply(error, descriptions[status]);
  }
  details["POST /api/podcasts/shows"].responses[409] = reply(obj({ error: s, show: row("podcastShows") }), descriptions[409]);
  for (const key of ["POST /api/video-notes/import", "POST /api/podcasts/episodes/:id/summarize", "POST /api/podcasts/episodes/:id/transcript"]) {
    details[key].responses[400] = reply(obj({ error: s, code: s }), "Invalid or inaccessible video");
  }
  for (const action of ["approve", "reject"]) {
    details[`POST /api/muse/agent/updates/:updateId/${action}`].responses[400] = reply(obj({ ok: b, error: s }), "Update cannot be applied");
  }
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"]) {
    details[`${method} /api/webhook/in/:token`].responses[404] = reply(error, "Invalid webhook token");
  }
}
