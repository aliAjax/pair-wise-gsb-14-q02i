<script setup lang="ts">
import { computed, ref } from "vue";
import {
  FUEL_OPTIONS,
  parsePaste,
  rowKey,
  splitRows,
  todayString,
  validateRow,
  type BatchRow,
  type ExceptionRow
} from "../batch/importRules";
import {
  approveBatch,
  createBatch,
  loadBatches,
  saveBatches,
  supplementBatch,
  type PriceBatch
} from "../batch/batchStore";

const pasteText = ref("");
const draftRows = ref<BatchRow[]>([]);
const exceptionRows = ref<ExceptionRow[]>([]);
const batches = ref<PriceBatch[]>(loadBatches());
const message = ref("");

/** 补录表单的展开状态：batchId -> { text, reason } */
const supplementForms = ref<Record<string, { text: string; reason: string; error: string }>>({});
const expandedVersions = ref<Record<string, boolean>>({});

const canSubmit = computed(() => draftRows.value.length > 0 && exceptionRows.value.length === 0);

function draftKeys(excludeId?: string): Set<string> {
  return new Set(draftRows.value.filter((row) => row.id !== excludeId).map(rowKey));
}

function parse() {
  if (!pasteText.value.trim()) {
    message.value = "请先粘贴调价清单。";
    return;
  }
  const parsed = parsePaste(pasteText.value);
  const { valid, exceptions } = splitRows(parsed, todayString(), draftKeys());
  draftRows.value = [...draftRows.value, ...valid];
  exceptionRows.value = [...exceptionRows.value, ...exceptions];
  pasteText.value = "";
  message.value = `解析 ${parsed.length} 行：${valid.length} 行进入待审区，${exceptions.length} 行进入异常区。`;
}

/** 异常区改完后重新校验，通过的并入同一批待审区。 */
function recheckExceptions() {
  const stillBad: ExceptionRow[] = [];
  const fixed: BatchRow[] = [];
  const today = todayString();
  const keys = draftKeys();
  const seen = new Map<string, number>();

  for (const row of exceptionRows.value) {
    const reasons = validateRow(row, today);
    const key = rowKey(row);
    if (row.station && row.fuel) {
      if (keys.has(key)) {
        reasons.push(`重复站点油品：待审区已存在「${row.station} / ${row.fuel}」`);
      } else if (seen.has(key)) {
        reasons.push(`重复站点油品：异常区第 ${seen.get(key)} 条已包含「${row.station} / ${row.fuel}」`);
      }
    }
    if (reasons.length > 0) {
      stillBad.push({ ...row, reasons });
    } else {
      seen.set(key, row.lineNo);
      const { reasons: _drop, ...rest } = row;
      fixed.push(rest);
    }
  }
  exceptionRows.value = stillBad;
  draftRows.value = [...draftRows.value, ...fixed];
  message.value = fixed.length > 0
    ? `${fixed.length} 行已修正并入待审区，仍有 ${stillBad.length} 行异常。`
    : "没有可并入的行，请按异常原因修改。";
}

function removeDraft(id: string) {
  draftRows.value = draftRows.value.filter((row) => row.id !== id);
}

function removeException(id: string) {
  exceptionRows.value = exceptionRows.value.filter((row) => row.id !== id);
}

/** 送审前对待审区整体复核：仍有异常则留在异常区，本次不能送审。 */
function submitBatch() {
  const today = todayString();
  const keys = new Set<string>();
  const ok: BatchRow[] = [];
  const bad: ExceptionRow[] = [];
  for (const row of draftRows.value) {
    const reasons = validateRow(row, today);
    const key = rowKey(row);
    if (row.station && row.fuel && keys.has(key)) {
      reasons.push(`重复站点油品：本批已存在「${row.station} / ${row.fuel}」`);
    }
    if (reasons.length > 0) {
      bad.push({ ...row, reasons });
    } else {
      keys.add(key);
      ok.push(row);
    }
  }
  if (bad.length > 0) {
    draftRows.value = ok;
    exceptionRows.value = [...exceptionRows.value, ...bad];
    message.value = `待审区有 ${bad.length} 行复核未通过，已移回异常区，请修正后再送审。`;
    return;
  }
  if (ok.length === 0) {
    message.value = "待审区为空，不能送审。";
    return;
  }
  const batch = createBatch(ok, batches.value);
  batches.value = [batch, ...batches.value];
  saveBatches(batches.value);
  draftRows.value = [];
  message.value = `${batch.name} 已送审，共 ${ok.length} 行，等待审核。`;
}

