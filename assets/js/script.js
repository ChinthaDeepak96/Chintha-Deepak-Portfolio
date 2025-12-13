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
   * Cursor orb (magnetic) visual
   ******************************************************/
  (function initOrb() {
    // create orb if not present
    let orb = document.querySelector(".cursor-orb");
    if (!orb) {
      orb = document.createElement("div");
      orb.className = "cursor-orb";
      document.body.appendChild(orb);
    }
    orb.style.display = "block";
    orb.style.width = "18px";
    orb.style.height = "18px";
    orb.style.opacity = "0";
    orb.style.position = "fixed";
    orb.style.left = "0";
    orb.style.top = "0";
    orb.style.borderRadius = "50%";
    orb.style.transform = "translate(-50%,-50%)";
    orb.style.pointerEvents = "none";
    orb.style.zIndex = "9999";
    orb.style.background = "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.95), rgba(0,224,255,0.9))";
    orb.style.boxShadow = "0 8px 30px rgba(0,224,255,0.08), 0 2px 8px rgba(168,85,247,0.06)";
    orb.style.mixBlendMode = "screen";

    let ox = 0, oy = 0, tx = 0, ty = 0;
    const lerp = (a, b, t) => a + (b - a) * t;

    document.addEventListener("mousemove", (e) => {
      tx = e.clientX; ty = e.clientY;
      orb.style.opacity = "1";
    }, { passive: true });

    function loop() {
      ox = lerp(ox, tx, 0.24);
      oy = lerp(oy, ty, 0.24);
      orb.style.transform = `translate(${ox}px, ${oy}px) translate(-50%, -50%)`;
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    // enlarge on hoverable elements
    const interactables = document.querySelectorAll("a, button, .btn-solid, .project-card, .nav a, .social-icons a");
    interactables.forEach(el => {
      el.addEventListener("mouseenter", () => {
        orb.style.width = "36px"; orb.style.height = "36px"; orb.style.opacity = "0.96"; orb.style.mixBlendMode = "difference";
      });
      el.addEventListener("mouseleave", () => {
        orb.style.width = "18px"; orb.style.height = "18px"; orb.style.opacity = "0.88"; orb.style.mixBlendMode = "screen";
      });
    });
  })();

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
