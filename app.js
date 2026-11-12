/* No spare change? Here's how you can help.
 *
 * What this file does, in order:
 *   1. Loads the list (Google Sheet CSV, or the saved copy in data/seed.js).
 *   2. Cleans each row and drops anything hidden or too old.
 *   3. Draws the cards, the filter chips and the "Near me" controls.
 *   4. Loads the map (Leaflet) last, so the list never waits for it.
 *   5. Fades the map between gray and full color as the page scrolls.
 *
 * Safety rules kept throughout:
 *   - Text from the sheet is only ever placed with textContent, never innerHTML.
 *   - Links are used only if they start with https:// or mailto:
 *   - Nothing about the visitor is stored or sent anywhere.
 */
(function () {
  "use strict";

  var CONFIG = window.CONFIG || {};
  var STALE_DAYS = toNumber(CONFIG.STALE_DAYS, 45);
  var HIDE_DAYS = toNumber(CONFIG.HIDE_DAYS, 60);
  // If config.js is damaged, fall back to OpenStreetMap so the map still works.
  var TILE_URL = CONFIG.TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  var TILE_ATTRIBUTION = CONFIG.TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

  // Map library: Leaflet 1.9.4 from cdnjs (exact version).
  var LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
  var LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var NEEDS = ["items", "shifts", "skills"];
  var REQUIRED_HEADERS = ["name", "last_checked", "status"];
  var NYC_CENTER = [40.7308, -73.9973];

  // Everything the page remembers lives here, in memory only. Nothing is saved.
  var state = {
    orgs: [],            // rows that are allowed to be shown
    filters: { items: false, shifts: false, skills: false },
    origin: null,        // { lat, lng } once a location or ZIP is set
    usingSeed: false,
    activeKey: null,     // the card and coin currently highlighted
    map: null,
    markerLayer: null,
    markers: {},
    byKey: {},           // organizations currently in the list, by key
    exploring: false,    // true while "Explore the map" is open
    bloomed: false,      // true once the coins have dropped onto the map
    lockUntil: 0         // pauses scroll-following for a moment after a tap
  };

  var root = document.documentElement;
  var wideScreen = window.matchMedia ? window.matchMedia("(min-width: 56rem)") : { matches: false };
  function isWide() { return wideScreen.matches; }

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Small helpers ----------

  function $(id) { return document.getElementById(id); }

  function toNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) && n > 0 ? n : fallback;
  }

  // Make an element with a class and plain text. Text is never treated as HTML.
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clean(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  // Only https:// and mailto: links are allowed. Anything else returns "".
  function safeUrl(value) {
    var text = clean(value);
    if (!/^(https:\/\/|mailto:)/i.test(text)) return "";
    if (/[\s<>"'`\\]/.test(text) || /[\u0000-\u001f]/.test(text)) return "";
    try {
      var parsed = new URL(text);
      if (parsed.protocol !== "https:" && parsed.protocol !== "mailto:") return "";
    } catch (e) {
      return "";
    }
    return text;
  }

  // Dates must be typed exactly as YYYY-MM-DD. Anything else returns null.
  function parseDate(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(value));
    if (!match) return null;
    var y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
    var date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return date;
  }

  function formatDate(date) {
    return MONTHS[date.getMonth()] + " " + date.getDate() + ", " + date.getFullYear();
  }

  function daysSince(date) {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today - date) / 86400000);
  }

  // Straight-line distance in miles between two points.
  function milesBetween(a, b) {
    var toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad;
    var dLng = (b.lng - a.lng) * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // ---------- Reading the CSV ----------

  // Turns CSV text into rows of cells. Uses Papa Parse when it loaded,
  // and a small built-in reader when it didn't (for example, offline).
  function parseCsv(text) {
    text = String(text || "").replace(/^﻿/, "");
    if (window.Papa && typeof window.Papa.parse === "function") {
      return window.Papa.parse(text, { header: false, skipEmptyLines: "greedy" }).data;
    }
    return simpleCsv(text);
  }

  function simpleCsv(text) {
    var rows = [], row = [], field = "", inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) {
      return r.some(function (cell) { return clean(cell) !== ""; });
    });
  }

  // Turns rows of cells into organizations. Columns are matched by header name,
  // so their order doesn't matter and extra columns are ignored.
  function toOrgs(rows) {
    if (!rows || !rows.length) return { ok: false, orgs: [] };
    var headers = rows[0].map(function (h) { return clean(h).toLowerCase(); });
    var missing = REQUIRED_HEADERS.filter(function (h) { return headers.indexOf(h) === -1; });
    if (missing.length) return { ok: false, orgs: [] };

    var orgs = [];
    for (var r = 1; r < rows.length; r++) {
      var raw = {};
      for (var c = 0; c < headers.length; c++) {
        if (headers[c] && raw[headers[c]] === undefined) raw[headers[c]] = clean(rows[r][c]);
      }
      var org = toOrg(raw, r);
      if (org) orgs.push(org);
    }
    return { ok: true, orgs: orgs };
  }

  // Cleans one row. Returns null when the row must not be shown.
  function toOrg(raw, rowNumber) {
    var name = clean(raw.name);
    var status = clean(raw.status).toLowerCase();
    var checked = parseDate(raw.last_checked);

    if (!name) return null;
    if (status !== "confirmed" && status !== "unverified") return null;  // "hidden", blank or mistyped
    if (!checked) return null;                                           // no readable date, so no freshness to show

    var days = daysSince(checked);
    if (days > HIDE_DAYS) return null;   // too old
    if (days < -2) return null;          // a date in the future is a typing mistake

    // Coordinates: both must be real numbers. Blank or odd values just mean "no pin".
    var latText = clean(raw.lat), lngText = clean(raw.lng);
    var lat = Number(latText), lng = Number(lngText);
    var hasPin = latText !== "" && lngText !== "" && isFinite(lat) && isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

    return {
      key: "org-" + rowNumber,
      name: name,
      program: clean(raw.program),
      neighborhood: clean(raw.neighborhood),
      borough: clean(raw.borough),
      address: clean(raw.address),
      hasPin: hasPin,
      lat: hasPin ? lat : null,
      lng: hasPin ? lng : null,
      waysToHelp: clean(raw.ways_to_help),
      items: clean(raw.needs_items),
      shifts: clean(raw.needs_shifts),
      skills: clean(raw.needs_skills),
      howToHelp: clean(raw.how_to_help),
      signupUrl: safeUrl(raw.signup_url),
      sourceUrl: safeUrl(raw.source_url),
      requirements: clean(raw.requirements),
      bookAhead: clean(raw.book_ahead_note),
      checked: checked,
      stale: days > STALE_DAYS,
      status: status
    };
  }

  // ---------- Loading the list ----------

  function useSeed() {
    state.usingSeed = true;
    var result = toOrgs(parseCsv(window.SEED_CSV || ""));
    return result.orgs;
  }

  function loadOrgs() {
    var url = clean(CONFIG.SHEET_CSV_URL);
    if (!url || typeof window.fetch !== "function") return Promise.resolve(useSeed());

    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;

    // No cookies and no referrer are sent with this request.
    return window.fetch(url, {
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (!response.ok) throw new Error("Sheet answered " + response.status);
      return response.text();
    }).then(function (text) {
      if (timer) clearTimeout(timer);
      var result = toOrgs(parseCsv(text));
      if (!result.ok) throw new Error("Sheet is missing a required column");
      return result.orgs;
    }).catch(function () {
      if (timer) clearTimeout(timer);
      return useSeed();
    });
  }

  // ---------- Filtering and sorting ----------

  function activeNeeds() {
    return NEEDS.filter(function (need) { return state.filters[need]; });
  }

  function visibleOrgs() {
    var needs = activeNeeds();
    var list = state.orgs.filter(function (org) {
      if (!needs.length) return true;
      // With more than one chip on, an organization matching any of them is shown.
      return needs.some(function (need) { return org[need] !== ""; });
    });

    list.forEach(function (org) {
      org.miles = state.origin && org.hasPin ? milesBetween(state.origin, org) : null;
    });

    list.sort(function (a, b) {
      if (state.origin) {
        if (a.miles !== null && b.miles !== null && a.miles !== b.miles) return a.miles - b.miles;
        if (a.miles !== null && b.miles === null) return -1;
        if (a.miles === null && b.miles !== null) return 1;
      }
      if (a.status !== b.status) return a.status === "confirmed" ? -1 : 1;
      if (a.checked.getTime() !== b.checked.getTime()) return b.checked - a.checked;
      return a.name.localeCompare(b.name);
    });
    return list;
  }

  // ---------- Drawing the cards ----------

  function addDetail(list, label, value) {
    if (!value) return;
    var row = el("div");
    row.appendChild(el("dt", "", label));
    row.appendChild(el("dd", "", value));
    list.appendChild(row);
  }

  function signupLabel(org) {
    return (/^mailto:/i.test(org.signupUrl) ? "Email " : "Sign up with ") + org.name;
  }

  // Points a link at an organization's sign-up page. Web pages open in a new tab; email links don't.
  function fillSignupLink(link, org) {
    link.textContent = signupLabel(org);
    link.href = org.signupUrl;
    if (/^mailto:/i.test(org.signupUrl)) {
      link.removeAttribute("target");
      link.removeAttribute("rel");
    } else {
      link.target = "_blank";
      link.rel = "noopener";
      link.appendChild(el("span", "visually-hidden", " (opens in a new tab)"));
    }
  }

  function buildCard(org) {
    var item = el("li");
    var card = el("article", "card");
    card.id = "card-" + org.key;
    if (org.key === state.activeKey) card.classList.add("is-active");

    // The coin with this organization's number (the same number is on its map marker)
    var top = el("div", "card-top");
    var coin = el("span", "coin", String(org.num));
    coin.setAttribute("aria-hidden", "true");
    top.appendChild(coin);
    var title = el("div");
    var heading = el("h3", "", org.name);
    heading.tabIndex = -1;
    title.appendChild(heading);
    if (org.program) title.appendChild(el("p", "program", org.program));
    top.appendChild(title);
    card.appendChild(top);

    var where = [org.neighborhood, org.borough].filter(Boolean).join(", ");
    if (where) card.appendChild(el("p", "where", where));
    if (org.address) card.appendChild(el("p", "address", org.address));
    if (org.miles !== null && org.miles !== undefined) {
      card.appendChild(el("p", "distance", org.miles < 0.1 ? "less than 0.1 mi away" : "about " + org.miles.toFixed(1) + " mi away"));
    }

    // This month's needs
    var month = el("div", "month");
    month.appendChild(el("h4", "", "This month"));
    if (org.items || org.shifts || org.skills) {
      var needs = el("dl", "this-month");
      addDetail(needs, "Items", org.items);
      addDetail(needs, "Shifts", org.shifts);
      addDetail(needs, "Skills", org.skills);
      month.appendChild(needs);
    } else {
      month.appendChild(el("p", "not-confirmed", "Not yet confirmed"));
    }
    card.appendChild(month);

    // Standing details, each only if filled in
    if (org.waysToHelp || org.requirements || org.bookAhead || org.howToHelp) {
      var details = el("dl", "details");
      addDetail(details, "Ways to help", org.waysToHelp);
      addDetail(details, "Requirements", org.requirements);
      addDetail(details, "Book ahead", org.bookAhead);
      addDetail(details, "How to sign up", org.howToHelp);
      card.appendChild(details);
    }

    // Freshness line
    var fresh = el("p", "freshness");
    fresh.appendChild(document.createTextNode(org.status === "confirmed"
      ? "Confirmed with the organization on " + formatDate(org.checked)
      : "From their website, " + formatDate(org.checked) + " · Not yet confirmed"));
    if (org.stale) {
      fresh.appendChild(document.createElement("br"));
      fresh.appendChild(el("span", "stale-flag", "May be out of date"));
    }
    card.appendChild(fresh);

    // Buttons and links
    var actions = el("div", "actions");
    if (org.signupUrl) {
      var signup = el("a", "btn-primary");
      fillSignupLink(signup, org);
      actions.appendChild(signup);
    }
    if (org.sourceUrl) {
      var source = el("a", "source-link", "Source");
      source.href = org.sourceUrl;
      if (!/^mailto:/i.test(org.sourceUrl)) {
        source.target = "_blank";
        source.rel = "noopener";
      }
      source.appendChild(el("span", "visually-hidden", " for " + org.name + " (opens in a new tab)"));
      actions.appendChild(source);
    }
    if (org.hasPin && state.map) {
      var show = el("button", "btn-text", "Show on map");
      show.type = "button";
      show.appendChild(el("span", "visually-hidden", ": " + org.name));
      show.addEventListener("click", function () { showOnMap(org.key); });
      actions.appendChild(show);
    }
    if (actions.childNodes.length) card.appendChild(actions);

    item.appendChild(card);
    return item;
  }

  function updateChips() {
    NEEDS.forEach(function (need) {
      var count = state.orgs.filter(function (org) { return org[need] !== ""; }).length;
      var chip = document.querySelector('.chip[data-need="' + need + '"]');
      $("count-" + need).textContent = "(" + count + ")";
      chip.disabled = count === 0;
      if (count === 0) state.filters[need] = false;
      chip.setAttribute("aria-pressed", state.filters[need] ? "true" : "false");
    });
  }

  function plural(n) { return n === 1 ? "1 organization" : n + " organizations"; }

  // Redraws the chips, the count, the cards and the coins from the current state.
  function render() {
    updateChips();
    var list = visibleOrgs();
    var total = state.orgs.length;
    var listNode = $("org-list");
    listNode.textContent = "";

    // Number the list from 1 in its current order. Each coin on the map carries the same number.
    state.byKey = {};
    list.forEach(function (org, index) {
      org.num = index + 1;
      state.byKey[org.key] = org;
    });
    if (!state.byKey[state.activeKey]) state.activeKey = null;

    if (total === 0) {
      $("result-count").textContent = "No current listings. Check back soon.";
    } else {
      $("result-count").textContent = list.length === total
        ? "Showing " + plural(total) + "."
        : "Showing " + list.length + " of " + plural(total) + ".";
      list.forEach(function (org) { listNode.appendChild(buildCard(org)); });
    }

    $("saved-copy-note").hidden = !state.usingSeed;

    // Footer: the newest last_checked date among shown rows
    var newest = null;
    state.orgs.forEach(function (org) { if (!newest || org.checked > newest) newest = org.checked; });
    $("updated-line").hidden = !newest;
    if (newest) $("updated-date").textContent = formatDate(newest);

    syncMarkers(list);
    updateWash();
  }

  // ---------- Highlighting a card and its coin ----------

  function scrollTo(node, block) {
    if (node && node.scrollIntoView) {
      node.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: block || "start" });
    }
  }

  // Marks one organization as the highlighted one, on its card and on the map. null clears it.
  function setActive(key) {
    state.activeKey = key;
    var cards = document.querySelectorAll(".card");
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle("is-active", cards[i].id === "card-" + key);
    }
    Object.keys(state.markers).forEach(function (k) {
      var marker = state.markers[k];
      var pin = marker.getElement();
      if (pin) pin.classList.toggle("is-active", k === key);
      marker.setZIndexOffset(k === key ? 1000 : 0);
    });
  }

  function goToCard(key) {
    var card = $("card-" + key);
    if (!card) return;
    scrollTo(card, isWide() ? "center" : "start");
    var heading = card.querySelector("h3");
    if (heading) heading.focus({ preventScroll: true });
  }

  // A coin on the map was tapped (or Enter was pressed on it).
  function onPin(key) {
    if (state.exploring) { showPeek(key); return; }
    state.lockUntil = Date.now() + 1200;
    setActive(key);
    goToCard(key);
    if (isWide()) flyToOrg(key);
  }

  // "Show on map" was pressed on a card.
  function showOnMap(key) {
    if (!state.map || !state.markers[key]) return;
    if (isWide()) {
      // Wide screens: the map is already beside the list, so just glide to the coin.
      state.lockUntil = Date.now() + 1200;
      setActive(key);
      flyToOrg(key);
      var pin = state.markers[key].getElement();
      if (pin) pin.focus({ preventScroll: true });
    } else {
      // Phones: open the full-screen map on that coin.
      openExplore(key);
    }
  }

  // ---------- The gray veil: fades with scrolling ----------

  function clamp01(n) { return Math.max(0, Math.min(1, n)); }

  // The map is a pale gray print at the top of the page, comes into full color as the
  // list arrives, and goes gray again as "How this works" and the footer arrive.
  function updateWash() {
    if (state.exploring) return;
    var vh = window.innerHeight || 1;
    var stage = isWide() ? $("controls") : $("map-window");
    var arriving = clamp01((stage.getBoundingClientRect().top - 0.35 * vh) / (0.5 * vh));
    var leaving = clamp01((vh - $("how").getBoundingClientRect().top) / (0.5 * vh));
    var wash = 0.9 * Math.max(arriving, leaving);
    root.style.setProperty("--wash", wash.toFixed(3));

    if (!state.bloomed && state.map && wash < 0.45) {
      state.bloomed = true;
      dropCoins();
    }
  }

  // The one flourish: the first time the map comes into color, the coins drop onto it.
  function dropCoins() {
    if (reduceMotion) return;
    Object.keys(state.markers).forEach(function (key, index) {
      var pin = state.markers[key].getElement();
      if (!pin) return;
      pin.style.setProperty("--delay", (index * 0.07) + "s");
      pin.classList.add("drop");
      pin.addEventListener("animationend", function () { pin.classList.remove("drop"); }, { once: true });
    });
  }

  // Wide screens: as the list scrolls, the map follows the card you're reading.
  function followScroll() {
    if (!isWide() || !state.map || state.exploring || Date.now() < state.lockUntil) return;
    var vh = window.innerHeight || 1;
    var probe = 0.42 * vh;
    var cards = document.querySelectorAll(".card");
    var best = null, bestGap = Infinity;
    for (var i = 0; i < cards.length; i++) {
      var box = cards[i].getBoundingClientRect();
      if (box.bottom < 0.12 * vh || box.top > 0.88 * vh) continue;
      var gap = box.top <= probe && box.bottom >= probe ? 0 : Math.min(Math.abs(box.top - probe), Math.abs(box.bottom - probe));
      if (gap < bestGap) { bestGap = gap; best = cards[i]; }
    }
    if ($("org-list").getBoundingClientRect().top > 0.7 * vh) best = null;   // still at the top: show everything
    var key = best ? best.id.replace("card-", "") : null;
    if (key === state.activeKey) return;
    setActive(key);
    if (key) flyToOrg(key); else fitToPins(true);
  }

  // ---------- Map ----------

  function mapFailed() {
    if (state.exploring) closeExplore();
    state.map = null;
    document.body.classList.add("no-map");
    var note = $("map-note");
    note.textContent = "The map couldn't load. Every organization is in the list.";
    note.hidden = false;
  }

  // Loads Leaflet's styles, then its script, then starts the map.
  function loadMap() {
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = LEAFLET_CSS;
    css.onerror = mapFailed;
    css.onload = function () {
      var script = document.createElement("script");
      script.src = LEAFLET_JS;
      script.onerror = mapFailed;
      script.onload = startMap;
      document.body.appendChild(script);
    };
    document.head.insertBefore(css, document.head.querySelector('link[href="styles.css"]'));
  }

  function startMap() {
    try {
      var L = window.L;
      var map = L.map("map", {
        zoomControl: false,
        scrollWheelZoom: false,     // the mouse wheel scrolls the page, not the map
        dragging: isWide(),         // on phones a finger scrolls the page; "Explore the map" turns dragging on
        fadeAnimation: !reduceMotion,
        zoomAnimation: !reduceMotion,
        markerZoomAnimation: !reduceMotion
      });
      L.control.zoom({ position: "bottomright" }).addTo(map);
      map.attributionControl.setPrefix(false);
      map.setView(NYC_CENTER, 11);

      // Map background. The address and credit come from config.js.
      var loaded = 0;
      var tiles = L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 });
      tiles.on("tileload", function () {
        loaded++;
        $("map-note").hidden = true;
      });
      tiles.on("tileerror", function () {
        if (loaded === 0) {
          $("map-note").textContent = "The map background didn't load. The coins still work, and every organization is in the list.";
          $("map-note").hidden = false;
        }
      });
      tiles.addTo(map);

      state.markerLayer = L.layerGroup().addTo(map);
      state.map = map;

      // Phones get the "Explore the map" button and the map credit. The credit text comes from config.js, not the sheet.
      $("explore-open").hidden = false;
      $("map-credit").innerHTML = TILE_ATTRIBUTION;
      $("map-credit").hidden = false;

      render();          // redraw so cards get their "Show on map" buttons
      fitToPins();
    } catch (e) {
      mapFailed();
      render();
    }
  }

  // Puts one numbered coin on the map for each shown organization that has coordinates.
  function syncMarkers(list) {
    if (!state.map) return;
    var L = window.L;
    state.markerLayer.clearLayers();
    state.markers = {};

    list.forEach(function (org) {
      if (!org.hasPin) return;
      var marker = L.marker([org.lat, org.lng], {
        // org.num is a number made by this page, so it is safe to place in the marker.
        icon: L.divIcon({ className: "pin", html: '<span class="coin">' + Number(org.num) + "</span>", iconSize: [44, 44], iconAnchor: [22, 22] }),
        title: org.name,
        keyboard: true,
        zIndexOffset: org.key === state.activeKey ? 1000 : 0
      });
      marker.on("click", function () { onPin(org.key); });
      marker.addTo(state.markerLayer);
      var pin = marker.getElement();
      if (pin) {
        // The coin's name for screen readers. setAttribute keeps it as plain text.
        pin.setAttribute("aria-label", org.num + ". " + org.name + (org.neighborhood ? ", " + org.neighborhood : "") + ". Go to this organization in the list.");
        pin.classList.toggle("is-active", org.key === state.activeKey);
        // Enter or Space on a coin does the same as tapping it.
        pin.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onPin(org.key);
          }
        });
      }
      state.markers[org.key] = marker;
    });
  }

  // How much of the left side of the screen the list column covers (wide screens only).
  function leftCover() {
    return isWide() ? Math.max(0, $("controls").getBoundingClientRect().right) : 0;
  }

  // Zooms out to show every coin, keeping them clear of the list column.
  function fitToPins(animate) {
    if (!state.map) return;
    var points = Object.keys(state.markers).map(function (k) { return state.markers[k].getLatLng(); });
    if (!points.length) {
      state.map.setView(NYC_CENTER, 11, { animate: false });
      return;
    }
    // On phones (outside "Explore the map") the coins are kept in the upper part of the screen,
    // where the open window onto the map sits when you pause on it.
    var bottomSpace = 100;
    if (!isWide() && !state.exploring) {
      bottomSpace = Math.max(100, (window.innerHeight || 600) - ($("map-window").offsetHeight - 50));
    }
    state.map.fitBounds(window.L.latLngBounds(points), {
      paddingTopLeft: [leftCover() + 40, isWide() ? 90 : 60],
      paddingBottomRight: [isWide() ? 70 : 40, bottomSpace],
      maxZoom: 14,
      animate: !!animate && !reduceMotion
    });
  }

  // Glides to one coin. shiftX and shiftY keep it clear of the list column or the bottom sheet.
  function flyToOrg(key, shiftY) {
    var marker = state.markers[key];
    if (!state.map || !marker) return;
    var zoom = Math.min(16, Math.max(state.map.getZoom(), 14));
    var point = state.map.project(marker.getLatLng(), zoom);
    point.x -= leftCover() / 2;
    point.y += (shiftY || 0) / 2;
    var center = state.map.unproject(point, zoom);
    if (reduceMotion) state.map.setView(center, zoom, { animate: false });
    else state.map.flyTo(center, zoom, { duration: 0.9 });
  }

  // ---------- "Explore the map" (phones) ----------
  // The page steps aside and the map takes the whole screen. Tapping a coin shows a small
  // sheet with the organization's name and sign-up button.

  function setPageInert(on) {
    var nodes = document.querySelectorAll(".on-top, .org-list > li");
    for (var i = 0; i < nodes.length; i++) {
      if (on) nodes[i].setAttribute("inert", ""); else nodes[i].removeAttribute("inert");
    }
  }

  function openExplore(key) {
    if (!state.map) return;
    state.exploring = true;
    state.returnFocus = document.activeElement;
    document.body.classList.add("is-exploring");
    root.style.overflow = "hidden";
    setPageInert(true);
    $("explore-ui").hidden = false;
    state.map.dragging.enable();
    if (key) {
      showPeek(key);
    } else {
      hidePeek();
      setActive(null);
      fitToPins(true);
    }
    $("explore-close").focus();
  }

  function closeExplore(goToKey) {
    state.exploring = false;
    document.body.classList.remove("is-exploring");
    root.style.overflow = "";
    root.style.removeProperty("--sheet");
    setPageInert(false);
    $("explore-ui").hidden = true;
    hidePeek();
    if (state.map && !isWide()) state.map.dragging.disable();
    updateWash();
    if (goToKey && state.byKey[goToKey]) {
      setActive(goToKey);
      goToCard(goToKey);
    } else {
      fitToPins();
      if (state.returnFocus && state.returnFocus.focus) state.returnFocus.focus({ preventScroll: true });
    }
  }

  function hidePeek() {
    $("peek").hidden = true;
    root.style.removeProperty("--sheet");
  }

  // Fills and shows the bottom sheet for one organization. All text is placed as plain text.
  function showPeek(key) {
    var org = state.byKey[key];
    if (!org) return;
    setActive(key);
    $("peek-coin").textContent = String(org.num);
    $("peek-name").textContent = org.name;
    $("peek-where").textContent = [org.neighborhood, org.borough].filter(Boolean).join(", ");
    var link = $("peek-signup");
    if (org.signupUrl) {
      fillSignupLink(link, org);
      link.hidden = false;
    } else {
      link.removeAttribute("href");
      link.hidden = true;
    }
    var peek = $("peek");
    peek.hidden = false;
    var sheetHeight = peek.offsetHeight + 24;
    root.style.setProperty("--sheet", sheetHeight + "px");   // lifts the zoom buttons and credit above the sheet
    flyToOrg(key, sheetHeight);
  }

  // ---------- Near me ----------
  // The location is used only for arithmetic on this page. It is never sent or saved.

  function setNearStatus(text, isError) {
    var status = $("near-status");
    status.textContent = text;
    status.classList.toggle("is-error", !!isError);
  }

  function setOrigin(lat, lng, label) {
    state.origin = { lat: lat, lng: lng };
    $("clear-location").hidden = false;
    setNearStatus("Sorted by straight-line distance from " + label + ".", false);
    render();
  }

  function useMyLocation() {
    var fallback = " You can type a ZIP code instead, or just browse the list.";
    if (!navigator.geolocation || window.isSecureContext === false) {
      setNearStatus("Location isn't available here." + fallback, false);
      return;
    }
    setNearStatus("Finding your location…", false);
    navigator.geolocation.getCurrentPosition(function (position) {
      setOrigin(position.coords.latitude, position.coords.longitude, "your location");
    }, function (error) {
      if (error && error.code === 1) {
        setNearStatus("No problem, location is off." + fallback, false);
      } else {
        setNearStatus("We couldn't find your location." + fallback, false);
      }
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  function useZip() {
    var zip = clean($("zip-input").value);
    var table = window.NYC_ZIPS || {};
    var spot = /^\d{5}$/.test(zip) && Object.prototype.hasOwnProperty.call(table, zip) ? table[zip] : null;
    if (!spot) {
      setNearStatus("Enter a 5-digit NYC ZIP code.", true);
      return;
    }
    setOrigin(spot[0], spot[1], "ZIP code " + zip);
  }

  function clearLocation() {
    state.origin = null;
    $("zip-input").value = "";
    $("clear-location").hidden = true;
    setNearStatus("Location cleared.", false);
    render();
  }

  // ---------- Setting up the page ----------

  function setUpControls() {
    var chips = document.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener("click", function () {
        var need = this.getAttribute("data-need");
        state.filters[need] = !state.filters[need];
        render();
        fitToPins(true);
      });
    }

    $("use-location").addEventListener("click", useMyLocation);
    $("zip-go").addEventListener("click", useZip);
    $("zip-input").addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); useZip(); }
    });
    $("clear-location").addEventListener("click", clearLocation);

    // If the ZIP table is empty, switch the ZIP box off.
    if (!window.NYC_ZIPS || !Object.keys(window.NYC_ZIPS).length) {
      $("zip-input").disabled = true;
      $("zip-go").disabled = true;
      $("zip-note").hidden = false;
    }

    // "Explore the map"
    $("explore-open").addEventListener("click", function () { openExplore(null); });
    $("explore-close").addEventListener("click", function () { closeExplore(); });
    $("peek-details").addEventListener("click", function () { closeExplore(state.activeKey); });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && state.exploring) closeExplore();
    });
  }

  // Scrolling and resizing: fade the veil right away, and let the map follow once scrolling settles.
  function setUpScrolling() {
    var queued = false, settle = null;
    function onMove() {
      if (!queued) {
        queued = true;
        window.requestAnimationFrame(function () { queued = false; updateWash(); });
      }
      clearTimeout(settle);
      settle = setTimeout(followScroll, 140);
    }
    window.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("resize", onMove);

    // Crossing between the phone layout and the wide layout
    var onLayoutChange = function () {
      if (state.exploring) closeExplore();
      if (state.map) {
        if (isWide()) state.map.dragging.enable(); else state.map.dragging.disable();
        setActive(null);
        fitToPins();
      }
      updateWash();
    };
    if (wideScreen.addEventListener) wideScreen.addEventListener("change", onLayoutChange);
    else if (wideScreen.addListener) wideScreen.addListener(onLayoutChange);
  }

  function setUpFooterAndNotes() {
    $("stale-days").textContent = String(STALE_DAYS);
    $("hide-days").textContent = String(HIDE_DAYS);

    var email = clean(CONFIG.CONTACT_EMAIL);
    if (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) {
      var link = $("contact-link");
      link.href = "mailto:" + email;
      link.textContent = email;
      $("contact-line").hidden = false;
    }
  }

  // Cloudflare Web Analytics: only added when a token is set in config.js. It uses no cookies.
  function setUpAnalytics() {
    var token = clean(CONFIG.CF_ANALYTICS_TOKEN);
    if (!/^[A-Za-z0-9]+$/.test(token)) return;
    var script = document.createElement("script");
    script.defer = true;
    script.src = "https://static.cloudflareinsights.com/beacon.min.js";
    script.setAttribute("data-cf-beacon", JSON.stringify({ token: token }));
    document.body.appendChild(script);
  }

  setUpControls();
  setUpScrolling();
  setUpFooterAndNotes();
  setUpAnalytics();
  updateWash();

  loadOrgs().then(function (orgs) {
    state.orgs = orgs;
    render();
    loadMap();   // last, so the list never waits for the map
  });
})();
