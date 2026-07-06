(function () {
  "use strict";

  var data = window.__BRAND__ || {};
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fineHover = matchMedia("(hover: hover) and (pointer: fine)").matches;

  var $ = function (sel, scope) { return (scope || document).querySelector(sel); };
  var $$ = function (sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); };
  var escHTML = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  function safe(fn, name) {
    try { fn(); } catch (e) { console.warn("[" + name + "] failed:", e); }
  }

  /* ---------------------------------------------------------
     Google Sheets — lectura pública vía JSONP (sin backend)
     --------------------------------------------------------- */
  var sheetCache = null;
  var sheetCbCounter = 0;
  var sheetPendingCallbacks = null;

  function driveImageUrl(rawUrl, size) {
    if (!rawUrl) return "";
    var m = String(rawUrl).match(/\/d\/([a-zA-Z0-9_-]+)/) || String(rawUrl).match(/id=([a-zA-Z0-9_-]+)/);
    if (!m) return rawUrl;
    return "https://drive.google.com/thumbnail?id=" + m[1] + "&sz=w" + (size || 1000);
  }

  function parseSheetTable(table) {
    var cols = table.cols.map(function (c) { return (c.label || "").trim().toLowerCase(); });
    return table.rows.map(function (row) {
      var obj = {};
      row.c.forEach(function (cell, i) {
        obj[cols[i]] = cell ? (cell.v == null ? "" : cell.v) : "";
      });
      return obj;
    });
  }

  function loadSheetProducts(callback) {
    if (sheetCache) { callback(sheetCache); return; }
    if (!data.sheet || !data.sheet.id) { callback(null); return; }

    // Varios mounts piden datos casi al mismo tiempo — comparten UNA sola
    // request en vuelo en vez de disparar un <script> JSONP por cada uno.
    if (sheetPendingCallbacks) { sheetPendingCallbacks.push(callback); return; }
    sheetPendingCallbacks = [callback];

    function resolveAll(rows) {
      var callbacks = sheetPendingCallbacks || [];
      sheetPendingCallbacks = null;
      if (rows) sheetCache = rows;
      callbacks.forEach(function (cb) { cb(rows); });
    }

    var cbName = "__sheetCb" + Date.now() + "_" + (sheetCbCounter++);
    var done = false;
    var timeout = setTimeout(function () {
      if (done) return;
      done = true;
      delete window[cbName];
      resolveAll(null);
    }, 8000);

    window[cbName] = function (resp) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      delete window[cbName];
      try {
        resolveAll(parseSheetTable(resp.table));
      } catch (e) {
        resolveAll(null);
      }
    };

    var script = document.createElement("script");
    script.src = data.sheet.endpoint(cbName);
    script.onerror = function () {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      delete window[cbName];
      resolveAll(null);
    };
    document.head.appendChild(script);
  }

  function normalizeProducts(rows) {
    return rows
      .filter(function (r) { return String(r.activo || "").trim().toUpperCase() === "SI"; })
      .map(function (r) {
        var precioNum = parseFloat(r.precio || r["precio "] || 0) || 0;
        return {
          nombre: r.nombre || "",
          precio: precioNum,
          precioLabel: "$" + precioNum.toLocaleString("es-AR"),
          talles: String(r.talles || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean),
          categoria: String(r.categoria || "otros").trim().toLowerCase(),
          imagenA: driveImageUrl(r.imagen, 700),
          imagenB: driveImageUrl(r.imagen2 || r.imagen, 700)
        };
      });
  }

  function productCardHTML(p) {
    var catLabel = (data.categoryLabels && data.categoryLabels[p.categoria]) ||
      (p.categoria.charAt(0).toUpperCase() + p.categoria.slice(1));
    var waText = "Hola! Quiero consultar por: " + p.nombre + (p.precio ? " (" + p.precioLabel + ")" : "");
    var waUrl = "https://wa.me/" + data.contact.whatsapp + "?text=" + encodeURIComponent(waText);
    var imgA = p.imagenA || "assets/img/tienda-hero.jpg";
    var imgB = p.imagenB || imgA;
    var hasSizes = p.talles.length > 0;
    var productJSON = escHTML(JSON.stringify({
      nombre: p.nombre, precio: p.precio, precioLabel: p.precioLabel, categoria: p.categoria, imagen: imgA
    }));
    return (
      '<article class="product-card card has-tilt has-halo" data-category="' + escHTML(p.categoria) + '" data-product="' + productJSON + '">' +
        '<div class="product-media">' +
          '<img class="product-img img-a" src="' + escHTML(imgA) + '" alt="' + escHTML(p.nombre) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">' +
          '<img class="product-img img-b" src="' + escHTML(imgB) + '" alt="" aria-hidden="true" loading="lazy" decoding="async" referrerpolicy="no-referrer">' +
        "</div>" +
        '<div class="product-body">' +
          '<p class="product-cat">' + escHTML(catLabel) + "</p>" +
          '<h3 class="product-name">' + escHTML(p.nombre) + "</h3>" +
          '<p class="product-price">' + escHTML(p.precioLabel) + "</p>" +
          (hasSizes
            ? '<div class="product-sizes" data-sizes>' + p.talles.map(function (t) {
                return '<button type="button" class="size-chip" data-size="' + escHTML(t) + '">' + escHTML(t) + "</button>";
              }).join("") + "</div>" +
              '<p class="product-sizes-hint" data-size-hint>Elegí un talle primero</p>'
            : "") +
          '<button type="button" class="btn btn-primary btn-block btn-add-cart" data-add-cart' + (hasSizes ? " disabled" : "") + '>Agregar al carrito</button>' +
          '<p class="product-whatsapp-link">o <a href="' + waUrl + '" target="_blank" rel="noopener">consultar por WhatsApp</a></p>' +
        "</div>" +
      "</article>"
    );
  }

  /* ---------------------------------------------------------
     Carrito (localStorage — sin backend)
     --------------------------------------------------------- */
  var CART_KEY = "salinasjrs_cart";

  function getCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function cartLineKey(nombre, talle) { return nombre + "__" + (talle || ""); }

  function saveCart(cart) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
    updateCartBadge();
    renderCart();
  }

  function addToCart(product, talle) {
    var cart = getCart();
    var key = cartLineKey(product.nombre, talle);
    var existing = null;
    cart.forEach(function (i) { if (cartLineKey(i.nombre, i.talle) === key) existing = i; });
    if (existing) {
      existing.qty++;
    } else {
      cart.push({
        nombre: product.nombre, precio: product.precio, precioLabel: product.precioLabel,
        categoria: product.categoria, imagen: product.imagen, talle: talle || "", qty: 1
      });
    }
    saveCart(cart);
  }

  function removeFromCart(key) {
    saveCart(getCart().filter(function (i) { return cartLineKey(i.nombre, i.talle) !== key; }));
  }

  function updateCartQty(key, delta) {
    var cart = getCart();
    var item = null;
    cart.forEach(function (i) { if (cartLineKey(i.nombre, i.talle) === key) item = i; });
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) cart = cart.filter(function (i) { return i !== item; });
    saveCart(cart);
  }

  function cartTotal(cart) {
    return cart.reduce(function (sum, i) { return sum + (i.precio * i.qty); }, 0);
  }

  function money(n) { return "$" + Math.round(n).toLocaleString("es-AR"); }

  function updateCartBadge() {
    var badge = $("[data-cart-badge]");
    if (!badge) return;
    var count = getCart().reduce(function (sum, i) { return sum + i.qty; }, 0);
    badge.textContent = count;
    badge.classList.toggle("is-visible", count > 0);
  }

  function renderCart() {
    var list = $("[data-cart-items]");
    var totalEl = $("[data-cart-total]");
    if (!list) return;
    var cart = getCart();
    if (!cart.length) {
      list.innerHTML = '<p class="cart-empty">Todavía no agregaste productos.</p>';
    } else {
      list.innerHTML = cart.map(function (i) {
        var key = cartLineKey(i.nombre, i.talle);
        var priceLabel = i.precioLabel || money(i.precio);
        return (
          '<div class="cart-item" data-key="' + escHTML(key) + '">' +
            '<div class="cart-item-img"><img src="' + escHTML(i.imagen || "assets/img/tienda-hero.jpg") + '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>' +
            "<div>" +
              '<p class="cart-item-name">' + escHTML(i.nombre) + "</p>" +
              (i.talle ? '<p class="cart-item-meta">Talle ' + escHTML(i.talle) + "</p>" : "") +
              '<p class="cart-item-price">' + escHTML(priceLabel) + "</p>" +
              '<div class="cart-item-qty">' +
                '<button type="button" class="cart-qty-btn" data-qty-minus aria-label="Restar">−</button>' +
                '<span class="cart-qty-value">' + i.qty + "</span>" +
                '<button type="button" class="cart-qty-btn" data-qty-plus aria-label="Sumar">+</button>' +
              "</div>" +
            "</div>" +
            '<button type="button" class="cart-item-remove" data-remove>Quitar</button>' +
          "</div>"
        );
      }).join("");
    }
    if (totalEl) totalEl.textContent = money(cartTotal(cart));
  }

  function buildCheckoutMessage(cart) {
    var lines = cart.map(function (i) {
      var priceLabel = i.precioLabel || money(i.precio);
      var meta = i.talle ? (" (talle " + i.talle + ", x" + i.qty + ")") : (" (x" + i.qty + ")");
      return "• " + i.nombre + meta + " — " + priceLabel;
    });
    return "Hola! Quiero hacer este pedido:\n" + lines.join("\n") + "\n\nTotal: " + money(cartTotal(cart));
  }

  function initCart() {
    var cartBtn = $("[data-cart-btn]");
    var drawer = $("[data-cart-drawer]");
    var overlay = $("[data-cart-overlay]");
    var closeBtn = $("[data-cart-close]");
    var checkoutBtn = $("[data-cart-checkout]");
    var payBtn = $("[data-cart-pay]");
    var payError = $("[data-cart-pay-error]");

    function openCart() {
      renderCart();
      if (drawer) drawer.classList.add("is-open");
      if (overlay) overlay.classList.add("is-open");
    }
    function closeCart() {
      if (drawer) drawer.classList.remove("is-open");
      if (overlay) overlay.classList.remove("is-open");
    }

    if (cartBtn) cartBtn.addEventListener("click", openCart);
    if (closeBtn) closeBtn.addEventListener("click", closeCart);
    if (overlay) overlay.addEventListener("click", closeCart);

    var itemsWrap = $("[data-cart-items]");
    if (itemsWrap) {
      itemsWrap.addEventListener("click", function (e) {
        var row = e.target.closest(".cart-item");
        if (!row) return;
        var key = row.dataset.key;
        if (e.target.closest("[data-qty-plus]")) updateCartQty(key, 1);
        else if (e.target.closest("[data-qty-minus]")) updateCartQty(key, -1);
        else if (e.target.closest("[data-remove]")) removeFromCart(key);
      });
    }

    if (checkoutBtn) {
      checkoutBtn.addEventListener("click", function () {
        var cart = getCart();
        if (!cart.length) return;
        var url = "https://wa.me/" + data.contact.whatsapp + "?text=" + encodeURIComponent(buildCheckoutMessage(cart));
        window.open(url, "_blank", "noopener");
      });
    }

    if (payBtn) {
      payBtn.addEventListener("click", function () {
        var cart = getCart();
        if (!cart.length) return;
        var endpoint = data.payments && data.payments.createPreferenceUrl;
        if (!endpoint || endpoint.indexOf("TU-PROYECTO") !== -1) {
          if (payError) {
            payError.textContent = "El pago con tarjeta todavía no está conectado. Probá con WhatsApp mientras tanto.";
            payError.classList.add("is-visible");
          }
          return;
        }
        if (payError) payError.classList.remove("is-visible");
        var label = payBtn.textContent;
        payBtn.disabled = true;
        payBtn.textContent = "Generando pago…";

        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: cart, origin: location.origin })
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.init_point) {
              window.location.href = res.init_point;
            } else {
              throw new Error("sin init_point");
            }
          })
          .catch(function () {
            payBtn.disabled = false;
            payBtn.textContent = label;
            if (payError) {
              payError.textContent = "No pudimos generar el pago. Intentá de nuevo o usá WhatsApp.";
              payError.classList.add("is-visible");
            }
          });
      });
    }

    updateCartBadge();
  }

  function initProductInteractions() {
    document.addEventListener("click", function (e) {
      var sizeBtn = e.target.closest(".size-chip");
      if (sizeBtn) {
        var card = sizeBtn.closest(".product-card");
        if (!card) return;
        $$(".size-chip", card).forEach(function (b) { b.classList.remove("is-selected"); });
        sizeBtn.classList.add("is-selected");
        card.dataset.selectedSize = sizeBtn.dataset.size;
        var addBtn = $("[data-add-cart]", card);
        if (addBtn) addBtn.disabled = false;
        var hint = $("[data-size-hint]", card);
        if (hint) hint.classList.remove("is-visible");
        return;
      }

      var addBtn2 = e.target.closest("[data-add-cart]");
      if (addBtn2) {
        var card2 = addBtn2.closest(".product-card");
        if (!card2) return;
        var hasSizes = !!$(".product-sizes", card2);
        if (hasSizes && !card2.dataset.selectedSize) {
          var hint2 = $("[data-size-hint]", card2);
          if (hint2) hint2.classList.add("is-visible");
          return;
        }
        var product;
        try { product = JSON.parse(card2.dataset.product); } catch (err) { return; }
        addToCart(product, card2.dataset.selectedSize || "");
        var label = addBtn2.textContent;
        addBtn2.disabled = true;
        addBtn2.textContent = "Agregado ✓";
        setTimeout(function () {
          addBtn2.textContent = label;
          addBtn2.disabled = false;
        }, 1200);
      }
    });
  }

  /* ---------------------------------------------------------
     Mounts
     --------------------------------------------------------- */
  function mountTiendaCatalog() {
    var grid = $("[data-products]");
    if (!grid) return;
    grid.innerHTML = '<p class="product-skeleton">Cargando catálogo…</p>';

    loadSheetProducts(function (rows) {
      var products = rows ? normalizeProducts(rows) : normalizeProducts(data.fallbackProducts || []);
      if (!products.length) {
        grid.innerHTML = '<p class="product-error">No pudimos cargar el catálogo ahora. Escribinos por <a href="https://wa.me/' + data.contact.whatsapp + '" style="color:var(--accent)">WhatsApp</a> y te contamos qué hay disponible.</p>';
        return;
      }
      grid.innerHTML = products.map(productCardHTML).join("");
      grid.dataset.loaded = "1";
      buildFilters(products);
      safe(initTilt, "initTilt(products)");
      safe(initHalo, "initHalo(products)");
    });
  }

  function buildFilters(products) {
    var bar = $("[data-filters]");
    if (!bar) return;
    var cats = [];
    products.forEach(function (p) { if (cats.indexOf(p.categoria) === -1) cats.push(p.categoria); });
    var labels = data.categoryLabels || {};
    var html = '<button class="chip is-active" data-filter="all">Todos</button>';
    html += cats.map(function (c) {
      var label = labels[c] || (c.charAt(0).toUpperCase() + c.slice(1));
      return '<button class="chip" data-filter="' + escHTML(c) + '">' + escHTML(label) + "</button>";
    }).join("");
    bar.innerHTML = html;

    bar.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-filter]");
      if (!btn) return;
      $$(".chip", bar).forEach(function (c) { c.classList.remove("is-active"); });
      btn.classList.add("is-active");
      var filter = btn.dataset.filter;
      $$(".product-card", $("[data-products]")).forEach(function (card) {
        var show = filter === "all" || card.dataset.category === filter;
        card.style.display = show ? "" : "none";
      });
    });
  }

  function mountHomeFeatured() {
    var grid = $("[data-featured]");
    if (!grid) return;
    grid.innerHTML = '<p class="product-skeleton">Cargando destacados…</p>';
    loadSheetProducts(function (rows) {
      var products = rows ? normalizeProducts(rows) : normalizeProducts(data.fallbackProducts || []);
      if (!products.length) { grid.innerHTML = ""; return; }
      grid.innerHTML = products.slice(0, 4).map(productCardHTML).join("");
      safe(initTilt, "initTilt(featured)");
      safe(initHalo, "initHalo(featured)");
    });
  }

  function mountCategoryShowcase() {
    var track = $("[data-showcase]");
    if (!track) return;
    loadSheetProducts(function (rows) {
      var products = rows ? normalizeProducts(rows) : normalizeProducts(data.fallbackProducts || []);
      var byCategory = {};
      products.forEach(function (p) {
        if (!byCategory[p.categoria]) byCategory[p.categoria] = { count: 0, img: p.imagenA };
        byCategory[p.categoria].count++;
      });
      var labels = data.categoryLabels || {};
      var cats = Object.keys(byCategory);
      if (!cats.length) return;
      track.innerHTML = cats.map(function (c) {
        var info = byCategory[c];
        var label = labels[c] || (c.charAt(0).toUpperCase() + c.slice(1));
        var img = info.img || "assets/img/tienda-hero.jpg";
        return (
          '<a class="showcase-card" href="tienda.html?cat=' + encodeURIComponent(c) + '">' +
            '<img src="' + escHTML(img) + '" alt="' + escHTML(label) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">' +
            '<div class="showcase-card-overlay">' +
              '<div><span class="showcase-card-title">' + escHTML(label) + '</span>' +
              '<span class="showcase-card-count">' + info.count + (info.count === 1 ? " producto" : " productos") + '</span></div>' +
            "</div>" +
          "</a>"
        );
      }).join("");
      safe(initShowcasePinned, "initShowcasePinned");
    });
  }

  function applyUrlCategoryFilter() {
    var params = new URLSearchParams(location.search);
    var cat = params.get("cat");
    if (!cat) return;
    var tryClick = function () {
      var btn = $('[data-filter="' + cat + '"]');
      if (btn) { btn.click(); return true; }
      return false;
    };
    if (!tryClick()) {
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (tryClick() || tries > 20) clearInterval(iv);
      }, 300);
    }
  }

  /* ---------------------------------------------------------
     Splash
     --------------------------------------------------------- */
  function initSplash() {
    var splash = $("[data-splash]");
    if (!splash) return;
    var hide = function () { splash.classList.add("is-out"); };
    if (document.readyState === "complete") setTimeout(hide, 500);
    else window.addEventListener("load", function () { setTimeout(hide, 350); });
    setTimeout(hide, 3500);
  }

  /* ---------------------------------------------------------
     Nav
     --------------------------------------------------------- */
  function initNav() {
    var nav = $(".nav");
    if (!nav) return;
    var onScroll = function () {
      if (scrollY > 60) nav.classList.add("is-scrolled"); else nav.classList.remove("is-scrolled");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    var burger = $("[data-nav-burger]");
    var mobile = $("[data-nav-mobile]");
    var close = $("[data-nav-close]");
    if (burger && mobile) {
      burger.addEventListener("click", function () { mobile.setAttribute("aria-hidden", "false"); });
    }
    if (close && mobile) {
      close.addEventListener("click", function () { mobile.setAttribute("aria-hidden", "true"); });
    }
    if (mobile) {
      $$("a", mobile).forEach(function (a) {
        a.addEventListener("click", function () { mobile.setAttribute("aria-hidden", "true"); });
      });
    }
  }

  /* ---------------------------------------------------------
     Cursor
     --------------------------------------------------------- */
  function initCursor() {
    var root = $("[data-cursor-root]");
    if (!root || !fineHover) return;
    document.documentElement.classList.add("has-cursor");
    var ring = $(".cursor-ring", root);
    var dot = $(".cursor-dot", root);
    var tx = 0, ty = 0, rx = 0, ry = 0, firstMove = false;

    window.addEventListener("mousemove", function (e) {
      tx = e.clientX; ty = e.clientY;
      if (dot) dot.style.transform = "translate3d(" + tx + "px," + ty + "px,0)";
      if (!firstMove) {
        firstMove = true; rx = tx; ry = ty;
        if (ring) ring.style.transform = "translate3d(" + rx + "px," + ry + "px,0)";
        root.classList.add("is-ready");
      }
    }, { passive: true });

    function tick() {
      rx += (tx - rx) * 0.18; ry += (ty - ry) * 0.18;
      if (ring) ring.style.transform = "translate3d(" + rx + "px," + ry + "px,0)";
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    var HOVERABLES = "[data-cursor], .card, .btn, a[href]";
    document.addEventListener("mouseover", function (e) {
      if (e.target.closest(HOVERABLES)) root.classList.add("is-interactive");
    });
    document.addEventListener("mouseout", function (e) {
      var related = e.relatedTarget;
      if (e.target.closest(HOVERABLES) && !(related && related.closest && related.closest(HOVERABLES))) {
        root.classList.remove("is-interactive");
      }
    });
  }

  /* ---------------------------------------------------------
     Tilt + halo (signature effect)
     --------------------------------------------------------- */
  function initTilt() {
    if (!fineHover) return;
    $$(".has-tilt").forEach(function (card) {
      if (card.dataset.tiltBound) return;
      card.dataset.tiltBound = "1";
      var MAX = 6;
      var tx = 0, ty = 0, cx = 0, cy = 0, raf = null;
      card.addEventListener("mousemove", function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        tx = -py * MAX; ty = px * MAX;
        if (!raf) raf = requestAnimationFrame(loop);
      });
      card.addEventListener("mouseleave", function () {
        tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(loop);
      });
      function loop() {
        cx += (tx - cx) * 0.15; cy += (ty - cy) * 0.15;
        card.style.setProperty("--rx", cx.toFixed(2) + "deg");
        card.style.setProperty("--ry", cy.toFixed(2) + "deg");
        raf = (Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05) ? requestAnimationFrame(loop) : null;
      }
    });
  }

  function initHalo() {
    if (!fineHover) return;
    $$(".has-halo").forEach(function (card) {
      if (card.dataset.haloBound) return;
      card.dataset.haloBound = "1";
      card.addEventListener("mousemove", function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100) + "%");
        card.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100) + "%");
      });
    });
  }

  /* ---------------------------------------------------------
     Marquee
     --------------------------------------------------------- */
  function initMarquee() {
    if (!window.gsap) return;
    $$("[data-marquee]").forEach(function (track) {
      if (track.dataset.marqueeBound) return;
      track.dataset.marqueeBound = "1";
      var clone = track.cloneNode(true);
      clone.removeAttribute("data-marquee");
      track.parentNode.appendChild(clone);
      var distance = track.scrollWidth;
      var speed = 50;
      gsap.to([track, clone], {
        x: -distance, duration: distance / speed, ease: "none", repeat: -1,
        modifiers: { x: gsap.utils.unitize(function (x) { return parseFloat(x) % distance; }) }
      });
    });
  }

  /* ---------------------------------------------------------
     Reveals
     --------------------------------------------------------- */
  function initReveals() {
    var els = $$("[data-reveal]");
    if (!els.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-revealed"); io.unobserve(e.target); }
      });
    }, { threshold: 0.01, rootMargin: "0px 0px -2% 0px" });
    els.forEach(function (el) { io.observe(el); });

    setTimeout(function () {
      $$("[data-reveal]:not(.is-revealed)").forEach(function (el) {
        if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add("is-revealed");
      });
    }, 6000);
  }

  /* ---------------------------------------------------------
     Hero parallax
     --------------------------------------------------------- */
  function initHeroParallax() {
    if (!window.gsap || !window.ScrollTrigger) return;
    var heroContent = $(".hero-inner");
    if (!heroContent) return;
    gsap.to(heroContent, {
      yPercent: -35, opacity: 0.2, ease: "none",
      scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true }
    });
  }

  /* ---------------------------------------------------------
     Showcase pinned horizontal
     --------------------------------------------------------- */
  function initShowcasePinned() {
    if (!window.gsap || !window.ScrollTrigger) return;
    var sec = $(".showcase");
    var track = $("[data-showcase]");
    if (!sec || !track) return;

    var setup = function () {
      ScrollTrigger.getAll().forEach(function (s) { if (s.vars.id === "showcase-pin") s.kill(); });
      var isDesktop = window.innerWidth >= 1024;
      sec.classList.toggle("is-pinned", isDesktop);
      if (!isDesktop) { gsap.set(track, { x: 0 }); return; }
      var trackRect = track.getBoundingClientRect();
      var distance = track.scrollWidth - window.innerWidth + trackRect.left + 32;
      if (distance <= 0) return;
      gsap.to(track, {
        x: function () { return -distance; }, ease: "none",
        scrollTrigger: {
          id: "showcase-pin", trigger: sec, start: "top top+=" + document.querySelector(".nav").offsetHeight,
          end: function () { return "+=" + (distance + window.innerHeight * 0.35); },
          pin: true, scrub: 0.6, invalidateOnRefresh: true, anticipatePin: 1
        }
      });
    };
    setup();
    var to;
    window.addEventListener("resize", function () {
      clearTimeout(to);
      to = setTimeout(function () { ScrollTrigger.refresh(); setup(); }, 250);
    });
  }

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */
  function boot() {
    safe(mountTiendaCatalog, "mountTiendaCatalog");
    safe(mountHomeFeatured, "mountHomeFeatured");
    safe(mountCategoryShowcase, "mountCategoryShowcase");

    safe(initSplash, "initSplash");
    safe(initNav, "initNav");
    safe(initCursor, "initCursor");
    safe(initReveals, "initReveals");
    safe(initCart, "initCart");
    safe(initProductInteractions, "initProductInteractions");

    setTimeout(function () { safe(applyUrlCategoryFilter, "applyUrlCategoryFilter"); }, 400);

    if (window.gsap && window.ScrollTrigger) {
      try { gsap.registerPlugin(ScrollTrigger); } catch (e) {}
      safe(initHeroParallax, "initHeroParallax");
      safe(initMarquee, "initMarquee");
    }

    document.documentElement.classList.add("is-ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
