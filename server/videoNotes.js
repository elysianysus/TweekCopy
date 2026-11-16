import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const WHISPER_MAX_DURATION_SEC = 30 * 60;
const WHISPER_MAX_FILE_BYTES = 24 * 1024 * 1024;
const YT_DLP_TIMEOUT_MS = 4 * 60 * 1000;

export class VideoNoteError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function detectPlatform(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const url = rawUrl.trim();
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") {
      const v = u.searchParams.get("v");
      if (v) return { platform: "youtube", id: v, url };
    }
    const shorts = u.pathname.match(/^\/shorts\/([\w-]{6,})/);
    if (shorts) return { platform: "youtube", id: shorts[1], url };
    const live = u.pathname.match(/^\/live\/([\w-]{6,})/);
    if (live) return { platform: "youtube", id: live[1], url };
  }
  if (host === "youtu.be") {
    const id = u.pathname.replace(/^\//, "").split("/")[0];
    if (id) return { platform: "youtube", id, url };
  }
  if (host === "bilibili.com" || host === "m.bilibili.com") {
    const m = u.pathname.match(/\/video\/(BV[\w]+|av\d+)/i);
    if (m) return { platform: "bilibili", id: m[1], url };
  }
  if (host === "b23.tv") {
    return { platform: "bilibili-short", id: u.pathname.replace(/^\//, ""), url };
  }
  return null;
}

async function resolveB23(shortPath) {
  try {
    const r = await fetch(`https://b23.tv/${shortPath}`, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": DESKTOP_UA },
    });
    const finalUrl = r.url || "";
    const m = finalUrl.match(/\/video\/(BV[\w]+|av\d+)/i);
    if (m) return m[1];
  } catch {}
  throw new VideoNoteError("NOT_FOUND", "Could not resolve b23.tv short link");
}

async function scrapeYoutubeDuration(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": DESKTOP_UA, "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/"lengthSeconds":"(\d+)"/);
    if (m) return parseInt(m[1], 10);
  } catch {}
  return null;
}

export async function fetchYoutubeMeta(videoId, originalUrl) {
  let oembedData = null;
  try {
    const oembed = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`,
      )}&format=json`,
      { headers: { "User-Agent": DESKTOP_UA } },
    );
    if (oembed.ok) oembedData = await oembed.json();
  } catch {}
  const durationSec = await scrapeYoutubeDuration(videoId);
  return {
    title: oembedData?.title || `YouTube ${videoId}`,
    author: oembedData?.author_name || "",
    thumbnail: oembedData?.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    durationSec,
    url: originalUrl || `https://www.youtube.com/watch?v=${videoId}`,
  };
}

