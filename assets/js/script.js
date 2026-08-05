// assets/js/script.js
// Rebuilt for <spline-viewer> usage (Option A).
// - Uses viewer.emitEvent(...) when available
// - Falls back to postMessage to inner iframe if present
// - Full-page cursor capture + overlay toggle
// - Magnetic cursor orb + head-bob + aura/shadow toggles

/**********************
 * Utility: throttle
 **********************/
function throttle(fn, wait) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn(...args);
    }
  };
}

/**********************
 * Small compatibility helpers
 **********************/
function safeEmit(viewer, eventName, payload = {}) {
  try {
    if (!viewer) return false;
    // Preferred: Spline viewer exposes emitEvent
    if (typeof viewer.emitEvent === "function") {
      viewer.emitEvent(eventName, payload);
      return true;
    }

    // Some older viewer builds might expose a "dispatchEvent" or "viewer" property.
    if (viewer.viewer && typeof viewer.viewer.emitEvent === "function") {
      viewer.viewer.emitEvent(eventName, payload);
      return true;
    }

    // Fallback: find internal iframe and postMessage
    const iframe = viewer.shadowRoot && viewer.shadowRoot.querySelector("iframe");
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(Object.assign({ __from: "spline-wrapper", type: eventName }, payload), "*");
      return true;
    }
  } catch (err) {
    console.warn("safeEmit error:", err);
  }
  return false;
}

/**********************
 * Main initializer
 **********************/
