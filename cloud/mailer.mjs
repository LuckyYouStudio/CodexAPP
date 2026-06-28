// Sends verification emails. SMTP config comes from the DB (editable in the admin
// UI) and falls back to env vars. Read fresh each send so admin changes take
// effect without a restart. If no SMTP host is set, the link is logged to console.
import nodemailer from "nodemailer";
import * as db from "./db.mjs";

export function getSmtpConfig() {
  const val = (key, env) => {
    const v = db.getSetting(key);
    return v !== null && v !== "" ? v : (process.env[env] || "");
  };
  let secure;
  const sv = db.getSetting("smtp_secure");
  if (sv !== null) secure = sv === "1" || sv === "true";
  else secure = Number(process.env.SMTP_PORT) === 465;
  return {
    host: val("smtp_host", "SMTP_HOST"),
    port: Number(val("smtp_port", "SMTP_PORT")) || 587,
    user: val("smtp_user", "SMTP_USER"),
    pass: db.getSetting("smtp_pass") ?? process.env.SMTP_PASS ?? "",
    from: val("smtp_from", "SMTP_FROM"),
    fromName: val("smtp_from_name", "SMTP_FROM_NAME"),
    secure,
  };
}

function buildTransport(cfg) {
  if (!cfg.host) return null;
  return nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: !!cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
}
function fromAddr(cfg) {
  const email = cfg.from || cfg.user;
  return cfg.fromName ? `${cfg.fromName} <${email}>` : email;
}

export function emailConfigured() { return !!getSmtpConfig().host; }

export async function sendVerifyEmail(to, link) {
  const cfg = getSmtpConfig();
  const t = buildTransport(cfg);
  if (!t) { console.log(`[mailer] (SMTP 未配置) 给 ${to} 的验证链接：${link}`); return; }
  await t.sendMail({
    from: fromAddr(cfg), to,
    subject: "验证你的 CodexApp 账号",
    text: `欢迎使用 CodexApp。请点击下面的链接验证你的邮箱：\n${link}\n\n如果不是你本人操作，请忽略此邮件。`,
    html: `<p>欢迎使用 CodexApp。请点击下面的链接验证你的邮箱：</p>
<p><a href="${link}">${link}</a></p>
<p style="color:#888">如果不是你本人操作，请忽略此邮件。</p>`,
  });
}

// Verify SMTP connectivity; optionally send a test email to `to`.
export async function testSmtp(to) {
  const t = buildTransport(getSmtpConfig());
  if (!t) return { ok: false, error: "未配置 SMTP 主机" };
  try {
    await t.verify();
    if (to) await t.sendMail({ from: fromAddr(getSmtpConfig()), to, subject: "CodexApp SMTP 测试", text: "这是一封来自 CodexApp 管理后台的测试邮件，收到即说明配置正确。" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