const INNERTUBE_API_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const INNERTUBE_CLIENT_VERSION = "20.10.38";
const INNERTUBE_USER_AGENT = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`;

async function fetchYoutubePlayerData(videoId) {
  let resp;
  try {
    resp = await fetch(INNERTUBE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": INNERTUBE_USER_AGENT,
      },
      body: JSON.stringify({
        context: { client: { clientName: "ANDROID", clientVersion: INNERTUBE_CLIENT_VERSION } },
        videoId,
      }),
    });
  } catch (e) {
    throw new VideoNoteError("FETCH_FAILED", `YouTube InnerTube fetch failed: ${e.message || e}`);
  }
  if (!resp.ok) {
    throw new VideoNoteError("FETCH_FAILED", `YouTube InnerTube HTTP ${resp.status}`);
  }
  return resp.json();
}

function pickCaptionTrack(captionTracks, audioTracks, defaultAudioTrackIndex, uiLang) {
  if (!Array.isArray(captionTracks) || captionTracks.length === 0) return null;

  const norm = (s) => String(s || "").toLowerCase().split(/[-_]/)[0];
  const isAsr = (t) => t?.kind === "asr";
  const isOriginal = (t) => {
    // YouTube marks original tracks with vssId starting "." and ASR with "a."
    const v = String(t?.vssId || "");
    if (v.startsWith(".")) return true;
    if (v.startsWith("a.")) return false;
    return !isAsr(t);
  };

  // 1. Honour the audio track's default caption pointer when present.
  if (Array.isArray(audioTracks) && audioTracks.length) {
    const idx = Number.isInteger(defaultAudioTrackIndex) ? defaultAudioTrackIndex : 0;
    const audio = audioTracks[idx] || audioTracks[0];
    const defIdx = audio?.defaultCaptionTrackIndex;
    if (Number.isInteger(defIdx) && captionTracks[defIdx]) {
      return captionTracks[defIdx];
    }
    const indices = Array.isArray(audio?.captionTrackIndices) ? audio.captionTrackIndices : [];
    const fromAudio = indices
      .map((i) => captionTracks[i])
      .filter(Boolean);
    const orig = fromAudio.find(isOriginal);
    if (orig) return orig;
    const nonAsr = fromAudio.find((t) => !isAsr(t));
    if (nonAsr) return nonAsr;
    if (fromAudio[0]) return fromAudio[0];
  }

  // 2. Any track flagged as the original (manual, non-translated).
  const original = captionTracks.find(isOriginal);
  if (original) return original;

  // 3. Fall back to the user's UI language if we have a track for it.
  if (uiLang) {
    const want = norm(uiLang);
    const ui = captionTracks.find((t) => norm(t.languageCode) === want);
    if (ui) return ui;
  }

  // 4. Prefer any non-ASR track, otherwise just take the first.
  return captionTracks.find((t) => !isAsr(t)) || captionTracks[0];
}

function parseTranscriptXml(xml) {
  const results = [];
  // srv3 / timedtext format: <p t="ms" d="ms"><s>word</s>…</p>
  const pRegex = /<p\s+t="(\d+)"(?:\s+d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = pRegex.exec(xml)) !== null) {
    const startMs = parseInt(m[1], 10);
    const inner = m[3];
    let text = "";
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sm;
    while ((sm = sRegex.exec(inner)) !== null) text += sm[1];
    if (!text) text = inner.replace(/<[^>]+>/g, "");
    results.push({ startSec: Math.floor(startMs / 1000), text });
  }
  if (results.length) return results;
  // Classic format: <text start="s" dur="s">…</text>
  const tRegex = /<text\s+start="([^"]+)"(?:\s+dur="[^"]*")?[^>]*>([\s\S]*?)<\/text>/g;
  while ((m = tRegex.exec(xml)) !== null) {
    results.push({ startSec: Math.floor(Number(m[1]) || 0), text: m[2] });
  }
  return results;
}

export async function fetchYoutubeTranscript(videoId, { uiLang } = {}) {
  let data;
  try {
    data = await fetchYoutubePlayerData(videoId);
  } catch (e) {
    if (e instanceof VideoNoteError) throw e;
    throw new VideoNoteError("FETCH_FAILED", String(e?.message || e));
  }
  const status = data?.playabilityStatus?.status;
  if (status === "LOGIN_REQUIRED" || status === "UNPLAYABLE") {
    throw new VideoNoteError("PRIVATE", "This YouTube video is private or restricted.");
  }
  if (status === "ERROR") {
    throw new VideoNoteError("NOT_FOUND", "This YouTube video doesn't exist or was removed.");
  }
  const tracklist = data?.captions?.playerCaptionsTracklistRenderer;
  const captionTracks = tracklist?.captionTracks;
  if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
    throw new VideoNoteError("NO_CAPTIONS", "This video has no captions available.");
  }
  const track = pickCaptionTrack(
    captionTracks,
    tracklist?.audioTracks,
    tracklist?.defaultAudioTrackIndex,
    uiLang,
  );
  if (!track?.baseUrl) {
    throw new VideoNoteError("NO_CAPTIONS", "Could not select a caption track.");
  }
  let baseUrl;
  try {
    baseUrl = new URL(track.baseUrl);
  } catch {
    throw new VideoNoteError("FETCH_FAILED", "Invalid caption track URL.");
  }
  if (!baseUrl.hostname.endsWith(".youtube.com")) {
    throw new VideoNoteError("FETCH_FAILED", "Refusing non-YouTube caption host.");
  }
  // Strip any tlang query so we get the track in its native language, never auto-translated.
  baseUrl.searchParams.delete("tlang");
  let xml;
  try {
    const r = await fetch(baseUrl.toString(), {
      headers: { "User-Agent": DESKTOP_UA },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    xml = await r.text();
  } catch (e) {
    throw new VideoNoteError("FETCH_FAILED", `Caption download failed: ${e.message || e}`);
  }
  const parsed = parseTranscriptXml(xml);
  const segments = parsed
    .map((s) => ({
      startSec: Math.max(0, s.startSec),
      text: decodeHtmlEntities(String(s.text || "")).replace(/\s+/g, " ").trim(),
    }))
    .filter((s) => s.text);
  if (!segments.length) {
    throw new VideoNoteError("NO_CAPTIONS", "Captions were empty.");
  }
  return {
    segments,
    lang: track.languageCode || "",
    langName: track?.name?.simpleText || track?.name?.runs?.[0]?.text || "",
    isAutoGenerated: track.kind === "asr",
  };
}

function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

export async function fetchBilibiliMeta(bvid) {
  const r = await fetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    { headers: { "User-Agent": DESKTOP_UA, Referer: "https://www.bilibili.com/" } },
  );
  if (!r.ok) throw new VideoNoteError("FETCH_FAILED", `Bilibili meta HTTP ${r.status}`);
  const j = await r.json();
  if (j.code !== 0 || !j.data) {
    if (j.code === -404) throw new VideoNoteError("NOT_FOUND", "Bilibili video not found.");
    if (j.code === -403 || j.code === 62002) throw new VideoNoteError("PRIVATE", "Bilibili video is private or restricted.");
    throw new VideoNoteError("FETCH_FAILED", `Bilibili meta error ${j.code}: ${j.message || ""}`);
  }
  const d = j.data;
  return {
    title: d.title || `Bilibili ${bvid}`,
    author: d.owner?.name || "",
    thumbnail: d.pic || "",
    durationSec: typeof d.duration === "number" ? d.duration : null,
    cid: d.cid,
    bvid,
    url: `https://www.bilibili.com/video/${bvid}`,
  };
}

