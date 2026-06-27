// Sends verification emails via SMTP. If SMTP isn't configured (dev), it logs
// the link to the console instead — so local testing works without an email server.
// Configure via env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
import nodemailer from "nodemailer";

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

let transport = null;
if (SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
}
export const emailConfigured = !!transport;

export async function sendVerifyEmail(to, link) {
  if (!transport) {
    console.log(`[mailer] (SMTP 未配置) 给 ${to} 的验证链接：${link}`);
    return;
  }
  await transport.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject: "验证你的 CodexApp 账号",
    text: `欢迎使用 CodexApp。请点击下面的链接验证你的邮箱：\n${link}\n\n如果不是你本人操作，请忽略此邮件。`,
    html: `<p>欢迎使用 CodexApp。请点击下面的链接验证你的邮箱：</p>
<p><a href="${link}">${link}</a></p>
<p style="color:#888">如果不是你本人操作，请忽略此邮件。</p>`,
  });
}
