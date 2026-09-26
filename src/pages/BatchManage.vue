<script setup lang="ts">
// 批次管理页：待审批次通过后整批冻结价格与生效日期；
// 已通过批次可发起补录（另建带原因版本并保留旧值），可查版本历史。
import { computed, ref } from "vue";
import { useBatchStore } from "../price/store";
import type { PriceVersion } from "../price/types";

const store = useBatchStore();

const tab = ref<"pending" | "approved" | "versions">("pending");
const historyKey = ref("");

const list = computed(() =>
  tab.value === "pending" ? store.pendingBatches : store.approvedBatches,
);

const versionKeys = computed(() => {
  const keys = new Map<string, PriceVersion>();
  for (const v of store.versions) {
    const key = `${v.station}|${v.fuel}`;
    const prev = keys.get(key);
    if (!prev || v.version > prev.version) keys.set(key, v);
  }
  return [...keys.values()].sort((a, b) =>
    `${a.station}${a.fuel}`.localeCompare(`${b.station}${b.fuel}`),
  );
});

const currentVersion = computed(() =>
  historyKey.value ? store.currentVersion(historyKey.value) : undefined,
);
const history = computed(() =>
  historyKey.value
    ? store.historyOf(historyKey.value.split("|")[0], historyKey.value.split("|")[1])
    : [],
);

function approve(id: string) {
  const batch = store.approveBatch(id);
  tab.value = "approved";
  alert(`批次 ${batch.batchNo} 已通过，整批价格与生效日期已冻结`);
}

function startSupplement(batchNo: string) {
  store.startSupplement(batchNo);
}
</script>

<template>
  <section class="list-panel batches-page">
    <div class="toolbar batch-tabs">
      <h2>调价批次</h2>
      <div class="seg">
        <button type="button" :class="{ secondary: tab !== 'pending' }" @click="tab = 'pending'">
          待审（{{ store.pendingBatches.length }}）
        </button>
        <button type="button" :class="{ secondary: tab !== 'approved' }" @click="tab = 'approved'">
          已通过（{{ store.approvedBatches.length }}）
        </button>
        <button type="button" :class="{ secondary: tab !== 'versions' }" @click="tab = 'versions'">
          冻结价格版本（{{ versionKeys.length }}）
        </button>
      </div>
    </div>

    <template v-if="tab !== 'versions'">
      <div v-if="list.length === 0" class="empty">
        {{ tab === "pending" ? "暂无待审批次" : "暂无已通过批次，批次通过后价格与生效日期将冻结" }}
      </div>
      <div class="batch-grid">
        <article v-for="batch in list" :key="batch.id" class="record batch-card">
          <div class="record-head">
            <p class="record-title">{{ batch.batchNo }}</p>
            <span class="status" :class="{ frozen: batch.status === '已通过' }">{{ batch.status }}</span>
          </div>
          <p v-if="batch.basedOnBatchNo" class="note">
            补录批次，来源：{{ batch.basedOnBatchNo }}；原因：{{ batch.reason }}
          </p>
          <table class="zone-table">
            <thead>
              <tr><th>站点</th><th>油品</th><th>挂牌价</th><th>生效日</th><th v-if="batch.status === '已通过'">旧值</th></tr>
            </thead>
            <tbody>
              <tr v-for="entry in batch.entries" :key="entry.id">
                <td>{{ entry.station }}</td>
                <td>{{ entry.fuel }}</td>
                <td class="frozen-cell">{{ entry.price }}</td>
                <td class="frozen-cell">{{ entry.effectiveDate }}</td>
                <td v-if="batch.status === '已通过'">
                  <template v-if="entry.oldPrice">
                    {{ entry.oldPrice }} / {{ entry.oldEffectiveDate }}
                  </template>
                  <template v-else>首次定价</template>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="batch-meta">
            <span>送审：{{ new Date(batch.submittedAt).toLocaleString() }}</span>
            <span v-if="batch.approvedAt">通过：{{ new Date(batch.approvedAt).toLocaleString() }}</span>
            <span v-if="!batch.basedOnBatchNo && batch.reason">说明：{{ batch.reason }}</span>
          </div>
          <div class="actions">
            <button v-if="batch.status === '待审'" type="button" @click="approve(batch.id)">
              审批通过（整批冻结）
            </button>
            <button v-else type="button" class="secondary" @click="startSupplement(batch.batchNo)">
              对此批次补录（另建带原因版本）
            </button>
          </div>
        </article>
      </div>
    </template>

    <template v-else>
      <div class="version-picker">
        <label>
          选择站点 / 油品查看版本
          <select v-model="historyKey">
            <option value="">请选择</option>
            <option v-for="v in versionKeys" :key="`${v.station}|${v.fuel}`" :value="`${v.station}|${v.fuel}`">
              {{ v.station }} / {{ v.fuel }}
            </option>
          </select>
        </label>
      </div>
      <div v-if="!historyKey" class="empty">选择站点油品后查看冻结版本与补录历史</div>
      <div v-else class="version-detail">
        <p class="note" v-if="currentVersion">
          当前冻结：{{ currentVersion.price }} 元，生效日 {{ currentVersion.effectiveDate }}
          （第 {{ currentVersion.version }} 版，批次 {{ currentVersion.batchNo }}，原因：{{ currentVersion.reason }}）
        </p>
        <table class="zone-table">
          <thead>
            <tr><th>版本</th><th>挂牌价</th><th>生效日</th><th>来源批次</th><th>原因</th><th>时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="v in history" :key="`${v.batchNo}-${v.version}`">
              <td>v{{ v.version }}</td>
              <td>{{ v.price }}</td>
              <td>{{ v.effectiveDate }}</td>
              <td>{{ v.batchNo }}</td>
              <td>{{ v.reason }}</td>
              <td>{{ new Date(v.createdAt).toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
