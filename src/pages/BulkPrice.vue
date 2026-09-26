<script setup lang="ts">
// 批量调价页：一次粘贴站点/油品/挂牌价/生效日期，
// 正确行进待审区，异常行进异常区并写明原因，改完并入同一批，仍异常不能送审。
import { computed, onMounted, ref } from "vue";
import {
  IMPORT_GUIDE,
  PASTE_TEMPLATE,
  parsePriceText,
  revalidateRow,
} from "../price/importRules";
import type { InvalidRow, ValidRow } from "../price/types";
import { useBatchStore } from "../price/store";

const store = useBatchStore();

const pasteText = ref("");
const validRows = ref<ValidRow[]>([]);
const invalidRows = ref<InvalidRow[]>([]);
const reason = ref("");
const message = ref("");
const restoredAt = ref("");

const basedOnBatchNo = computed(() => store.supplementSource);
const sourceBatch = computed(() =>
  store.batches.find((b) => b.batchNo === basedOnBatchNo.value),
);

const occupiedKeys = computed(
  () => new Set(validRows.value.map((r) => `${r.station}|${r.fuel}`)),
);

const canSubmit = computed(
  () =>
    validRows.value.length > 0 &&
    invalidRows.value.length === 0 &&
    (!basedOnBatchNo.value || reason.value.trim().length > 0),
);

const blockReason = computed(() => {
  if (validRows.value.length === 0) return "待审区还没有行";
  if (invalidRows.value.length > 0) return `异常区还有 ${invalidRows.value.length} 行未处理`;
  if (basedOnBatchNo.value && !reason.value.trim()) return "补录批次必须填写原因";
  return "";
});

onMounted(() => {
  // 中断过的编辑可从暂存恢复；补录模式切换后旧暂存不匹配则丢弃。
  const draft = store.loadDraft();
  if (draft && draft.basedOnBatchNo === store.supplementSource) {
    validRows.value = draft.valid;
    invalidRows.value = draft.invalid;
    reason.value = draft.reason;
    restoredAt.value = draft.savedAt;
  } else if (draft) {
    store.clearDraft();
  }
});

function flash(text: string) {
  message.value = text;
}

function handleParse() {
  if (!pasteText.value.trim()) {
    flash("请先粘贴调价清单内容");
    return;
  }

  const result = parsePriceText(pasteText.value);

  // 与本次粘贴前已在待审区的行再做一次跨粘贴查重
  const extraInvalid: InvalidRow[] = [];
  const mergedValid: ValidRow[] = [];
  for (const row of result.valid) {
    if (occupiedKeys.value.has(`${row.station}|${row.fuel}`)) {
      extraInvalid.push({
        id: row.id,
        line: row.line,
        cells: [row.station, row.fuel, row.price, row.effectiveDate],
        reason: "与待审区已存在的行站点油品重复",
      });
    } else {
      mergedValid.push(row);
      occupiedKeys.value.add(`${row.station}|${row.fuel}`);
    }
  }

  validRows.value.push(...mergedValid);
  invalidRows.value.push(...result.invalid, ...extraInvalid);
  pasteText.value = "";
  flash(
    `解析完成：${mergedValid.length} 行进入待审区，` +
      `${result.invalid.length + extraInvalid.length} 行进入异常区` +
      (result.skippedHeaderLine ? `，已跳过第 ${result.skippedHeaderLine} 行表头` : ""),
  );
}

function retryRow(row: InvalidRow) {
  const result = revalidateRow(row.cells, row.line, occupiedKeys.value);
  if (result.data) {
    validRows.value.push(result.data);
    invalidRows.value = invalidRows.value.filter((r) => r.id !== row.id);
    flash(`第 ${row.line} 行已修正，并入待审区`);
  } else {
    row.reason = result.reason || "仍不符合导入规则";
    flash(`第 ${row.line} 行仍异常：${row.reason}`);
  }
}

function removeInvalid(row: InvalidRow) {
  invalidRows.value = invalidRows.value.filter((r) => r.id !== row.id);
}

function removeValid(row: ValidRow) {
  validRows.value = validRows.value.filter((r) => r.id !== row.id);
}

function handleSaveDraft() {
  store.saveDraft({
    valid: validRows.value,
    invalid: invalidRows.value,
    reason: reason.value,
    basedOnBatchNo: basedOnBatchNo.value,
  });
  flash("批次已暂存，可稍后继续处理异常行");
}

function discardDraft() {
  store.clearDraft();
  validRows.value = [];
  invalidRows.value = [];
  reason.value = "";
  restoredAt.value = "";
}

function handleSubmit() {
  if (!canSubmit.value) return;
  const batch = store.submitBatch(validRows.value, {
    reason: reason.value,
    basedOnBatchNo: basedOnBatchNo.value,
  });
  store.clearDraft();
  store.exitSupplement();
  validRows.value = [];
  invalidRows.value = [];
  reason.value = "";
  restoredAt.value = "";
  store.activeTab = "batches";
  flash(`批次 ${batch.batchNo} 已送审`);
}
</script>

