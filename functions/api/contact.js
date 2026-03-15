import {
  cleanBlock,
  cleanLine,
  ensureSchema,
  isUSRequest,
  isValidEmail,
  json,
  normalizeEmail,
  redirectToContact,
  wantsJson
} from "../_lib/form-utils.js";
import { syncContactMessageToGoogleSheets } from "../_lib/google-sheets.js";

function invalid(request, message) {
  if (wantsJson(request)) {
    return json({ ok: false, message }, 400);
  }

  return redirectToContact(request, { contact: "error", message });
}

function blocked(request) {
  const message = "Sorry, this form is only available in the United States.";

  if (wantsJson(request)) {
    return json({ ok: false, message }, 403);
  }

  return redirectToContact(request, { contact: "error", message });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!isUSRequest(request)) {
      return blocked(request);
    }

    const form = await request.formData();

    if (cleanLine(form.get("website"))) {
      if (wantsJson(request)) {
        return json({ ok: true, message: "Thanks for reaching out. We'll be in touch soon." });
      }

      return redirectToContact(request, { contact: "success" });
    }

    const name = cleanLine(form.get("name"), 120);
    const email = normalizeEmail(form.get("email"));
    const message = cleanBlock(form.get("message"), 4000);

    if (!name) {
      return invalid(request, "Please enter your name.");
    }

    if (!isValidEmail(email)) {
      return invalid(request, "Please enter a valid email address.");
    }

    if (!message) {
      return invalid(request, "Please enter a message before sending.");
    }

    await ensureSchema(env.SITE_DATA);

    const submittedAt = new Date().toISOString();
    const insertResult = await env.SITE_DATA
      .prepare(`
        INSERT INTO contact_messages (name, email, message, submitted_at)
        VALUES (?, ?, ?, ?)
      `)
      .bind(name, email, message, submittedAt)
      .run();

    const messageId = insertResult.meta?.last_row_id;
    let emailStatus = "skipped";
    let emailError = null;

    if (env.CONTACT_MAILER) {
      try {
        const mailerResponse = await env.CONTACT_MAILER.fetch("https://mailer.internal/send", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            name,
            email,
            message,
            submittedAt
          })
        });

        if (!mailerResponse.ok) {
          const payload = await mailerResponse.json().catch(() => ({}));
          throw new Error(payload.message || `Mailer error: ${mailerResponse.status}`);
        }

        emailStatus = "sent";
      } catch (error) {
        emailStatus = "failed";
        emailError = error instanceof Error ? error.message : String(error);
        console.error("Contact email send failed", emailError);
      }
    }

    const googleSheetsResult = await syncContactMessageToGoogleSheets(env, {
      submittedAt,
      name,
      email,
      message,
      emailStatus
    });

    if (messageId) {
      await env.SITE_DATA
        .prepare(`
          UPDATE contact_messages
          SET email_status = ?, email_error = ?, google_sheets_status = ?, google_sheets_error = ?, google_sheets_synced_at = ?
          WHERE id = ?
        `)
        .bind(
          emailStatus,
          emailError,
          googleSheetsResult.status,
          googleSheetsResult.error,
          googleSheetsResult.syncedAt,
          messageId
        )
        .run();
    }

    const responseMessage = "Thanks for reaching out. Your message has been received.";

    if (wantsJson(request)) {
      return json({
        ok: true,
        message: responseMessage,
        emailStatus,
        googleSheetsStatus: googleSheetsResult.status
      });
    }

    return redirectToContact(request, { contact: "success" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send your message right now.";
    console.error("Contact handler failed", message);

    if (wantsJson(request)) {
      return json({ ok: false, message }, 500);
    }

    return redirectToContact(request, { contact: "error", message });
  }
}
