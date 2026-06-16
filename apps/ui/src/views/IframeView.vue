<script setup lang="ts">
/**
 * The device page — used for both the home (all devices) and per-room routes.
 * The room scope itself is set from the route in `App.vue`; this view just
 * renders the (scope-aware) toolbar and grid.
 */
const url = "http://10.54.17.99:1338/static/ui_builder/ui_builder.html?device=planetapraha"
const title = "Pixera"
</script>

<template>

    <iframe
        :src="url"
        :title="title"
        width="100%"
        height="100%"
        frameborder="0"
    ></iframe>


</template>
