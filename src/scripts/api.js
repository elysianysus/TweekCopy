import levenshtein from "js-levenshtein";

const MAX_LEVENSHTEIN_DISTANCE = 3;
const TOKEN_KEY = "auth_token";

export function getStoredToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function storeToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}

export function sleep(time) {
    return new Promise(resolve => {
        setTimeout(resolve, time);
    });
}

export function tryCatchDecorator(func) {
    return async function () {
        try {
            const data = await func.call(this, ...arguments);
            return {
                success: true,
                data,
            }
        } catch (err) {
            console.log(err.message);
            return {
                success: false,
                message: err.message,
            }
        }
    }
}

async function apiFetch(url, options = {}) {
    const token = getStoredToken();
    const res = await fetch(url, {
        credentials: "include",
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...options.headers,
        },
    });
    if (res.status === 401) {
        throw new Error("Not authenticated");
    }
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Request failed");
    }
    return res.json();
}

export async function loginUser(email, password) {
    const data = await apiFetch("/api/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
    });
    storeToken(data.token);
    return data;
}

export async function signupUser(email, password, name, timezone) {
    const data = await apiFetch("/api/signup", {
        method: "POST",
        body: JSON.stringify({ email, password, name, timezone }),
    });
    storeToken(data.token);
    return data;
}

export async function logoutUser() {
    clearToken();
    return await apiFetch("/api/logout", {
        method: "POST",
    });
}

export async function createTask(data) {
    return await apiFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function getUserTasks() {
    return await apiFetch("/api/tasks");
}

export async function getSearchedTasks(query) {
    return await apiFetch(`/api/tasks/search?q=${encodeURIComponent(query)}`);
}

export async function updateTask(taskId, data, applyTo) {
    const payload = applyTo ? { ...data, applyTo } : data;
    await apiFetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
    });
}

export async function moveTask(taskId, newDate, newOrder) {
    await apiFetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        body: JSON.stringify({ date: newDate, order: newOrder }),
    });
}

export async function listRepeatExceptions(taskId) {
    return await apiFetch(`/api/tasks/${taskId}/repeat-exceptions`);
}

export async function addRepeatException(taskId, date) {
    return await apiFetch(`/api/tasks/${taskId}/repeat-exceptions`, {
        method: "POST",
        body: JSON.stringify({ date }),
    });
}

export async function removeRepeatException(taskId, date) {
    return await apiFetch(`/api/tasks/${taskId}/repeat-exceptions/${encodeURIComponent(date)}`, {
        method: "DELETE",
    });
}

export async function updateRepeatAnchor(taskId, repeatAnchorDate) {
    return await apiFetch(`/api/tasks/${taskId}/repeat-anchor`, {
        method: "PUT",
        body: JSON.stringify({ repeatAnchorDate }),
    });
}

export async function deleteTask(taskId, scope) {
    const qs = scope ? `?scope=${encodeURIComponent(scope)}` : "";
    await apiFetch(`/api/tasks/${taskId}${qs}`, {
        method: "DELETE",
    });
}

export async function reOrderTasks(reOrdered) {
    await apiFetch("/api/tasks/reorder", {
        method: "PUT",
        body: JSON.stringify({ tasks: reOrdered }),
    });
}

export async function toggleDoneTask(taskId, scope) {
    const qs = scope && scope !== "one" ? `?scope=${encodeURIComponent(scope)}` : "";
    await apiFetch(`/api/tasks/${taskId}/toggle${qs}`, {
        method: "PUT",
    });
}

export async function clearUsersTasks() {
    await apiFetch("/api/tasks", {
        method: "DELETE",
    });
}

export async function getCurrentUser() {
    try {
        return await apiFetch("/api/auth/user");
    } catch {
        return null;
    }
}

