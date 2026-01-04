<template>
  <svg viewBox="0 0 24 24" fill="currentColor" v-bind="$attrs">
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M12 6v6l4 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
</template>

<script setup lang="ts">
defineOptions({
  name: 'SearxngIcon',
  inheritAttrs: false,
});
</script>

