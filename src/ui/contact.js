/**
 * Contact form.
 *
 * Submission currently opens the visitor's mail client. Everything that talks
 * to the outside world lives in `deliver()` below — to switch to Formspree,
 * Web3Forms or your own API, replace that one function and nothing else
 * changes.
 */

const CONTACT_EMAIL = "weiweiwang.0617@gmail.com";

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * Hand the message off. Swap this body for a fetch() when you have an endpoint:
 *
 *   await fetch("https://formspree.io/f/XXXX", {
 *     method: "POST",
 *     headers: { "Content-Type": "application/json", Accept: "application/json" },
 *     body: JSON.stringify({ name, email, message }),
 *   });
 */
function deliver({ name, email, message }) {
  const subject = `Website enquiry from ${name}`;
  const body = `${message}\n\n— ${name} (${email})`;
  window.location.href =
    `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;

  return Promise.resolve();
}

function markInvalid(input, invalid) {
  input.closest(".field")?.classList.toggle("is-invalid", invalid);
}

export function initContact() {
  const form = document.getElementById("contact-form");
  const status = document.getElementById("form-status");
  if (!form) return;

  const nameEl = form.elements.name;
  const mailEl = form.elements.mail;
  const msgEl = form.elements.message;

  [nameEl, mailEl, msgEl].forEach((el) =>
    el.addEventListener("input", () => markInvalid(el, false))
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = nameEl.value.trim();
    const email = mailEl.value.trim();
    const message = msgEl.value.trim();

    const problems = [
      [nameEl, !name],
      [mailEl, !isEmail(email)],
      [msgEl, !message],
    ];
    problems.forEach(([el, bad]) => markInvalid(el, bad));

    const firstBad = problems.find(([, bad]) => bad);
    if (firstBad) {
      if (status) status.textContent = "Please complete every field.";
      firstBad[0].focus();
      return;
    }

    if (status) status.textContent = "Opening your mail client…";

    try {
      await deliver({ name, email, message });
      if (status) status.textContent = "Thanks — I'll get back to you soon.";
      form.reset();
    } catch (err) {
      console.error(err);
      if (status) {
        status.textContent = `Something went wrong. Email me directly at ${CONTACT_EMAIL}.`;
      }
    }
  });
}
