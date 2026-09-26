// 批次保存：调价批次的持久化、送审、审批冻结与补录版本。
// 页面只通过这里读写批次，校验规则在 importRules.ts。
import { defineStore } from "pinia";
import type { BatchEntry, PriceBatch, PriceVersion, ValidRow } from "./types";

const BATCHES_KEY = "dfwlfront-9-price-batches";
const VERSIONS_KEY = "dfwlfront-9-price-versions";
const DRAFT_KEY = "dfwlfront-9-price-draft";

/** 暂存到本地的编辑区草稿（含异常区，方便中断后继续改） */
export interface WorkspaceDraft {
  valid: ValidRow[];
  invalid: {
    id: string;
    line: number;
    cells: [string, string, string, string];
    reason: string;
  }[];
  reason: string;
  basedOnBatchNo: string;
  savedAt: string;
}

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function batchDay(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

interface CreateOptions {
  /** 补录原因；补录批次必填 */
  reason?: string;
  /** 补录来源批次号 */
  basedOnBatchNo?: string;
}

export const useBatchStore = defineStore("price-batch", {
  state: () => ({
    batches: readJson<PriceBatch[]>(BATCHES_KEY, []),
    versions: readJson<PriceVersion[]>(VERSIONS_KEY, []),
    /** 顶部页签：single 单条调价 / bulk 批量调价 / batches 调价批次 */
    activeTab: "bulk" as string,
    /** 批量页补录模式的来源批次号，空串表示普通批次 */
    supplementSource: "",
  }),

  getters: {
    pendingBatches: (state) => state.batches.filter((b) => b.status === "待审"),
    approvedBatches: (state) => state.batches.filter((b) => b.status === "已通过"),

    /** 站点|油品 → 当前冻结版本 */
    currentVersion(state): (key: string) => PriceVersion | undefined {
      return (key: string) =>
        [...state.versions]
          .filter((v) => `${v.station}|${v.fuel}` === key)
          .sort((a, b) => b.version - a.version)[0];
    },
  },

  actions: {
    persistBatches() {
      localStorage.setItem(BATCHES_KEY, JSON.stringify(this.batches));
    },
    persistVersions() {
      localStorage.setItem(VERSIONS_KEY, JSON.stringify(this.versions));
    },

    /** 暂存编辑区（含异常区） */
    saveDraft(draft: Omit<WorkspaceDraft, "savedAt">) {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ ...draft, savedAt: new Date().toISOString() }),
      );
    },
    loadDraft(): WorkspaceDraft | null {
      return readJson<WorkspaceDraft | null>(DRAFT_KEY, null);
    },
    clearDraft() {
      localStorage.removeItem(DRAFT_KEY);
    },

    /** 生成当天递增批次号：PL20260926-001 */
    nextBatchNo(): string {
      const prefix = `PL${batchDay()}-`;
      const seq =
        this.batches.filter((b) => b.batchNo.startsWith(prefix)).length + 1;
      return `${prefix}${pad(seq)}`;
    },

    /**
     * 送审：校验通过的行整批保存为“待审”批次。
     * 调用方必须保证异常区已清空。
     */
    submitBatch(rows: ValidRow[], options: CreateOptions = {}): PriceBatch {
      if (rows.length === 0) throw new Error("待审区没有可送审的行");
      if (options.basedOnBatchNo && !options.reason?.trim()) {
        throw new Error("补录批次必须填写原因");
      }
      const now = new Date().toISOString();
      const entries: BatchEntry[] = rows.map((row) => ({
        ...row,
        oldPrice: "",
        oldEffectiveDate: "",
      }));
      const batch: PriceBatch = {
        id: crypto.randomUUID(),
        batchNo: this.nextBatchNo(),
        status: "待审",
        entries,
        reason: options.reason?.trim() || "",
        createdAt: now,
        submittedAt: now,
        approvedAt: "",
        basedOnBatchNo: options.basedOnBatchNo || "",
      };
      this.batches.unshift(batch);
      this.persistBatches();
      return batch;
    },

    /**
     * 审批通过：整批价格与生效日期冻结。
     * 冻结时把站点油品的旧值快照到行内，并追加一条带原因的新版本，
     * 补录批次因此完整保留旧值。
     */
    approveBatch(id: string): PriceBatch {
      const batch = this.batches.find((b) => b.id === id);
      if (!batch) throw new Error("批次不存在");
      if (batch.status !== "待审") throw new Error("仅待审批次可以通过");

      for (const entry of batch.entries) {
        const key = `${entry.station}|${entry.fuel}`;
        const old = this.currentVersion(key);
        if (old) {
          entry.oldPrice = old.price;
          entry.oldEffectiveDate = old.effectiveDate;
        }
        this.versions.push({
          station: entry.station,
          fuel: entry.fuel,
          version: old ? old.version + 1 : 1,
          price: entry.price,
          effectiveDate: entry.effectiveDate,
          batchNo: batch.batchNo,
          reason: batch.basedOnBatchNo
            ? `补录：${batch.reason.trim()}`
            : batch.reason.trim() || "总部调价清单",
          createdAt: new Date().toISOString(),
        });
      }

      batch.status = "已通过";
      batch.approvedAt = new Date().toISOString();
      this.persistBatches();
      this.persistVersions();
      return batch;
    },

    /** 进入补录模式：批量页将基于指定已通过批次另建版本 */
    startSupplement(batchNo: string) {
      this.supplementSource = batchNo;
      this.activeTab = "bulk";
    },

    exitSupplement() {
      this.supplementSource = "";
    },

    /** 某站点油品的版本历史（旧值追溯） */
    historyOf(station: string, fuel: string): PriceVersion[] {
      return this.versions
        .filter((v) => v.station === station && v.fuel === fuel)
        .sort((a, b) => b.version - a.version);
    },
  },
});
