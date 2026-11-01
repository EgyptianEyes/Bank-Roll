(() => {
  const key = "bank-roll-theme";
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const valid = (value) => ["light", "dark", "system"].includes(value);
  let preference = "system";
  let storageError = "";

  try {
    const saved = localStorage.getItem(key);
    if (valid(saved)) preference = saved;
  } catch (error) {
    console.warn("Bank-Roll could not read the theme preference.", error);
    storageError = "Theme storage is unavailable. Changes apply to this page only.";
  }

  function apply() {
    const theme = preference === "system" ? (system.matches ? "dark" : "light") : preference;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    const control = document.querySelector("[data-theme-select]");
    if (control) control.value = preference;
    const status = document.querySelector("[data-theme-status]");
    if (status) status.textContent = storageError;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#0b100d" : "#f6f4ed";
    window.dispatchEvent(new Event("bank-roll-theme-change"));
  }

  apply();
  system.addEventListener("change", () => {
    if (preference === "system") apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : "system";
    apply();
  });
  document.addEventListener("DOMContentLoaded", () => {
    const control = document.querySelector("[data-theme-select]");
    control.addEventListener("change", () => {
      preference = control.value;
      storageError = "";
      try {
        localStorage.setItem(key, preference);
      } catch (error) {
        console.warn("Bank-Roll could not save the theme preference.", error);
        storageError = "Theme could not be saved. Changes apply to this page only.";
      }
      apply();
    });
    apply();
  });
})();
