<script setup lang="ts">
/**
 * Admin cameras page — lists all VISCA PTZ camera devices with inline PTZ
 * controls, preset management, and an optional stream preview panel.
 *
 * Reuses the shared devices store (hydrated app-wide); cameras are identified
 * by subtype `visca.camera`. Device CRUD is delegated to the standard
 * DeviceFormDialog.
 */
import { computed, onMounted, ref } from 'vue'
import {
  CameraIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  HomeIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  VideoIcon,
  ZapIcon,
} from '@lucide/vue'
import type { DeviceDTO } from '@gallery/types'
import { useDevicesStore } from '@/stores/devices'
import { useConnectionsStore } from '@/stores/connections'
import { useDriversStore } from '@/stores/drivers'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import DeviceFormDialog from '@/components/admin/DeviceFormDialog.vue'
import type { DeviceRecord } from '@/lib/devices'

const devices = useDevicesStore()
const connections = useConnectionsStore()
const drivers = useDriversStore()

onMounted(() => {
  devices.init()
  connections.init()
  drivers.load()
})

/** Only VISCA camera devices. */
const cameraDevices = computed(() =>
  devices.records.filter((d) => d.subtype === 'visca.camera'),
)

function connName(id: string): string {
  return connections.connections.find((c) => c.id === id)?.name ?? id
}

/** Stream URL stored in the connection config.streamUrl field (if any). */
function streamUrl(connectionId: string): string | null {
  const conn = connections.connections.find((c) => c.id === connectionId)
  const url = conn?.config?.streamUrl
  return typeof url === 'string' && url ? url : null
}

function statusClass(d: DeviceRecord): string {
  const s = devices.statusOf(d.id)
  if (!d.enabled) return 'bg-muted-foreground/40'
  if (s?.online) return 'bg-emerald-500'
  return 'bg-rose-500'
}

// ── dialog + delete state ──────────────────────────────────────────────────
const formOpen = ref(false)
const editing = ref<DeviceRecord | null>(null)
const toDelete = ref<DeviceRecord | null>(null)
const deleteOpen = ref(false)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}
function openEdit(d: DeviceRecord): void {
  editing.value = d
  formOpen.value = true
}
function askDelete(d: DeviceRecord): void {
  toDelete.value = d
  deleteOpen.value = true
}
async function confirmDelete(): Promise<void> {
  const d = toDelete.value
  deleteOpen.value = false
  if (d) await devices.removeDevice(d.id)
  toDelete.value = null
}

// ── inline enable/disable ─────────────────────────────────────────────────
async function toggleEnabled(d: DeviceRecord): Promise<void> {
  await devices.updateDevice(d.id, { enabled: !d.enabled })
}

// ── PTZ commands ──────────────────────────────────────────────────────────

/** Which camera's controls panel is expanded. */
const expandedCamera = ref<string | null>(null)

function toggleControls(id: string): void {
  expandedCamera.value = expandedCamera.value === id ? null : id
}

function send(deviceId: string, command: string, params: Record<string, unknown> = {}): void {
  devices.sendCommand(deviceId, command, params, {})
}

function move(
  deviceId: string,
  pan: 'left' | 'right' | 'stop',
  tilt: 'up' | 'down' | 'stop',
  speed = 8,
): void {
  send(deviceId, 'move', { pan, tilt, panSpeed: speed, tiltSpeed: speed })
}

function stopMove(deviceId: string): void {
  send(deviceId, 'move', { pan: 'stop', tilt: 'stop' })
}

function recallPreset(deviceId: string, preset: number): void {
  send(deviceId, 'recallPreset', { preset })
}

function savePreset(deviceId: string, preset: number): void {
  send(deviceId, 'savePreset', { preset })
}

/** Which preset number is pending a "save" confirmation per device. */
const pendingSave = ref<Record<string, number | null>>({})

function askSavePreset(deviceId: string, preset: number): void {
  pendingSave.value = { ...pendingSave.value, [deviceId]: preset }
}
function cancelSavePreset(deviceId: string): void {
  pendingSave.value = { ...pendingSave.value, [deviceId]: null }
}
function confirmSavePreset(deviceId: string): void {
  const p = pendingSave.value[deviceId]
  if (p !== null && p !== undefined) savePreset(deviceId, p)
  cancelSavePreset(deviceId)
}

const PRESET_COUNT = 16
</script>

