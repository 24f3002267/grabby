import { Router, type IRouter, type Request, type Response } from "express";
import { ExtractMediaBody, ExtractMediaResponse } from "@workspace/api-zod";
import {
  probeUrl,
  probeVideo,
  spawnDownload,
  YtdlpError,
  type YtdlpFormat,
  type YtdlpInfo,
} from "../lib/ytdlp";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SUPPORTED_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "bilibili.com",
  "www.bilibili.com",
  "m.bilibili.com",
  "b23.tv",
];

function classifySource(info: YtdlpInfo, fallback: string): "youtube" | "bilibili" | "other" {
  const ek = (info.extractor_key || info.extractor || "").toLowerCase();
  if (ek.includes("youtube")) return "youtube";
  if (ek.includes("bili")) return "bilibili";
  const host = safeHost(info.webpage_url || info.original_url || fallback);
  if (host.includes("youtu")) return "youtube";
  if (host.includes("bili") || host.includes("b23.tv")) return "bilibili";
  return "other";
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isSupportedUrl(u: string): boolean {
  const host = safeHost(u);
  if (!host) return false;
  return SUPPORTED_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

function formatBytes(bytes: number | null | undefined): string | null {
  if (!bytes || !Number.isFinite(bytes)) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function classifyKind(f: YtdlpFormat): "video" | "audio" | "video_audio" {
  const v = (f.vcodec ?? "").toLowerCase();
  const a = (f.acodec ?? "").toLowerCase();
  const hasVideo = v && v !== "none";
  const hasAudio = a && a !== "none";
  if (hasVideo && hasAudio) return "video_audio";
  if (hasVideo) return "video";
  if (hasAudio) return "audio";
  if (f.height) return "video";
  return "audio";
}

function pickThumbnail(info: YtdlpInfo): string | null {
  if (info.thumbnail) return info.thumbnail;
  if (info.thumbnails && info.thumbnails.length > 0) {
    const last = info.thumbnails[info.thumbnails.length - 1];
    if (last && last.url) return last.url;
  }
  return null;
}

function sortFormats(formats: YtdlpFormat[]): YtdlpFormat[] {
  const copy = [...formats];
  copy.sort((a, b) => {
    const ah = a.height ?? 0;
    const bh = b.height ?? 0;
    if (bh !== ah) return bh - ah;
    const atbr = a.tbr ?? a.abr ?? 0;
    const btbr = b.tbr ?? b.abr ?? 0;
    if (btbr !== atbr) return btbr - atbr;
    return 0;
  });
  return copy;
}

function mapFormat(f: YtdlpFormat) {
  const kind = classifyKind(f);
  let resolution: string | null = null;
  if (kind === "audio") {
    resolution = "Audio only";
  } else if (f.resolution) {
    resolution = f.resolution;
  } else if (f.height) {
    resolution = `${f.height}p`;
  }
  const filesize = f.filesize ?? f.filesize_approx ?? null;
  return {
    formatId: f.format_id,
    ext: f.ext ?? "bin",
    kind,
    resolution,
    height: f.height ?? null,
    width: f.width ?? null,
    fps: f.fps ?? null,
    vcodec: f.vcodec && f.vcodec !== "none" ? f.vcodec : null,
    acodec: f.acodec && f.acodec !== "none" ? f.acodec : null,
    abr: f.abr ?? null,
    tbr: f.tbr ?? null,
    filesize: filesize,
    filesizeLabel: formatBytes(filesize),
    note: f.format_note ?? null,
  };
}

function injectMergedFormats(
  rawFormats: YtdlpFormat[],
  mapped: ReturnType<typeof mapFormat>[],
): ReturnType<typeof mapFormat>[] {
  const hasNativeCombined = mapped.some((f) => f.kind === "video_audio");

  const audios = rawFormats.filter((f) => {
    const v = (f.vcodec ?? "").toLowerCase();
    const a = (f.acodec ?? "").toLowerCase();
    const noVideo = !v || v === "none";
    const hasAudio = a && a !== "none";
    const looksAudio = noVideo && !f.height && !f.width;
    return (noVideo && hasAudio) || looksAudio;
  });
  if (audios.length === 0) return mapped;

  audios.sort((a, b) => {
    const ar = (a.abr ?? 0) || (a.tbr ?? 0);
    const br = (b.abr ?? 0) || (b.tbr ?? 0);
    return br - ar;
  });
  const bestAudio = audios[0];
  if (!bestAudio) return mapped;
  const audioExt = (bestAudio.ext ?? "").toLowerCase();

  const videos = rawFormats.filter((f) => {
    const v = (f.vcodec ?? "").toLowerCase();
    const a = (f.acodec ?? "").toLowerCase();
    return v && v !== "none" && (!a || a === "none") && f.height;
  });
  if (videos.length === 0) return mapped;

  const seenHeights = new Set<number>();
  const merged: ReturnType<typeof mapFormat>[] = [];
  const sortedVideos = [...videos].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  for (const v of sortedVideos) {
    const h = v.height ?? 0;
    if (!h) continue;
    if (seenHeights.has(h)) continue;
    seenHeights.add(h);
    const videoExt = (v.ext ?? "").toLowerCase();
    const canBeMp4 = videoExt === "mp4" && (audioExt === "m4a" || audioExt === "mp4");
    const outExt = canBeMp4 ? "mp4" : "mkv";
    const vSize = v.filesize ?? v.filesize_approx ?? 0;
    const aSize = bestAudio.filesize ?? bestAudio.filesize_approx ?? 0;
    const total = vSize && aSize ? vSize + aSize : null;
    merged.push({
      formatId: `${v.format_id}+${bestAudio.format_id}`,
      ext: outExt,
      kind: "video_audio",
      resolution: v.resolution ?? `${h}p`,
      height: h,
      width: v.width ?? null,
      fps: v.fps ?? null,
      vcodec: v.vcodec ?? null,
      acodec: bestAudio.acodec ?? null,
      abr: bestAudio.abr ?? null,
      tbr: (v.tbr ?? 0) + (bestAudio.abr ?? 0) || null,
      filesize: total,
      filesizeLabel: formatBytes(total),
      note: hasNativeCombined ? "Merged" : null,
    });
  }

  return [...merged, ...mapped];
}

function isPlaylistInfo(info: YtdlpInfo): boolean {
  if (info._type === "playlist" || info._type === "multi_video") return true;
  if (Array.isArray(info.entries) && info.entries.length > 0 && !info.formats) return true;
  return false;
}

router.post("/extract", async (req: Request, res: Response) => {
  const parsed = ExtractMediaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const url = parsed.data.url.trim();
  if (!url) {
    res.status(400).json({ error: "URL is required" });
    return;
  }
  if (!isSupportedUrl(url)) {
    res.status(400).json({
      error: "Only YouTube and Bilibili links are supported.",
    });
    return;
  }

  try {
    const info = await probeUrl(url);

    if (isPlaylistInfo(info)) {
      const entries = (info.entries ?? []).filter((e): e is YtdlpInfo => !!e);
      const playlist = {
        kind: "playlist" as const,
        playlist: {
          id: info.id,
          url: info.webpage_url ?? info.original_url ?? url,
          title: info.title ?? "Untitled playlist",
          uploader: info.uploader ?? info.channel ?? null,
          thumbnail: pickThumbnail(info),
          source: classifySource(info, url),
          entryCount: info.playlist_count ?? entries.length,
          entries: entries.map((e) => ({
            id: e.id,
            url: e.webpage_url ?? e.original_url ?? e.url ?? "",
            title: e.title ?? "Untitled",
            thumbnail: pickThumbnail(e),
            duration: e.duration ?? null,
            durationLabel: formatDuration(e.duration),
            uploader: e.uploader ?? e.channel ?? null,
          })),
        },
      };

      const validated = ExtractMediaResponse.safeParse(playlist);
      if (!validated.success) {
        req.log.error({ issues: validated.error.issues }, "Playlist response validation failed");
        res.status(500).json({ error: "Internal response shape error" });
        return;
      }
      res.json(validated.data);
      return;
    }

    // Single video — re-probe with full format info if formats are missing
    let videoInfo = info;
    if (!info.formats || info.formats.length === 0) {
      videoInfo = await probeVideo(url);
    }

    const formats = (videoInfo.formats ?? []).filter(
      (f) => f.format_id && (f.protocol ?? "").toLowerCase() !== "mhtml",
    );
    const mapped = sortFormats(formats).map(mapFormat);
    const withMerged = injectMergedFormats(formats, mapped);

    const video = {
      kind: "video" as const,
      video: {
        id: videoInfo.id,
        url: videoInfo.webpage_url ?? videoInfo.original_url ?? url,
        title: videoInfo.title ?? "Untitled",
        uploader: videoInfo.uploader ?? videoInfo.channel ?? null,
        duration: videoInfo.duration ?? null,
        durationLabel: formatDuration(videoInfo.duration),
        thumbnail: pickThumbnail(videoInfo),
        source: classifySource(videoInfo, url),
        formats: withMerged,
      },
    };

    const validated = ExtractMediaResponse.safeParse(video);
    if (!validated.success) {
      req.log.error({ issues: validated.error.issues }, "Video response validation failed");
      res.status(500).json({ error: "Internal response shape error" });
      return;
    }
    res.json(validated.data);
  } catch (err) {
    if (err instanceof YtdlpError) {
      req.log.warn({ err: err.message, stderr: err.stderr }, "Extraction failed");
      res.status(400).json({
        error: humanizeYtdlpError(err.stderr) || "Could not extract this URL.",
      });
      return;
    }
    req.log.error({ err }, "Unexpected extraction error");
    res.status(500).json({ error: "Unexpected error during extraction" });
  }
});

function humanizeYtdlpError(stderr: string): string | null {
  if (!stderr) return null;
  const lower = stderr.toLowerCase();
  if (lower.includes("video unavailable")) return "This video is unavailable.";
  if (lower.includes("private video")) return "This video is private.";
  if (lower.includes("sign in")) return "This video requires sign-in and cannot be downloaded.";
  if (lower.includes("members-only")) return "This is a members-only video.";
  if (lower.includes("requested format is not available"))
    return "The requested format is no longer available.";
  // Pull the last "ERROR:" line for context
  const match = stderr.match(/ERROR:[^\n]+/g);
  if (match && match.length > 0) {
    const last = match[match.length - 1];
    if (!last) return null;
    return last.replace(/^ERROR:\s*/, "").slice(0, 240);
  }
  return null;
}

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || "download"
  );
}

router.get("/download", async (req: Request, res: Response) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  const formatId = typeof req.query.formatId === "string" ? req.query.formatId : "";
  const filenameRaw = typeof req.query.filename === "string" ? req.query.filename : "";

  if (!url || !formatId) {
    res.status(400).json({ error: "url and formatId are required" });
    return;
  }
  if (!isSupportedUrl(url)) {
    res.status(400).json({ error: "Only YouTube and Bilibili links are supported." });
    return;
  }
  if (!/^[A-Za-z0-9_+\-./]+$/.test(formatId) || formatId.length > 64) {
    res.status(400).json({ error: "Invalid formatId" });
    return;
  }

  const filename = sanitizeFilename(filenameRaw || `download-${Date.now()}.bin`);

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.setHeader("Cache-Control", "no-store");

  const lowerName = filename.toLowerCase();
  const mergeFormat: "mp4" | "mkv" | null = lowerName.endsWith(".mp4")
    ? "mp4"
    : lowerName.endsWith(".mkv")
      ? "mkv"
      : null;

  const stream = spawnDownload({ url, formatId, mergeFormat });

  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    stream.cancel();
  };

  req.on("close", () => {
    if (!res.writableEnded) {
      cancel();
    }
  });

  stream.stdout.pipe(res);

  stream.done.catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : err }, "Download stream ended with error");
    if (!res.headersSent) {
      res.status(502).json({ error: "Download failed" });
    } else if (!res.writableEnded) {
      res.end();
    }
  });
});

export default router;