function approve(batch: PriceBatch) {
  approveBatch(batch);
  saveBatches(batches.value);
  message.value = `${batch.name} 审核通过，整批价格与生效日期已冻结。`;
}

function openSupplement(batch: PriceBatch) {
  if (!supplementForms.value[batch.id]) {
    const text = batch.rows
      .map((row) => `${row.station}\t${row.fuel}\t${row.price}\t${row.effectiveDate}`)
      .join("\n");
    supplementForms.value[batch.id] = { text, reason: "", error: "" };
  } else {
    delete supplementForms.value[batch.id];
  }
}

/** 冻结批次补录：另建带原因的版本，旧值保留在版本历史中。 */
function submitSupplement(batch: PriceBatch) {
  const form = supplementForms.value[batch.id];
  if (!form) return;
  if (!form.reason.trim()) {
    form.error = "请填写补录原因。";
    return;
  }
  const parsed = parsePaste(form.text);
  if (parsed.length === 0) {
    form.error = "请粘贴补录内容。";
    return;
  }
  const { valid, exceptions } = splitRows(parsed, todayString());
  if (exceptions.length > 0) {
    form.error = `补录内容有 ${exceptions.length} 行异常：${exceptions
      .map((row) => `第 ${row.lineNo} 行（${row.reasons.join("；")}）`)
      .join("；")}`;
    return;
  }
  supplementBatch(batch, valid, form.reason.trim());
  saveBatches(batches.value);
  delete supplementForms.value[batch.id];
  message.value = `${batch.name} 已补录为版本 ${batch.versions.length}，旧版本已保留。`;
}

function toggleVersions(batch: PriceBatch) {
  expandedVersions.value[batch.id] = !expandedVersions.value[batch.id];
}

function formatTime(iso: string) {
  return iso.replace("T", " ").slice(0, 16);
}
</script>

