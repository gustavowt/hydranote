<template>
  <svg viewBox="0 0 24 24" fill="none" v-bind="$attrs">
    <path d="M18 3H6C4.34 3 3 4.34 3 6V18C3 19.66 4.34 21 6 21H18C19.66 21 21 19.66 21 18V6C21 4.34 19.66 3 18 3Z" fill="#4285F4"/>
    <path d="M18 3H6C4.34 3 3 4.34 3 6V8H21V6C21 4.34 19.66 3 18 3Z" fill="#1967D2"/>
    <rect x="6" y="10" width="3" height="2.5" rx="0.5" fill="white"/>
    <rect x="10.5" y="10" width="3" height="2.5" rx="0.5" fill="white"/>
    <rect x="15" y="10" width="3" height="2.5" rx="0.5" fill="white"/>
    <rect x="6" y="14" width="3" height="2.5" rx="0.5" fill="white"/>
    <rect x="10.5" y="14" width="3" height="2.5" rx="0.5" fill="white"/>
    <rect x="15" y="14" width="3" height="2.5" rx="0.5" fill="white"/>
  </svg>
</template>

<script setup lang="ts">
defineOptions({
  name: 'GoogleCalendarIcon',
  inheritAttrs: false,
});
</script>
