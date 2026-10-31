import { simpleParser, type AddressObject } from "mailparser";

export interface ParsedEmail { from: string; to: string; subject: string; date: Date; text: string }

/** The parts a model needs, as plain text: HTML-only mail is stripped to its words. */
export async function parseEmail(source: Buffer): Promise<ParsedEmail> {
  const mail = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const text = mail.text?.trim() || (typeof mail.html === "string" ? htmlToText(mail.html) : "");
  return {
    from: mail.from?.text || "unknown sender",
    to: addresses(mail.to),
    subject: mail.subject?.trim() || "(no subject)",
    date: mail.date ?? new Date(),
    text,
  };
}

function addresses(value: AddressObject | AddressObject[] | undefined): string {
  if (!value) return "";
  return (Array.isArray(value) ? value : [value]).map(({ text }) => text).join(", ");
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}