<template>
  <div class="flex flex-col gap-6 p-6">
    <!-- Header -->
    <div class="flex items-center justify-between gap-4">
      <p class="text-muted-foreground text-sm">{{ cameraDevices.length }} camera(s)</p>
      <Button @click="openCreate">
        <PlusIcon class="size-4" />
        Add camera
      </Button>
    </div>

    <!-- Empty state -->
    <div
      v-if="!cameraDevices.length"
      class="text-muted-foreground flex flex-col items-center gap-3 py-16 text-center"
    >
      <CameraIcon class="size-10 opacity-30" />
      <p class="text-sm">No VISCA PTZ cameras configured yet.</p>
      <p class="text-muted-foreground/70 text-xs">
        Add a connection with the VISCA driver, then add a camera device here.
      </p>
    </div>

    <!-- Camera cards -->
    <div v-else class="flex flex-col gap-4">
      <div
        v-for="cam in cameraDevices"
        :key="cam.id"
        class="rounded-lg border bg-card"
      >
        <!-- Card header row -->
        <div class="flex items-center gap-3 p-4">
          <!-- Status dot -->
          <span
            class="size-2 rounded-full shrink-0"
            :class="statusClass(cam)"
            :title="devices.statusOf(cam.id)?.online ? 'Online' : 'Offline'"
          />

          <!-- Camera icon + name -->
          <CameraIcon class="text-muted-foreground size-4 shrink-0" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate">{{ cam.name }}</p>
            <p class="text-muted-foreground text-xs truncate">
              {{ connName(cam.connectionId) }}
              <span v-if="cam.roomId" class="before:mx-1 before:content-['·']">
                {{ devices.rooms.find((r) => r.id === cam.roomId)?.name ?? '' }}
              </span>
            </p>
          </div>

          <!-- Enabled toggle -->
          <Switch
            :model-value="cam.enabled"
            :aria-label="`${cam.name} enabled`"
            @update:model-value="toggleEnabled(cam)"
          />

          <!-- Controls toggle button -->
          <Button
            variant="ghost"
            size="sm"
            class="gap-1.5"
            @click="toggleControls(cam.id)"
          >
            <ZapIcon class="size-3.5" />
            Controls
          </Button>

          <!-- Stream preview button -->
          <a
            v-if="streamUrl(cam.connectionId)"
            :href="streamUrl(cam.connectionId)!"
            target="_blank"
            rel="noopener noreferrer"
            class="text-muted-foreground hover:text-foreground"
            title="Open stream"
          >
            <VideoIcon class="size-4" />
          </a>

          <!-- Edit / delete -->
          <Button variant="ghost" size="icon-sm" aria-label="Edit" @click="openEdit(cam)">
            <PencilIcon class="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Delete" @click="askDelete(cam)">
            <Trash2Icon class="size-4" />
          </Button>
        </div>

        <!-- Expandable controls panel -->
        <div
          v-if="expandedCamera === cam.id"
          class="border-t px-4 py-4"
        >
          <div class="flex flex-wrap gap-6">
            <!-- PTZ joystick + zoom -->
            <div class="flex flex-col gap-3">
              <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Pan / Tilt / Zoom
              </p>
              <div class="flex items-center gap-3">
                <!-- 3×3 joystick grid -->
                <div class="grid grid-cols-3 gap-1">
                  <Button
                    variant="outline" size="icon" class="size-8"
                    @mousedown="move(cam.id, 'left', 'up')"
                    @mouseup="stopMove(cam.id)"
                    @mouseleave="stopMove(cam.id)"
                  >
                    <ChevronLeftIcon class="size-3.5 -translate-x-px -translate-y-px" />
                  </Button>
                  <Button
                    variant="outline" size="icon" class="size-8"
                    @mousedown="move(cam.id, 'stop', 'up')"
                    @mouseup="stopMove(cam.id)"
                    @mouseleave="stopMove(cam.id)"
                  >
                    <ChevronUpIcon class="size-3.5" />
                  </Button>
                  <Button
                    variant="outline" size="icon" class="size-8"
                    @mousedown="move(cam.id, 'right', 'up')"
                    @mouseup="stopMove(cam.id)"
                    @mouseleave="stopMove(cam.id)"
                  >
                    <ChevronRightIcon class="size-3.5 translate-x-px -translate-y-px" />
                  </Button>

                  <Button
                    variant="outline" size="icon" class="size-8"
                    @mousedown="move(cam.id, 'left', 'stop')"
                    @mouseup="stopMove(cam.id)"
                    @mouseleave="stopMove(cam.id)"
                  >
                    <ChevronLeftIcon class="size-3.5" />
                  </Button>
                  <Button variant="outline" size="icon" class="size-8" @click="send(cam.id, 'home')">
                    <HomeIcon class="size-3.5" />
                  </Button>
                  <Button
                    variant="outline" size="icon" class="size-8"
                    @mousedown="move(cam.id, 'right', 'stop')"
                    @mouseup="stopMove(cam.id)"
                    @mouseleave="stopMove(cam.id)"
                  >
                    <ChevronRightIcon class="size-3.5" />
                  </Button>

                  <Button
                    variant="outline" size="icon" class="size-8"
                    @mousedown="move(cam.id, 'left', 'down')"
                    @mouseup="stopMove(cam.id)"
                    @mouseleave="stopMove(cam.id)"
                  >
                    <ChevronLeftIcon class="size-3.5 -translate-x-px translate-y-px" />
                  </Button>
                  <Button
                    variant="outline" size="icon" class="size-8"
                    @mousedown="move(cam.id, 'stop', 'down')"
                    @mouseup="stopMove(cam.id)"
                    @mouseleave="stopMove(cam.id)"
                  >
                    <ChevronDownIcon class="size-3.5" />
                  </Button>
                  <Button
                    variant="outline" size="icon" class="size-8"
                    @mousedown="move(cam.id, 'right', 'down')"
                    @mouseup="stopMove(cam.id)"
                    @mouseleave="stopMove(cam.id)"
                  >
                    <ChevronRightIcon class="size-3.5 translate-x-px translate-y-px" />
                  </Button>
                </div>

                <!-- Zoom column -->
                <div class="flex flex-col gap-1">
                  <Button
                    variant="outline" size="icon" class="size-8"
                    title="Zoom in"
                    @mousedown="send(cam.id, 'zoomIn')"
                    @mouseup="send(cam.id, 'zoomStop')"
                    @mouseleave="send(cam.id, 'zoomStop')"
                  >
                    <PlusIcon class="size-3.5" />
                  </Button>
                  <div class="text-muted-foreground/50 text-center text-[9px] font-medium uppercase tracking-wider">
                    Z
                  </div>
                  <Button
                    variant="outline" size="icon" class="size-8"
                    title="Zoom out"
                    @mousedown="send(cam.id, 'zoomOut')"
                    @mouseup="send(cam.id, 'zoomStop')"
                    @mouseleave="send(cam.id, 'zoomStop')"
                  >
                    <MinusIcon class="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            <!-- Preset grid -->
            <div class="flex flex-col gap-3">
              <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Presets
                <span class="text-muted-foreground/60 ml-1 normal-case">(click = recall, right-click = save)</span>
              </p>
              <div class="grid grid-cols-8 gap-1">
                <div
                  v-for="n in PRESET_COUNT"
                  :key="n"
                  class="relative"
                >
                  <!-- Save confirmation overlay -->
                  <div
                    v-if="pendingSave[cam.id] === n - 1"
                    class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-0.5 rounded border bg-card p-0.5 shadow-md"
                  >
                    <span class="text-[9px] font-medium">Save?</span>
                    <div class="flex gap-0.5">
                      <Button
                        variant="default"
                        class="h-4 px-1 text-[9px]"
                        @click="confirmSavePreset(cam.id)"
                      >Yes</Button>
                      <Button
                        variant="ghost"
                        class="h-4 px-1 text-[9px]"
                        @click="cancelSavePreset(cam.id)"
                      >No</Button>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    class="h-8 w-full px-0 text-xs"
                    :title="`P${n}: click to recall, right-click to save`"
                    @click="recallPreset(cam.id, n - 1)"
                    @contextmenu.prevent="askSavePreset(cam.id, n - 1)"
                  >
                    P{{ n }}
                  </Button>
                </div>
              </div>
            </div>

            <!-- Stream preview -->
            <div v-if="streamUrl(cam.connectionId)" class="flex flex-col gap-3">
              <p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Stream preview
              </p>
              <div class="rounded border overflow-hidden bg-black" style="width: 320px; height: 180px;">
                <iframe
                  :src="streamUrl(cam.connectionId)!"
                  class="h-full w-full border-0"
                  allow="autoplay"
                  title="Camera stream"
                />
              </div>
            </div>
          </div>

          <!-- Power controls -->
          <div class="mt-4 flex items-center gap-2 border-t pt-4">
            <p class="text-muted-foreground text-xs">Power:</p>
            <Button variant="outline" size="sm" @click="send(cam.id, 'on')">
              On
            </Button>
            <Button variant="outline" size="sm" @click="send(cam.id, 'off')">
              Off (standby)
            </Button>
            <Badge
              v-if="devices.stateOf(cam.id)?.power"
              :variant="devices.stateOf(cam.id)?.power === 'on' ? 'default' : 'secondary'"
              class="ml-auto"
            >
              {{ devices.stateOf(cam.id)?.power }}
            </Badge>
          </div>
        </div>
      </div>
    </div>

    <!-- Device form dialog (reuses the standard device dialog) -->
    <DeviceFormDialog v-model:open="formOpen" :device="editing" />

    <!-- Delete confirmation -->
    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{{ toDelete?.name }}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the camera device from GalleryOS. The physical camera is unaffected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive hover:bg-destructive/90"
            @click="confirmDelete"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
