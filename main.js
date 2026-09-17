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

  // Nombres de color en español → hex, para pintar las pastillas de color.
  var COLOR_MAP = {
    "negro": "#1A1A1A", "blanco": "#F5F5F5", "gris": "#8A8A8A", "gris claro": "#C4C4C4", "gris oscuro": "#4A4A4A",
    "rojo": "#C0272D", "bordo": "#6D1A2D", "bordó": "#6D1A2D", "vino": "#722F37",
    "azul": "#1F4E8C", "azul marino": "#1B2A4A", "marino": "#1B2A4A", "celeste": "#7EB6E0", "turquesa": "#2E9EA5", "petroleo": "#0F4C5C", "petróleo": "#0F4C5C",
    "verde": "#3E6B35", "verde militar": "#4B5320", "verde oliva": "#6B8E23", "oliva": "#6B8E23", "verde claro": "#8FBC8F",
    "amarillo": "#E8C547", "mostaza": "#C49A3A", "naranja": "#E86F2D", "coral": "#F08080",
    "rosa": "#E8A0BF", "rosa viejo": "#C08081", "fucsia": "#C74375", "violeta": "#7C5295", "lila": "#B39BC8", "morado": "#5D3A6B",
    "marron": "#6B4A2F", "marrón": "#6B4A2F", "beige": "#D8C9A8", "crema": "#EFE6D0", "camel": "#B8814F", "chocolate": "#4E342E", "tostado": "#A67B5B",
    "denim": "#3F5F8A", "jean": "#3F5F8A", "natural": "#E5DCC5", "crudo": "#EAE3D2"
  };
  function colorHex(nombre) { return COLOR_MAP[String(nombre || "").trim().toLowerCase()] || ""; }
  function colorTextOn(hex) {
    if (!hex) return "";
    var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? "#1A1A1A" : "#F8F7F4";
  }

  function normalizeGender(g) {
    g = String(g || "").trim().toLowerCase();
    if (g.indexOf("homb") === 0) return "hombre";
    if (g.indexOf("muj") === 0) return "mujer";
    if (g.indexOf("acces") === 0) return "accesorios";
    return "unisex";
  }

  function normalizeProducts(rows) {
    return rows
      .filter(function (r) { return String(r.activo || "").trim().toUpperCase() === "SI"; })
      .map(function (r) {
        var precioNum = parseFloat(r.precio || r["precio "] || 0) || 0;
        var imagenes = [r.imagen, r.imagen2, r.imagen3, r.imagen4, r.imagen5]
          .map(function (u) { return driveImageUrl(u, 700); })
          .filter(Boolean);
        return {
          nombre: r.nombre || "",
          precio: precioNum,
          precioLabel: "$" + precioNum.toLocaleString("es-AR"),
          talles: String(r.talles || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean),
          colores: String(r.colores || r.color || "").split(",").map(function (c) { return c.trim(); }).filter(Boolean),
          categoria: String(r.categoria || "otros").trim().toLowerCase(),
          generoRaw: String(r.genero || "").trim(),
          genero: normalizeGender(r.genero),
          imagenes: imagenes
        };
      });
  }

  function productCardHTML(p) {
    var catLabel = (data.categoryLabels && data.categoryLabels[p.categoria]) ||
      (p.categoria.charAt(0).toUpperCase() + p.categoria.slice(1));
    var imagenes = p.imagenes.length ? p.imagenes : ["assets/img/tienda-hero.jpg"];
    var waText = "Hola! Quiero consultar por: " + p.nombre + (p.precio ? " (" + p.precioLabel + ")" : "") +
      "\nFoto: " + imagenes[0];
    var waUrl = "https://wa.me/" + data.contact.whatsapp + "?text=" + encodeURIComponent(waText);
    var hasSizes = p.talles.length > 0;
    var hasColors = p.colores.length > 0;
    var productJSON = escHTML(JSON.stringify({
      nombre: p.nombre, precio: p.precio, precioLabel: p.precioLabel, categoria: catLabel,
      imagen: imagenes[0], imagenes: imagenes, talles: p.talles, colores: p.colores
    }));
    return (
      '<article class="product-card card has-tilt has-halo" data-category="' + escHTML(p.categoria) + '" data-genero="' + escHTML(p.genero) + '" data-product="' + productJSON + '">' +
        '<div class="product-media" data-images="' + escHTML(JSON.stringify(imagenes)) + '">' +
          '<img class="product-img" src="' + escHTML(imagenes[0]) + '" alt="' + escHTML(p.nombre) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">' +
        "</div>" +
        '<div class="product-body">' +
          '<p class="product-cat">' + escHTML(catLabel) + "</p>" +
          '<h3 class="product-name">' + escHTML(p.nombre) + "</h3>" +
          '<p class="product-price">' + escHTML(p.precioLabel) + "</p>" +
          (hasColors
            ? '<div class="product-colors" data-colors="' + escHTML(JSON.stringify(imagenes)) + '">' + p.colores.map(function (c, i) {
                var hex = colorHex(c);
                var style = hex ? ' style="background:' + hex + ';color:' + colorTextOn(hex) + ';border-color:' + hex + ';"' : "";
                return '<button type="button" class="color-chip' + (i === 0 ? " is-selected" : "") + '" data-color="' + escHTML(c) + '" data-idx="' + i + '"' + style + '>' + escHTML(c) + "</button>";
              }).join("") + "</div>"
            : "") +
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

  function cartLineKey(nombre, talle, color) { return nombre + "__" + (talle || "") + "__" + (color || ""); }

  function saveCart(cart) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
    updateCartBadge();
    renderCart();
  }

  function addToCart(product, talle, color) {
    var cart = getCart();
    var key = cartLineKey(product.nombre, talle, color);
    var existing = null;
    cart.forEach(function (i) { if (cartLineKey(i.nombre, i.talle, i.color) === key) existing = i; });
    if (existing) {
      existing.qty++;
    } else {
      cart.push({
        nombre: product.nombre, precio: product.precio, precioLabel: product.precioLabel,
        categoria: product.categoria, imagen: product.imagen, talle: talle || "", color: color || "", qty: 1
      });
    }
    saveCart(cart);
  }

  function removeFromCart(key) {
    saveCart(getCart().filter(function (i) { return cartLineKey(i.nombre, i.talle, i.color) !== key; }));
  }

  function updateCartQty(key, delta) {
    var cart = getCart();
    var item = null;
    cart.forEach(function (i) { if (cartLineKey(i.nombre, i.talle, i.color) === key) item = i; });
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
        var key = cartLineKey(i.nombre, i.talle, i.color);
        var priceLabel = i.precioLabel || money(i.precio);
        var meta = [i.color, i.talle ? ("Talle " + i.talle) : ""].filter(Boolean).join(" · ");
        return (
          '<div class="cart-item" data-key="' + escHTML(key) + '">' +
            '<div class="cart-item-img"><img src="' + escHTML(i.imagen || "assets/img/tienda-hero.jpg") + '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>' +
            "<div>" +
              '<p class="cart-item-name">' + escHTML(i.nombre) + "</p>" +
              (meta ? '<p class="cart-item-meta">' + escHTML(meta) + "</p>" : "") +
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
      var detalle = [i.color, i.talle ? ("talle " + i.talle) : ""].filter(Boolean).join(", ");
      var meta = (detalle ? (" (" + detalle + ", x" + i.qty + ")") : (" (x" + i.qty + ")"));
      var line = "• " + i.nombre + meta + " — " + priceLabel;
      if (i.imagen && i.imagen.indexOf("http") === 0) line += "\n  Foto: " + i.imagen;
      return line;
    });
    return "Hola! Quiero hacer este pedido:\n" + lines.join("\n") + "\n\nTotal: " + money(cartTotal(cart));
  }

  function initCart() {
    var cartBtn = $("[data-cart-btn]");
    var drawer = $("[data-cart-drawer]");
    var overlay = $("[data-cart-overlay]");
    var closeBtn = $("[data-cart-close]");
    var checkoutBtn = $("[data-cart-checkout]");

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

    updateCartBadge();
  }

  /* ---------------------------------------------------------
     Lightbox — ampliar fotos del producto
     --------------------------------------------------------- */
  var lightbox = (function () {
    var el = null, gallery = null;
    function ensure() {
      if (el) return;
      el = document.createElement("div");
      el.className = "lightbox";
      el.hidden = true;
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", "Fotos del producto");
      el.innerHTML = '<button type="button" class="lightbox-close" aria-label="Cerrar">✕</button><div class="lightbox-gallery"></div>';
      document.body.appendChild(el);
      gallery = $(".lightbox-gallery", el);
      $(".lightbox-close", el).addEventListener("click", close);
      el.addEventListener("click", function (e) { if (e.target === el) close(); });
      document.addEventListener("keydown", function (e) { if (!el.hidden && e.key === "Escape") close(); });
    }
    function open(imgs, alt) {
      ensure();
      var list = Array.isArray(imgs) ? imgs.filter(Boolean) : [imgs];
      if (!list.length) return;
      gallery.innerHTML = list.map(function (src) {
        return '<img src="' + escHTML(src) + '" alt="' + escHTML(alt || "") + '">';
      }).join("");
      el.hidden = false;
      el.scrollTop = 0;
      document.documentElement.classList.add("lightbox-open");
    }
    function close() {
      if (!el) return;
      el.hidden = true;
      document.documentElement.classList.remove("lightbox-open");
      gallery.innerHTML = "";
    }
    return { open: open, close: close };
  })();

  /* ---------------------------------------------------------
     Vista rápida del producto (modal)
     --------------------------------------------------------- */
  var productModal = (function () {
    var el = null, gallery = null, info = null, catEl = null, nameEl = null, priceEl = null;
    var colorsWrap = null, colorsEl = null, sizesWrap = null, sizesEl = null, addBtn = null;
    var imagenes = [], producto = null, talleSel = "", colorSel = "", imagenSel = "", colorIdx = -1;

    function ensure() {
      if (el) return;
      el = document.createElement("div");
      el.className = "pmodal";
      el.hidden = true;
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", "Detalle del producto");
      el.innerHTML =
        '<div class="pmodal-backdrop" data-pmodal-close></div>' +
        '<div class="pmodal-box">' +
          '<button type="button" class="pmodal-close" data-pmodal-close aria-label="Cerrar">✕</button>' +
          '<div class="pmodal-gallery"></div>' +
          '<div class="pmodal-info">' +
            '<p class="pmodal-cat"></p>' +
            '<h2 class="pmodal-name"></h2>' +
            '<p class="pmodal-price"></p>' +
            '<div class="pmodal-block pmodal-block-colors" hidden>' +
              '<span class="pmodal-label">Color</span>' +
              '<div class="pmodal-opts pmodal-colors"></div>' +
            "</div>" +
            '<div class="pmodal-block pmodal-block-sizes" hidden>' +
              '<span class="pmodal-label">Talle</span>' +
              '<div class="pmodal-opts pmodal-sizes"></div>' +
            "</div>" +
            '<button type="button" class="btn btn-primary btn-block pmodal-add"></button>' +
            '<p class="pmodal-hint">Coordinamos stock y entrega por WhatsApp.</p>' +
          "</div>" +
        "</div>";
      document.body.appendChild(el);

      gallery = $(".pmodal-gallery", el);
      info = $(".pmodal-info", el);
      catEl = $(".pmodal-cat", el);
      nameEl = $(".pmodal-name", el);
      priceEl = $(".pmodal-price", el);
      colorsWrap = $(".pmodal-block-colors", el);
      colorsEl = $(".pmodal-colors", el);
      sizesWrap = $(".pmodal-block-sizes", el);
      sizesEl = $(".pmodal-sizes", el);
      addBtn = $(".pmodal-add", el);

      el.addEventListener("click", onClick);
      document.addEventListener("keydown", function (e) {
        if (el && !el.hidden && e.key === "Escape") close();
      });
    }

    // Las fotos de Drive cargan de a poco y el alto cambia, por eso se
    // reposiciona en cada load hasta que la foto del color quede a la vista.
    function scrollToPhoto(i) {
      var target = gallery.children[i];
      if (target && target.tagName === "IMG") gallery.scrollTop = target.offsetTop;
    }

    function refreshAddBtn() {
      var falta = !sizesWrap.hidden && !talleSel;
      addBtn.disabled = falta;
      addBtn.textContent = falta ? "Elegí un talle" : "Agregar al carrito";
    }

    function onClick(e) {
      if (e.target.closest("[data-pmodal-close]")) { close(); return; }

      var colorBtn = e.target.closest(".color-chip");
      if (colorBtn) {
        $$(".color-chip", colorsEl).forEach(function (b) { b.classList.remove("is-selected"); });
        colorBtn.classList.add("is-selected");
        colorSel = colorBtn.dataset.color;
        colorIdx = parseInt(colorBtn.dataset.idx, 10);
        if (imagenes[colorIdx]) imagenSel = imagenes[colorIdx];
        scrollToPhoto(colorIdx);
        return;
      }

      var sizeBtn = e.target.closest(".size-chip");
      if (sizeBtn) {
        $$(".size-chip", sizesEl).forEach(function (b) { b.classList.remove("is-selected"); });
        sizeBtn.classList.add("is-selected");
        talleSel = sizeBtn.dataset.size;
        refreshAddBtn();
        return;
      }

      if (e.target.closest(".pmodal-gallery img")) {
        lightbox.open(imagenes, producto ? producto.nombre : "");
        return;
      }

      if (e.target.closest(".pmodal-add") && !addBtn.disabled) {
        addToCart({
          nombre: producto.nombre, precio: producto.precio, precioLabel: producto.precioLabel,
          categoria: producto.categoria, imagen: imagenSel || imagenes[0]
        }, talleSel, colorSel);
        close();
      }
    }

    function open(p) {
      ensure();
      producto = p;
      imagenes = (p.imagenes && p.imagenes.length) ? p.imagenes : [p.imagen].filter(Boolean);
      talleSel = ""; colorSel = ""; colorIdx = -1;
      imagenSel = imagenes[0] || "";

      gallery.innerHTML = imagenes.length
        ? imagenes.map(function (src) {
            return '<img src="' + escHTML(src) + '" alt="' + escHTML(p.nombre) + '" referrerpolicy="no-referrer">';
          }).join("")
        : '<div class="pmodal-noimg">Sin foto</div>';
      $$("img", gallery).forEach(function (im) {
        im.addEventListener("load", function () { if (colorIdx > 0) scrollToPhoto(colorIdx); });
      });

      catEl.textContent = p.categoria || "";
      catEl.hidden = !p.categoria;
      nameEl.textContent = p.nombre || "";
      priceEl.textContent = p.precioLabel || "";

      var colores = p.colores || [];
      colorsWrap.hidden = !colores.length;
      colorsEl.innerHTML = colores.map(function (c, i) {
        var hex = colorHex(c);
        var style = hex ? ' style="background:' + hex + ';color:' + colorTextOn(hex) + ';border-color:' + hex + ';"' : "";
        return '<button type="button" class="color-chip" data-color="' + escHTML(c) + '" data-idx="' + i + '"' + style + ">" + escHTML(c) + "</button>";
      }).join("");

      var talles = p.talles || [];
      sizesWrap.hidden = !talles.length;
      sizesEl.innerHTML = talles.map(function (t) {
        return '<button type="button" class="size-chip" data-size="' + escHTML(t) + '">' + escHTML(t) + "</button>";
      }).join("");

      refreshAddBtn();
      el.hidden = false;
      gallery.scrollTop = 0;
      info.scrollTop = 0;
      document.documentElement.classList.add("pmodal-open");
    }

    function close() {
      if (!el) return;
      el.hidden = true;
      document.documentElement.classList.remove("pmodal-open");
      gallery.innerHTML = "";
    }

    return { open: open, close: close };
  })();

  function initProductInteractions() {
    document.addEventListener("click", function (e) {
      var mediaImg = e.target.closest(".product-media .product-img");
      if (mediaImg) {
        var mediaCard = mediaImg.closest(".product-card");
        if (mediaCard) {
          try {
            productModal.open(JSON.parse(mediaCard.dataset.product));
          } catch (err) {}
        }
        return;
      }

      var colorBtn = e.target.closest(".color-chip");
      if (colorBtn) {
        var colorCard = colorBtn.closest(".product-card");
        if (!colorCard) return;
        $$(".color-chip", colorCard).forEach(function (b) { b.classList.remove("is-selected"); });
        colorBtn.classList.add("is-selected");
        colorCard.dataset.selectedColor = colorBtn.dataset.color;
        var wrap = $(".product-colors", colorCard);
        var img = $(".product-img", colorCard);
        if (wrap && img) {
          try {
            var imgs = JSON.parse(wrap.dataset.colors);
            var idx = parseInt(colorBtn.dataset.idx, 10);
            if (imgs[idx]) {
              img.style.opacity = "0";
              setTimeout(function () { img.src = imgs[idx]; img.style.opacity = "1"; }, 150);
            }
          } catch (err) {}
        }
        return;
      }

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
        var colorsWrap = $(".product-colors", card2);
        var selectedChip = $(".color-chip.is-selected", card2);
        if (colorsWrap && selectedChip) {
          try {
            var chipImgs = JSON.parse(colorsWrap.dataset.colors);
            var chipIdx = parseInt(selectedChip.dataset.idx, 10);
            if (chipImgs[chipIdx]) product.imagen = chipImgs[chipIdx];
          } catch (err2) {}
        }
        addToCart(product, card2.dataset.selectedSize || "", card2.dataset.selectedColor || "");
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

  var catActive = "all";
  var genderActive = "todos";

  function applyProductFilters() {
    $$(".product-card", $("[data-products]")).forEach(function (card) {
      var okCat = catActive === "all" || card.dataset.category === catActive;
      var gen = card.dataset.genero || "unisex";
      var okGen;
      if (genderActive === "todos") okGen = true;
      else if (genderActive === "accesorios") okGen = gen === "accesorios";
      else okGen = gen === genderActive || gen === "unisex";
      card.style.display = (okCat && okGen) ? "" : "none";
    });
  }

  function buildFilters(products) {
    var bar = $("[data-filters]");
    if (!bar) return;

    var genderBar = $("[data-gender-filters]");
    var hasGender = products.some(function (p) { return p.generoRaw; });
    if (hasGender && genderBar) {
      genderBar.innerHTML =
        '<button class="chip is-active" data-gender="todos">Todos</button>' +
        '<button class="chip" data-gender="hombre">Hombre</button>' +
        '<button class="chip" data-gender="mujer">Mujer</button>' +
        '<button class="chip" data-gender="accesorios">Accesorios</button>';
      genderBar.addEventListener("click", function (e) {
        var gbtn = e.target.closest("[data-gender]");
        if (!gbtn) return;
        $$(".chip", genderBar).forEach(function (c) { c.classList.remove("is-active"); });
        gbtn.classList.add("is-active");
        genderActive = gbtn.dataset.gender;
        applyProductFilters();
      });
    }

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
      catActive = btn.dataset.filter;
      applyProductFilters();
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
        if (!byCategory[p.categoria]) byCategory[p.categoria] = { count: 0, img: p.imagenes[0] };
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
