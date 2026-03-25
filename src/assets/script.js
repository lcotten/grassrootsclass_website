const footerNote = document.getElementById("footer-note");

if (footerNote) {
  footerNote.textContent = `Built for local preview and easy deployment to Cloudflare Pages. ${new Date().getFullYear()}`;
}

function setFormStatus(statusNode, type, message) {
  if (!statusNode) {
    return;
  }

  statusNode.textContent = message || "";
  statusNode.className = "form-status";

  if (type) {
    statusNode.classList.add(`form-status--${type}`);
  }
}

async function handleAsyncFormSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const statusNode = form.querySelector("[data-form-status]");
  const submitButton = form.querySelector('button[type="submit"]');
  const originalLabel = submitButton ? submitButton.textContent : "";

  setFormStatus(statusNode, "", "");

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Sending...";
  }

  if (!form.checkValidity()) {
    form.reportValidity();
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
    return;
  }

  try {
      const response = await fetch(form.action, {
        method: form.method || "POST",
        body: new FormData(form),
        headers: {
          Accept: "application/json",
          "X-Requested-With": "fetch"
        }
      });

      const contentType = response.headers.get("content-type") || "";
      const isJson = contentType.includes("application/json");
      const isLocalPreview =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      let payload = null;

      if (isJson) {
        payload = await response.json();
      } else {
        await response.text();
      }

      if (!response.ok || (payload && !payload.ok)) {
        const fallback = isLocalPreview
          ? "Forms are disabled in the local preview. Please test on the live website."
          : "Something went wrong. Please try again.";
        throw new Error((payload && payload.message) || fallback);
      }

      setFormStatus(
        statusNode,
        "success",
        (payload && payload.message) || "Thanks. Your form was submitted."
      );
      form.reset();
    } catch (error) {
    setFormStatus(
      statusNode,
      "error",
      error instanceof Error ? error.message : "Something went wrong. Please try again."
    );
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  }
}

for (const form of document.querySelectorAll("[data-async-form]")) {
  form.addEventListener("submit", handleAsyncFormSubmit);
}

function initNavToggle() {
  const nav = document.querySelector(".site-nav");
  if (!nav) {
    return;
  }

  const toggle = nav.querySelector(".site-nav__toggle");
  const links = nav.querySelector(".site-nav__links");

  if (!toggle || !links) {
    return;
  }

  nav.classList.add("site-nav--ready");

  toggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("site-nav--open");
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  for (const link of links.querySelectorAll("a")) {
    link.addEventListener("click", () => {
      nav.classList.remove("site-nav--open");
      toggle.setAttribute("aria-expanded", "false");
    });
  }
}

initNavToggle();

function initPhoneValidation() {
  const phoneInputs = document.querySelectorAll('input[type="tel"][name="phone"]');
  const phonePattern = /^(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}$/;

  for (const input of phoneInputs) {
    input.addEventListener("input", () => {
      const value = String(input.value || "").trim();
      if (!value) {
        input.setCustomValidity("");
        return;
      }

      if (!phonePattern.test(value)) {
        input.setCustomValidity("Please enter a valid 10-digit U.S. phone number.");
      } else {
        input.setCustomValidity("");
      }
    });
  }
}

initPhoneValidation();

function initProtectedAreas() {
  const protectedAreas = document.querySelectorAll("[data-protected=\"true\"]");

  for (const area of protectedAreas) {
    const content = area.querySelector(".protected__content");
    if (!content) {
      continue;
    }

    const password = String(area.dataset.protectedPassword || "").trim().toLowerCase();
    if (!password) {
      continue;
    }

    const hint = String(area.dataset.protectedHint || "").trim();
    const title = String(area.dataset.protectedTitle || "Protected Area").trim();
    const storageKey = `protected:${title.toLowerCase().replace(/\s+/g, "-")}`;

    if (sessionStorage.getItem(storageKey) === "true") {
      continue;
    }

    content.hidden = true;

    const overlay = document.createElement("div");
    overlay.className = "protected__overlay";
    overlay.innerHTML = `
      <div class="protected__panel">
        <h3>${title}</h3>
        <p class="protected__hint">${hint}</p>
        <form class="stacked-form" data-protected-form>
          <label for="protected-password-${storageKey}">Password</label>
          <div class="protected__row">
            <input id="protected-password-${storageKey}" type="text" autocomplete="current-password" placeholder="Password" required>
            <button type="submit" class="protected__submit">Unlock</button>
          </div>
          <p class="protected__error" data-protected-error role="status" aria-live="polite"></p>
        </form>
      </div>
    `;

    const form = overlay.querySelector("[data-protected-form]");
    const input = overlay.querySelector("input");
    const error = overlay.querySelector("[data-protected-error]");
    const hintNode = overlay.querySelector(".protected__hint");
    const pageHint = area.closest(".card-stack")?.querySelector(".protected-hint-note");
    const baseHint = hint;
    const wrongHint = "Wrong Password Entered.  Please enter the Class Password. Hint: It is the first 3 words of the scripture spoken at the end of each class (no spaces and all lower case)";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const entered = String(input.value || "").trim().toLowerCase();
      if (entered === password) {
        sessionStorage.setItem(storageKey, "true");
        content.hidden = false;
        overlay.remove();
        return;
      }

      input.value = "";
      input.focus();
      if (hintNode) {
        hintNode.textContent = wrongHint;
        hintNode.classList.add("is-error");
      }
      if (pageHint) {
        pageHint.textContent = wrongHint;
        pageHint.classList.add("is-error");
      }
      if (error) {
        error.hidden = false;
        error.style.display = "block";
        error.style.visibility = "visible";
        error.style.opacity = "1";
        error.textContent = "Wrong Password, try again";
      }
    });

    area.appendChild(overlay);
    input.focus();
  }
}

initProtectedAreas();
