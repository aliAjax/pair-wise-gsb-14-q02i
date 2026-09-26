// 批量调价相关的数据模型
// 导入规则、批次保存与页面共用这些类型。

/** 支持的油品种类 */
export const FUEL_OPTIONS = ["92号汽油", "95号汽油", "98号汽油", "柴油"] as const;
export type Fuel = (typeof FUEL_OPTIONS)[number];

/** 批量批次状态 */
export type BatchStatus = "草稿" | "待审" | "已通过";

/** 校验通过、进入待审区的行 */
export interface ValidRow {
  /** 行唯一标识 */
  id: string;
  /** 来源清单中的物理行号（从 1 开始，表头占行） */
  line: number;
  station: string;
  fuel: string;
  /** 挂牌价，保留两位小数的字符串形式，如 "7.62" */
  price: string;
  /** 生效日期，格式 YYYY-MM-DD */
  effectiveDate: string;
}

/** 校验未通过、留在异常区的行 */
export interface InvalidRow {
  id: string;
  line: number;
  /** 原始拆分后的四个单元格，用于回显编辑 */
  cells: [string, string, string, string];
  /** 异常原因，多条以 "；" 连接 */
  reason: string;
}

/** 批次中的一行价格；审批后该行连同生效日期一起冻结 */
export interface BatchEntry extends ValidRow {
  /** 上一版本的挂牌价（补录批次保留旧值时写入，无旧值为空） */
  oldPrice: string;
  /** 上一版本的生效日期 */
  oldEffectiveDate: string;
}

/** 冻结价格版本（站点+油品维度），补录时保留旧值 */
export interface PriceVersion {
  station: string;
  fuel: string;
  /** 版本序号，从 1 开始 */
  version: number;
  price: string;
  effectiveDate: string;
  batchNo: string;
  /** 产生新版本的原因（补录时必填） */
  reason: string;
  createdAt: string;
}

/** 一个调价批次 */
export interface PriceBatch {
  id: string;
  /** 批次号，如 PL20260926-001 */
  batchNo: string;
  status: BatchStatus;
  entries: BatchEntry[];
  reason: string;
  /** 草稿/待审创建时间 */
  createdAt: string;
  /** 送审时间 */
  submittedAt: string;
  /** 审批通过时间，通过后批次冻结 */
  approvedAt: string;
  /** 补录批次的来源批次号 */
  basedOnBatchNo: string;
}
