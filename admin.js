'use strict';

/**
 * Musicala · Admin Panel (lectura + stats)
 * - Login con Google
 * - Solo correos autorizados pueden ver (UI + Rules)
 * - Lee /reviews (orderBy createdAt desc)
 * - Stats: KPIs + ranking por persona + últimos comentarios
 * - Export CSV
 */

import { auth, provider, db } from "./firebase.js";
import { signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, query, orderBy, limit, getDocs }
  from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const ADMIN_EMAILS = new Set([
  "alekcaballeromusic@gmail.com",
  "catalina.medina.leal@gmail.com"
]);

const state = {
  user: null,
  isAdmin: false,
  loading: false,
  rowsCache: [],
  peopleById: new Map(), // personId -> {name, role}
};

const els = {
  btnLogin: document.getElementById("btnLogin"),
  btnLogout: document.getElementById("btnLogout"),
  authState: document.getElementById("authState"),
  summary: document.getElementById("summary"),
  msg: document.getElementById("msg"),

  filterPerson: document.getElementById("filterPerson"),
  rangeDays: document.getElementById("rangeDays"),
  btnReload: document.getElementById("btnReload"),
  btnExport: document.getElementById("btnExport"),

  kpisWrap: document.getElementById("kpis"),
  kpiTotal: document.getElementById("kpiTotal"),
  kpiAvg: document.getElementById("kpiAvg"),
  kpiWithComment: document.getElementById("kpiWithComment"),
  kpiRecent: document.getElementById("kpiRecent"),

  tbodyAgg: document.getElementById("tbodyAgg"),
  tbodyComments: document.getElementById("tbodyComments"),
  tbody: document.getElementById("tbody"),
};

wireUI();
bindAuth();

/* =========================
   UI
========================= */
function wireUI() {
  els.btnLogin?.addEventListener("click", doLogin);
  els.btnLogout?.addEventListener("click", doLogout);
  els.btnReload?.addEventListener("click", () => loadAndRender());
  els.btnExport?.addEventListener("click", exportCSV);

  const rerender = debounce(() => renderAllFromCache(), 80);
  els.filterPerson?.addEventListener("input", rerender);
  els.rangeDays?.addEventListener("change", rerender);
}

async function doLogin() {
  setMsg("");
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
    setMsg("No se pudo iniciar sesión (popup bloqueado o cancelado).", "error");
  }
}

async function doLogout() {
  setMsg("");
  try {
    await signOut(auth);
  } catch (e) {
    console.error(e);
    setMsg("No se pudo cerrar sesión.", "error");
  }
}

/* =========================
   Auth
========================= */
function bindAuth() {
  onAuthStateChanged(auth, async (user) => {
    state.user = user || null;

    if (!user) {
      state.isAdmin = false;
      state.rowsCache = [];
      state.peopleById.clear();
      setAuthUI("No has iniciado sesión.", false);
      hideKpis();
      renderEmptyAll();
      setSummary("Inicia sesión para ver datos.");
      setMsg("");
      return;
    }

    const email = String(user.email || "").toLowerCase();
    state.isAdmin = ADMIN_EMAILS.has(email);

    setAuthUI(`Sesión: ${email}`, true);

    if (!state.isAdmin) {
      hideKpis();
      renderEmptyAll();
      setSummary("Este correo no está autorizado.");
      setMsg("Acceso denegado: correo no autorizado.", "error");
      return;
    }

    setMsg("");
    await loadPeopleIndex(); // data.json (nombres)
    loadAndRender();
  });
}

function setAuthUI(text, loggedIn) {
  if (els.authState) els.authState.textContent = text;
  if (els.btnLogin) els.btnLogin.hidden = !!loggedIn;
  if (els.btnLogout) els.btnLogout.hidden = !loggedIn;
}

