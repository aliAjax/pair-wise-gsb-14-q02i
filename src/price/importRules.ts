// 导入规则：总部调价清单文本 → 待审区 / 异常区。
// 本文件只负责解析与校验，不读写状态，便于单独验证规则。
import { FUEL_OPTIONS } from "./types";
import type { InvalidRow, ValidRow } from "./types";

export interface ParseResult {
  valid: ValidRow[];
  invalid: InvalidRow[];
  /** 被识别为表头而跳过的行号 */
  skippedHeaderLine: number;
}

/** 导入规则说明，页面直接展示 */
export const IMPORT_GUIDE = [
  "每行一条：站点、油品、挂牌价、生效日期，共 4 列。",
  "支持直接粘贴 Excel：制表符、逗号（含中文逗号）或连续空格分隔均可。",
  "首行为表头（含“站点”“油品”）时自动跳过。",
  "油品只能是：92号汽油、95号汽油、98号汽油、柴油。",
  "挂牌价必须为正数，且保留两位小数（如 7.62）。",
  "生效日期格式为 YYYY-MM-DD，且不得早于当天。",
  "同一次导入中站点+油品重复时，重复行进入异常区。",
] as const;

/** 粘贴区占位示例 */
export const PASTE_TEMPLATE = [
  "站点\t油品\t挂牌价\t生效日期",
  "城东一站\t92号汽油\t7.62\t2026-09-30",
  "城东一站\t95号汽油\t8.05\t2026-09-30",
].join("\n");

let rowSeq = 0;
function rowId(): string {
  rowSeq += 1;
  return `row-${Date.now().toString(36)}-${rowSeq}`;
}

/** 本地日期（YYYY-MM-DD），避免时区把日期往前拨 */
export function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 拆分一行：优先按制表符/逗号，退化为连续空白 */
function splitLine(line: string): string[] {
  let parts: string[];
  if (/\t/.test(line)) {
    // 制表符/逗号是明确的列分隔符，中间空列必须保留以便报“为空”
    parts = line.split("\t");
  } else if (/[,，]/.test(line)) {
    parts = line.split(/[,，]/);
  } else {
    // 纯空白分隔无法表达中间空列，忽略空段
    parts = line.split(/\s{2,}|\s+/).filter((cell) => cell.trim() !== "");
  }
  return parts.map((cell) => cell.trim().replace(/^["']|["']$/g, ""));
}

/** 校验挂牌价：正数且恰好两位小数 */
export function validatePrice(raw: string): string | null {
  if (!raw) return "挂牌价为空";
  if (!/^\d+\.\d{2}$/.test(raw)) return "挂牌价必须保留两位小数";
  if (Number(raw) <= 0) return "挂牌价必须大于0";
  return null;
}

/** 校验生效日期：可解析且不早于当天 */
export function validateDate(raw: string, nowDay = today()): string | null {
  if (!raw) return "生效日期为空";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "生效日期格式应为YYYY-MM-DD";
  const [y, m, d] = raw.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return "生效日期不是有效日期";
  }
  if (raw < nowDay) return "生效日期早于当天";
  return null;
}

/**
 * 校验一行的四个单元格。
 * @param seen 本批次已出现的 站点|油品 键 → 行号，用于查重
 */
function validateCells(
  cells: string[],
  seen: Map<string, number>,
  nowDay: string,
): { data?: Omit<ValidRow, "id" | "line">; reasons: string[] } {
  const reasons: string[] = [];
  if (cells.length !== 4) reasons.push(`列数应为4列，实际${cells.length}列`);

  const [stationRaw, fuelRaw, priceRaw, dateRaw] = cells;
  const station = (stationRaw || "").trim();
  const fuel = (fuelRaw || "").trim();
  const price = (priceRaw || "").trim();
  const date = (dateRaw || "").trim();

  if (!station) reasons.push("站点为空");
  if (!fuel) reasons.push("油品为空");
  else if (!(FUEL_OPTIONS as readonly string[]).includes(fuel)) reasons.push("油品不在可选范围");

  const priceError = validatePrice(price);
  if (priceError) reasons.push(priceError);

  const dateError = validateDate(date, nowDay);
  if (dateError) reasons.push(dateError);

  if (station && fuel && (FUEL_OPTIONS as readonly string[]).includes(fuel)) {
    const firstLine = seen.get(`${station}|${fuel}`);
    if (firstLine) reasons.push(`与第${firstLine}行站点油品重复`);
  }

  if (reasons.length > 0) return { reasons };
  return { data: { station, fuel, price, effectiveDate: date }, reasons };
}

/**
 * 解析粘贴的调价清单。
 * @param nowDay 基准“当天”（YYYY-MM-DD），默认取本地今天
 */
export function parsePriceText(text: string, nowDay: string = today()): ParseResult {
  const lines = text.split(/\r?\n/);
  const valid: ValidRow[] = [];
  const invalid: InvalidRow[] = [];
  const seen = new Map<string, number>();
  let skippedHeaderLine = 0;

  lines.forEach((rawLine, index) => {
    const line = index + 1;
    if (!rawLine.trim()) return;
    const cells = splitLine(rawLine);

    // 首行表头：前两列是“站点/站”“油品”这类标题时跳过
    if (index === 0 && cells.length >= 2 && /站/.test(cells[0]) && /油品/.test(cells[1])) {
      skippedHeaderLine = line;
      return;
    }

    const check = validateCells(cells, seen, nowDay);
    if (check.data) {
      seen.set(`${check.data.station}|${check.data.fuel}`, line);
      valid.push({ id: rowId(), line, ...check.data });
    } else {
      invalid.push({
        id: rowId(),
        line,
        cells: [cells[0] ?? "", cells[1] ?? "", cells[2] ?? "", cells[3] ?? ""],
        reason: check.reasons.join("；"),
      });
    }
  });

  return { valid, invalid, skippedHeaderLine };
}

/**
 * 异常区修正后重新校验单行；通过返回 ValidRow（带新 id），否则返回新的原因。
 */
export function revalidateRow(
  cells: [string, string, string, string],
  line: number,
  occupiedKeys: Set<string>,
  nowDay: string = today(),
): { data?: ValidRow; reason?: string } {
  const seen = new Map<string, number>();
  const check = validateCells(cells, seen, nowDay);

  // validateCells 内部的查重只覆盖本行，跨页的占用集合在这里判断
  if (check.data) {
    const key = `${check.data.station}|${check.data.fuel}`;
    if (occupiedKeys.has(key)) {
      return { reason: `与待审区其他行站点油品重复` };
    }
    return { data: { id: rowId(), line, ...check.data } };
  }
  return { reason: check.reasons.join("；") };
}
