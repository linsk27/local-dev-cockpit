<template>
  <svg class="dev-pilot-mark" viewBox="0 0 64 64" role="img" :aria-label="title">
    <defs>
      <linearGradient :id="shellId" x1="10" x2="54" y1="8" y2="58" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="currentColor" stop-opacity="0.92" />
        <stop offset="1" stop-color="currentColor" stop-opacity="0.18" />
      </linearGradient>
      <radialGradient :id="glowId" cx="50%" cy="42%" r="62%">
        <stop offset="0" stop-color="currentColor" stop-opacity="0.3" />
        <stop offset="1" stop-color="currentColor" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect x="5" y="5" width="54" height="54" rx="15" :fill="`url(#${glowId})`" />
    <path d="M16 42V22h15.5c7.8 0 14 6.2 14 14v6" fill="none" :stroke="`url(#${shellId})`" stroke-width="5.2" stroke-linecap="round" />
    <path d="M26 42V28h6.7c4.1 0 7.3 3.2 7.3 7.3V42" fill="none" stroke="currentColor" stroke-width="3.3" stroke-linecap="round" opacity="0.95" />
    <circle cx="32" cy="32" r="19" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.28" />
    <circle cx="32" cy="32" r="10.5" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.18" />
    <path d="M32 13v6M32 45v6M13 32h6M45 32h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.38" />
    <path d="M32 32 47 21" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity="0.82" />
    <circle cx="47" cy="21" r="3.2" fill="currentColor" />
    <circle cx="20" cy="45" r="2.4" fill="currentColor" opacity="0.78" />
    <circle cx="48" cy="43" r="2.1" fill="currentColor" opacity="0.55" />
  </svg>
</template>

<script setup lang="ts">
defineProps<{
  title?: string;
}>();

const idBase = `pilot-${Math.random().toString(36).slice(2)}`;
const shellId = `${idBase}-shell`;
const glowId = `${idBase}-glow`;
</script>
