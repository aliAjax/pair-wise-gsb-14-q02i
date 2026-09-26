<script setup lang="ts">
// 油品价格维护入口：单条调价、批量调价、批次管理三页分开。
import { computed } from "vue";
import { useBatchStore } from "./price/store";
import SinglePrice from "./pages/SinglePrice.vue";
import BulkPrice from "./pages/BulkPrice.vue";
import BatchManage from "./pages/BatchManage.vue";

const store = useBatchStore();

const tabs = [
  { key: "single", label: "单条调价" },
  { key: "bulk", label: "批量调价" },
  { key: "batches", label: "调价批次" },
];

const metrics = computed(() => [
  { label: "待审批次", value: store.pendingBatches.length },
  { label: "已通过批次", value: store.approvedBatches.length },
  {
    label: "冻结站点油品价",
    value: new Set(store.versions.map((v) => `${v.station}|${v.fuel}`)).size,
  },
]);
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业前端最小闭环</p>
          <h1>油品价格维护</h1>
          <p class="subtitle">
            接收总部调价清单批量调价：格式正确的行进入待审区，异常行写明原因、改完并入同一批；
            审批通过后整批价格与生效日期冻结，补录另建带原因版本并保留旧值。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">Vite</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Pinia</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="item in metrics" :key="item.label" class="metric">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </article>
      </section>

      <nav class="page-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          :class="{ active: store.activeTab === tab.key }"
          @click="store.activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>

      <SinglePrice v-if="store.activeTab === 'single'" />
      <BulkPrice v-else-if="store.activeTab === 'bulk'" />
      <BatchManage v-else />
    </div>
  </main>
</template>