export async function fetchBilibiliTranscript(bvid, cid) {
  const playerUrl = `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${cid}`;
  const r = await fetch(playerUrl, {
    headers: { "User-Agent": DESKTOP_UA, Referer: `https://www.bilibili.com/video/${bvid}` },
  });
  if (!r.ok) throw new VideoNoteError("FETCH_FAILED", `Bilibili player HTTP ${r.status}`);
  const j = await r.json();
  const subs = j?.data?.subtitle?.subtitles || [];
  if (!subs.length) {
    throw new VideoNoteError("NO_CAPTIONS", "This Bilibili video has no subtitles.");
  }
  // Pick first subtitle (usually the only one or the auto-generated one)
  const pick = subs[0];
  let subUrl = pick.subtitle_url || "";
  if (subUrl.startsWith("//")) subUrl = "https:" + subUrl;
  if (!subUrl) throw new VideoNoteError("NO_CAPTIONS", "Subtitle URL missing.");
  // SSRF hardening: only follow https URLs on bilibili-owned hosts.
  let subParsed;
  try {
    subParsed = new URL(subUrl);
  } catch {
    throw new VideoNoteError("FETCH_FAILED", "Invalid subtitle URL.");
  }
  const subHost = subParsed.hostname.toLowerCase();
  const allowed = subParsed.protocol === "https:" && (
    subHost === "bilibili.com" ||
    subHost.endsWith(".bilibili.com") ||
    subHost.endsWith(".biliapi.net") ||
    subHost.endsWith(".hdslb.com")
  );
  if (!allowed) {
    throw new VideoNoteError("FETCH_FAILED", "Refusing to fetch subtitle from non-Bilibili host.");
  }
  const sr = await fetch(subParsed.toString(), {
    headers: { "User-Agent": DESKTOP_UA, Referer: `https://www.bilibili.com/video/${bvid}` },
  });
  if (!sr.ok) throw new VideoNoteError("FETCH_FAILED", `Bilibili subtitle HTTP ${sr.status}`);
  const sj = await sr.json();
  const body = sj?.body || [];
  if (!Array.isArray(body) || !body.length) {
    throw new VideoNoteError("NO_CAPTIONS", "Subtitle body empty.");
  }
  const segments = body
    .map((b) => ({
      startSec: Math.max(0, Math.floor(Number(b.from) || 0)),
      text: String(b.content || "").replace(/\s+/g, " ").trim(),
    }))
    .filter((s) => s.text);
  return { segments, lang: pick.lan || "" };
}

