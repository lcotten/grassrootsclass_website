import { EmailMessage } from "cloudflare:email";
import { createMimeMessage, Mailbox } from "mimetext";

function cleanLine(value, maxLength = 500) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanBlock(value, maxLength = 4000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function formatSubmittedTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
    hour12: true
  }).format(date);

  return `${formatted} CT`;
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return json({ ok: false, message: "Method not allowed." }, 405);
    }

    const payload = await request.json().catch(() => null);
    if (!payload) {
      return json({ ok: false, message: "Invalid request body." }, 400);
    }

    const type = cleanLine(payload.type, 40) || "contact";
    const name = cleanLine(payload.name, 120);
    const firstName = cleanLine(payload.firstName, 120);
    const lastName = cleanLine(payload.lastName, 120);
    const email = cleanLine(payload.email, 320).toLowerCase();
    const phone = cleanLine(payload.phone, 40);
    const message = cleanBlock(payload.message, 4000);
    const requestText = cleanBlock(payload.request, 4000);
    const submittedAt = cleanLine(payload.submittedAt, 64) || new Date().toISOString();
    const submittedTime = formatSubmittedTime(submittedAt);

    if (type === "contact") {
      if (!name || !email || !message) {
        return json({ ok: false, message: "Missing required contact fields." }, 400);
      }
    } else if (type === "subscribe") {
      if (!email) {
        return json({ ok: false, message: "Missing required signup email." }, 400);
      }
    } else if (type === "prayer") {
      if (!requestText) {
        return json({ ok: false, message: "Missing required prayer request." }, 400);
      }
    } else {
      return json({ ok: false, message: "Unknown notification type." }, 400);
    }

    try {
      const mime = createMimeMessage();
      mime.setSender({ name: "Grassroots Sunday School Class", addr: env.CONTACT_SENDER });
      mime.setRecipient(env.NOTIFY_EMAIL);
      let subject = "New Grassroots message";
      let lines = [];

      if (type === "contact") {
        subject = `New Grassroots contact from ${name}`;
        lines = [
          `Name: ${name}`,
          `Email: ${email}`,
          `Submitted: ${submittedTime}`,
          "",
          message
        ];
        mime.setHeader("Reply-To", new Mailbox(email));
      }

      if (type === "subscribe") {
        subject = "New Grassroots email updates signup";
        const displayName = [firstName, lastName].filter(Boolean).join(" ") || "Not provided";
        lines = [
          `Name: ${displayName}`,
          `Email: ${email}`,
          `Submitted: ${submittedTime}`
        ];
      }

      if (type === "prayer") {
        subject = "New Grassroots prayer request";
        lines = [
          `Name: ${name || "Not provided"}`,
          `Email: ${email || "Not provided"}`,
          `Phone: ${phone || "Not provided"}`,
          `Submitted: ${submittedTime}`,
          "",
          requestText
        ];
      }

      mime.setSubject(subject);
      mime.addMessage({
        contentType: "text/plain",
        data: lines.join("\n")
      });

      const emailMessage = new EmailMessage(env.CONTACT_SENDER, env.NOTIFY_EMAIL, mime.asRaw());
      await env.OUTBOUND_EMAIL.send(emailMessage);

      return json({ ok: true });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      console.error("Mailer worker failed", messageText);
      return json({ ok: false, message: messageText }, 502);
    }
  }
};
