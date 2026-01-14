<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 100 100"
    fill="currentColor"
    v-bind="$attrs"
  >
    <!-- Hugging Face Logo - simplified version -->
    <path
      d="M50 5C25.1 5 5 25.1 5 50s20.1 45 45 45 45-20.1 45-45S74.9 5 50 5zm0 82c-20.4 0-37-16.6-37-37s16.6-37 37-37 37 16.6 37 37-16.6 37-37 37z"
    />
    <!-- Left eye -->
    <circle cx="35" cy="42" r="6" />
    <!-- Right eye -->
    <circle cx="65" cy="42" r="6" />
    <!-- Smile -->
    <path
      d="M30 58c0 0 8 14 20 14s20-14 20-14"
      fill="none"
      stroke="currentColor"
      stroke-width="5"
      stroke-linecap="round"
    />
    <!-- Left ear -->
    <ellipse cx="22" cy="30" rx="8" ry="12" />
    <!-- Right ear -->
    <ellipse cx="78" cy="30" rx="8" ry="12" />
  </svg>
</template>

<script setup lang="ts">
// HuggingFace icon component
// Uses currentColor for theming support
</script>
