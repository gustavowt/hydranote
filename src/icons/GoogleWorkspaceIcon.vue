<template>
  <svg viewBox="0 0 24 24" fill="none" v-bind="$attrs">
    <!-- Google "G" shape with Workspace colors -->
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="#4285F4" opacity="0.15"/>
    <path d="M12 5c-3.87 0-7 3.13-7 7s3.13 7 7 7c1.93 0 3.68-.79 4.95-2.05l-2.4-2.4C13.78 15.47 12.93 16 12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4c1.1 0 2.09.45 2.81 1.17L17.25 6.7A6.978 6.978 0 0012 5z" fill="#4285F4"/>
    <path d="M19 12h-3v2h1.59C16.83 15.78 14.56 17 12 17v0c-.34 0-.67-.03-1-.08V12h4v-2h-4V7.08c.33-.05.66-.08 1-.08 2.56 0 4.83 1.22 5.59 3H19v2z" fill="#34A853"/>
    <circle cx="17.5" cy="7.5" r="1.5" fill="#EA4335"/>
    <circle cx="17.5" cy="16.5" r="1.5" fill="#FBBC05"/>
    <circle cx="6.5" cy="12" r="1.5" fill="#4285F4"/>
  </svg>
</template>

<script setup lang="ts">
defineOptions({
  name: 'GoogleWorkspaceIcon',
  inheritAttrs: false,
});
</script>
