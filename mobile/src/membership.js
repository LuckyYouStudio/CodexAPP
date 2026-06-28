// Membership display helpers (mirror the web client).
export const LIFETIME_TS = 4102444800000; // 2100-01-01 = "永久" sentinel

export function fmtMember(until) {
  if (!until) return "未开通";
  if (until >= LIFETIME_TS) return "永久会员";
  if (until < Date.now()) return "已过期";
  return "有效期至 " + new Date(until).toLocaleDateString();
}
