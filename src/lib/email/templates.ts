const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function verificationEmail(fullName: string, link: string, hours: number) {
  const subject = "Verify your PNPay-H email address";
  const text =
    `Hello ${fullName},\n\n` +
    `Please confirm your email address to activate your PNPay-H account:\n\n${link}\n\n` +
    `This link expires in ${hours} hours and can be used once.\n` +
    `If you did not register, you can ignore this email.\n`;
  const html =
    `<p>Hello ${esc(fullName)},</p>` +
    `<p>Please confirm your email address to activate your PNPay-H account:</p>` +
    `<p><a href="${esc(link)}">Verify my email</a></p>` +
    `<p>This link expires in ${hours} hours and can be used once. If you did not register, you can ignore this email.</p>`;
  return { subject, text, html };
}

/**
 * Payment notification email (Phase 4). The body is the in-app notification text plus one link: it never contains
 * receipt images, reference numbers, student IDs, reviewer remarks (OPEN-14 / D-040) or any token. Recipients sign
 * in to see details.
 */
export function notificationEmail(input: { recipientName: string; title: string; message: string; link: string; linkLabel: string }) {
  const subject = `PNPay-H: ${input.title}`;
  const text =
    `Hello ${input.recipientName},\n\n${input.message}\n\n${input.linkLabel}:\n${input.link}\n\n` +
    `You are receiving this because of activity on your PNPay-H payment record. This site records receipts; it does not process payments.\n`;
  const html =
    `<p>Hello ${esc(input.recipientName)},</p><p>${esc(input.message)}</p>` +
    `<p><a href="${esc(input.link)}">${esc(input.linkLabel)}</a></p>` +
    `<p style="color:#555;font-size:12px">You are receiving this because of activity on your PNPay-H payment record. This site records receipts; it does not process payments.</p>`;
  return { subject, text, html };
}