/* =========================
   Load people (data.json)
========================= */
async function loadPeopleIndex() {
  try {
    const res = await fetch("./data.json", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const people = Array.isArray(data?.people) ? data.people : [];
    state.peopleById.clear();

    for (const p of people) {
      const pid = String(p.personId || p.id || "").trim();
      if (!pid) continue;
      state.peopleById.set(pid, {
        name: String(p.name || pid),
        role: String(p.role || ""),
      });
    }
  } catch (e) {
    // Si falla, no es fatal. Solo perdemos los nombres bonitos.
    console.warn("No se pudo cargar data.json para index", e);
    state.peopleById.clear();
  }
}

/* =========================
   Data load
========================= */
async function loadAndRender() {
  if (!state.isAdmin) return;
  if (state.loading) return;

  state.loading = true;
  setMsg("Cargando…");
  setSummary("Consultando Firestore…");

  try {
    const q = query(
      collection(db, "reviews"),
      orderBy("createdAt", "desc"),
      limit(500)
    );

    const snap = await getDocs(q);

    const rows = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const createdAt = d.createdAt?.toDate ? d.createdAt.toDate() : null;

      rows.push({
        id: doc.id,
        createdAt,
        personId: String(d.personId || ""),
        stars: clampInt(Number(d.stars || 0), 0, 5),
        comment: String(d.comment || ""),
      });
    });

    state.rowsCache = rows;

    renderAllFromCache();

    setMsg("Listo.", "success");
  } catch (e) {
    console.error(e);

    const msg = isPermissionError(e)
      ? "Sin permisos para leer. Revisa Firestore Rules (admins) y el dominio autorizado en Auth."
      : "No se pudo cargar. Intenta recargar.";

    hideKpis();
    renderEmptyAll();
    setSummary("No se pudieron cargar datos.");
    setMsg(msg, "error");
  } finally {
    state.loading = false;
  }
}

/* =========================
   Render (from cache)
========================= */
function renderAllFromCache() {
  const rows = applyFilters(state.rowsCache);

  renderKpis(rows, state.rowsCache);
  renderAgg(rows);
  renderComments(rows);
  renderRaw(rows);

  setSummary(`Mostrando ${rows.length} de ${state.rowsCache.length} registros (últimos 500).`);
}

function applyFilters(rows) {
  const q = String(els.filterPerson?.value || "").trim().toLowerCase();
  const days = Number(els.rangeDays?.value || 0);

  const minDate = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;

  return (rows || []).filter((r) => {
    if (minDate && r.createdAt && r.createdAt < minDate) return false;

    if (!q) return true;

    const pid = String(r.personId || "").toLowerCase();
    const info = state.peopleById.get(r.personId) || null;
    const name = String(info?.name || "").toLowerCase();

    return pid.includes(q) || name.includes(q);
  });
}

function renderKpis(filteredRows, allRows) {
  if (!els.kpisWrap) return;

  if (!state.isAdmin) { hideKpis(); return; }

  els.kpisWrap.style.display = "grid";

  const total = filteredRows.length;
  const sum = filteredRows.reduce((a, r) => a + (Number(r.stars) || 0), 0);
  const avg = total ? (sum / total) : 0;

  const withComment = filteredRows.filter(r => String(r.comment || "").trim().length > 0).length;
  const pctComment = total ? Math.round((withComment / total) * 100) : 0;

  const recent7 = allRows.filter(r => r.createdAt && (Date.now() - r.createdAt.getTime()) <= 7*24*60*60*1000).length;

  if (els.kpiTotal) els.kpiTotal.textContent = String(total);
  if (els.kpiAvg) els.kpiAvg.textContent = avg ? avg.toFixed(2) : "0.00";
  if (els.kpiWithComment) els.kpiWithComment.textContent = `${pctComment}%`;
  if (els.kpiRecent) els.kpiRecent.textContent = String(recent7);
}

function hideKpis() {
  if (els.kpisWrap) els.kpisWrap.style.display = "none";
}

function renderAgg(rows) {
  if (!els.tbodyAgg) return;

  if (!rows || rows.length === 0) {
    els.tbodyAgg.innerHTML = emptyRow(5, "No hay datos para calcular ranking.");
    return;
  }

  const map = new Map(); // personId -> {count,sum,last}
  for (const r of rows) {
    const pid = String(r.personId || "").trim();
    if (!pid) continue;
    const cur = map.get(pid) || { count: 0, sum: 0, last: null };
    cur.count += 1;
    cur.sum += Number(r.stars || 0);
    if (r.createdAt && (!cur.last || r.createdAt > cur.last)) cur.last = r.createdAt;
    map.set(pid, cur);
  }

  const agg = Array.from(map.entries()).map(([pid, v]) => {
    const avg = v.count ? (v.sum / v.count) : 0;
    return { pid, avg, count: v.count, last: v.last };
  }).sort((a, b) => (b.avg - a.avg) || (b.count - a.count));

  els.tbodyAgg.innerHTML = agg.map((a) => {
    const info = state.peopleById.get(a.pid);
    const name = info?.name || a.pid;
    const role = info?.role ? ` · ${info.role}` : "";
    return `
      <tr>
        <td>${escapeHtml(name)}<span class="muted2">${escapeHtml(role)}</span></td>
        <td><code>${escapeHtml(a.pid)}</code></td>
        <td class="starsTxt">${escapeHtml(a.avg.toFixed(2))}</td>
        <td>${escapeHtml(String(a.count))}</td>
        <td>${escapeHtml(fmtDate(a.last))}</td>
      </tr>
    `;
  }).join("");
}

