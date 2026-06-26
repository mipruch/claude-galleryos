<script setup lang="ts">
/**
 * Live camera view — plays a single CCTV camera's RTSP feed, transcoded to HLS
 * by the server on demand. Mounting (or switching cameras) starts playback;
 * leaving the route tears the player down AND tells the server to kill ffmpeg so
 * nothing is transcoded once nobody is watching.
 *
 * Display only: no audio, no controls, no seeking — a live wall. Most browsers
 * can't play HLS natively, so playback goes through hls.js (Safari uses its
 * native HLS path). Every lifecycle step is logged so streaming issues are
 * traceable from the browser console.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Hls from 'hls.js'
import { VideoOffIcon, LoaderCircleIcon } from '@lucide/vue'
import { useCamerasStore } from '@/stores/cameras'
import { playlistUrl, stopUrl } from '@/lib/cameras'
import { logger } from '@/lib/logger'

const log = logger.child('camera-view')
const route = useRoute()
const store = useCamerasStore()

const videoEl = ref<HTMLVideoElement | null>(null)
const status = ref<'loading' | 'playing' | 'error'>('loading')
const errorText = ref('')

/** Max fatal-network recoveries before we give up and show an error. */
const MAX_NETWORK_RECOVERIES = 5

let hls: Hls | null = null
/** The camera currently being streamed — what teardown must stop. */
let activeId: string | null = null
let networkRecoveries = 0

const cameraId = computed(() => {
  const id = route.params.cameraId
  return typeof id === 'string' ? id : null
})
const camera = computed(() => (cameraId.value ? store.byId(cameraId.value) : undefined))

/**
 * Stop playback for `id` and ask the server to kill its transcoder. Uses
 * `sendBeacon` so the stop survives a page unload / navigation; the store API
 * call is a fallback when the beacon API is unavailable.
 */
function teardown(id: string | null): void {
  if (hls) {
    hls.destroy()
    hls = null
  }
  if (!id) return
  let beaconed = false
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    beaconed = navigator.sendBeacon(stopUrl(id))
  }
  if (!beaconed) {
    void fetch(stopUrl(id), { method: 'POST', keepalive: true }).catch(() => {})
  }
  log.info('stream torn down', { cameraId: id, beaconed })
}

/** Begin playing camera `id` into the <video> element via hls.js (or native HLS). */
function start(id: string): void {
  const video = videoEl.value
  if (!video) {
    log.warn('no video element to attach', { cameraId: id })
    return
  }
  status.value = 'loading'
  errorText.value = ''
  networkRecoveries = 0
  activeId = id
  const url = playlistUrl(id)
  log.info('starting stream', { cameraId: id, url, hlsJs: Hls.isSupported() })

  if (Hls.isSupported()) {
    hls = new Hls({ liveDurationInfinity: true, lowLatencyMode: true, backBufferLength: 10 })
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      log.debug('manifest parsed', { cameraId: id })
      void play(video, id)
    })
    hls.on(Hls.Events.ERROR, (_event, data) => onHlsError(id, data))
    hls.loadSource(url)
    hls.attachMedia(video)
    return
  }

  // Safari / iOS: native HLS through the media element.
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    log.debug('using native HLS', { cameraId: id })
    video.src = url
    video.addEventListener('loadedmetadata', () => void play(video, id), { once: true })
    return
  }

  status.value = 'error'
  errorText.value = 'This browser cannot play the camera stream.'
  log.error('HLS not supported by this browser', { cameraId: id })
}

async function play(video: HTMLVideoElement, id: string): Promise<void> {
  try {
    await video.play()
    status.value = 'playing'
    log.info('stream playing', { cameraId: id })
  } catch (err) {
    // Autoplay can be blocked; the stream is muted so this is rare. Surface it
    // but keep the element live so a user gesture can start it.
    log.warn('autoplay was blocked', { cameraId: id, error: errMsg(err) })
    status.value = 'playing'
  }
}

/** Handle hls.js errors: recover transient ones, surface fatal ones. */
function onHlsError(id: string, data: { type: string; details: string; fatal: boolean }): void {
  const meta = { cameraId: id, type: data.type, details: data.details, fatal: data.fatal }
  if (!data.fatal) {
    log.debug('hls non-fatal error', meta)
    return
  }
  log.warn('hls fatal error', meta)
  if (!hls) return
  if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveries < MAX_NETWORK_RECOVERIES) {
    networkRecoveries += 1
    log.info('recovering hls network error', { ...meta, attempt: networkRecoveries })
    hls.startLoad()
    return
  }
  if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
    log.info('recovering hls media error', meta)
    hls.recoverMediaError()
    return
  }
  status.value = 'error'
  errorText.value = 'The camera stream is unavailable.'
  log.error('giving up on stream', meta)
}

/** Switch the player to a new camera (or initial mount). */
function switchTo(id: string | null): void {
  if (id === activeId) return
  if (activeId) teardown(activeId)
  activeId = null
  if (id) start(id)
}

// Re-run on route param changes so /cameras/:id → /cameras/:other swaps cleanly.
watch(cameraId, (id) => switchTo(id))

// Belt-and-braces: a hard tab close fires pagehide but not always unmount.
function onPageHide(): void {
  teardown(activeId)
}

onMounted(() => {
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide)
  switchTo(cameraId.value)
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide)
  teardown(activeId)
  activeId = null
})

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))
</script>

<template>
  <div v-if="camera" class="relative size-full bg-black">
    <video
      ref="videoEl"
      class="size-full object-contain"
      muted
      playsinline
      autoplay
      aria-label="Live camera stream"
    />

    <!-- Loading overlay -->
    <div
      v-if="status === 'loading'"
      class="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm"
    >
      <LoaderCircleIcon class="size-6 animate-spin" />
      <span>Connecting to {{ camera.name }}…</span>
    </div>

    <!-- Error overlay -->
    <div
      v-else-if="status === 'error'"
      class="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm"
    >
      <VideoOffIcon class="size-6" />
      <span>{{ errorText || 'The camera stream is unavailable.' }}</span>
    </div>
  </div>

  <div
    v-else
    class="text-muted-foreground flex size-full items-center justify-center text-sm"
  >
    Camera not found.
  </div>
</template>