<template>
  <section class="bulk-page">
    <div v-if="basedOnBatchNo" class="supplement-banner">
      <strong>补录模式</strong>
      <span>
        基于已通过批次 {{ basedOnBatchNo }} 另建带原因的新版本，审批通过后保留旧值。
      </span>
      <ul v-if="sourceBatch" class="supplement-list">
        <li v-for="entry in sourceBatch.entries" :key="entry.id">
          {{ entry.station }} / {{ entry.fuel }}：{{ entry.price }} 元，生效日 {{ entry.effectiveDate }}
        </li>
      </ul>
      <button type="button" class="secondary" @click="store.exitSupplement()">退出补录</button>
    </div>

    <div v-if="restoredAt" class="draft-banner">
      已恢复 {{ new Date(restoredAt).toLocaleString() }} 暂存的批次：
      {{ validRows.length }} 行待审、{{ invalidRows.length }} 行异常。
      <button type="button" class="secondary" @click="discardDraft">放弃暂存</button>
    </div>

    <div class="panel">
      <div class="toolbar">
        <h2>粘贴总部调价清单</h2>
        <button type="button" class="secondary" @click="pasteText = PASTE_TEMPLATE">填入示例</button>
      </div>
      <textarea
        v-model="pasteText"
        class="paste-area"
        placeholder="站点&#10;制表符/逗号分隔：站点、油品、挂牌价、生效日期"
      ></textarea>
      <div class="actions">
        <button type="button" @click="handleParse">解析并校验</button>
      </div>
      <details class="guide">
        <summary>导入规则</summary>
        <ol>
          <li v-for="(rule, index) in IMPORT_GUIDE" :key="index">{{ rule }}</li>
        </ol>
      </details>
      <p v-if="message" class="note">{{ message }}</p>
    </div>

    <div class="zone-grid">
      <section class="list-panel zone zone-ok">
        <div class="toolbar">
          <h2>待审区（{{ validRows.length }}）</h2>
        </div>
        <table v-if="validRows.length" class="zone-table">
          <thead>
            <tr><th>行</th><th>站点</th><th>油品</th><th>挂牌价</th><th>生效日</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="row in validRows" :key="row.id">
              <td>{{ row.line }}</td>
              <td>{{ row.station }}</td>
              <td>{{ row.fuel }}</td>
              <td>{{ row.price }}</td>
              <td>{{ row.effectiveDate }}</td>
              <td><button type="button" class="secondary tiny" @click="removeValid(row)">移除</button></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">格式正确的行将进入这里</div>
      </section>

      <section class="list-panel zone zone-bad">
        <div class="toolbar">
          <h2>异常区（{{ invalidRows.length }}）</h2>
        </div>
        <div v-if="invalidRows.length" class="invalid-list">
          <article v-for="row in invalidRows" :key="row.id" class="invalid-row">
            <p class="invalid-line">第 {{ row.line }} 行</p>
            <div class="invalid-cells">
              <label>站点<input v-model="row.cells[0]" /></label>
              <label>油品<input v-model="row.cells[1]" list="fuel-options" /></label>
              <label>挂牌价<input v-model="row.cells[2]" inputmode="decimal" /></label>
              <label>生效日<input v-model="row.cells[3]" type="date" /></label>
            </div>
            <p class="invalid-reason">原因：{{ row.reason }}</p>
            <div class="actions">
              <button type="button" @click="retryRow(row)">重新校验并入批</button>
              <button type="button" class="danger" @click="removeInvalid(row)">丢弃该行</button>
            </div>
          </article>
        </div>
        <div v-else class="empty">重复站点油品、小数位不对或生效日早于当天的行将留在这</div>
      </section>
    </div>

    <datalist id="fuel-options">
      <option value="92号汽油"></option>
      <option value="95号汽油"></option>
      <option value="98号汽油"></option>
      <option value="柴油"></option>
    </datalist>

    <section class="panel submit-bar">
      <label class="reason-field">
        {{ basedOnBatchNo ? "补录原因（必填）" : "批次备注/原因（选填）" }}
        <textarea
          v-model="reason"
          :placeholder="basedOnBatchNo ? '说明本次补录原因，随新版本一并冻结' : '如：总部2026年第39周调价清单'"
        ></textarea>
      </label>
      <div class="actions submit-actions">
        <button type="button" class="secondary" @click="handleSaveDraft">暂存批次</button>
        <button type="button" :disabled="!canSubmit" @click="handleSubmit">送审</button>
        <span v-if="!canSubmit" class="block-tip">不能送审：{{ blockReason }}</span>
      </div>
    </section>
  </section>
</template>
