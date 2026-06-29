/**
 * Centralised, typed configuration loaded from the environment.
 *
 * Bun automatically loads `.env` files, so no dotenv dependency is needed.
 * All env access happens here; the rest of the code imports the typed `config`.
 */

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

function int(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

type LogLevel = "debug" | "info" | "warn" | "error";

export const appConfig = {
  env: str("NODE_ENV", "development"),
  isProd: str("NODE_ENV", "development") === "production",

  server: {
    port: int("PORT", 3000),
  },

  log: {
    level: str("LOG_LEVEL", "info") as LogLevel,
    filePath: str("LOG_FILE_PATH", "./logs/gallery.log"),
    retentionDays: int("LOG_RETENTION_DAYS", 90),
  },

  db: {
    url: str("DATABASE_URL", "postgresql://gallery:gallery_dev_password@localhost:5432/gallery"),
  },

  redis: {
    url: str("REDIS_URL", "redis://localhost:6379"),
  },

  input: {
    oscPort: int("OSC_PORT", 8765),
    tcpPort: int("TCP_INPUT_PORT", 8766),
  },

  // On-demand RTSP → HLS transcoding for CCTV cameras (see core/StreamManager).
  // A camera is only transcoded while a browser is watching it: the first
  // playlist request spawns ffmpeg, and the process is killed once the viewer
  // leaves (explicit stop) or stops fetching segments (idle timeout).
  stream: {
    // ffmpeg binary — resolved from PATH by default. Override for a pinned build.
    ffmpegPath: str("FFMPEG_PATH", "ffmpeg"),
    // Where HLS playlists/segments are written (one subdir per live camera).
    hlsDir: str("STREAM_HLS_DIR", "./.cache/streams"),
    // Kill ffmpeg this long after the last playlist/segment fetch. The HLS player
    // polls continuously while visible, so silence means the viewer has left.
    idleTimeoutMs: int("STREAM_IDLE_TIMEOUT_MS", 12_000),
    // How long the first playlist request waits for ffmpeg to produce a manifest
    // before giving up with 503 (camera unreachable / wrong credentials).
    startTimeoutMs: int("STREAM_START_TIMEOUT_MS", 10_000),
    // HLS segment length (s) and how many segments to keep in the live window.
    // Short segments = lower latency at the cost of more requests.
    segmentTime: int("STREAM_SEGMENT_TIME", 2),
    listSize: int("STREAM_LIST_SIZE", 5),
    // Video codec passed to ffmpeg. "copy" remuxes the camera's H.264 with near-
    // zero CPU (the common CCTV case); set to e.g. "libx264" to force a transcode
    // for cameras whose codec the browser can't play (H.265).
    videoCodec: str("STREAM_VIDEO_CODEC", "copy"),
    // RTSP transport. "tcp" is the most reliable over lossy networks; "udp" can
    // cut latency on a clean LAN.
    rtspTransport: str("STREAM_RTSP_TRANSPORT", "tcp"),
  },

  watchdog: {
    connectionIntervalMs: int("WATCHDOG_CONNECTION_INTERVAL_MS", 10_000),
    endpointIntervalMs: int("WATCHDOG_ENDPOINT_INTERVAL_MS", 60_000),
  },

  driver: {
    restartMaxAttempts: int("DRIVER_RESTART_MAX_ATTEMPTS", 0), // 0 = unlimited
    restartBaseDelayMs: int("DRIVER_RESTART_BASE_DELAY_MS", 1_000),
    restartMaxDelayMs: int("DRIVER_RESTART_MAX_DELAY_MS", 30_000),
    // IPC request budget for executeCommand / readState / healthCheck. Must
    // comfortably exceed a driver's worst-case single round-trip (e.g. a PJLink
    // session = connect + banner + response over a short-lived socket) so a slow
    // but reachable device is never reported as a false IPC timeout.
    commandTimeoutMs: int("DRIVER_COMMAND_TIMEOUT_MS", 5_000),
  },
} as const;
