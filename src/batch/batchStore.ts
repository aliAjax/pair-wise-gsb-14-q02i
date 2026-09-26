/**
 * 批量调价 - 批次保存
 * 批次生命周期：待审核（送审）→ 已冻结（审核通过，价格与生效日冻结）
 * 冻结后补录会生成带原因的新版本，旧版本完整保留。
 */

import type { BatchRow } from "./importRules";

export type BatchStatus = "待审核" | "已冻结";

export interface BatchVersion {
  version: number;
  reason: string;
  createdAt: string;
  rows: BatchRow[];
}

export interface PriceBatch {
  id: string;
  name: string;
  status: BatchStatus;
  createdAt: string;
  submittedAt: string;
  approvedAt?: string;
  /** 当前生效的行（冻结后只读） */
  rows: BatchRow[];
  /** 历史版本，version 1 为送审时的原始快照 */
  versions: BatchVersion[];
}

const STORAGE_KEY = "dfwlfront-9-price-batches";

export function loadBatches(): PriceBatch[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PriceBatch[];
  } catch {
    return [];
  }
}

export function saveBatches(batches: PriceBatch[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
}

/** 送审：把待审区行保存为一个待审核批次，并留存 version 1 快照。 */
export function createBatch(rows: BatchRow[], existing: PriceBatch[]): PriceBatch {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: `调价批次 ${now.slice(0, 10)} #${existing.length + 1}`,
    status: "待审核",
    createdAt: now,
    submittedAt: now,
    rows,
    versions: [{ version: 1, reason: "送审原始版本", createdAt: now, rows: structuredClone(rows) }]
  };
}

/** 审核通过：整批冻结，价格与生效日不再可改。 */
export function approveBatch(batch: PriceBatch): void {
  batch.status = "已冻结";
  batch.approvedAt = new Date().toISOString();
}

/** 补录：冻结批次上生成带原因的新版本，旧版本保留在 versions 中。 */
export function supplementBatch(batch: PriceBatch, rows: BatchRow[], reason: string): void {
  const now = new Date().toISOString();
  batch.rows = rows;
  batch.versions.push({
    version: batch.versions.length + 1,
    reason,
    createdAt: now,
    rows: structuredClone(rows)
  });
}
