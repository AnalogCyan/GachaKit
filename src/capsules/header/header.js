// Nav-pill mobile toggle, sliding indicator, and theme cycle

(() => {
  function initNav(root) {
    const nav = root.querySelector(".nav-pill");
    if (!nav) return;

    const toggle = nav.querySelector(".nav-pill__toggle");
    const list = nav.querySelector(".nav-pill__list");
    if (!toggle || !list) return;

    const icon = toggle.querySelector("i");
    const openClass = "nav-pill--open";
    const mediaQuery = window.matchMedia("(max-width: 720px)");

    const setOpen = (open, focusFirst) => {
      if (!mediaQuery.matches) {
        nav.classList.remove(openClass);
        toggle.setAttribute("aria-expanded", "false");
        if (icon) {
          icon.classList.remove("ri-close-line");
          icon.classList.add("ri-menu-line");
        }
        return;
      }

      nav.classList.toggle(openClass, open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (icon) {
        icon.classList.toggle("ri-menu-line", !open);
        icon.classList.toggle("ri-close-line", open);
      }

      if (open && focusFirst) {
        const firstLink = list.querySelector("a");
        if (firstLink) requestAnimationFrame(() => firstLink.focus());
      }
    };

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      if (!mediaQuery.matches) return;
      const opening = !nav.classList.contains(openClass);
      setOpen(opening, opening && event.detail === 0);
    });

    document.addEventListener("click", (event) => {
      if (!mediaQuery.matches) return;
      if (!nav.contains(event.target)) {
        setOpen(false);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (!mediaQuery.matches) return;
      if (event.key === "Escape" && nav.classList.contains(openClass)) {
        setOpen(false);
        toggle.focus();
      }
    });

    list.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });

    nav.addEventListener("focusout", (event) => {
      if (event.relatedTarget && !nav.contains(event.relatedTarget)) {
        setOpen(false);
      }
    });

    mediaQuery.addEventListener("change", () => setOpen(false));

    setOpen(false);

    const navPage = root.closest("[data-nav-page]")?.dataset.navPage;
    if (navPage) {
      const activeLink = list.querySelector(`[data-nav="${navPage}"]`);
      if (activeLink) {
        activeLink.classList.add("is-active");
        // is-active is colour only; aria-current is what a screen reader reads
        activeLink.setAttribute("aria-current", "page");
      }
    }
  }

  function initSlidingPill(container, opts) {
    var items = Array.from(container.querySelectorAll(opts.itemSelector));
    if (items.length === 0) return;

    var cloneSource = opts.cloneSource || container;
    var getDefault =
      opts.getDefault ||
      function () {
        return null;
      };
    var mediaQuery = opts.mediaQuery || null;
    var listenTarget = opts.listenTarget || container;

    var cs = getComputedStyle(container);
    var bL = parseFloat(cs.borderLeftWidth) || 0;
    var bT = parseFloat(cs.borderTopWidth) || 0;
    var bR = parseFloat(cs.borderRightWidth) || 0;
    var bB = parseFloat(cs.borderBottomWidth) || 0;

    var indicator = document.createElement("div");
    indicator.className = "sliding-pill";
    indicator.setAttribute("aria-hidden", "true");

    var overlay = document.createElement("div");
    overlay.className = "sliding-pill__overlay";
    overlay.setAttribute("aria-hidden", "true");

    function buildClone() {
      var c = cloneSource.cloneNode(true);
      c.querySelectorAll(".sliding-pill, .sliding-pill__overlay").forEach(
        function (el) {
          el.remove();
        }
      );
      c.removeAttribute("id");
      c.querySelectorAll("[id]").forEach(function (el) {
        el.removeAttribute("id");
      });
      c.querySelectorAll("a, button").forEach(function (el) {
        el.setAttribute("tabindex", "-1");
        el.removeAttribute("aria-controls");
        el.removeAttribute("aria-expanded");
        el.dataset.themeToggleBound = "true";
      });
      return c;
    }

    var clone = buildClone();
    overlay.appendChild(clone);
    container.appendChild(indicator);
    container.appendChild(overlay);
    container.classList.add(opts.containerClass);

    function syncClone() {
      var cRect = container.getBoundingClientRect();
      if (cloneSource === container) {
        clone.style.position = "absolute";
        clone.style.left = -bL + "px";
        clone.style.top = -bT + "px";
        clone.style.width = cRect.width + "px";
        clone.style.height = cRect.height + "px";
        clone.style.boxSizing = "border-box";
      } else {
        var sRect = cloneSource.getBoundingClientRect();
        clone.style.position = "absolute";
        clone.style.left = sRect.left - cRect.left - bL + "px";
        clone.style.top = sRect.top - cRect.top - bT + "px";
        clone.style.width = sRect.width + "px";
      }
    }

    syncClone();

    var currentTarget = null;

    function moveTo(item, animate) {
      if (!item) return hide(animate);
      if (mediaQuery && mediaQuery.matches) return hide(animate);

      var cRect = container.getBoundingClientRect();
      var iRect = item.getBoundingClientRect();
      var left = iRect.left - cRect.left - bL;
      var top = iRect.top - cRect.top - bT;
      var oW = cRect.width - bL - bR;
      var oH = cRect.height - bT - bB;
      var right = oW - left - iRect.width;
      var bottom = oH - top - iRect.height;

      if (animate === false) {
        indicator.style.transition = "none";
        overlay.style.transition = "none";
      }

      indicator.style.transform = "translateX(" + left + "px)";
      indicator.style.top = top + "px";
      indicator.style.width = iRect.width + "px";
      indicator.style.height = iRect.height + "px";
      indicator.classList.add("is-visible");

      overlay.style.clipPath =
        "inset(" +
        top +
        "px " +
        right +
        "px " +
        bottom +
        "px " +
        left +
        "px round 9999px)";

      if (animate === false) {
        indicator.offsetHeight;
        indicator.style.transition = "";
        overlay.style.transition = "";
      }

      currentTarget = item;
    }

    function hide(animate) {
      if (animate === false) {
        indicator.style.transition = "none";
        overlay.style.transition = "none";
      }
      indicator.classList.remove("is-visible");
      overlay.style.clipPath = "inset(50% 50% 50% 50% round 9999px)";
      if (animate === false) {
        indicator.offsetHeight;
        indicator.style.transition = "";
        overlay.style.transition = "";
      }
      currentTarget = null;
    }

    function returnToDefault() {
      requestAnimationFrame(function () {
        const navPage = container.closest("[data-nav-page]")?.dataset.navPage;
        // An empty value, as on the 404 page, means no link is current
        if (navPage !== undefined) {
          items.forEach((item) => {
            if (item.dataset.nav === navPage) {
              item.classList.add("is-active");
              item.setAttribute("aria-current", "page");
            } else {
              item.classList.remove("is-active");
              item.removeAttribute("aria-current");
            }
          });
        }

        var def = getDefault();
        if (def) moveTo(def);
        else hide();
      });
    }

    var def = getDefault();
    if (def) moveTo(def, false);

    items.forEach(function (item) {
      item.addEventListener("mouseenter", function () {
        moveTo(item);
      });
      item.addEventListener("focus", function () {
        moveTo(item);
      });
    });

    listenTarget.addEventListener("mouseleave", returnToDefault);
    listenTarget.addEventListener("focusout", function (e) {
      if (!listenTarget.contains(e.relatedTarget)) returnToDefault();
    });

    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        var newCs = getComputedStyle(container);
        bL = parseFloat(newCs.borderLeftWidth) || 0;
        bT = parseFloat(newCs.borderTopWidth) || 0;
        bR = parseFloat(newCs.borderRightWidth) || 0;
        bB = parseFloat(newCs.borderBottomWidth) || 0;
        syncClone();
        var target = currentTarget || getDefault();
        if (target) moveTo(target, false);
      }).observe(container);
    }

    if (mediaQuery) {
      mediaQuery.addEventListener("change", function () {
        if (mediaQuery.matches) hide(false);
        else {
          var def = getDefault();
          if (def) moveTo(def, false);
        }
      });
    }

    if (opts.watchChanges) {
      var timer = null;
      new MutationObserver(function (mutations) {
        if (
          mutations.every(function (m) {
            return overlay.contains(m.target);
          })
        )
          return;
        if (timer) return;
        timer = requestAnimationFrame(function () {
          timer = null;
          var newClone = buildClone();
          overlay.removeChild(clone);
          overlay.appendChild(newClone);
          clone = newClone;
          syncClone();
        });
      }).observe(cloneSource, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    return { returnToDefault: returnToDefault, hide: hide };
  }

  function initPillIndicators(root) {
    var nav = root.querySelector(".nav-pill");
    if (nav) {
      var list = nav.querySelector(".nav-pill__list");
      if (list) {
        var pill = initSlidingPill(nav, {
          itemSelector: ".nav-pill__link",
          cloneSource: list,
          getDefault: function () {
            return list.querySelector(".nav-pill__link.is-active");
          },
          mediaQuery: window.matchMedia("(max-width: 720px)"),
          listenTarget: list,
          containerClass: "nav-pill--has-indicator",
        });
        if (pill) {
          var shell = list.closest("[data-nav-page]");
          if (shell) {
            new MutationObserver(pill.returnToDefault).observe(shell, {
              attributes: true,
              attributeFilter: ["data-nav-page"],
            });
          }
        }
      }
    }

    var toggle = root.querySelector(".theme-toggle");
    if (toggle) {
      initSlidingPill(toggle, {
        itemSelector: ".theme-toggle__button",
        listenTarget: toggle,
        containerClass: "theme-toggle--has-indicator",
        watchChanges: true,
      });
    }
  }

  function initThemeToggle(root) {
    const STORAGE_KEY = root.dataset.themeKey || "gachakit_theme";
    const THEMES = {
      AUTO: "auto",
      LIGHT: "light",
      DARK: "dark",
    };

    const toggles = Array.from(
      root.querySelectorAll("[data-theme-button='true']")
    );
    if (toggles.length === 0) return;
    const status = root.querySelector("[data-theme-status]");

    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)");
    const ICON_MAP = {
      [THEMES.AUTO]: { icon: "ri-contrast-2-line", label: "Auto" },
      [THEMES.LIGHT]: { icon: "ri-sun-line", label: "Light" },
      [THEMES.DARK]: { icon: "ri-moon-line", label: "Dark" },
    };

    function readStoredMode() {
      try {
        return localStorage.getItem(STORAGE_KEY) || THEMES.AUTO;
      } catch {
        return THEMES.AUTO;
      }
    }

    // Held in memory so cycling still works when storage is unavailable
    let currentMode = readStoredMode();

    function savePreference(mode) {
      currentMode = mode;
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        /* noop */
      }
    }

    function updatePresentation(mode) {
      const meta = ICON_MAP[mode] || ICON_MAP[THEMES.AUTO];
      toggles.forEach((toggle) => {
        toggle.dataset.themeMode = mode;
        toggle.setAttribute("aria-label", `Theme: ${meta.label}`);
        const iconEl = toggle.querySelector(".theme-toggle__icon");
        const textEl = toggle.querySelector(".theme-toggle__text");

        if (iconEl) {
          iconEl.classList.remove(
            "ri-contrast-2-line",
            "ri-sun-line",
            "ri-moon-line"
          );
          iconEl.classList.add(meta.icon);
        }

        if (textEl) {
          textEl.textContent = meta.label;
        }
      });
    }

    function applyTheme(mode) {
      document.documentElement.classList.remove("light-theme", "dark-theme");

      switch (mode) {
        case THEMES.LIGHT:
          document.documentElement.classList.add("light-theme");
          break;
        case THEMES.DARK:
          document.documentElement.classList.add("dark-theme");
          break;
        case THEMES.AUTO:
        default: {
          mode = THEMES.AUTO;
          if (systemPrefersDark.matches) {
            document.documentElement.classList.add("dark-theme");
          } else {
            document.documentElement.classList.add("light-theme");
          }
          break;
        }
      }

      updatePresentation(mode);
    }

    function cycleTheme() {
      let newMode;

      switch (currentMode) {
        case THEMES.AUTO:
          newMode = THEMES.LIGHT;
          break;
        case THEMES.LIGHT:
          newMode = THEMES.DARK;
          break;
        case THEMES.DARK:
        default:
          newMode = THEMES.AUTO;
          break;
      }

      savePreference(newMode);
      applyTheme(newMode);
      if (status) {
        status.textContent = `Theme: ${ICON_MAP[newMode].label}`;
      }
    }

    toggles.forEach((toggle) => {
      if (toggle.dataset.themeToggleBound === "true") return;
      toggle.addEventListener("click", cycleTheme);
      toggle.dataset.themeToggleBound = "true";
    });

    systemPrefersDark.addEventListener("change", () => {
      if (currentMode === THEMES.AUTO) {
        applyTheme(THEMES.AUTO);
      }
    });

    applyTheme(currentMode);
  }

  function initLayout(root) {
    const navWrap = root.matches(".nav-pill-wrap")
      ? root
      : root.querySelector(".nav-pill-wrap");
    if (!navWrap) return;
    const container = navWrap.closest(".container");
    if (!container) return;

    // Bounds from the stylesheet, read before the first write shadows them.
    // A nav with three items would otherwise squash the whole column to it.
    const rootStyles = window.getComputedStyle(document.documentElement);
    const toPx = (value) => {
      const num = parseFloat(value);
      if (!Number.isFinite(num)) return null;
      return /rem\s*$/.test(value)
        ? num * parseFloat(rootStyles.fontSize)
        : num;
    };
    const minWidth =
      toPx(rootStyles.getPropertyValue("--container-min-width")) ?? 0;
    const maxWidth =
      toPx(rootStyles.getPropertyValue("--container-max-width")) ?? Infinity;

    let lastAppliedWidth = null;

    // Writing the variable can resize the nav we observe, so identical writes
    // are skipped to keep the observer from feeding itself.
    function applyContainerMaxWidth(value) {
      if (value === lastAppliedWidth) return;
      lastAppliedWidth = value;
      document.documentElement.style.setProperty(
        "--container-max-width",
        value
      );
    }

    function updateContainerMaxWidth() {
      const viewportWidth =
        window.innerWidth || document.documentElement.clientWidth || 0;
      const mobileBreakpoint = 720;

      if (viewportWidth <= mobileBreakpoint) {
        applyContainerMaxWidth(`${viewportWidth}px`);
        return;
      }

      const navRect = navWrap.getBoundingClientRect();
      const styles = window.getComputedStyle(container);
      const padLeft = parseFloat(styles.paddingLeft) || 0;
      const padRight = parseFloat(styles.paddingRight) || 0;
      const navWidth = Math.ceil(navRect.width + padLeft + padRight);
      const width = Math.min(
        Math.max(navWidth, minWidth),
        maxWidth,
        viewportWidth
      );

      applyContainerMaxWidth(`${width}px`);
    }

    updateContainerMaxWidth();

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(updateContainerMaxWidth);
    }

    let _rafId = null;
    window.addEventListener("resize", () => {
      if (_rafId !== null) cancelAnimationFrame(_rafId);
      _rafId = requestAnimationFrame(() => {
        _rafId = null;
        updateContainerMaxWidth();
      });
    });

    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => updateContainerMaxWidth());
      observer.observe(navWrap);
    }
  }

  function init() {
    const roots = document.querySelectorAll('[data-capsule="header"]');

    roots.forEach((root) => {
      if (root.dataset.headerReady === "true") return;
      root.dataset.headerReady = "true";

      initNav(root);
      initThemeToggle(root);
      initPillIndicators(root);
      initLayout(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
