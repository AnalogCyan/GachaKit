// Fetches photo data and renders polaroid cards with a modal viewer

const photoDataCache = new Map();
let modalKeydownHandler = null;
const motionPreferenceQuery = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
);
let prefersReducedMotion = motionPreferenceQuery.matches;

motionPreferenceQuery.addEventListener("change", (event) => {
  prefersReducedMotion = event.matches;
});

// Renders every gallery not rendered yet, then builds the modal for the cards
// on the page
async function initPhotoCards() {
  const sections = Array.from(
    document.querySelectorAll(".polaroid-grid")
  ).filter((section) => !section.dataset.ready);

  if (sections.length === 0) return;

  const registry = new Map();

  await Promise.all(
    sections.map(async (section) => {
      section.dataset.ready = "true";
      const config = normalizeConfig(section.dataset);

      try {
        const data = await fetchPhotoData(config.dataPath);
        if (!Array.isArray(data)) {
          throw new TypeError(`${config.dataPath} is not a JSON array`);
        }
        const usable = data.filter((entry) => entry?.imageSrc);
        if (usable.length < data.length) {
          console.warn(
            `Skipped ${data.length - usable.length} photo(s) without imageSrc in ${config.dataPath}`
          );
        }
        renderSection(section, usable.slice(0, config.count), config, registry);
      } catch (error) {
        console.error("Failed to load photo data:", error);
        section.innerHTML = `<p>Could not load photos.</p>`;
      }
    })
  );

  if (registry.size === 0) return;

  createModalStructure();
  initializePhotoModal(registry, () => prefersReducedMotion);
}

document.addEventListener("DOMContentLoaded", initPhotoCards);

function normalizeConfig(dataset) {
  const parsedCount = parseInt(dataset.count, 10);
  const count =
    Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 3;

  const dataPath = dataset.path || "/data/photos.json";
  const imagesPathRaw = dataset.imagesPath || "/images/";
  const imagesPath = imagesPathRaw.endsWith("/")
    ? imagesPathRaw
    : `${imagesPathRaw}/`;

  return { count, dataPath, imagesPath };
}

async function fetchPhotoData(path) {
  if (photoDataCache.has(path)) {
    return photoDataCache.get(path);
  }

  const request = fetch(path)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.json();
    })
    .catch((error) => {
      photoDataCache.delete(path);
      throw error;
    });

  photoDataCache.set(path, request);
  return request;
}

function renderSection(section, cards, config, registry) {
  section.innerHTML = "";

  if (!cards || cards.length === 0) {
    section.innerHTML = `<p>No photos available.</p>`;
    return;
  }

  cards.forEach((card, idx) => {
    const rawId = card.id ?? `${config.dataPath}-${idx}`;
    const cardId = String(rawId);
    // Galleries may share a data file but not an image folder
    const uniqueKey = `${config.dataPath}::${config.imagesPath}::${cardId}`;
    const imagePath = config.imagesPath + card.imageSrc;
    const title = card.title || "Untitled";
    // Intrinsic size reserves the card's height before the lazy image loads
    const size =
      Number.isFinite(card.width) && Number.isFinite(card.height)
        ? ` width="${card.width}" height="${card.height}"`
        : "";

    const polaroid = document.createElement("button");
    polaroid.type = "button";
    polaroid.className = "polaroid";
    polaroid.setAttribute("data-id", cardId);
    polaroid.setAttribute("data-card-key", uniqueKey);

    const randomAngle = (Math.random() * 6 - 3).toFixed(2);
    polaroid.style.setProperty("--hover-rotation", `${randomAngle}deg`);
    // The caption names the button, so the image is decorative here
    polaroid.innerHTML = `
      <span class="photo-container">
        <img src="${escapeHTML(imagePath)}" alt=""${size} loading="lazy" decoding="async" />
      </span>
      <span class="caption">
        <span class="caption-title">${escapeHTML(title)}</span>
        <span class="caption-date"><i class="ri-calendar-line" aria-hidden="true"></i> ${escapeHTML(
          card.date || ""
        )}</span>
      </span>
    `;

    section.appendChild(polaroid);
    registry.set(uniqueKey, {
      data: { ...card, title },
      imagePath,
      imagesPath: config.imagesPath,
      trigger: polaroid,
    });
  });
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function downloadImage(src, title) {
  fetch(src)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.blob();
    })
    .then((blob) => {
      const extension =
        new URL(src, location.href).pathname.match(/\.(\w+)$/)?.[1] ||
        blob.type.match(/^image\/(\w+)/)?.[1] ||
        "jpg";
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${(title || "photo").replace(/\s+/g, "-").toLowerCase()}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    })
    .catch((error) => {
      console.error("Error downloading image:", error);
      alert("Unable to download the image. Please try again.");
    });
}

