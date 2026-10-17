<script setup lang="ts">
/** Small stroke icons drawn on a 16×16 grid. */
const PATHS: Record<string, string> = {
  user: "M8 2.5a3 3 0 1 1 0 6a3 3 0 1 1 0-6zM2.5 14c.6-2.8 2.8-4.2 5.5-4.2s4.9 1.4 5.5 4.2",
  role: "M5.5 3.5a2.3 2.3 0 1 1 0 4.6a2.3 2.3 0 1 1 0-4.6zM1.5 13c.4-2.2 2-3.4 4-3.4s3.6 1.2 4 3.4M10.5 3.6a2.2 2.2 0 1 1 .3 4.4M11.5 9.7c1.6.3 2.7 1.4 3 3.3",
  system: "M8 1.8l5.2 2v4c0 3.2-2.2 5.3-5.2 6.4C5 13.1 2.8 11 2.8 7.8v-4z",
  search: "M7 3a4 4 0 1 1 0 8a4 4 0 1 1 0-8zM10 10l3.5 3.5",
  plus: "M8 3v10M3 8h10",
  refresh: "M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3",
  edit: "M3 13l1-3.5 7-7 2.5 2.5-7 7zM9.5 4l2.5 2.5",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9M7 7v4M9 7v4",
  copy: "M5.5 5.5h7v8h-7zM3.5 10.5v-8h7",
  code: "M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5",
  external: "M9 2.5h4.5V7M13.5 2.5L7 9M11.5 9.5v4h-9v-9h4",
  key: "M5.5 7a3 3 0 1 1 0 .1zM8.3 8.3l5.2 5.2M11 11l1.5-1.5M12.5 12.5L14 11",
  check: "M3 8.5l3 3 7-7",
  close: "M4 4l8 8M12 4l-8 8",
  ok: "M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2zM5.3 8.2l1.9 1.9 3.6-3.8",
  fail: "M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2zM6 6l4 4M10 6l-4 4",
  warning: "M8 2.5l6 11H2zM8 6.5v3M8 11.5v.5",
  info: "M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2zM8 7.5V11M8 5v.5",
  unknown: "M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2zM6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.3M8 11.3v.2",
  chevronDown: "M4 6l4 4 4-4",
  chevronRight: "M6 4l4 4-4 4",
  back: "M9.5 4L5.5 8l4 4",
  sessions: "M2.5 3.5h11v7h-11zM5.5 13.5h5M8 10.5v3",
  lock: "M4 7.5h8v6H4zM5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2",
  clock: "M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2zM8 4.5V8l2.5 1.5",
  table: "M2.5 3.5h11v9h-11zM2.5 6.5h11M2.5 9.5h11M6 6.5v6",
  database: "M3 4c0-1 2.2-1.8 5-1.8s5 .8 5 1.8-2.2 1.8-5 1.8S3 5 3 4zM3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8",
  schema: "M2 4.5h4.5l1.2 1.5H14v7H2z",
  link: "M6.5 9.5l3-3M5 8l-1.5 1.5a2.1 2.1 0 0 0 3 3L8 11M8 5l1.5-1.5a2.1 2.1 0 0 1 3 3L11 8",
  play: "M5 3.5v9l7-4.5z",
  shield: "M8 1.8l5.2 2v4c0 3.2-2.2 5.3-5.2 6.4C5 13.1 2.8 11 2.8 7.8v-4zM5.8 8l1.6 1.6 3-3.2",
  bug: "M5.5 5.5h5v5a2.5 2.5 0 0 1-5 0zM6 5.5a2 2 0 0 1 4 0M2.5 7.5h3M10.5 7.5h3M2.5 11h3M10.5 11h3M8 8v5",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6a2 2 0 1 1 0 4a2 2 0 1 1 0-4z",
  download: "M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10",
  settings: "M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7M11 3v3M5 10v3",
  minus: "M3 8h10",
};

defineProps<{ name: string; size?: number; title?: string }>();
</script>

<template>
  <svg
    class="icon"
    :width="size ?? 16"
    :height="size ?? 16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    :aria-hidden="title ? undefined : 'true'"
    :role="title ? 'img' : undefined"
  >
    <title v-if="title">{{ title }}</title>
    <path :d="PATHS[name] ?? PATHS.info" :fill="name === 'play' ? 'currentColor' : 'none'" />
  </svg>
</template>