export async function updateUserData(data) {
    return await apiFetch("/api/user", {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function getLastWeatherPush() {
    return await apiFetch("/api/user/last-weather-push");
}

export async function getRecurrenceSchedulerHealth() {
    return await apiFetch("/api/health/recurrence");
}

export async function getOfficeWorkerHealth() {
    return await apiFetch("/api/health/office");
}

export function searchTasks(tasks, query) {
    return tasks.filter(task => levenshtein(task.name, query) <= MAX_LEVENSHTEIN_DISTANCE);
}

export async function getSubtasks(taskId) {
    return await apiFetch(`/api/tasks/${taskId}/subtasks`);
}

export async function createSubtask(taskId, data) {
    return await apiFetch(`/api/tasks/${taskId}/subtasks`, {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function updateSubtask(subId, data) {
    return await apiFetch(`/api/subtasks/${subId}`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function deleteSubtask(subId) {
    return await apiFetch(`/api/subtasks/${subId}`, {
        method: "DELETE",
    });
}

export async function getTaskFiles(taskId) {
    return await apiFetch(`/api/tasks/${taskId}/files`);
}

export async function uploadTaskFile(taskId, file) {
    const formData = new FormData();
    formData.append("file", file);
    const token = getStoredToken();
    const res = await fetch(`/api/tasks/${taskId}/files`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
    });
    if (!res.ok) throw new Error("Upload failed");
    return await res.json();
}

export async function deleteTaskFile(fileId) {
    return await apiFetch(`/api/files/${fileId}`, {
        method: "DELETE",
    });
}

export async function getMemos() {
    return await apiFetch("/api/memos");
}

export async function searchMemos(query) {
    return await apiFetch(`/api/memos/search?q=${encodeURIComponent(query)}`);
}

export async function createMemo(data) {
    return await apiFetch("/api/memos", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function updateMemo(memoId, data) {
    return await apiFetch(`/api/memos/${memoId}`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function deleteMemo(memoId) {
    return await apiFetch(`/api/memos/${memoId}`, {
        method: "DELETE",
    });
}

export async function getMemoByDate(date) {
    return await apiFetch(`/api/memos/by-date/${date}`);
}

export async function getReflectionSummary({ weekStart, promptId, promptLabel, entries, regenerate }) {
    return await apiFetch(`/api/reflection-summary`, {
        method: "POST",
        body: JSON.stringify({ weekStart, promptId, promptLabel, entries, ...(regenerate ? { regenerate: true } : {}) }),
    });
}

export async function sendReflectionSummaryFeedback({ weekStart, promptId, entries, rating }) {
    return await apiFetch(`/api/reflection-summary/feedback`, {
        method: "POST",
        body: JSON.stringify({ weekStart, promptId, entries, rating }),
    });
}

export async function uploadMemoFile(memoId, file) {
    const formData = new FormData();
    formData.append("file", file);
    const token = getStoredToken();
    const res = await fetch(`/api/memos/${memoId}/files`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
    });
    if (!res.ok) throw new Error("Upload failed");
    return await res.json();
}

export async function deleteMemoFile(fileId) {
    return await apiFetch(`/api/memo-files/${fileId}`, {
        method: "DELETE",
    });
}

export async function getMemoTitles() {
    return await apiFetch("/api/memos/titles");
}

export async function getMemoBacklinks(memoId) {
    return await apiFetch(`/api/memos/${memoId}/backlinks`);
}

export async function getMemoWhiteboardsMap() {
    return await apiFetch("/api/memos/whiteboards-map");
}

export async function getMemoGraph() {
    return await apiFetch("/api/memos/graph");
}

export async function getMemoKnowledgeStatus(options = {}) {
    return await apiFetch("/api/memo-knowledge/status", options);
}

export async function syncMemoKnowledge(options = {}) {
    return await apiFetch("/api/memo-knowledge/sync", {
        ...options,
        method: "POST",
        body: JSON.stringify({}),
    });
}

export async function askMemoKnowledge(question, options = {}) {
    return await apiFetch("/api/memo-knowledge/ask", {
        ...options,
        method: "POST",
        body: JSON.stringify({ question }),
    });
}

export async function getRelatedMemoKnowledge(id, options = {}) {
    return await apiFetch(`/api/memo-knowledge/related/${encodeURIComponent(id)}`, options);
}

export async function importVideoNote(url) {
    return await apiFetch("/api/video-notes/import", {
        method: "POST",
        body: JSON.stringify({ url }),
    });
}

export async function aiOrganizeMemos(memos) {
    return await apiFetch("/api/memos/ai-organize", {
        method: "POST",
        body: JSON.stringify({ memos }),
    });
}

export async function getShareToken() {
    return await apiFetch("/api/share-token");
}

export async function regenerateShareToken() {
    return await apiFetch("/api/share-token/regenerate", {
        method: "POST",
    });
}

export async function getWhiteboard() {
    return await apiFetch("/api/whiteboard");
}

export async function saveWhiteboard(data) {
    return await apiFetch("/api/whiteboard", {
        method: "PUT",
        body: JSON.stringify({ data }),
    });
}

export async function getWhiteboards() {
    return await apiFetch("/api/whiteboards");
}

export async function getWhiteboardsOverview() {
    return await apiFetch("/api/whiteboards/overview");
}

export async function createWhiteboard(name, parentId = null) {
    return await apiFetch("/api/whiteboards", {
        method: "POST",
        body: JSON.stringify({ name, parentId }),
    });
}

export async function updateWhiteboard(id, data) {
    return await apiFetch(`/api/whiteboards/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function deleteWhiteboard(id) {
    return await apiFetch(`/api/whiteboards/${id}`, {
        method: "DELETE",
    });
}

export async function getWhiteboardById(id) {
    return await apiFetch(`/api/whiteboards/${id}`);
}

export async function getWhiteboardMemos(wbId) {
    return await apiFetch(`/api/whiteboards/${wbId}/memos`);
}

export async function addMemoToWhiteboard(wbId, memoId, x, y) {
    return await apiFetch(`/api/whiteboards/${wbId}/memos`, {
        method: "POST",
        body: JSON.stringify({ memoId, x, y }),
    });
}

export async function updateWhiteboardMemo(placementId, data) {
    return await apiFetch(`/api/whiteboard-memos/${placementId}`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function removeWhiteboardMemo(placementId) {
    return await apiFetch(`/api/whiteboard-memos/${placementId}`, {
        method: "DELETE",
    });
}

export async function bulkMoveWhiteboardMemos(sourceWbId, placementIds, targetWhiteboardId) {
    return await apiFetch(`/api/whiteboards/${sourceWbId}/memos/bulk-move`, {
        method: "POST",
        body: JSON.stringify({ placementIds, targetWhiteboardId }),
    });
}

export async function getWhiteboardConnections(wbId) {
    return await apiFetch(`/api/whiteboards/${wbId}/connections`);
}

export async function createWhiteboardConnection(wbId, fromMemoId, toMemoId, label) {
    return await apiFetch(`/api/whiteboards/${wbId}/connections`, {
        method: "POST",
        body: JSON.stringify({ fromMemoId, toMemoId, label: label || "" }),
    });
}

export async function updateWhiteboardConnection(connId, data) {
    return await apiFetch(`/api/whiteboard-connections/${connId}`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function deleteWhiteboardConnection(connId) {
    return await apiFetch(`/api/whiteboard-connections/${connId}`, { method: "DELETE" });
}

export async function getWhiteboardSections(wbId) {
    return await apiFetch(`/api/whiteboards/${wbId}/sections`);
}

export async function createWhiteboardSection(wbId, data) {
    return await apiFetch(`/api/whiteboards/${wbId}/sections`, {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function updateWhiteboardSection(sectionId, data) {
    return await apiFetch(`/api/whiteboard-sections/${sectionId}`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function deleteWhiteboardSection(sectionId) {
    return await apiFetch(`/api/whiteboard-sections/${sectionId}`, { method: "DELETE" });
}

export async function getMemoLinks(memoId) {
    return await apiFetch(`/api/memos/${memoId}/links`);
}

export async function getRssFeeds() {
    return await apiFetch("/api/rss/feeds");
}

export async function addRssFeed(url, title) {
    return await apiFetch("/api/rss/feeds", {
        method: "POST",
        body: JSON.stringify({ url, title }),
    });
}

export async function deleteRssFeed(feedId) {
    return await apiFetch(`/api/rss/feeds/${feedId}`, { method: "DELETE" });
}

export async function updateRssFeed(feedId, updates) {
    return await apiFetch(`/api/rss/feeds/${feedId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
    });
}

export async function runYoutubeAutoImportNow() {
    return await apiFetch("/api/rss/auto-import/run", { method: "POST" });
}

export async function fetchRssFeed(url) {
    return await apiFetch(`/api/rss/fetch?url=${encodeURIComponent(url)}`);
}

export async function getHkPack() {
    return await apiFetch("/api/rss/hk-pack");
}

export async function addHkPack() {
    return await apiFetch("/api/rss/feeds/hk-pack", { method: "POST" });
}

export async function addYoutubeFeed(input, title) {
    return await apiFetch("/api/rss/feeds/youtube", {
        method: "POST",
        body: JSON.stringify({ input, title }),
    });
}

export async function getDigestPreferences() {
    return await apiFetch("/api/digest/preferences");
}

export async function putDigestPreferences(prefs) {
    return await apiFetch("/api/digest/preferences", {
        method: "PUT",
        body: JSON.stringify(prefs),
    });
}

export async function submitEmail(from, subject, body) {
    return await apiFetch("/api/email/inbound", {
        method: "POST",
        body: JSON.stringify({ from, subject, body }),
    });
}

export async function getEmailInbox() {
    return await apiFetch("/api/email/inbox");
}

export async function deleteEmail(id) {
    return await apiFetch(`/api/email/${id}`, { method: "DELETE" });
}

export async function getGmailStatus() {
    return await apiFetch("/api/gmail/status");
}

export async function getGmailAuthUrl() {
    return await apiFetch("/api/gmail/auth-url");
}

export async function disconnectGmail() {
    return await apiFetch("/api/gmail/disconnect", { method: "POST" });
}

export async function updateGmailSettings(settings) {
    return await apiFetch("/api/gmail/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
    });
}

export async function gmailCheckNow() {
    return await apiFetch("/api/gmail/check-now", { method: "POST" });
}

export async function generateCustomSkill(name, chatLog, icon, color, relationshipInfo, personalityTags) {
    return await apiFetch("/api/skills/generate", {
        method: "POST",
        body: JSON.stringify({ name, chatLog, icon, color, relationshipInfo, personalityTags }),
    });
}

export async function correctCustomSkill(id, correction, context) {
    return await apiFetch(`/api/skills/${id}/correct`, {
        method: "POST",
        body: JSON.stringify({ correction, context }),
    });
}

export async function evolveCustomSkill(id, chatLog) {
    return await apiFetch(`/api/skills/${id}/evolve`, {
        method: "POST",
        body: JSON.stringify({ chatLog }),
    });
}

export async function saveCustomSkill(data) {
    return await apiFetch("/api/skills", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function getCustomSkills() {
    return await apiFetch("/api/skills");
}

export async function updateCustomSkill(id, updates) {
    return await apiFetch(`/api/skills/${id}`, {
        method: "PUT",
        body: JSON.stringify(updates),
    });
}

export async function deleteCustomSkill(id) {
    return await apiFetch(`/api/skills/${id}`, { method: "DELETE" });
}

export async function soulcraftStart({ skillId } = {}) {
    return await apiFetch("/api/skills/soulcraft/start", {
        method: "POST",
        body: JSON.stringify({ skillId: skillId || null }),
    });
}

export async function soulcraftAnswer({ sessionId, answer, skip, back } = {}) {
    return await apiFetch("/api/skills/soulcraft/answer", {
        method: "POST",
        body: JSON.stringify({ sessionId, answer, skip: !!skip, back: !!back }),
    });
}

export async function soulcraftSynthesize(sessionId) {
    return await apiFetch("/api/skills/soulcraft/synthesize", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
    });
}

export async function soulcraftTweak({ sessionId, field, draft }) {
    return await apiFetch("/api/skills/soulcraft/tweak", {
        method: "POST",
        body: JSON.stringify({ sessionId, field, draft }),
    });
}

export async function soulcraftEnd(sessionId) {
    return await apiFetch("/api/skills/soulcraft/end", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
    });
}

export async function getMilestones() {
    return await apiFetch("/api/milestones");
}

export async function createMilestone(data) {
    return await apiFetch("/api/milestones", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function updateMilestone(id, data) {
    return await apiFetch(`/api/milestones/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function deleteMilestone(id) {
    return await apiFetch(`/api/milestones/${id}`, { method: "DELETE" });
}

export async function getLifeActivity() {
    return await apiFetch("/api/life-activity");
}

export async function getGraphConnections() {
    return await apiFetch("/api/graph-connections");
}

export async function createGraphConnection(data) {
    return await apiFetch("/api/graph-connections", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function deleteGraphConnection(id) {
    return await apiFetch(`/api/graph-connections/${id}`, { method: "DELETE" });
}

export async function getRizeSessions(dateStr) {
    const parts = dateStr.split('-');
    const isoDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    return await apiFetch(`/api/rize/sessions?date=${isoDate}`);
}

export async function getJournalEntries(date) {
    const q = date ? `?date=${encodeURIComponent(date)}` : "";
    return await apiFetch(`/api/journal${q}`);
}

export async function getJournalDates() {
    return await apiFetch(`/api/journal/dates`);
}

export async function createJournalEntry(body, source = "manual", date) {
    return await apiFetch(`/api/journal`, {
        method: "POST",
        body: JSON.stringify({ body, source, date }),
    });
}

export async function deleteJournalEntry(id) {
    return await apiFetch(`/api/journal/${id}`, { method: "DELETE" });
}

export async function getJournalStuckSteps(goal) {
    return await apiFetch(`/api/journal/stuck`, {
        method: "POST",
        body: JSON.stringify({ goal }),
    });
}

// --- Muse long-term memory --------------------------------------------------

export async function listMuseMemories({ q = "", limit = 100, offset = 0, kind = null, sourceConversationId = null } = {}) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (limit) params.set("limit", String(limit));
    if (offset) params.set("offset", String(offset));
    if (kind) params.set("kind", kind);
    if (sourceConversationId) params.set("source_conversation_id", String(sourceConversationId));
    const qs = params.toString();
    return await apiFetch(`/api/muse/memories${qs ? "?" + qs : ""}`);
}

export async function clearMuseMemoriesByConversation(conversationId) {
    return await apiFetch(`/api/muse/memories/conversation/${conversationId}`, { method: "DELETE" });
}

export async function createMuseMemory(content, kind = "manual") {
    return await apiFetch(`/api/muse/memories`, {
        method: "POST",
        body: JSON.stringify({ content, kind }),
    });
}

export async function updateMuseMemory(id, content) {
    return await apiFetch(`/api/muse/memories/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ content }),
    });
}

export async function deleteMuseMemory(id) {
    return await apiFetch(`/api/muse/memories/${id}`, { method: "DELETE" });
}

export async function clearAllMuseMemories() {
    return await apiFetch(`/api/muse/memories/all`, { method: "DELETE" });
}

export async function importMuseConversations(source, data, { extractMemories = true } = {}) {
    return await apiFetch(`/api/muse/import`, {
        method: "POST",
        body: JSON.stringify({ source, data, extractMemories }),
    });
}

export async function listOfficeJobs(limit = 80) {
    return await apiFetch(`/api/office/jobs?limit=${limit}`);
}

export async function enqueueOfficeJob(skillKey, actionType, argument = "") {
    return await apiFetch(`/api/office/jobs`, {
        method: "POST",
        body: JSON.stringify({ skillKey, actionType, argument }),
    });
}

export async function getOfficeActionTypes() {
    return await apiFetch(`/api/office/action-types`);
}

// Worker info card / per-worker memory.
export async function getWorkerProfile(skillKey) {
    return await apiFetch(`/api/office/workers/${encodeURIComponent(skillKey)}/profile`);
}

export async function addWorkerMemory(skillKey, content) {
    return await apiFetch(`/api/office/workers/${encodeURIComponent(skillKey)}/memories`, {
        method: "POST",
        body: JSON.stringify({ content }),
    });
}

export async function deleteWorkerMemory(memoryId) {
    return await apiFetch(`/api/office/memories/${memoryId}`, { method: "DELETE" });
}

// E · Live preview + rating.
export async function getJobFeedbackMap() {
    return await apiFetch(`/api/office/jobs/feedback`);
}

export async function submitJobFeedback(jobId, kind, note = "") {
    return await apiFetch(`/api/office/jobs/${jobId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ kind, note }),
    });
}

// Podcast Notebook
export async function getPodcastShows() {
    return await apiFetch(`/api/podcasts/shows`);
}

export async function addPodcastShow(channel) {
    return await apiFetch(`/api/podcasts/shows`, {
        method: "POST",
        body: JSON.stringify({ channel }),
    });
}

export async function getAllPodcastNotes() {
    return await apiFetch(`/api/podcasts/notes`);
}

export async function addPodcastVideo(url) {
    return await apiFetch(`/api/podcasts/videos`, {
        method: "POST",
        body: JSON.stringify({ url }),
    });
}

export async function refreshPodcastShow(showId) {
    return await apiFetch(`/api/podcasts/shows/${showId}/refresh`, { method: "POST" });
}

export async function deletePodcastShow(showId) {
    return await apiFetch(`/api/podcasts/shows/${showId}`, { method: "DELETE" });
}

export async function getPodcastEpisodes(showId) {
    return await apiFetch(`/api/podcasts/shows/${showId}/episodes`);
}

export async function updatePodcastEpisode(episodeId, patch) {
    return await apiFetch(`/api/podcasts/episodes/${episodeId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
    });
}

export async function summarizePodcastEpisode(episodeId, force = false) {
    return await apiFetch(`/api/podcasts/episodes/${episodeId}/summarize`, {
        method: "POST",
        body: JSON.stringify({ force }),
    });
}

export async function memorizePodcastEpisode(episodeId) {
    return await apiFetch(`/api/podcasts/episodes/${episodeId}/memorize`, { method: "POST" });
}

export async function getPodcastTranscript(episodeId, force = false) {
    return await apiFetch(`/api/podcasts/episodes/${episodeId}/transcript`, {
        method: "POST",
        body: JSON.stringify({ force }),
    });
}

export async function getPodcastEpisodeNotes(episodeId) {
    return await apiFetch(`/api/podcasts/episodes/${episodeId}/notes`);
}

export async function addPodcastEpisodeNote(episodeId, { sec = null, content }) {
    return await apiFetch(`/api/podcasts/episodes/${episodeId}/notes`, {
        method: "POST",
        body: JSON.stringify({ sec, content }),
    });
}

export async function updatePodcastEpisodeNote(noteId, content) {
    return await apiFetch(`/api/podcasts/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify({ content }),
    });
}

export async function deletePodcastEpisodeNote(noteId) {
    return await apiFetch(`/api/podcasts/notes/${noteId}`, { method: "DELETE" });
}
