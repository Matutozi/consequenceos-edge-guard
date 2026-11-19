// Shows what each button "did", so a demo makes visible which clicks Edge Guard let through.
// Nothing is charged, sent or deleted, and the sign-in form never leaves the page.
const log = document.getElementById("log");

function note(text) {
  if (log.dataset.started !== "true") {
    log.replaceChildren();
    log.dataset.started = "true";
  }
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()}: ${text}`;
  log.append(item);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || button.type === "submit") return;
  note(`"${button.textContent.trim()}" went through.`);
});

document.getElementById("pay-form").addEventListener("submit", (event) => {
  event.preventDefault();
  note("Payment of $1,240.00 went through (pretend).");
});

document.getElementById("signin-form").addEventListener("submit", (event) => {
  event.preventDefault();
  note("The password form was submitted (pretend; nothing was sent).");
});