function runCommand(cmd, args, { timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timer = null;
    let killed = false;
    if (timeoutMs) {
      timer = setTimeout(() => {
        killed = true;
        try { child.kill("SIGKILL"); } catch {}
      }, timeoutMs);
    }
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (killed) return reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
      if (code !== 0) return reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 500)}`));
      resolve({ stdout, stderr });
    });
  });
}

async function probeDurationSec(sourceUrl, platform) {
  const args = ["--no-playlist", "--no-warnings", "--skip-download", "--dump-json"];
  if (platform === "bilibili") {
    args.push("--referer", "https://www.bilibili.com/");
    args.push("--user-agent", DESKTOP_UA);
  }
  args.push(sourceUrl);
  try {
    const { stdout } = await runCommand("yt-dlp", args, { timeoutMs: 30 * 1000 });
    const info = JSON.parse(stdout.split("\n").find((l) => l.trim().startsWith("{")) || "{}");
    const d = Number(info?.duration);
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

async function downloadAudioForUrl(sourceUrl, platform) {
  const dir = await mkdtemp(path.join(tmpdir(), "vn-audio-"));
  const outTemplate = path.join(dir, "audio.%(ext)s");
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--quiet",
    "-f", "bestaudio/best",
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "9",
    "--postprocessor-args", "ffmpeg:-ac 1 -ar 16000",
    "-o", outTemplate,
  ];
  if (platform === "bilibili") {
    args.push("--referer", "https://www.bilibili.com/");
    args.push("--user-agent", DESKTOP_UA);
  }
  args.push(sourceUrl);
  try {
    await runCommand("yt-dlp", args, { timeoutMs: YT_DLP_TIMEOUT_MS });
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new VideoNoteError("FETCH_FAILED", `Audio download failed: ${err.message}`);
  }
  const filePath = path.join(dir, "audio.mp3");
  let size;
  try {
    size = (await stat(filePath)).size;
  } catch {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new VideoNoteError("FETCH_FAILED", "Audio file missing after download.");
  }
  if (size > WHISPER_MAX_FILE_BYTES) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new VideoNoteError("TOO_LONG", "Audio is too large to transcribe.");
  }
  return { filePath, dir, size };
}

export async function transcribeWithWhisper(openai, { platform, url, durationSec }) {
  const tooLong = (sec) =>
    new VideoNoteError(
      "TOO_LONG",
      `Video is ~${Math.round(sec / 60)} min, longer than the ${Math.round(WHISPER_MAX_DURATION_SEC / 60)}-minute cap; skipping audio transcription to keep things fast.`,
    );
  if (durationSec && durationSec > WHISPER_MAX_DURATION_SEC) {
    throw tooLong(durationSec);
  }
  if (!durationSec) {
    const probed = await probeDurationSec(url, platform);
    if (probed && probed > WHISPER_MAX_DURATION_SEC) throw tooLong(probed);
  }
  const { filePath, dir } = await downloadAudioForUrl(url, platform);
  try {
    const buf = await readFile(filePath);
    const file = new File([buf], "audio.mp3", { type: "audio/mpeg" });
    let resp;
    try {
      resp = await openai.audio.transcriptions.create({
        file,
        model: "whisper-1",
        response_format: "verbose_json",
      });
    } catch (err) {
      throw new VideoNoteError("FETCH_FAILED", `Whisper transcription failed: ${err.message || err}`);
    }
    const segs = Array.isArray(resp?.segments) ? resp.segments : [];
    let segments = segs
      .map((s) => ({
        startSec: Math.max(0, Math.floor(Number(s.start) || 0)),
        text: String(s.text || "").replace(/\s+/g, " ").trim(),
      }))
      .filter((s) => s.text);
    if (!segments.length) {
      const text = String(resp?.text || "").trim();
      if (!text) throw new VideoNoteError("NO_CAPTIONS", "Whisper produced no transcript.");
      segments = [{ startSec: 0, text }];
    }
    return { segments, lang: resp?.language || "" };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function loadVideo(rawUrl, { openai, onCaptionsMissing, uiLang } = {}) {
  let det = detectPlatform(rawUrl);
  if (!det) throw new VideoNoteError("BAD_URL", "Unsupported URL. Use a YouTube or Bilibili link.");

  if (det.platform === "bilibili-short") {
    const bvid = await resolveB23(det.id);
    det = { platform: "bilibili", id: bvid, url: `https://www.bilibili.com/video/${bvid}` };
  }

  if (det.platform === "youtube") {
    const meta = await fetchYoutubeMeta(det.id, det.url);
    let transcript;
    try {
      transcript = await fetchYoutubeTranscript(det.id, { uiLang });
    } catch (e) {
      if (e instanceof VideoNoteError && e.code === "NO_CAPTIONS" && openai) {
        if (typeof onCaptionsMissing === "function") onCaptionsMissing();
        transcript = await transcribeWithWhisper(openai, {
          platform: "youtube",
          url: meta.url,
          durationSec: meta.durationSec,
        });
        transcript.source = "whisper";
      } else {
        throw e;
      }
    }
    return { platform: "youtube", id: det.id, meta, transcript };
  }
  if (det.platform === "bilibili") {
    const meta = await fetchBilibiliMeta(det.id);
    let transcript;
    try {
      transcript = await fetchBilibiliTranscript(meta.bvid, meta.cid);
    } catch (e) {
      if (e instanceof VideoNoteError && e.code === "NO_CAPTIONS" && openai) {
        if (typeof onCaptionsMissing === "function") onCaptionsMissing();
        transcript = await transcribeWithWhisper(openai, {
          platform: "bilibili",
          url: meta.url,
          durationSec: meta.durationSec,
        });
        transcript.source = "whisper";
      } else {
        throw e;
      }
    }
    return { platform: "bilibili", id: det.id, meta, transcript };
  }
  throw new VideoNoteError("BAD_URL", "Unsupported platform.");
}

