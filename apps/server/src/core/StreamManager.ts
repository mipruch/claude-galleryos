/**
 * StreamManager — on-demand RTSP → HLS transcoding for CCTV cameras.
 *
 * The browser cannot consume RTSP directly, so for each *currently watched*
 * camera the server runs one ffmpeg process that pulls the camera's RTSP stream
 * and writes a rolling HLS playlist (`index.m3u8` + `seg_*.ts`) into a per-camera
 * working directory. The cameras routes serve those files over HTTP; the UI
 * plays them with hls.js. No audio, no seeking — a live wall only.
 *
 * Lifecycle (the key requirement: never transcode 24/7):
 *   - The first playlist request for a camera spawns ffmpeg (`ensure`).
 *   - Every playlist/segment request `touch`es the session, resetting an idle
 *     timer. The HLS player polls continuously while the view is open, so a gap
 *     longer than `idleTimeoutMs` means the viewer has left (tab closed, crash,
 *     navigation) — the process is killed and its working dir removed.
 *   - The UI also calls `stop` explicitly when its view unmounts, for immediate
 *     teardown without waiting out the idle timer.
 *
 * Credentials never leave the server: the stored camera URL carries no userinfo;
 * `username`/`password` are injected into the RTSP URL only at spawn time, and
 * the spawned URL is never logged.
 *
 * `spawn`, `now`, `setTimer`/`clearTimer` and `playlistExists` are injectable so
 * the manager is unit-testable without a real ffmpeg binary.
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../logger.ts";

/** The subset of a camera row the manager needs to build the ffmpeg command. */
export interface CameraStreamSource {
  id: string;
  name: string;
  /** RTSP base URL without credentials: rtsp://host:port/path. */
  url: string;
  username: string | null;
  password: string | null;
}

/** Transport-agnostic handle to a spawned transcoder process. */
export interface StreamProcess {
  readonly pid?: number;
  /** Resolves with the exit code once the process terminates. */
  readonly exited: Promise<number>;
  /** ffmpeg diagnostics (drained to the logger); omitted by test doubles. */
  readonly stderr?: ReadableStream<Uint8Array>;
  kill(): void;
}

/** Spawn an ffmpeg-like process. Injectable so tests avoid a real binary. */
export type SpawnFn = (binary: string, args: string[]) => StreamProcess;

/** A scheduled idle-timeout handle (opaque; matched to clearTimer). */
type TimerHandle = ReturnType<typeof setTimeout>;

export interface StreamManagerOptions {
  logger: Logger;
  ffmpegPath: string;
  /** Root dir for per-camera HLS working directories. */
  baseDir: string;
  idleTimeoutMs: number;
  startTimeoutMs: number;
  segmentTime: number;
  listSize: number;
  videoCodec: string;
  rtspTransport: string;
  /** Defaults to a `Bun.spawn`-backed implementation. */
  spawn?: SpawnFn;
  /** Injectable clock (epoch ms). Defaults to `Date.now`. */
  now?: () => number;
  /** Whether the playlist file exists yet. Defaults to a filesystem check. */
  playlistExists?: (path: string) => boolean;
}

/** Internal per-camera transcoding session. */
interface Session {
  cameraId: string;
  cameraName: string;
  dir: string;
  proc: StreamProcess;
  idleTimer: TimerHandle | null;
  startedAt: number;
  /** True once we've asked the process to stop, so its exit isn't logged as a crash. */
  stopping: boolean;
}

const PLAYLIST_FILE = "index.m3u8";
const SEGMENT_DIR = "seg";
/** Only `seg_<n>.ts` files may be served — guards against path traversal. */
const SEGMENT_RE = /^seg_\d+\.ts$/;

/**
 * Default spawn: launch ffmpeg via `Bun.spawn`. stdout is discarded; stderr is
 * piped so the manager can surface diagnostics through the logger.
 */
const bunSpawn: SpawnFn = (binary, args) => {
  const proc = Bun.spawn([binary, ...args], { stdout: "ignore", stderr: "pipe" });
  return {
    pid: proc.pid,
    exited: proc.exited,
    stderr: proc.stderr as ReadableStream<Uint8Array>,
    kill: () => proc.kill(),
  };
};

