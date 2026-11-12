/* No spare change? Here's how you can help.
 *
 * What this file does, in order:
 *   1. Loads the list (Google Sheet CSV, or the saved copy in data/seed.js).
 *   2. Cleans each row and drops anything hidden or too old.
 *   3. Draws the cards, the filter chips and the "Near me" controls.
 *   4. Loads the map (Leaflet) last, so the list never waits for it.
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
    selectedKey: null,   // the card/pin currently highlighted
    map: null,
    markerLayer: null,
    markers: {}
  };

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

  function buildCard(org) {
    var item = el("li");
    var card = el("article", "card");
    card.id = "card-" + org.key;
    if (org.key === state.selectedKey) card.classList.add("is-highlighted");

    var heading = el("h3", "", org.name);
    heading.tabIndex = -1;
    card.appendChild(heading);
    if (org.program) card.appendChild(el("p", "program", org.program));

    var where = [org.neighborhood, org.borough].filter(Boolean).join(", ");
    if (org.miles !== null && org.miles !== undefined) {
      var distance = org.miles < 0.1 ? "less than 0.1 mi away" : "about " + org.miles.toFixed(1) + " mi away";
      where = where ? where + " · " + distance : distance;
    }
    if (where) card.appendChild(el("p", "where", where));
    if (org.address) card.appendChild(el("p", "address", org.address));

    var flag = el("p", "selected-flag", "Selected on the map");
    flag.hidden = org.key !== state.selectedKey;
    card.appendChild(flag);

    // This month's needs
    card.appendChild(el("h4", "", "This month"));
    if (org.items || org.shifts || org.skills) {
      var needs = el("dl", "this-month");
      addDetail(needs, "Items", org.items);
      addDetail(needs, "Shifts", org.shifts);
      addDetail(needs, "Skills", org.skills);
      card.appendChild(needs);
    } else {
      card.appendChild(el("p", "not-confirmed", "Not yet confirmed"));
    }

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
      var isEmail = /^mailto:/i.test(org.signupUrl);
      var signup = el("a", "btn-primary", (isEmail ? "Email " : "Sign up with ") + org.name);
      signup.href = org.signupUrl;
      if (!isEmail) {
        signup.target = "_blank";
        signup.rel = "noopener";
        signup.appendChild(el("span", "visually-hidden", " (opens in a new tab)"));
      }
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
      var show = el("button", "btn btn-link", "Show on map");
      show.type = "button";
      show.appendChild(el("span", "visually-hidden", ": " + org.name));
      show.addEventListener("click", function () { selectOrg(org.key, "card"); });
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

  // Redraws the chips, the count, the cards and the pins from the current state.
  function render() {
    updateChips();
    var list = visibleOrgs();
    var total = state.orgs.length;
    var listNode = $("org-list");
    listNode.textContent = "";

    if (!list.some(function (org) { return org.key === state.selectedKey; })) state.selectedKey = null;

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
  }

  // ---------- Highlighting a card and its pin ----------

  function scrollTo(node) {
    if (node && node.scrollIntoView) {
      node.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }

  function selectOrg(key, from) {
    state.selectedKey = key;

    // Update the cards
    var cards = document.querySelectorAll(".card");
    for (var i = 0; i < cards.length; i++) {
      var on = cards[i].id === "card-" + key;
      cards[i].classList.toggle("is-highlighted", on);
      var flag = cards[i].querySelector(".selected-flag");
      if (flag) flag.hidden = !on;
    }
    // Update the pins
    Object.keys(state.markers).forEach(function (k) {
      var pin = state.markers[k].getElement();
      if (pin) pin.classList.toggle("is-selected", k === key);
    });

    if (from === "pin") {
      // A pin was tapped: go to its card.
      var card = $("card-" + key);
      if (card) {
        scrollTo(card);
        var heading = card.querySelector("h3");
        if (heading) heading.focus({ preventScroll: true });
      }
    } else if (from === "card" && state.map && state.markers[key]) {
      // "Show on map" was pressed: open the map and go to the pin.
      setMapHidden(false);
      var marker = state.markers[key];
      state.map.setView(marker.getLatLng(), Math.max(state.map.getZoom(), 15), { animate: !reduceMotion });
      scrollTo($("map-section"));
      var pinNode = marker.getElement();
      if (pinNode) pinNode.focus({ preventScroll: true });
    }
  }

  // ---------- Map ----------

  function mapFailed() {
    state.map = null;
    $("map").hidden = true;
    $("map-toggle").hidden = true;
    $("map-holder").hidden = false;
    var note = $("map-note");
    note.textContent = "The map couldn't load. Every organization is in the list.";
    note.hidden = false;
  }

  function setMapHidden(hidden) {
    var toggle = $("map-toggle");
    $("map-holder").hidden = hidden;
    toggle.textContent = hidden ? "Show map" : "Hide map";
    toggle.setAttribute("aria-expanded", hidden ? "false" : "true");
    if (!hidden && state.map) state.map.invalidateSize();
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
        fadeAnimation: !reduceMotion,
        zoomAnimation: !reduceMotion,
        markerZoomAnimation: !reduceMotion
      });
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
          $("map-note").textContent = "The map background didn't load. The pins still work, and every organization is in the list.";
          $("map-note").hidden = false;
        }
      });
      tiles.addTo(map);

      state.markerLayer = L.layerGroup().addTo(map);
      state.map = map;
      render();          // redraw so cards get their "Show on map" buttons
      fitToPins();
    } catch (e) {
      mapFailed();
      render();
    }
  }

  // Puts one pin on the map for each shown organization that has coordinates.
  function syncMarkers(list) {
    if (!state.map) return;
    var L = window.L;
    state.markerLayer.clearLayers();
    state.markers = {};

    list.forEach(function (org) {
      if (!org.hasPin) return;
      var marker = L.marker([org.lat, org.lng], {
        icon: L.divIcon({ className: "pin", html: '<span class="pin-shape"></span>', iconSize: [44, 44], iconAnchor: [22, 44] }),
        title: org.name,
        keyboard: true
      });
      marker.on("click", function () { selectOrg(org.key, "pin"); });
      marker.addTo(state.markerLayer);
      var pin = marker.getElement();
      if (pin) {
        // The pin's name for screen readers. setAttribute keeps it as plain text.
        pin.setAttribute("aria-label", org.name + (org.neighborhood ? ", " + org.neighborhood : "") + ". Go to this organization in the list.");
        pin.classList.toggle("is-selected", org.key === state.selectedKey);
        // Enter or Space on a pin does the same as tapping it.
        pin.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectOrg(org.key, "pin");
          }
        });
      }
      state.markers[org.key] = marker;
    });
  }

  function fitToPins() {
    if (!state.map) return;
    var points = Object.keys(state.markers).map(function (k) { return state.markers[k].getLatLng(); });
    if (points.length) {
      state.map.fitBounds(window.L.latLngBounds(points).pad(0.25), { maxZoom: 14, animate: false });
    } else {
      state.map.setView(NYC_CENTER, 11, { animate: false });
    }
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
        fitToPins();
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

    $("map-toggle").addEventListener("click", function () {
      setMapHidden(!$("map-holder").hidden);
    });
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
  setUpFooterAndNotes();
  setUpAnalytics();

  loadOrgs().then(function (orgs) {
    state.orgs = orgs;
    render();
    loadMap();   // last, so the list never waits for the map
  });
})();
