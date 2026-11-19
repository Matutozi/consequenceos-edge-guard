// Copies chrome://extensions, which web pages are not allowed to link to.
const button = document.getElementById("copy");
button.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("chrome://extensions");
    button.textContent = "Copied";
  } catch {
    button.textContent = "Select it and copy";
  }
  setTimeout(() => (button.textContent = "Copy"), 2500);
});
