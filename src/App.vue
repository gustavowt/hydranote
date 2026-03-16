<template>
  <ion-app>
    <ion-router-outlet />
    <UpdateBanner />
  </ion-app>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import UpdateBanner from '@/components/UpdateBanner.vue';
import { startUpdateChecker, stopUpdateChecker } from '@/services/updateService';

onMounted(() => startUpdateChecker());
onUnmounted(() => stopUpdateChecker());
</script>