<template>
  <section class="batch-page">
    <div class="panel">
      <h2>批量调价导入</h2>
      <p class="hint">
        每行一条，依次粘贴：站点、油品、挂牌价（两位小数）、生效日（YYYY-MM-DD，不早于当天），列之间用 Tab、逗号或空格分隔。
      </p>
      <textarea
        v-model="pasteText"
        class="paste-area"
        placeholder="示例：&#10;城东加油站	92号汽油	7.62	2026-09-27&#10;城西加油站	柴油	7.18	2026-09-27"
      />
      <div class="actions">
        <button type="button" @click="parse">解析导入</button>
        <span v-if="message" class="message">{{ message }}</span>
      </div>
    </div>

    <div class="panel">
      <div class="toolbar">
        <h2>待审区（{{ draftRows.length }}）</h2>
        <button
          type="button"
          :disabled="!canSubmit"
          :title="exceptionRows.length > 0 ? '异常区仍有未修正的行，不能送审' : ''"
          @click="submitBatch"
        >
          送审
        </button>
      </div>
      <div v-if="draftRows.length === 0" class="empty">暂无待审数据</div>
      <table v-else class="batch-table">
        <thead>
          <tr><th>站点</th><th>油品</th><th>挂牌价</th><th>生效日</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="row in draftRows" :key="row.id">
            <td><input v-model="row.station" /></td>
            <td>
              <select v-model="row.fuel">
                <option v-for="fuel in FUEL_OPTIONS" :key="fuel">{{ fuel }}</option>
              </select>
            </td>
            <td><input v-model="row.price" placeholder="0.00" /></td>
            <td><input v-model="row.effectiveDate" type="date" /></td>
            <td><button class="danger" type="button" @click="removeDraft(row.id)">移除</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="exceptionRows.length > 0" class="panel exception-panel">
      <div class="toolbar">
        <h2>异常区（{{ exceptionRows.length }}）</h2>
        <button class="secondary" type="button" @click="recheckExceptions">重新校验并入</button>
      </div>
      <p class="hint">以下行未通过校验，请按原因修改后并入同一批；异常未清空前不能送审。</p>
      <table class="batch-table">
        <thead>
          <tr><th>来源行</th><th>站点</th><th>油品</th><th>挂牌价</th><th>生效日</th><th>异常原因</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="row in exceptionRows" :key="row.id">
            <td>{{ row.lineNo }}</td>
            <td><input v-model="row.station" /></td>
            <td>
              <select v-model="row.fuel">
                <option value="">请选择</option>
                <option v-for="fuel in FUEL_OPTIONS" :key="fuel">{{ fuel }}</option>
              </select>
            </td>
            <td><input v-model="row.price" placeholder="0.00" /></td>
            <td><input v-model="row.effectiveDate" type="date" /></td>
            <td>
              <ul class="reasons">
                <li v-for="reason in row.reasons" :key="reason">{{ reason }}</li>
              </ul>
            </td>
            <td><button class="danger" type="button" @click="removeException(row.id)">移除</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <h2>调价批次（{{ batches.length }}）</h2>
      <div v-if="batches.length === 0" class="empty">暂无批次</div>
      <article v-for="batch in batches" :key="batch.id" class="record batch-record">
        <div class="record-head">
          <p class="record-title">{{ batch.name }}（版本 {{ batch.versions.length }}）</p>
          <span class="status" :class="{ frozen: batch.status === '已冻结' }">{{ batch.status }}</span>
        </div>
        <p class="note">
          送审时间：{{ formatTime(batch.submittedAt) }}
          <template v-if="batch.approvedAt">　冻结时间：{{ formatTime(batch.approvedAt) }}</template>
        </p>
        <table class="batch-table readonly">
          <thead>
            <tr><th>站点</th><th>油品</th><th>挂牌价</th><th>生效日</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in batch.rows" :key="row.id">
              <td>{{ row.station }}</td>
              <td>{{ row.fuel }}</td>
              <td>{{ row.price }}</td>
              <td>{{ row.effectiveDate }}</td>
            </tr>
          </tbody>
        </table>
        <div class="actions">
          <button v-if="batch.status === '待审核'" type="button" @click="approve(batch)">审核通过并冻结</button>
          <button v-if="batch.status === '已冻结'" class="secondary" type="button" @click="openSupplement(batch)">
            {{ supplementForms[batch.id] ? "收起补录" : "补录新版本" }}
          </button>
          <button class="secondary" type="button" @click="toggleVersions(batch)">
            {{ expandedVersions[batch.id] ? "收起版本" : `版本历史（${batch.versions.length}）` }}
          </button>
        </div>

        <div v-if="expandedVersions[batch.id]" class="version-list">
          <div v-for="version in [...batch.versions].reverse()" :key="version.version" class="version-item">
            <p class="version-head">
              版本 {{ version.version }} ｜ {{ formatTime(version.createdAt) }} ｜ 原因：{{ version.reason }}
            </p>
            <table class="batch-table readonly">
              <thead>
                <tr><th>站点</th><th>油品</th><th>挂牌价</th><th>生效日</th></tr>
              </thead>
              <tbody>
                <tr v-for="row in version.rows" :key="row.id">
                  <td>{{ row.station }}</td>
                  <td>{{ row.fuel }}</td>
                  <td>{{ row.price }}</td>
                  <td>{{ row.effectiveDate }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-if="supplementForms[batch.id]" class="supplement-form">
          <p class="hint">原批次已冻结，补录将另建带原因的新版本，旧值保留在版本历史中。按导入格式粘贴调整后的整批内容：</p>
          <textarea v-model="supplementForms[batch.id].text" class="paste-area" />
          <label>
            补录原因
            <input v-model="supplementForms[batch.id].reason" placeholder="例如：总部调价清单勘误" />
          </label>
          <p v-if="supplementForms[batch.id].error" class="error-text">{{ supplementForms[batch.id].error }}</p>
          <div class="actions">
            <button type="button" @click="submitSupplement(batch)">保存补录版本</button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
