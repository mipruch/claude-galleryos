/**
 * StreamManager tests — hermetic (no ffmpeg binary, no DB).
 *
 * A fake `spawn` stands in for ffmpeg: it records the argv (so we can assert the
 * RTSP URL / credential injection) and, by default, writes a stub playlist file
 * so `waitForPlaylist` resolves. Lifecycle (spawn-once, idle reaping, explicit
 * stop, unexpected exit) is then driven deterministically.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../../src/logger.ts";
import {
  StreamManager,
  buildRtspUrl,
  type CameraStreamSource,
  type SpawnFn,
  type StreamProcess,
} from "../../src/core/StreamManager.ts";

const CAMERA: CameraStreamSource = {
  id: "cam-1",
  name: "Hall",
  url: "rtsp://10.0.0.5:554/Streaming/Channels/101",
  username: "admin",
  password: "secret",
};

interface FakeProcess extends StreamProcess {
  triggerExit(code: number): void;
}

/** Build a fake spawn that records calls and (optionally) writes the playlist. */
function fakeSpawn(opts: { writePlaylist?: boolean } = {}): {
  spawn: SpawnFn;
  calls: { args: string[]; proc: FakeProcess }[];
} {
  const calls: { args: string[]; proc: FakeProcess }[] = [];
  const spawn: SpawnFn = (_binary, args) => {
    let resolveExit!: (code: number) => void;
    const exited = new Promise<number>((resolve) => (resolveExit = resolve));
    let settled = false;
    const settle = (code: number): void => {
      if (settled) return;
      settled = true;
      resolveExit(code);
    };
    const proc: FakeProcess = {
      pid: 4242,
      exited,
      kill: () => settle(0),
      triggerExit: settle,
    };
    if (opts.writePlaylist !== false) {
      // The last arg is the playlist path; its dir was just created by the manager.
      writeFileSync(args[args.length - 1]!, "#EXTM3U\n#EXT-X-VERSION:3\n");
    }
    calls.push({ args, proc });
    return proc;
  };
  return { spawn, calls };
}

const dirs: string[] = [];
function makeManager(over: Partial<ConstructorParameters<typeof StreamManager>[0]> = {}): StreamManager {
  const baseDir = mkdtempSync(join(tmpdir(), "smtest-"));
  dirs.push(baseDir);
  return new StreamManager({
    logger,
    ffmpegPath: "ffmpeg",
    baseDir,
    idleTimeoutMs: 10_000,
    startTimeoutMs: 1_000,
    segmentTime: 1,
    listSize: 5,
    videoCodec: "copy",
    rtspTransport: "tcp",
    ...over,
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("buildRtspUrl", () => {
  test("injects credentials into the userinfo", () => {
    expect(buildRtspUrl(CAMERA)).toBe("rtsp://admin:secret@10.0.0.5:554/Streaming/Channels/101");
  });

  test("returns the URL unchanged when there are no credentials", () => {
    const url = "rtsp://10.0.0.5:554/s";
    expect(buildRtspUrl({ ...CAMERA, username: null, password: null, url })).toBe(url);
  });

  test("percent-encodes special characters in the password", () => {
    const out = buildRtspUrl({ ...CAMERA, password: "p@ss:w/rd" });
    expect(out).toContain("admin:");
    expect(out).not.toContain("p@ss:w/rd"); // raw special chars must be encoded
    expect(out).toContain("@10.0.0.5:554");
  });
});

describe("StreamManager lifecycle", () => {
  test("spawns ffmpeg once and serves the playlist", async () => {
    const { spawn, calls } = fakeSpawn();
    const mgr = makeManager({ spawn });

    mgr.ensure(CAMERA);
    expect(mgr.isRunning(CAMERA.id)).toBe(true);
    expect(calls).toHaveLength(1);
    // Credentials are injected into the ffmpeg argv (and only there).
    expect(calls[0]!.args).toContain("rtsp://admin:secret@10.0.0.5:554/Streaming/Channels/101");
    expect(calls[0]!.args).toContain("-an"); // no audio

    expect(await mgr.waitForPlaylist(CAMERA.id)).toBe(true);

    // A second ensure() while running does not spawn again.
    mgr.ensure(CAMERA);
    expect(calls).toHaveLength(1);

    mgr.stop(CAMERA.id, "test");
    expect(mgr.isRunning(CAMERA.id)).toBe(false);
  });

  test("waitForPlaylist fails when the process never produces a manifest", async () => {
    const { spawn } = fakeSpawn({ writePlaylist: false });
    const mgr = makeManager({ spawn, startTimeoutMs: 300 });
    mgr.ensure(CAMERA);
    expect(await mgr.waitForPlaylist(CAMERA.id)).toBe(false);
    mgr.stop(CAMERA.id, "test");
  });

  test("reaps an idle stream after the idle timeout", async () => {
    const { spawn } = fakeSpawn();
    const mgr = makeManager({ spawn, idleTimeoutMs: 40 });
    mgr.ensure(CAMERA);
    expect(mgr.isRunning(CAMERA.id)).toBe(true);
    await sleep(120);
    expect(mgr.isRunning(CAMERA.id)).toBe(false);
  });

  test("touch keeps a stream alive past the idle window", async () => {
    const { spawn } = fakeSpawn();
    const mgr = makeManager({ spawn, idleTimeoutMs: 60 });
    mgr.ensure(CAMERA);
    await sleep(30);
    mgr.touch(CAMERA.id); // reset the idle timer
    await sleep(40);
    expect(mgr.isRunning(CAMERA.id)).toBe(true); // would be reaped at 60ms without touch
    mgr.stop(CAMERA.id, "test");
  });

  test("drops the session when ffmpeg exits unexpectedly", async () => {
    const { spawn, calls } = fakeSpawn();
    const mgr = makeManager({ spawn });
    mgr.ensure(CAMERA);
    calls[0]!.proc.triggerExit(1);
    await sleep(10);
    expect(mgr.isRunning(CAMERA.id)).toBe(false);
  });

  test("stopAll tears down every running stream", () => {
    const { spawn } = fakeSpawn();
    const mgr = makeManager({ spawn });
    mgr.ensure({ ...CAMERA, id: "a" });
    mgr.ensure({ ...CAMERA, id: "b" });
    expect(mgr.isRunning("a")).toBe(true);
    expect(mgr.isRunning("b")).toBe(true);
    mgr.stopAll();
    expect(mgr.isRunning("a")).toBe(false);
    expect(mgr.isRunning("b")).toBe(false);
  });
});

describe("StreamManager segment paths", () => {
  test("accepts valid segment names and rejects traversal", () => {
    const mgr = makeManager();
    const ok = mgr.segmentPath("cam-1", "seg_3.ts");
    expect(ok).toContain(join("cam-1", "seg", "seg_3.ts"));
    for (const bad of ["../secret", "seg_3.ts/../../x", "index.m3u8", "seg_.ts", "evil.ts"]) {
      expect(mgr.segmentPath("cam-1", bad)).toBeNull();
    }
  });
});
