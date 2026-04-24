import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { logger } from "./logger";

const YTDLP_BIN = "yt-dlp";

const MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 60_000;

export type YtdlpFormat = {
  format_id: string;
  ext?: string;
  resolution?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
  abr?: number | null;
  tbr?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  format_note?: string | null;
  protocol?: string | null;
  url?: string | null;
};

export type YtdlpInfo = {
  _type?: string;
  id: string;
  title?: string;
  webpage_url?: string;
  original_url?: string;
  uploader?: string | null;
  channel?: string | null;
  duration?: number | null;
  thumbnail?: string | null;
  thumbnails?: { url: string }[] | null;
  extractor_key?: string;
  extractor?: string;
  formats?: YtdlpFormat[];
  entries?: YtdlpInfo[] | null;
  playlist_count?: number;
  url?: string | null;
};

export class YtdlpError extends Error {
  public readonly stderr: string;
  constructor(message: string, stderr: string) {
    super(message);
    this.name = "YtdlpError";
    this.stderr = stderr;
  }
}

function runYtdlpJson(args: string[], timeoutMs = PROBE_TIMEOUT_MS): Promise<YtdlpInfo> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let bufLen = 0;
    let killed = false;

    const timeout = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
      reject(new YtdlpError("yt-dlp timed out", ""));
    }, timeoutMs);

    proc.stdout.on("data", (d: Buffer) => {
      bufLen += d.length;
      if (bufLen > MAX_BUFFER_BYTES) {
        killed = true;
        proc.kill("SIGKILL");
        reject(new YtdlpError("yt-dlp output too large", ""));
        return;
      }
      chunks.push(d);
    });
    proc.stderr.on("data", (d: Buffer) => {
      errChunks.push(d);
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (killed) return;
      const stderr = Buffer.concat(errChunks).toString("utf8");
      if (code !== 0) {
        reject(new YtdlpError(`yt-dlp exited with code ${code}`, stderr));
        return;
      }
      const stdout = Buffer.concat(chunks).toString("utf8").trim();
      if (!stdout) {
        reject(new YtdlpError("yt-dlp produced no output", stderr));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed as YtdlpInfo);
      } catch (err) {
        reject(new YtdlpError("yt-dlp produced invalid JSON", stderr));
      }
    });
  });
}

export async function probeUrl(url: string): Promise<YtdlpInfo> {
  return runYtdlpJson([
    "-J",
    "--no-warnings",
    "--no-check-certificates",
    "--flat-playlist",
    "--ignore-no-formats-error",
    url,
  ]);
}

export async function probeVideo(url: string): Promise<YtdlpInfo> {
  return runYtdlpJson([
    "-J",
    "--no-warnings",
    "--no-check-certificates",
    "--no-playlist",
    url,
  ]);
}

export type DownloadStreamOptions = {
  url: string;
  formatId: string;
  mergeFormat?: "mp4" | "mkv" | null;
};

export type DownloadStream = {
  stdout: NodeJS.ReadableStream;
  cancel: () => void;
  done: Promise<void>;
};

export function spawnDownload({ url, formatId, mergeFormat }: DownloadStreamOptions): DownloadStream {
  const isMerge = formatId.includes("+") || !!mergeFormat;
  const out = new PassThrough();
  let cancelled = false;

  if (!isMerge) {
    // Single-format direct stream to stdout
    const args = [
      "-f",
      formatId,
      "-o",
      "-",
      "--no-warnings",
      "--no-check-certificates",
      "--no-playlist",
      "--no-part",
      "--quiet",
      url,
    ];

    logger.info({ formatId, url }, "Starting yt-dlp download (direct)");

    const proc = spawn(YTDLP_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });

    const errChunks: Buffer[] = [];
    proc.stderr.on("data", (d: Buffer) => {
      if (errChunks.reduce((a, c) => a + c.length, 0) < 1024 * 16) {
        errChunks.push(d);
      }
    });

    proc.stdout.pipe(out);

    const done = new Promise<void>((resolve, reject) => {
      proc.on("error", (err) => {
        out.destroy(err);
        reject(err);
      });
      proc.on("close", (code) => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          const stderr = Buffer.concat(errChunks).toString("utf8");
          logger.warn({ code, stderr }, "yt-dlp download exited non-zero");
          const err = new YtdlpError(`yt-dlp exited with code ${code}`, stderr);
          out.destroy(err);
          reject(err);
        }
      });
    });

    return {
      stdout: out,
      cancel: () => {
        cancelled = true;
        try {
          proc.kill("SIGKILL");
        } catch {
          /* ignored */
        }
      },
      done,
    };
  }

  // Merge path: download to temp file, then stream the file out.
  const merge = mergeFormat ?? "mkv";
  let workdir: string | null = null;
  let proc: ReturnType<typeof spawn> | null = null;

  const cleanup = async () => {
    if (workdir) {
      try {
        await rm(workdir, { recursive: true, force: true });
      } catch {
        /* ignored */
      }
      workdir = null;
    }
  };

  const done = (async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "grabby-"));
    const outPattern = path.join(workdir, "media.%(ext)s");
    const args = [
      "-f",
      formatId,
      "--merge-output-format",
      merge,
      "-o",
      outPattern,
      "--no-warnings",
      "--no-check-certificates",
      "--no-playlist",
      "--no-part",
      "--quiet",
      url,
    ];

    logger.info({ formatId, mergeFormat: merge, url }, "Starting yt-dlp download (merge)");

    proc = spawn(YTDLP_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });

    const errChunks: Buffer[] = [];
    proc.stderr?.on("data", (d: Buffer) => {
      if (errChunks.reduce((a, c) => a + c.length, 0) < 1024 * 16) {
        errChunks.push(d);
      }
    });

    await new Promise<void>((resolve, reject) => {
      proc!.on("error", reject);
      proc!.on("close", (code) => {
        if (cancelled) {
          reject(new YtdlpError("Download cancelled", ""));
          return;
        }
        if (code === 0) {
          resolve();
        } else {
          const stderr = Buffer.concat(errChunks).toString("utf8");
          logger.warn({ code, stderr }, "yt-dlp merge download exited non-zero");
          reject(new YtdlpError(`yt-dlp exited with code ${code}`, stderr));
        }
      });
    });

    // Find the produced file
    const files = await readdir(workdir);
    const produced = files.find((n) => n.startsWith("media."));
    if (!produced) {
      throw new YtdlpError("yt-dlp produced no output file", "");
    }
    const filePath = path.join(workdir, produced);

    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(filePath);
      rs.on("error", reject);
      out.on("error", reject);
      out.on("finish", () => resolve());
      rs.pipe(out);
    });
  })()
    .catch((err) => {
      out.destroy(err instanceof Error ? err : new Error(String(err)));
      throw err;
    })
    .finally(cleanup);

  return {
    stdout: out,
    cancel: () => {
      cancelled = true;
      if (proc) {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* ignored */
        }
      }
      out.destroy();
    },
    done,
  };
}