export class StreamManager {
  private readonly log: Logger;
  private readonly sessions = new Map<string, Session>();
  private readonly spawn: SpawnFn;
  private readonly now: () => number;
  private readonly playlistExists: (path: string) => boolean;

  constructor(private readonly opts: StreamManagerOptions) {
    this.log = opts.logger.child("stream");
    this.spawn = opts.spawn ?? bunSpawn;
    this.now = opts.now ?? Date.now;
    this.playlistExists = opts.playlistExists ?? ((p) => Bun.file(p).size > 0);
  }

  /** True while a camera is actively being transcoded. */
  isRunning(cameraId: string): boolean {
    return this.sessions.has(cameraId);
  }

  /** Absolute path of a camera's live playlist file. */
  playlistPath(cameraId: string): string {
    return join(this.opts.baseDir, cameraId, PLAYLIST_FILE);
  }

  /**
   * Resolve a segment filename to an absolute path, or `null` if the name is not
   * a valid `seg_<n>.ts` (rejecting any traversal attempt).
   */
  segmentPath(cameraId: string, file: string): string | null {
    if (!SEGMENT_RE.test(file)) return null;
    return join(this.opts.baseDir, cameraId, SEGMENT_DIR, file);
  }

  /**
   * Ensure a transcoder is running for `camera`, spawning ffmpeg on first use.
   * Idempotent: a second call while running just refreshes the idle timer.
   */
  ensure(camera: CameraStreamSource): void {
    const existing = this.sessions.get(camera.id);
    if (existing && !existing.stopping) {
      this.touch(camera.id);
      return;
    }
    this.spawnSession(camera);
  }

  /**
   * Wait until the playlist appears (ffmpeg has produced its first segments) or
   * give up. Resolves `false` if the process dies or the start window elapses
   * first — the caller then returns 503.
   */
  async waitForPlaylist(cameraId: string): Promise<boolean> {
    const path = this.playlistPath(cameraId);
    const deadline = this.now() + this.opts.startTimeoutMs;
    while (this.now() < deadline) {
      // A session that vanished means ffmpeg exited (bad URL/credentials).
      if (!this.sessions.has(cameraId)) return false;
      if (this.playlistExists(path)) return true;
      await sleep(150);
    }
    this.log.warn("stream did not start in time", {
      cameraId,
      startTimeoutMs: this.opts.startTimeoutMs,
    });
    return false;
  }

