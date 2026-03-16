<template>
  <svg viewBox="0 0 24 24" fill="none" v-bind="$attrs">
    <rect x="1" y="4" width="22" height="16" rx="4" fill="#2D8CFF"/>
    <path d="M5 8.5C5 7.67 5.67 7 6.5 7H13.5C14.33 7 15 7.67 15 8.5V15.5C15 16.33 14.33 17 13.5 17H6.5C5.67 17 5 16.33 5 15.5V8.5Z" fill="white"/>
    <path d="M15 10.5L19 8V16L15 13.5V10.5Z" fill="white"/>
  </svg>
</template>

<script setup lang="ts">
defineOptions({
  name: 'ZoomIcon',
  inheritAttrs: false,
});
</script>