function evenlySample(arr, max) {
  if (arr.length <= max) return arr;
  const out = [];
  const step = arr.length / max;
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function buildTranscriptForPrompt(segments, durationSec) {
  let lines = segments.map((s) => `[${formatTimestamp(s.startSec)}] ${s.text}`);
  let joined = lines.join("\n");
  const CAP = 30000;
  if (joined.length > CAP) {
    // Sample down to fit cap
    const target = Math.max(60, Math.floor(segments.length * (CAP / joined.length)));
    const sampled = evenlySample(segments, target);
    lines = sampled.map((s) => `[${formatTimestamp(s.startSec)}] ${s.text}`);
    joined = lines.join("\n");
    if (joined.length > CAP) joined = joined.slice(0, CAP);
  }
  return joined;
}

export function formatTimestamp(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function deepLink(platform, id, sec) {
  if (platform === "youtube") {
    return `https://www.youtube.com/watch?v=${id}&t=${Math.floor(sec)}s`;
  }
  if (platform === "bilibili") {
    return `https://www.bilibili.com/video/${id}?t=${Math.floor(sec)}`;
  }
  return "";
}

function describeLanguage(code, fallbackName) {
  const c = String(code || "").trim();
  if (!c) return fallbackName || "";
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "language" });
    const name = dn.of(c);
    if (name && name.toLowerCase() !== c.toLowerCase()) return name;
  } catch {}
  return fallbackName || c;
}

