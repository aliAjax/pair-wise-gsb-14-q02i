/**
 * 批量调价 - 导入规则
 * 负责把粘贴文本解析成行，并按业务规则校验：
 * - 重复站点油品
 * - 挂牌价小数位（必须两位小数）
 * - 生效日早于当天
 */

export const FUEL_OPTIONS = ["92号汽油", "95号汽油", "98号汽油", "柴油"] as const;

export const PRICE_PATTERN = /^\d+\.\d{2}$/;

export interface ParsedRow {
  lineNo: number;
  station: string;
  fuel: string;
  price: string;
  effectiveDate: string;
  raw: string;
}

export interface BatchRow extends ParsedRow {
  id: string;
}

export interface ExceptionRow extends BatchRow {
  reasons: string[];
}

export interface SplitResult {
  valid: BatchRow[];
  exceptions: ExceptionRow[];
}

function rowId() {
  return crypto.randomUUID();
}

/** 解析粘贴文本：每行一条，列之间支持 Tab、逗号、顿号或空白分隔。 */
export function parsePaste(text: string): ParsedRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const cells = line.split(/[\t,，、]|\s{1,}/).map((cell) => cell.trim());
      const [station = "", fuel = "", price = "", effectiveDate = ""] = cells;
      return {
        lineNo: index + 1,
        station,
        fuel,
        price,
        effectiveDate,
        raw: line,
        // 多出的列拼回生效日之后，交给校验报“列数不对”
        ...(cells.length > 4 ? { effectiveDate: `${effectiveDate} ${cells.slice(4).join(" ")}`.trim() } : {})
      };
    });
}

export function todayString(now = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** 单行校验，返回异常原因列表（空数组表示通过）。 */
export function validateRow(row: ParsedRow, today: string): string[] {
  const reasons: string[] = [];
  if (!row.station) reasons.push("站点为空");
  if (!FUEL_OPTIONS.includes(row.fuel as (typeof FUEL_OPTIONS)[number])) {
    reasons.push(`油品「${row.fuel || "空"}」不在支持范围`);
  }
  if (!PRICE_PATTERN.test(row.price)) {
    reasons.push(`挂牌价「${row.price || "空"}」小数位不对，需为两位小数（如 7.62）`);
  } else if (Number(row.price) <= 0) {
    reasons.push("挂牌价必须大于 0");
  }
  if (!isValidDate(row.effectiveDate)) {
    reasons.push(`生效日「${row.effectiveDate || "空"}」格式应为 YYYY-MM-DD`);
  } else if (row.effectiveDate < today) {
    reasons.push(`生效日 ${row.effectiveDate} 早于当天 ${today}`);
  }
  return reasons;
}

/**
 * 校验并拆分待审/异常。
 * @param rows 待校验行
 * @param today 当天日期（YYYY-MM-DD）
 * @param existingKeys 已在待审区的「站点|油品」键，用于跨次粘贴查重
 */
export function splitRows(rows: ParsedRow[], today: string, existingKeys: ReadonlySet<string> = new Set()): SplitResult {
  const seen = new Map<string, number>();
  const valid: BatchRow[] = [];
  const exceptions: ExceptionRow[] = [];

  for (const row of rows) {
    const reasons = validateRow(row, today);
    const key = `${row.station}|${row.fuel}`;
    if (row.station && row.fuel) {
      if (existingKeys.has(key)) {
        reasons.push(`重复站点油品：待审区已存在「${row.station} / ${row.fuel}」`);
      } else if (seen.has(key)) {
        reasons.push(`重复站点油品：与第 ${seen.get(key)} 行相同（${row.station} / ${row.fuel}）`);
      }
    }
    if (reasons.length > 0) {
      exceptions.push({ ...row, id: rowId(), reasons });
    } else {
      seen.set(key, row.lineNo);
      valid.push({ ...row, id: rowId() });
    }
  }
  return { valid, exceptions };
}

export function rowKey(row: Pick<ParsedRow, "station" | "fuel">): string {
  return `${row.station}|${row.fuel}`;
}