  /**
   * Mark a camera as freshly used: reset its idle timer so a watched stream stays
   * alive and an abandoned one is reaped. No-op (and unlogged) for unknown ids.
   */
  touch(cameraId: string): void {
    const session = this.sessions.get(cameraId);
    if (!session || session.stopping) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      this.log.info("stream idle — stopping", {
        cameraId,
        idleTimeoutMs: this.opts.idleTimeoutMs,
      });
      this.stop(cameraId, "idle");
    }, this.opts.idleTimeoutMs);
    // Don't let the idle timer keep the process alive at shutdown.
    session.idleTimer.unref?.();
  }

  /** Stop a camera's transcoder (if any) and clean up its working directory. */
  stop(cameraId: string, reason: string): void {
    const session = this.sessions.get(cameraId);
    if (!session) return;
    session.stopping = true;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    this.sessions.delete(cameraId);
    try {
      session.proc.kill();
    } catch (err) {
      this.log.warn("failed to kill ffmpeg", { cameraId, error: errMsg(err) });
    }
    this.cleanupDir(session.dir);
    this.log.info("stream stopped", {
      cameraId,
      reason,
      uptimeMs: this.now() - session.startedAt,
    });
  }

  /** Stop every running transcoder — called on server shutdown. */
  stopAll(): void {
    for (const cameraId of [...this.sessions.keys()]) this.stop(cameraId, "shutdown");
  }

  // ── internals ──────────────────────────────────────────────

  private spawnSession(camera: CameraStreamSource): void {
    const dir = join(this.opts.baseDir, camera.id);
    // Fresh dir each start so a previous run's stale segments can't be served.
    this.cleanupDir(dir);
    mkdirSync(join(dir, SEGMENT_DIR), { recursive: true });

    const args = this.ffmpegArgs(camera, dir);
    const proc = this.spawn(this.opts.ffmpegPath, args);
    const session: Session = {
      cameraId: camera.id,
      cameraName: camera.name,
      dir,
      proc,
      idleTimer: null,
      startedAt: this.now(),
      stopping: false,
    };
    this.sessions.set(camera.id, session);
    this.touch(camera.id);
    this.drainStderr(camera.id, proc);
    // Reap the session if ffmpeg exits on its own (unreachable camera, etc.).
    void proc.exited.then((code) => this.onExit(session, code));

    this.log.info("stream started", {
      cameraId: camera.id,
      name: camera.name,
      pid: proc.pid,
      // Logged WITHOUT credentials — only the stored base URL.
      url: camera.url,
      codec: this.opts.videoCodec,
    });
  }

  /** Build the ffmpeg argv for an RTSP → HLS live remux (video only, no audio). */
  private ffmpegArgs(camera: CameraStreamSource, dir: string): string[] {
    return [
      "-loglevel", "error",
      "-rtsp_transport", this.opts.rtspTransport,
      "-i", buildRtspUrl(camera),
      // Drop audio entirely — the wall is video-only.
      "-an",
      "-c:v", this.opts.videoCodec,
      "-f", "hls",
      "-hls_time", String(this.opts.segmentTime),
      "-hls_list_size", String(this.opts.listSize),
      // Rolling live window: delete old segments, never write an ENDLIST.
      "-hls_flags", "delete_segments+omit_endlist+independent_segments",
      "-hls_segment_type", "mpegts",
      // Segments live under seg/ so the playlist's relative URLs resolve to a
      // route distinct from the playlist itself (no router ambiguity).
      "-hls_base_url", `${SEGMENT_DIR}/`,
      "-hls_segment_filename", join(dir, SEGMENT_DIR, "seg_%d.ts"),
      join(dir, PLAYLIST_FILE),
    ];
  }

  /** Called when ffmpeg exits. Clean up unless we asked it to stop. */
  private onExit(session: Session, code: number): void {
    if (session.stopping) return; // expected — stop() already cleaned up
    // Unexpected exit: drop the session so waitForPlaylist fails fast.
    if (this.sessions.get(session.cameraId) === session) {
      if (session.idleTimer) clearTimeout(session.idleTimer);
      this.sessions.delete(session.cameraId);
    }
    this.cleanupDir(session.dir);
    this.log.error("ffmpeg exited unexpectedly", {
      cameraId: session.cameraId,
      name: session.cameraName,
      code,
      uptimeMs: this.now() - session.startedAt,
    });
  }

  /** Forward ffmpeg's stderr to the logger so failures are diagnosable. */
  private drainStderr(cameraId: string, proc: StreamProcess): void {
    if (!proc.stderr) return;
    void (async () => {
      try {
        const text = await new Response(proc.stderr).text();
        const trimmed = text.trim();
        if (trimmed) this.log.warn("ffmpeg stderr", { cameraId, output: trimmed.slice(-2000) });
      } catch {
        // Stream closed with the process — nothing to report.
      }
    })();
  }

  private cleanupDir(dir: string): void {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      this.log.warn("failed to clean stream dir", { dir, error: errMsg(err) });
    }
  }
}

/**
 * Compose the credentialed RTSP URL ffmpeg connects to, injecting the stored
 * username/password into the userinfo of the base URL. The result is used only
 * as an ffmpeg argument and is never logged or returned to clients.
 */
export function buildRtspUrl(camera: CameraStreamSource): string {
  if (!camera.username && !camera.password) return camera.url;
  try {
    const url = new URL(camera.url);
    // The WHATWG URL setters percent-encode userinfo themselves — assign raw.
    if (camera.username) url.username = camera.username;
    if (camera.password) url.password = camera.password;
    return url.toString();
  } catch {
    // Malformed URL — hand it to ffmpeg unchanged and let it report the error.
    return camera.url;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