export async function summarizeTranscript(openai, { platform, id, meta, transcript }) {
  const transcriptBlock = buildTranscriptForPrompt(transcript.segments, meta.durationSec);
  const langHint = transcript.lang || "";
  const langLabel = describeLanguage(transcript.lang, transcript.langName);

  const system = [
    "You are a careful note-taker that turns video transcripts into a clean Markdown study note.",
    "Mirror the language of the transcript (Chinese stays Chinese, English stays English). Do NOT translate.",
    "Be faithful — never invent facts that are not in the transcript. If you are unsure about a timestamp, omit that line.",
    "Return STRICT JSON matching this schema:",
    `{"tldr": string, "key_points": string[3..7], "timestamps": [{"sec": integer, "label": string}]}`,
    "Rules:",
    "- tldr: one sentence, <= 140 characters.",
    "- key_points: 3 to 7 short bullet lines (no leading dash).",
    "- timestamps: 4 to 10 entries, each with `sec` (integer seconds, must appear in the transcript) and `label` (short phrase, <= 60 chars).",
    "- Cover the whole video evenly with timestamps; do not bunch them at the start.",
  ].join("\n");

  const user = [
    `Video title: ${meta.title}`,
    meta.author ? `Author: ${meta.author}` : null,
    meta.durationSec ? `Duration: ${formatTimestamp(meta.durationSec)}` : null,
    langHint ? `Transcript language: ${langHint}` : null,
    "",
    "Transcript (timestamps in [m:ss] or [h:mm:ss] are seconds from start):",
    transcriptBlock,
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0.3,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VideoNoteError("FETCH_FAILED", "AI returned invalid JSON.");
  }

  const tldr = String(parsed.tldr || "").trim();
  const keyPoints = Array.isArray(parsed.key_points) ? parsed.key_points.map(String).map((s) => s.trim()).filter(Boolean) : [];
  const ts = Array.isArray(parsed.timestamps) ? parsed.timestamps : [];

  const lines = [];
  if (langLabel) {
    const sourceTag = transcript.source === "whisper"
      ? " (audio transcription)"
      : transcript.isAutoGenerated
        ? " (auto-generated captions)"
        : "";
    lines.push(`*Detected language: ${langLabel}${sourceTag}*`);
    lines.push("");
  }
  if (tldr) {
    lines.push(`> ${tldr}`);
    lines.push("");
  }
  if (keyPoints.length) {
    lines.push("## Key points");
    for (const k of keyPoints) lines.push(`- ${k}`);
    lines.push("");
  }
  if (ts.length) {
    lines.push("## Timestamps");
    for (const t of ts) {
      const sec = Math.max(0, Math.floor(Number(t.sec) || 0));
      const label = String(t.label || "").trim();
      if (!label) continue;
      lines.push(`- [${formatTimestamp(sec)}](${deepLink(platform, id, sec)}) — ${label}`);
    }
    lines.push("");
  }
  lines.push("## Source");
  const srcParts = [meta.title];
  if (meta.author) srcParts.push(meta.author);
  if (meta.durationSec) srcParts.push(formatTimestamp(meta.durationSec));
  lines.push(`${srcParts.join(" • ")}`);
  lines.push(`<${meta.url}>`);

  return lines.join("\n");
}
