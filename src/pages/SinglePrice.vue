<script setup lang="ts">
// 单条调价页：保留原有逐条录入与列表能力。
import { computed, reactive, ref } from "vue";

type Field = {
  key: string;
  label: string;
  type?: "number" | "date" | "select";
  options?: readonly string[];
};

type RecordItem = {
  id: string;
  status: string;
  notes: string;
  createdAt: string;
  [key: string]: string | number;
};

const fields: Field[] = [
  { key: "fuel", label: "油品", type: "select", options: ["92号汽油", "95号汽油", "98号汽油", "柴油"] },
  { key: "price", label: "挂牌价", type: "number" },
  { key: "operator", label: "操作员" },
  { key: "effectiveDate", label: "生效日期", type: "date" },
];
const statuses = ["生效中", "待确认", "已回退"];
const filters = ["全部油品", "92号汽油", "95号汽油", "98号汽油", "柴油"];
const seedRecords = [
  { fuel: "92号汽油", price: 7.62, operator: "站长", effectiveDate: "2026-06-30", status: "生效中", notes: "正常调价" },
  { fuel: "柴油", price: 7.18, operator: "值班经理", effectiveDate: "2026-06-30", status: "待确认", notes: "等待复核" },
];
const storageKey = "dfwlfront-9-price";

function createBlank() {
  return Object.fromEntries(fields.map((field) => [field.key, field.type === "number" ? 0 : ""]));
}

function loadRecords(): RecordItem[] {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return seedRecords.map((record, index) => ({
      ...record,
      id: `seed-${index + 1}`,
      createdAt: new Date(Date.now() - index * 86400000).toISOString(),
    })) as RecordItem[];
  }
  try {
    return JSON.parse(raw) as RecordItem[];
  } catch {
    return [];
  }
}

const records = ref<RecordItem[]>(loadRecords());
const form = reactive<Record<string, string | number>>(createBlank());
const note = ref("");
const filter = ref(filters[0]);

const filteredRecords = computed(() => {
  if (filter.value.startsWith("全部")) return records.value;
  return records.value.filter((record) => Object.values(record).includes(filter.value));
});

function persist() {
  localStorage.setItem(storageKey, JSON.stringify(records.value));
}

function nextStatus(status: string) {
  const index = statuses.indexOf(status);
  return statuses[(index + 1) % statuses.length];
}

function primaryText(record: RecordItem) {
  const first = fields[0];
  const second = fields[1];
  return [record[first.key], record[second.key]].filter(Boolean).join(" / ") || "油品";
}

function submit() {
  records.value = [
    {
      ...form,
      id: crypto.randomUUID(),
      status: statuses[0],
      notes: note.value || "暂无备注",
      createdAt: new Date().toISOString(),
    } as RecordItem,
    ...records.value,
  ];
  Object.assign(form, createBlank());
  note.value = "";
  persist();
}

function flow(record: RecordItem) {
  record.status = nextStatus(record.status);
  persist();
}

function remove(id: string) {
  records.value = records.value.filter((record) => record.id !== id);
  persist();
}
</script>

<template>
  <section class="workspace">
    <form class="panel" @submit.prevent="submit">
      <h2>调整油品价格</h2>
      <div class="form-grid">
        <label v-for="field in fields" :key="field.key">
          {{ field.label }}
          <select v-if="field.type === 'select'" v-model="form[field.key]" required>
            <option value="">请选择</option>
            <option v-for="option in field.options" :key="option">{{ option }}</option>
          </select>
          <input v-else v-model="form[field.key]" :type="field.type || 'text'" required />
        </label>
        <label>
          备注
          <textarea v-model="note" placeholder="填写处理说明或现场备注" />
        </label>
        <button type="submit">保存价格</button>
      </div>
    </form>

    <section class="list-panel">
      <div class="toolbar">
        <h2>油品列表</h2>
        <select v-model="filter">
          <option v-for="item in filters" :key="item">{{ item }}</option>
        </select>
      </div>

      <div class="record-grid">
        <div v-if="filteredRecords.length === 0" class="empty">暂无匹配数据</div>
        <article v-for="record in filteredRecords" :key="record.id" class="record">
          <div class="record-head">
            <p class="record-title">{{ primaryText(record) }}</p>
            <span class="status">{{ record.status }}</span>
          </div>
          <div class="details">
            <span v-for="field in fields" :key="field.key">{{ field.label }}: {{ record[field.key] }}</span>
          </div>
          <p class="note">{{ record.notes }}</p>
          <div class="actions">
            <button type="button" @click="flow(record)">流转状态</button>
            <button class="secondary" type="button" @click="navigator.clipboard?.writeText(primaryText(record))">复制摘要</button>
            <button class="danger" type="button" @click="remove(record.id)">删除</button>
          </div>
        </article>
      </div>
    </section>
  </section>
</template>