(function () {
  const holder = document.getElementById("splineHolder");
  const capture = document.getElementById("cursorCapture");
  const splineViewer = document.getElementById("splineViewer"); // <spline-viewer>
  const fallbackImage = holder ? holder.querySelector(".spline-fallback") : null;

  // ensure we have an area, otherwise abort quietly
  if (!holder || !splineViewer) {
    console.warn("Spline area or spline-viewer not found. Aborting spline init.");
    return;
  }

  // show fallback until viewer ready
  let viewerReady = false;
  function onViewerReady() {
    viewerReady = true;
    holder.classList.add("spline-loaded");
    if (fallbackImage) {
      fallbackImage.style.transition = "opacity .6s ease";
      fallbackImage.style.opacity = "0";
      setTimeout(() => {
        if (fallbackImage && fallbackImage.parentNode) fallbackImage.style.display = "none";
      }, 700);
    }
  }

  // try listen to viewer load/ready events
  // different viewer versions dispatch different events; attach multiple handlers
  const tryBindReady = () => {
    // 1) custom 'load' event on the element
    splineViewer.addEventListener("load", onViewerReady, { once: true });

    // 2) many versions will dispatch "ready" or "viewer-ready"
    splineViewer.addEventListener("ready", onViewerReady, { once: true });
    splineViewer.addEventListener("viewer-ready", onViewerReady, { once: true });

    // 3) fallback: poll for emitEvent capability (timeout 4s)
    const start = Date.now();
    const poll = setInterval(() => {
      if (typeof splineViewer.emitEvent === "function") {
        clearInterval(poll);
        onViewerReady();
        return;
      }
      // also check shadow iframe
      try {
        const iframe = splineViewer.shadowRoot && splineViewer.shadowRoot.querySelector("iframe");
        if (iframe && iframe.contentWindow) {
          clearInterval(poll);
          onViewerReady();
          return;
        }
      } catch (e) { /* ignore */ }

      if (Date.now() - start > 4000) {
        clearInterval(poll);
        // still call onViewerReady to hide fallback but keep viewerReady = true,
        // events may still be delivered via postMessage fallback later.
        onViewerReady();
      }
    }, 220);
  };
  tryBindReady();

  /******************************************************
   * Cursor sending (normalized to -1..1)
   * - uses splineViewer.emitEvent when available
   * - fallback to postMessage to iframe inside viewer.shadowRoot
   ******************************************************/
  const sendCursorInternal = (nx, ny) => {
    // head (fast) and body (slow)
    const ok1 = safeEmit(splineViewer, "cursorHeadFast", { x: nx, y: ny });
    const ok2 = safeEmit(splineViewer, "cursorBodySlow", { x: nx, y: ny });

    // If both failed, we still return false — but that's fine, we tried.
    return ok1 || ok2;
  };

  // Normalize screen coords to -1..1 (viewport based)
  function normViewport(clientX, clientY) {
    const nx = (clientX / window.innerWidth) * 2 - 1;
    const ny = -((clientY / window.innerHeight) * 2 - 1);
    return { nx, ny };
  }

  const sendCursor = throttle((e) => {
    if (!viewerReady && !splineViewer) return;
    let cx = e.clientX, cy = e.clientY;
    if (typeof cx === "undefined" && e.touches && e.touches[0]) {
      cx = e.touches[0].clientX;
      cy = e.touches[0].clientY;
    }
    const { nx, ny } = normViewport(cx, cy);
    sendCursorInternal(nx, ny);
  }, 16);

  // Global page events (we still use page coords, so robot follows across full page)
  window.addEventListener("mousemove", sendCursor, { passive: true });
  window.addEventListener("touchmove", throttle((e) => {
    if (!e.touches || !e.touches.length) return;
    const t = e.touches[0];
    const { nx, ny } = normViewport(t.clientX, t.clientY);
    sendCursorInternal(nx, ny);
  }, 40), { passive: true });

  // Also listen on the capture overlay for best responsiveness (it covers the spline-frame)
  if (capture) {
    capture.addEventListener("mousemove", (e) => {
      // stop propagation so the page handler won't double-send; but still allow page listeners too
      // (we don't call e.stopPropagation to avoid interfering with other handlers)
      sendCursor(e);
    }, { passive: true });

    capture.addEventListener("touchmove", (e) => {
      sendCursor(e);
    }, { passive: true });

    // Toggle overlay to allow direct interaction: click to enable interactive mode (adds .active -> pointer-events:none)
    capture.addEventListener("click", (ev) => {
      // toggle
      const isActive = capture.classList.toggle("active");
      // When active, we let user interact with the spline directly (pointer-events pass through)
      // When inactive, overlay captures pointer for consistent cursor-to-viewer mapping.
      // Provide a short hint via title
      if (isActive) {
        capture.title = "Spline interaction enabled — click again to capture cursor";
      } else {
        capture.title = "Click to interact with 3D (click again to lock cursor capture)";
      }
    });
  }

  /******************************************************
   * Head-bob idle + aura/shadow toggles (send via API)
   ******************************************************/
  let headBobOn = true;
  setInterval(() => {
    if (!viewerReady) return;
    // send a tick event; payload is free-form
    safeEmit(splineViewer, "headBob", { t: Date.now() });
  }, 5600);

  window.toggleRobotAura = function (on) {
    safeEmit(splineViewer, "robotAura", { value: !!on });
    // mirror as class for CSS effects
    holder.classList.toggle("robot-aura-on", !!on);
    holder.classList.toggle("robot-aura-off", !on);
  };
  window.toggleRobotShadow = function (on) {
    safeEmit(splineViewer, "robotShadow", { value: !!on });
    holder.classList.toggle("robot-shadow-off", !on);
  };

  // Expose hideEyes for login scripts
  window.sendHideEyes = function (value) {
    safeEmit(splineViewer, "hideEyes", { value: !!value });
  };

  /******************************************************
   * Entrance animation trigger + lazy load tweaks
   ******************************************************/
  window.addEventListener("load", () => {
    document.body.classList.add("site-ready");
    document.querySelectorAll(".lazy-load").forEach((el) => el.classList.add("visible"));
  });


  /******************************************************
   * Small accessibility: respect reduced-motion
   ******************************************************/
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // disable heavy animations by toggling a class
    document.documentElement.classList.add("reduce-motion");
  }

  // final: when viewer ready, trigger a friendly event to ensure it receives initial focus
  setTimeout(() => {
    if (viewerReady) {
      safeEmit(splineViewer, "pageReady", { t: Date.now() });
    }
  }, 900);
})();
/* ======================================================
   CERTIFICATE MODAL CONTROL
   ====================================================== */

/* ======================================================
   V2 UPGRADE — SCROLL REVEALS, ROBOT TILT, MAGNETIC UI
   ====================================================== */
