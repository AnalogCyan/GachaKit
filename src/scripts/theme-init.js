// Applies the stored theme class before first paint to avoid a flash

(() => {
  try {
    const root = document.documentElement;
    // Must match the header's data-theme-key
    const key = document.currentScript?.dataset.themeKey || "gachakit_theme";
    const mode = localStorage.getItem(key);

    if (mode === "light") {
      root.classList.add("light-theme");
    } else if (mode === "dark") {
      root.classList.add("dark-theme");
    } else if (mode === "auto") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
      root.classList.add(prefersDark.matches ? "dark-theme" : "light-theme");
    }
  } catch {
    // ignore storage failures
  }
})();