function createModalStructure() {
  // Replaced rather than reused, so a previous page's listeners go with it
  document.querySelector(".photo-modal-overlay")?.remove();
  document.querySelectorAll(".modal-flight").forEach((el) => el.remove());

  const modalOverlay = document.createElement("div");
  modalOverlay.className = "photo-modal-overlay";
  modalOverlay.setAttribute("aria-hidden", "true");
  modalOverlay.innerHTML = `
    <div class="modal-container" role="dialog" aria-modal="true" aria-labelledby="photo-modal-title" tabindex="-1">
      <div class="modal-header">
        <h2 class="modal-title" id="photo-modal-title"></h2>
        <div class="modal-buttons">
          <button class="modal-button modal-download" type="button" aria-label="Download photo">
            <i class="ri-download-2-line" aria-hidden="true"></i>
          </button>
          <button class="modal-button modal-close" type="button" aria-label="Close photo details">
            <i class="ri-close-line" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div class="modal-content">
        <div class="modal-left-column">
          <div class="modal-title-wrapper">
            <div class="image-container">
              <img class="modal-image" alt="" />
              <button class="modal-button modal-expand" type="button" aria-label="Open fullscreen view">
                <i class="ri-fullscreen-line" aria-hidden="true"></i>
              </button>
            </div>
          </div>
          <div class="modal-metadata">
            <!-- Metadata items will be generated dynamically -->
          </div>
        </div>
        <div class="modal-description">
          <!-- Description will be filled dynamically -->
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);
}

function initializePhotoModal(cardRegistry, getReduceMotion) {
  const cards = document.querySelectorAll(".polaroid");
  const modalOverlay = document.querySelector(".photo-modal-overlay");
  const modalContainer = document.querySelector(".modal-container");
  const modalClose = document.querySelector(".modal-close");
  const modalDownload = document.querySelector(".modal-download");
  const modalExpand = document.querySelector(".modal-expand");
  const modalTitle = document.querySelector(".modal-title");
  const modalImage = document.querySelector(".modal-image");
  const modalDescription = document.querySelector(".modal-description");
  const modalMetadataContainer = document.querySelector(".modal-metadata");

  let activeEntry = null;
  let lastFocusedElement = null;
  let animationHidOriginal = false;

  // Durations match the .modal-flight and .modal-container transitions. The
  // modal starts fading in late in the flight, so it materialises around the
  // photo as it lands rather than after a pause.
  const FLIGHT_MS = 400;
  const FADE_MS = 300;
  const MODAL_IN_AT_MS = 240;
  let flightBox = null;
  let flightTimer = null;
  let flightResize = null;

  // The photo in flight lives on <body>, outside the overlay, so it neither
  // inherits the overlay's fade nor vanishes when the overlay is hidden. A
  // fresh element each time means no inline state carries over. A resize
  // moves the target, so onResize finishes the flight instead of landing on
  // a stale rect.
  function startFlight(src, rect, onResize) {
    clearFlight();
    const box = document.createElement("div");
    box.className = "modal-flight";
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    box.appendChild(img);
    placeFlight(box, rect);
    document.body.appendChild(box);
    flightBox = box;
    flightResize = onResize;
    window.addEventListener("resize", onResize);
    return box;
  }

  function placeFlight(box, rect) {
    box.style.top = `${rect.top}px`;
    box.style.left = `${rect.left}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }

  function clearFlight() {
    if (flightTimer !== null) {
      clearTimeout(flightTimer);
      flightTimer = null;
    }
    if (flightResize) {
      window.removeEventListener("resize", flightResize);
      flightResize = null;
    }
    if (flightBox) {
      flightBox.remove();
      flightBox = null;
    }
  }

  function cardImage(card) {
    return card.querySelector(".photo-container img") || card;
  }
  const focusableSelector =
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  let focusableNodes = [];

  let inertedNodes = [];

  // Hides the rest of the page from assistive tech while the modal is open
  function setBackgroundInert() {
    inertedNodes = Array.from(document.body.children).filter(
      (node) => node !== modalOverlay && !node.inert
    );
    inertedNodes.forEach((node) => {
      node.inert = true;
    });
  }

  function releaseBackgroundInert() {
    inertedNodes.forEach((node) => {
      node.inert = false;
    });
    inertedNodes = [];
  }

  function setFocusTrap() {
    focusableNodes = Array.from(
      modalContainer.querySelectorAll(focusableSelector)
    ).filter((node) => !node.hasAttribute("disabled"));
    modalContainer.addEventListener("keydown", handleFocusTrap);
  }

  function releaseFocusTrap() {
    modalContainer.removeEventListener("keydown", handleFocusTrap);
    focusableNodes = [];
  }

  function handleFocusTrap(event) {
    if (event.key !== "Tab") return;
    // The expand button hides itself if the image fails to load
    const visible = focusableNodes.filter((node) => node.offsetParent !== null);
    if (visible.length === 0) return;

    const first = visible[0];
    const last = visible[visible.length - 1];
    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function estimateTextWidth(
    text,
    fontSize = "0.9rem",
    fontFamily = '"Nunito", sans-serif'
  ) {
    const tempSpan = document.createElement("span");
    tempSpan.style.fontSize = fontSize;
    tempSpan.style.fontFamily = fontFamily;
    tempSpan.style.visibility = "hidden";
    tempSpan.style.position = "absolute";
    tempSpan.style.whiteSpace = "nowrap";
    tempSpan.textContent = text;
    document.body.appendChild(tempSpan);

    const width = tempSpan.getBoundingClientRect().width;

    // Clean up
    document.body.removeChild(tempSpan);

    return width + 50; // 50px buffer for padding and icon
  }

  function createMetadataItemWithWidth(iconClass, textContent) {
    const estimatedWidth = estimateTextWidth(textContent);
    return {
      element: createMetadataItem(iconClass, textContent),
      width: estimatedWidth,
      textContent: textContent,
      iconClass: iconClass,
    };
  }

  function createMetadataItem(iconClass, textContent) {
    const item = document.createElement("div");
    item.className = "metadata-item";
    const icon = document.createElement("i");
    icon.className = iconClass;
    const text = document.createElement("span");
    text.textContent = textContent;
    item.appendChild(icon);
    item.appendChild(text);
    return item;
  }

  // Open modal function with improved positioning
  function openModal(cardKey, clickedElement) {
    const entry = cardRegistry.get(cardKey);
    if (!entry) return;

    const card = entry.data;
    // Two galleries reading the same file share keys, so the registry's
    // trigger can be the other gallery's card
    activeEntry = { ...entry, trigger: clickedElement };
    lastFocusedElement = clickedElement;
    animationHidOriginal = false;

    modalTitle.textContent = card.title || "Photo";
    modalExpand.style.display = "";
    modalImage.src = entry.imagePath;
    modalImage.alt = card.title || "Selected photo";

    const metadataItems = [];
    if (card.date) {
      metadataItems.push(
        createMetadataItemWithWidth("ri-calendar-line", card.date)
      );
    }
    if (card.camera) {
      metadataItems.push(
        createMetadataItemWithWidth("ri-camera-line", card.camera)
      );
    }
    if (card.location) {
      metadataItems.push(
        createMetadataItemWithWidth("ri-map-pin-line", card.location)
      );
    }
    if (Array.isArray(card.tags)) {
      card.tags
        .filter(
          (tag) =>
            ["string", "number", "boolean"].includes(typeof tag) && tag !== ""
        )
        .forEach((tag) => {
          metadataItems.push(
            createMetadataItemWithWidth("ri-price-tag-3-line", String(tag))
          );
        });
    }

    metadataItems.sort((a, b) => a.width - b.width);
    modalMetadataContainer.innerHTML = "";
    metadataItems.forEach((item) => {
      if (item.iconClass === "ri-map-pin-line") {
        item.element.querySelector("span").classList.add("modal-location");
      }
      modalMetadataContainer.appendChild(item.element);
    });

    modalDescription.textContent = card.description || "";

    const reduceMotion =
      typeof getReduceMotion === "function" ? !!getReduceMotion() : false;

    modalOverlay.style.display = "flex";
    modalOverlay.style.top = "0";
    modalOverlay.style.left = "0";
    modalOverlay.style.width = "100vw";
    modalOverlay.style.height = "100vh";
    modalOverlay.setAttribute("aria-hidden", "false");

    modalContainer.style.display = "flex";
    modalContainer.style.opacity = reduceMotion ? "1" : "0";

    setBackgroundInert();
    document.body.classList.add("modal-open");

    if (reduceMotion) {
      clearFlight();
      modalOverlay.classList.add("active");
      setFocusTrap();
      setTimeout(() => (modalClose || modalContainer).focus(), 0);
      return;
    }

    const land = () => {
      clearFlight();
      modalContainer.style.opacity = "1";
      setFocusTrap();
      if (!modalContainer.contains(document.activeElement)) {
        (modalClose || modalContainer).focus();
      }
    };
    const sourceImage = cardImage(clickedElement);
    const box = startFlight(
      entry.imagePath,
      sourceImage.getBoundingClientRect(),
      land
    );
    sourceImage.style.visibility = "hidden";
    animationHidOriginal = true;

    // Backdrop dims while the photo flies; the flight is not inside it
    modalOverlay.classList.add("active");

    // The target is the modal's own image, so wait until that image has its
    // real size before measuring, or the flight lands on a stale rect
    const ready = modalImage.decode
      ? modalImage.decode().catch(() => {})
      : Promise.resolve();

    ready.then(() => {
      if (flightBox !== box) return;
      requestAnimationFrame(() => {
        if (flightBox !== box) return;
        placeFlight(box, modalImage.getBoundingClientRect());

        flightTimer = setTimeout(() => {
          modalContainer.style.opacity = "1";
          flightTimer = setTimeout(() => {
            // The box sits exactly over the modal image, so this is a crossfade
            box.style.opacity = "0";
            setFocusTrap();
            (modalClose || modalContainer).focus();
            flightTimer = setTimeout(() => {
              flightTimer = null;
              if (flightBox === box) clearFlight();
            }, FADE_MS);
          }, FLIGHT_MS - MODAL_IN_AT_MS);
        }, MODAL_IN_AT_MS);
      });
    });
  }

  function closeModal() {
    if (!modalOverlay.classList.contains("active")) return;

    const reduceMotion =
      typeof getReduceMotion === "function" ? !!getReduceMotion() : false;
    const trigger = activeEntry?.trigger || null;
    const restoreFocusTarget = lastFocusedElement || trigger;

    const finalizeClose = () => {
      modalOverlay.style.display = "none";
      modalOverlay.setAttribute("aria-hidden", "true");
      releaseBackgroundInert();
      document.body.classList.remove("modal-open");
      modalContainer.style.opacity = "1";
      releaseFocusTrap();
      if (trigger) cardImage(trigger).style.visibility = "";
      clearFlight();
      if (restoreFocusTarget) restoreFocusTarget.focus();
      modalClose.style.pointerEvents = "auto";
      activeEntry = null;
      animationHidOriginal = false;
    };

    // Removing the class fades the backdrop out over FADE_MS; display: none
    // waits for that so it is not cut off
    modalOverlay.classList.remove("active");

    if (!reduceMotion && trigger && animationHidOriginal) {
      const targetImage = cardImage(trigger);
      const box = startFlight(
        activeEntry.imagePath,
        modalImage.getBoundingClientRect(),
        finalizeClose
      );

      modalContainer.style.opacity = "0";
      modalClose.style.pointerEvents = "none";

      requestAnimationFrame(() => {
        if (flightBox !== box) return;
        placeFlight(box, targetImage.getBoundingClientRect());
        flightTimer = setTimeout(() => {
          flightTimer = null;
          // Uncover the card image and drop the box in the same frame
          finalizeClose();
        }, FLIGHT_MS);
      });
    } else {
      clearFlight();
      finalizeClose();
    }
  }

  cards.forEach((card) => {
    const getCardKey = () =>
      card.getAttribute("data-card-key") || card.getAttribute("data-id");

    card.addEventListener("click", () => {
      openModal(getCardKey(), card);
    });
  });

  if (modalClose) {
    modalClose.addEventListener("click", (event) => {
      event.stopPropagation();
      closeModal();
    });
  }

  // Download image when clicking the download button
  if (modalDownload) {
    modalDownload.addEventListener("click", (event) => {
      event.stopPropagation();

      const imageSrc = modalImage.getAttribute("src");
      if (!imageSrc) return;
      downloadImage(imageSrc, modalTitle.textContent.trim());
    });
  }

  // An image that failed to load has no size to expand to
  modalImage.addEventListener("error", () => {
    modalExpand.style.display = "none";
  });

  if (modalExpand) {
    modalExpand.addEventListener("click", (event) => {
      event.stopPropagation();
      if (
        !modalOverlay.classList.contains("active") ||
        !modalImage.naturalWidth
      ) {
        return;
      }

      const fullscreenOverlay = document.createElement("div");
      fullscreenOverlay.className = "fullscreen-overlay";
      fullscreenOverlay.setAttribute("role", "dialog");
      fullscreenOverlay.setAttribute("aria-modal", "true");
      fullscreenOverlay.setAttribute(
        "aria-label",
        `${modalTitle.textContent.trim() || "Photo"}, fullscreen`
      );

      const sourceImage = modalImage;
      const sourceRect = sourceImage.getBoundingClientRect();

      const imageContainer = document.createElement("div");
      imageContainer.className = "fullscreen-image-container";

      const fullscreenImage = document.createElement("img");
      fullscreenImage.src = sourceImage.src;
      fullscreenImage.alt = sourceImage.alt;
      fullscreenImage.className = "fullscreen-image";

      imageContainer.appendChild(fullscreenImage);
      placeFlight(imageContainer, sourceRect);

      fullscreenOverlay.appendChild(imageContainer);

      const buttonContainer = document.createElement("div");
      buttonContainer.className = "fullscreen-button-bar";
      imageContainer.appendChild(buttonContainer);

      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.setAttribute("aria-label", "Download photo");
      downloadButton.innerHTML =
        '<i class="ri-download-2-line" aria-hidden="true"></i>';
      downloadButton.className =
        "fullscreen-button fullscreen-button--download";
      buttonContainer.appendChild(downloadButton);

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.setAttribute("aria-label", "Close fullscreen view");
      closeButton.innerHTML =
        '<i class="ri-close-line" aria-hidden="true"></i>';
      closeButton.className = "fullscreen-button fullscreen-button--close";
      buttonContainer.appendChild(closeButton);

      document.body.appendChild(fullscreenOverlay);
      // Keyboard and pointer stay in the fullscreen layer until it closes
      modalOverlay.inert = true;
      closeButton.focus();

      const reduceMotion =
        typeof getReduceMotion === "function" ? !!getReduceMotion() : false;
      let closed = false;
      let buttonTimer = null;

      // Calculate the optimal size for the expanded image (85% of viewport)
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const optimalWidth = viewportWidth * 0.85;
      const optimalHeight = viewportHeight * 0.85;

      const imgNatWidth = sourceImage.naturalWidth;
      const imgNatHeight = sourceImage.naturalHeight;

      // Calculate dimensions that maintain aspect ratio
      let targetWidth, targetHeight;
      const aspectRatio = imgNatWidth / imgNatHeight;

      if (imgNatWidth / optimalWidth > imgNatHeight / optimalHeight) {
        // Width is the limiting factor
        targetWidth = optimalWidth;
        targetHeight = targetWidth / aspectRatio;
      } else {
        // Height is the limiting factor
        targetHeight = optimalHeight;
        targetWidth = targetHeight * aspectRatio;
      }

      // The copy sits exactly over the modal image, so swapping them is
      // invisible, but only once the copy is decoded and can paint
      const ready = fullscreenImage.decode
        ? fullscreenImage.decode().catch(() => {})
        : Promise.resolve();

      ready.then(() => {
        if (closed) return;
        // Commit the start rect so the move below transitions from it
        void imageContainer.offsetWidth;
        sourceImage.style.visibility = "hidden";
        fullscreenOverlay.classList.add("fullscreen-overlay--active");

        // Centred with calc rather than a transform, so all four edges run
        // on one curve and the path is a straight line. It also stays
        // centred if the window resizes.
        imageContainer.style.top = `calc(50% - ${targetHeight / 2}px)`;
        imageContainer.style.left = `calc(50% - ${targetWidth / 2}px)`;
        imageContainer.style.width = `${targetWidth}px`;
        imageContainer.style.height = `${targetHeight}px`;

        buttonTimer = setTimeout(
          () => buttonContainer.classList.add("fullscreen-button-bar--visible"),
          reduceMotion ? 0 : FLIGHT_MS
        );
      });

      downloadButton.addEventListener("click", (e) => {
        e.stopPropagation();
        downloadImage(fullscreenImage.src, modalTitle.textContent.trim());
      });

      const closeFullscreen = () => {
        if (closed) return;
        closed = true;
        clearTimeout(buttonTimer);
        document.removeEventListener("keydown", keyHandler, true);

        // Gone at once, or the buttons shrink along with the photo
        buttonContainer.remove();
        // Measured again in case the window resized while open
        placeFlight(imageContainer, sourceImage.getBoundingClientRect());
        fullscreenOverlay.classList.remove("fullscreen-overlay--active");

        // The copy covers the modal image until it lands, then they swap in
        // one frame and focus goes back to the button that opened it. A timer
        // alone can fire a frame or two before the transition ends.
        let landed = false;
        const land = () => {
          if (landed) return;
          landed = true;
          fullscreenOverlay.remove();
          sourceImage.style.visibility = "";
          modalOverlay.inert = false;
          modalExpand.focus();
        };
        imageContainer.addEventListener("transitionend", (e) => {
          if (e.target === imageContainer) land();
        });
        // Nothing to wait for if the photo never moved
        setTimeout(land, reduceMotion ? 0 : FLIGHT_MS + 100);
      };

      fullscreenOverlay.addEventListener("click", closeFullscreen);
      closeButton.addEventListener("click", (e) => {
        e.stopPropagation();
        closeFullscreen();
      });

      // Prevent clicks on image from closing fullscreen
      fullscreenImage.addEventListener("click", (e) => {
        e.stopPropagation();
      });

      // Escape closes fullscreen only, not the modal underneath. Tab cycles
      // between the two buttons.
      function keyHandler(e) {
        if (closed) return;
        if (e.key === "Escape") {
          e.stopPropagation();
          closeFullscreen();
        } else if (e.key === "Tab") {
          e.preventDefault();
          const buttons = [downloadButton, closeButton];
          const next =
            buttons.indexOf(document.activeElement) + (e.shiftKey ? -1 : 1);
          buttons.at(next % buttons.length).focus();
        }
      }
      document.addEventListener("keydown", keyHandler, true);
    });
  }

  if (modalOverlay) {
    modalOverlay.addEventListener("click", (event) => {
      if (event.target === modalOverlay) {
        closeModal();
      }
    });
  }

  if (modalKeydownHandler) {
    document.removeEventListener("keydown", modalKeydownHandler);
  }
  modalKeydownHandler = (e) => {
    if (e.key === "Escape" && modalOverlay.classList.contains("active")) {
      closeModal();
    }
  };
  document.addEventListener("keydown", modalKeydownHandler);
}