(function () {
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Scroll reveal ---------- */
  const revealEls = document.querySelectorAll("[data-reveal]");
  if (revealEls.length && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const delay = entry.target.getAttribute("data-reveal-delay") || 0;
          entry.target.style.setProperty("--reveal-delay", delay);
          entry.target.classList.add("is-visible");
          // also flag the parent skill-card-pro so the fill bar animates
          if (entry.target.classList.contains("skill-card-pro")) {
            entry.target.classList.add("is-visible");
          }
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -60px 0px" });

    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  }

  /* ---------- Robot subtle tilt-toward-cursor ----------
     Works independently of the Spline scene's internal event bindings —
     tilts the whole viewer frame in 3D based on cursor position, so the
     robot visually "looks toward" the pointer no matter what's baked
     into the .splinecode file. */
  if (!reduceMotion) {
    const frame = document.getElementById("splineHolder");
    if (frame) {
      const maxTilt = 6; // degrees, kept subtle
      let rafId = null;
      let targetX = 0, targetY = 0, curX = 0, curY = 0;

      function updateTilt(clientX, clientY) {
        const rect = frame.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = (clientX - cx) / (window.innerWidth / 2);
        const dy = (clientY - cy) / (window.innerHeight / 2);
        targetY = Math.max(-1, Math.min(1, dx)) * maxTilt;
        targetX = Math.max(-1, Math.min(1, -dy)) * maxTilt;
        if (!rafId) rafId = requestAnimationFrame(tick);
      }

      function tick() {
        curX += (targetX - curX) * 0.08;
        curY += (targetY - curY) * 0.08;
        frame.style.setProperty("--tilt-x", curX.toFixed(2) + "deg");
        frame.style.setProperty("--tilt-y", curY.toFixed(2) + "deg");
        if (Math.abs(targetX - curX) > 0.01 || Math.abs(targetY - curY) > 0.01) {
          rafId = requestAnimationFrame(tick);
        } else {
          rafId = null;
        }
      }

      window.addEventListener("mousemove", (e) => {
        frame.classList.add("tilt-active");
        updateTilt(e.clientX, e.clientY);
      }, { passive: true });

      window.addEventListener("mouseleave", () => {
        targetX = 0; targetY = 0;
        if (!rafId) rafId = requestAnimationFrame(tick);
      });
    }
  }

  /* ---------- Magnetic buttons ---------- */
  if (!reduceMotion) {
    const magnets = document.querySelectorAll(".btn-solid, .btn-outline, .connect-card");
    magnets.forEach((el) => {
      let raf = null;
      el.addEventListener("mousemove", (e) => {
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left - rect.width / 2;
        const my = e.clientY - rect.top - rect.height / 2;
        const strength = 0.18;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          el.style.transform = `translate(${mx * strength}px, ${my * strength}px)`;
        });
      });
      el.addEventListener("mouseleave", () => {
        if (raf) cancelAnimationFrame(raf);
        el.style.transform = "translate(0, 0)";
      });
    });
  }

  /* ---------- Project card 3D tilt ---------- */
  if (!reduceMotion) {
    const cards = document.querySelectorAll(".project-card:not(.coming-soon)");
    cards.forEach((card) => {
      const wrap = card.closest("a") || card;
      wrap.addEventListener("mousemove", (e) => {
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.setProperty("--tilt-ry", (px * 8).toFixed(2) + "deg");
        card.style.setProperty("--tilt-rx", (-py * 8).toFixed(2) + "deg");
      });
      wrap.addEventListener("mouseleave", () => {
        card.style.setProperty("--tilt-ry", "0deg");
        card.style.setProperty("--tilt-rx", "0deg");
      });
    });
  }
})();

// Auto-update footer year
(function () {
  const y = document.getElementById("footerYear");
  if (y) y.textContent = new Date().getFullYear();
})();

function openCert(src) {
  const modal = document.getElementById("certModal");
  const img = document.getElementById("certModalImg");
  img.src = src;
  modal.style.display = "flex";
}

function closeCert() {
  const modal = document.getElementById("certModal");
  modal.style.display = "none";
}
/* ---------- Auto-rotating slideshows (Education + Projects) ---------- */
document.querySelectorAll(".slideshow").forEach((el) => {
  const imgs = el.querySelectorAll("img");
  if (imgs.length < 2) return; // single image, nothing to rotate
  let idx = 0;
  setInterval(() => {
    imgs[idx].classList.remove("active");
    idx = (idx + 1) % imgs.length;
    imgs[idx].classList.add("active");
  }, 5000);
});