function renderComments(rows) {
  if (!els.tbodyComments) return;

  const withText = (rows || [])
    .filter(r => String(r.comment || "").trim().length > 0)
    .slice(0, 60);

  if (withText.length === 0) {
    els.tbodyComments.innerHTML = emptyRow(4, "No hay comentarios en este filtro.");
    return;
  }

  els.tbodyComments.innerHTML = withText.map((r) => {
    const info = state.peopleById.get(r.personId);
    const name = info?.name || r.personId;
    return `
      <tr>
        <td>${escapeHtml(fmtDate(r.createdAt))}</td>
        <td>${escapeHtml(name)}</td>
        <td class="starsTxt">${escapeHtml(starsText(r.stars))}</td>
        <td>${escapeHtml(r.comment || "")}</td>
      </tr>
    `;
  }).join("");
}

function renderRaw(rows) {
  if (!els.tbody) return;

  if (!rows || rows.length === 0) {
    els.tbody.innerHTML = emptyRow(5, "No hay registros para mostrar.");
    return;
  }

  els.tbody.innerHTML = rows.map((r) => {
    const info = state.peopleById.get(r.personId);
    const name = info?.name || r.personId;
    return `
      <tr>
        <td>${escapeHtml(fmtDate(r.createdAt))}</td>
        <td>${escapeHtml(name)}</td>
        <td><code>${escapeHtml(r.personId)}</code></td>
        <td class="starsTxt">${escapeHtml(starsText(r.stars))}</td>
        <td>${escapeHtml(r.comment || "")}</td>
      </tr>
    `;
  }).join("");
}

function renderEmptyAll() {
  if (els.tbodyAgg) els.tbodyAgg.innerHTML = emptyRow(5, "Inicia sesión (admin) para ver datos.");
  if (els.tbodyComments) els.tbodyComments.innerHTML = emptyRow(4, "Inicia sesión (admin) para ver datos.");
  if (els.tbody) els.tbody.innerHTML = emptyRow(5, "Inicia sesión (admin) para ver datos.");
}

function emptyRow(cols, text) {
  return `
    <tr>
      <td colspan="${cols}" style="padding:14px;">
        <span style="color:rgba(0,0,0,.62);font-weight:800;">${escapeHtml(text)}</span>
      </td>
    </tr>
  `;
}

/* =========================
   Export
========================= */
function exportCSV() {
  if (!state.isAdmin) return;

  const rows = applyFilters(state.rowsCache);

  const header = ["fecha", "persona", "personId", "stars", "comment"];
  const lines = [header.join(",")];

  for (const r of rows) {
    const info = state.peopleById.get(r.personId);
    const name = info?.name || r.personId;

    lines.push([
      csvCell(fmtDateISO(r.createdAt)),
      csvCell(name),
      csvCell(r.personId),
      csvCell(String(r.stars || 0)),
      csvCell(String(r.comment || "")),
    ].join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `musicala_reviews_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* =========================
   Messaging
========================= */
function setSummary(text) {
  if (els.summary) els.summary.textContent = text;
}

function setMsg(text, kind = "") {
  if (!els.msg) return;
  els.msg.textContent = text || "";
  els.msg.className = kind === "success"
    ? "ok"
    : kind === "error"
      ? "bad"
      : "";
}

/* =========================
   Helpers
========================= */
function fmtDate(d) {
  if (!d) return "";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(d);
}

function fmtDateISO(d) {
  if (!d) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function starsText(n) {
  const v = clampInt(Number(n || 0), 0, 5);
  if (!v) return "";
  const full = "★".repeat(v);
  const empty = "☆".repeat(5 - v);
  return `${v} ${full}${empty}`;
}

function clampInt(n, a, b) {
  const x = Number.isFinite(n) ? Math.round(n) : a;
  return Math.max(a, Math.min(b, x));
}

function isPermissionError(err) {
  const s = String(err?.message || err || "").toLowerCase();
  return s.includes("permission") || s.includes("insufficient permissions") || s.includes("missing or insufficient permissions");
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function csvCell(v) {
  const s = String(v ?? "");
  // escapado CSV estándar
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}