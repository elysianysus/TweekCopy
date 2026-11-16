// Podcast Notebook helpers (Phase 1): resolve a YouTube channel reference
// into an Atom feed URL and pull episode entries from it.

const FEED_FETCH_TIMEOUT_MS = 8000;
const UC_ID_RE = /UC[\w-]{22}/;

const ALLOWED_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const FEED_URL_RE = /^https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=UC[\w-]{22}$/;

function feedUrlForChannelId(channelId) {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

function assertYoutubeUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname.toLowerCase())) {
    throw new Error("Only YouTube channel URLs are supported (youtube.com).");
  }
  return u;
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Analogue-Podcast/1.0)",
      "Accept-Language": "en",
    },
    signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
  return await r.text();
}

// Accepts: full feed URL, channel URL (/channel/UC…), handle URL (/@handle),
// bare @handle, or a bare UC… id. Returns { channelId, feedUrl }.
export async function resolveYoutubeChannel(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Channel URL or handle is required");

  // Bare UC id or any string containing one (incl. feed / channel URLs).
  const ucMatch = raw.match(UC_ID_RE);
  if (ucMatch) {
    return { channelId: ucMatch[0], feedUrl: feedUrlForChannelId(ucMatch[0]) };
  }

  // Normalize to a fetchable page URL for handles / custom URLs.
  let pageUrl = raw;
  if (raw.startsWith("@")) {
    pageUrl = `https://www.youtube.com/${encodeURIComponent(raw)}`;
  } else if (!/^https?:\/\//i.test(raw)) {
    pageUrl = `https://www.youtube.com/@${encodeURIComponent(raw.replace(/^\/+/, ""))}`;
  }
  // SSRF guard: only ever fetch YouTube pages over https.
  const parsed = assertYoutubeUrl(pageUrl.replace(/^http:\/\//i, "https://"));
  pageUrl = parsed.toString();
  let html;
  try {
    html = await fetchText(pageUrl);
  } catch (e) {
    throw new Error(`Could not load that YouTube page (${e.message}). Paste the channel URL, @handle, or UC… id.`);
  }
  const idMatch =
    html.match(/"channelId":"(UC[\w-]{22})"/) ||
    html.match(/channel_id=(UC[\w-]{22})/) ||
    html.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/);
  if (!idMatch) {
    throw new Error("Couldn't find a channel id on that page. Try pasting the channel's /channel/UC… URL.");
  }
  return { channelId: idMatch[1], feedUrl: feedUrlForChannelId(idMatch[1]) };
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Fetch the channel Atom feed and return { title, entries: [{ videoId,
// title, url, thumbnail, publishedAt }] } (newest first, up to 15 — that's
// all YouTube puts in the feed).
export async function fetchChannelEpisodes(feedUrl) {
  if (!FEED_URL_RE.test(String(feedUrl || ""))) {
    throw new Error("Invalid podcast feed URL");
  }
  const xml = await fetchText(feedUrl);
  const feedTitleMatch = xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const feedTitle = feedTitleMatch ? decodeEntities(feedTitleMatch[1].trim()) : "";

  const entries = [];
  for (const entry of xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []) {
    const idMatch = entry.match(/<yt:videoId>([\w-]{6,})<\/yt:videoId>/i);
    if (!idMatch) continue;
    const videoId = idMatch[1];
    const titleMatch = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pubMatch = entry.match(/<published>([\s\S]*?)<\/published>/i);
    const publishedAt = pubMatch ? new Date(pubMatch[1].trim()) : null;
    entries.push({
      videoId,
      title: titleMatch ? decodeEntities(titleMatch[1].trim()) : "",
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
    });
  }
  return { title: feedTitle, entries };
}
