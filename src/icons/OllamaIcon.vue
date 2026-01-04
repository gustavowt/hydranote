<template>
  <svg viewBox="0 0 24 24" fill="currentColor" v-bind="$attrs">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" opacity="0"/>
    <ellipse cx="12" cy="10" rx="6" ry="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="9.5" cy="9" r="1"/>
    <circle cx="14.5" cy="9" r="1"/>
    <ellipse cx="12" cy="12" rx="2" ry="1" fill="none" stroke="currentColor" stroke-width="1"/>
    <path d="M8 14c0 2 1.5 4 4 4s4-2 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M6 10c-1-1-2-1.5-2-3s1.5-2.5 2-2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M18 10c1-1 2-1.5 2-3s-1.5-2.5-2-2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
</template>

<script setup lang="ts">
defineOptions({
  name: 'OllamaIcon',
  inheritAttrs: false,
});
</script>

