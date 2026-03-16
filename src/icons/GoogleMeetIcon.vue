<template>
  <svg viewBox="0 0 24 24" fill="none" v-bind="$attrs">
    <path d="M14.5 11.5V7.5C14.5 6.95 14.95 6.5 15.5 6.5H17.5L21.5 2.5V21.5L17.5 17.5H15.5C14.95 17.5 14.5 17.05 14.5 16.5V12.5" stroke="currentColor" stroke-width="0" fill="#00897B"/>
    <rect x="2.5" y="6.5" width="12" height="11" rx="1" fill="#00897B"/>
    <path d="M16 7L21 3V21L16 17" fill="#00AC47"/>
    <path d="M2.5 6.5H14.5V17.5H2.5V6.5Z" fill="#00897B"/>
    <path d="M14.5 12L21 7V17L14.5 12Z" fill="#00AC47"/>
  </svg>
</template>

<script setup lang="ts">
defineOptions({
  name: 'GoogleMeetIcon',
  inheritAttrs: false,
});
</script>
