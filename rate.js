'use strict';

/**
 * Musicala · Rate UI (Front público)
 * - GitHub Pages + Firestore direct
 * - Público SOLO crea docs en /reviews (Rules bloquean read)
 *
 * Mejora clave:
 * - Fusiona registros repetidos por personId en UNA sola tarjeta.
 *   (Ej: Alek como admin + docente => 1 tarjeta con roles combinados)
 *
 * Requisitos:
 * - firebase.js en la raíz exportando: db
 * - Firestore Rules: allow create (público) + read (admins)
 */

import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const state = {
  raw: { people: [] },          // lo que llega del JSON
  people: [],                   // lista FUSIONADA (render real)
  query: "",
  lastFocus: null,
  currentPerson: null,
  selectedStars: 0,
  sending: false,
  loadError: false,

  // para filtrar rápido sin recalcular strings todo el tiempo:
  searchIndex: new Map(), // key: personKey -> haystack string
};

const els = {
  grid: document.getElementById("cards"),
  empty: document.getElementById("emptyState"),
  reset: document.getElementById("resetFilters"),
  search: document.getElementById("searchInput"),
  clear: document.getElementById("clearSearch"),

  modal: document.getElementById("personModal"),
  modalClose: document.getElementById("modalClose"),
  mPhoto: document.getElementById("mPhoto"),
  mName: document.getElementById("mName"),
  mRole: document.getElementById("mRole"),

  stars: document.getElementById("stars"),
  comment: document.getElementById("comment"),
  send: document.getElementById("sendRating"),
  cancel: document.getElementById("cancelRating"),
  status: document.getElementById("status"),
};

init();

/* =========================
   Boot
========================= */
async function init() {
  showLoading();
  await loadData();
  buildSearchIndex();
  wireUI();
  renderCards();
}

function showLoading() {
  if (els.grid) {
    els.grid.innerHTML = `<p class="muted" style="padding:14px;font-weight:700;">Cargando el equipo…</p>`;
  }
}

/* =========================
   Data
========================= */
async function loadData() {
  try {
    const res = await fetch("./data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const staticPeople = (data && Array.isArray(data.people)) ? data.people : [];
    const dynamicPeople = await loadDynamicTeamMembers();
    state.raw = { people: [...staticPeople, ...dynamicPeople] };

    // Normaliza rutas (assets/)
    const normalized = (state.raw.people || []).map(normalizePerson);

    // Fusión por personId (o id si no hay personId)
    state.people = mergePeople(normalized);
    state.loadError = false;
  } catch (e) {
    console.error("No se pudo cargar data.json", e);
    state.raw = { people: [] };
    state.people = [];
    state.loadError = true;
  }
}

function normalizePerson(p) {
  const out = { ...p };

  // Foto: si no trae ruta y no es URL, asumimos ./assets/
  out.photo = resolveAssetPath(out.photo, "avatar.png");

  // Tags: aseguramos array
  out.tags = Array.isArray(out.tags) ? out.tags : [];

  // Labels
  out.sectionLabel = out.sectionLabel || out.section || "";

  // Strings limpios
  out.name = String(out.name || "").trim();
  out.role = String(out.role || "").trim();
  out.subarea = String(out.subarea || "").trim();
  out.section = String(out.section || "").trim();
  out.sectionLabel = String(out.sectionLabel || "").trim();
  out.personId = String(out.personId || "").trim();
  out.id = String(out.id || "").trim();

  return out;
}

async function loadDynamicTeamMembers() {
  try {
    const snap = await getDocs(collection(db, "teamMembers"));
    const people = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      people.push({
        id: doc.id,
        personId: d.personId || doc.id,
        name: d.name || "",
        role: d.role || "",
        section: d.section || "",
        sectionLabel: d.sectionLabel || d.section || "",
        subarea: d.subarea || "",
        tags: Array.isArray(d.tags) ? d.tags : [],
        photo: d.photoDataUrl || d.photoUrl || "",
        _dynamic: true,
        _deleted: d.active === false,
      });
    });
    return people;
  } catch (e) {
    console.warn("No se pudieron cargar miembros adicionales.", e);
    return [];
  }
}

function resolveAssetPath(path, fallback) {
  const val = (path || "").trim();
  if (!val) return `./assets/${fallback}`;

  // Si ya es URL o ya trae carpeta, respétalo
  if (/^data:image\//i.test(val)) return val;
  if (/^https?:\/\//i.test(val)) return val;
  if (val.startsWith("./") || val.startsWith("../")) return val;
  if (val.includes("/")) return `./${val.replace(/^\//, "")}`;

  // Si es solo "foto.jpg" => assets/foto.jpg
  return `./assets/${val}`;
}

/**
 * Fusiona registros por personId (o id si falta)
 * Salida: [{ personId, name, roles[], roleDisplay, tags[], sectionLabel, ... }]
 */
function mergePeople(list) {
  const byKey = new Map();

  for (const p of (list || [])) {
    const key = mergeKey(p);
    if (!key) continue;

    const cur = byKey.get(key);
    if (p._deleted) {
      byKey.delete(key);
      continue;
    }

    if (!cur) {
      byKey.set(key, {
        // Identidad
        personId: p.personId || key,
        id: p.id || key,

        // Visual
        name: p.name || key,
        photo: p.photo || "./assets/avatar.png",

        // “Datos” fusionables
        roles: p.role ? [p.role] : [],
        tags: [...(p.tags || [])],

        // Para badge/orden
        section: p.section || "",
        sectionLabel: p.sectionLabel || "",
        subarea: p.subarea || "",

        // Extra para búsqueda y debugging
        _sections: new Set([p.sectionLabel || p.section || ""].filter(Boolean)),
        _subareas: new Set([p.subarea].filter(Boolean)),
        _sources: [p], // por si después quieren auditar
      });
      continue;
    }

    // Merge name: preferir el más largo (suele ser el completo)
    if (p._dynamic) {
      cur.name = p.name || cur.name;
      cur.photo = p.photo || cur.photo;
      cur.roles = [];
      cur.tags = [];
      cur.section = p.section || "";
      cur.sectionLabel = p.sectionLabel || "";
      cur.subarea = p.subarea || "";
      cur._sections = new Set();
      cur._subareas = new Set();
    }

    const nameA = String(cur.name || "").trim();
    const nameB = String(p.name || "").trim();
    if (!p._dynamic && nameB && (!nameA || nameB.length > nameA.length)) cur.name = nameB;

    // Merge photo: preferir la primera real (no avatar fallback)
    const isFallback = (x) => String(x || "").includes("avatar.png");
    if (p._dynamic || (p.photo && (isFallback(cur.photo) && !isFallback(p.photo)))) cur.photo = p.photo;

    // Roles únicos
    if (p.role) cur.roles.push(p.role);

    // Tags
    cur.tags.push(...(p.tags || []));

    // Secciones/subareas para búsqueda
    if (p.sectionLabel || p.section) cur._sections.add(p.sectionLabel || p.section);
    if (p.subarea) cur._subareas.add(p.subarea);

    // Prioridad de badge: si hay secciónLabel más “humana”, úsala
    if (!cur.sectionLabel && p.sectionLabel) cur.sectionLabel = p.sectionLabel;

    // Guardar fuente
    cur._sources.push(p);
  }

  // Post-proceso: dedupe + ordenar + roleDisplay
  const merged = Array.from(byKey.values()).map((p) => {
    const roles = uniqClean(p.roles);
    const tags = uniqClean(p.tags);
    const sections = uniqClean(Array.from(p._sections));
    const subareas = uniqClean(Array.from(p._subareas));

    const sectionLabel = pickPrimarySectionLabel(p.sectionLabel, sections);

    return {
      personId: p.personId,
      id: p.id,
      name: p.name,
      photo: p.photo || "./assets/avatar.png",

      // Para UI
      roles,
      roleDisplay: roles.join(" · "),
      tags,
      sectionLabel,
      section: p.section || "",
      subarea: subareas.join(" · "),

      // Para búsqueda
      _sections: sections,
      _subareas: subareas,
    };
  });

  // Orden estable: por secciónLabel y luego por nombre
  merged.sort((a, b) => {
    const sa = String(a.sectionLabel || "").toLowerCase();
    const sb = String(b.sectionLabel || "").toLowerCase();
    if (sa !== sb) return sa.localeCompare(sb, "es");
    return String(a.name || "").toLowerCase().localeCompare(String(b.name || "").toLowerCase(), "es");
  });

  return merged;
}

function mergeKey(p) {
  const pid = String(p?.personId || "").trim();
  if (pid) return pid;
  const id = String(p?.id || "").trim();
  if (id) return id;

  // último fallback: slug nombre+rol (evita perder gente si faltó personId/id)
  const nm = String(p?.name || "").trim();
  const rl = String(p?.role || "").trim();
  if (nm || rl) return slug(`${nm}-${rl}`);
  return "";
}

function uniqClean(arr) {
  const out = [];
  const seen = new Set();
  for (const raw of (arr || [])) {
    const v = String(raw || "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function pickPrimarySectionLabel(current, list) {
  // si ya viene algo, úsalo
  const cur = String(current || "").trim();
  if (cur) return cur;

  // sino, elige el primero “decente”
  const cleaned = (list || []).map(s => String(s || "").trim()).filter(Boolean);
  if (!cleaned.length) return "Equipo";

  // preferir uno que no sea un slug técnico (por ejemplo "docentes-musica")
  const human = cleaned.find(s => !s.includes("-") || s.includes(" "));
  return human || cleaned[0] || "Equipo";
}

function buildSearchIndex() {
  state.searchIndex.clear();

  for (const p of state.people) {
    const key = personKey(p);

    // Haystack: todo lo que alguien podría buscar
    const hay = [
      p.name,
      p.roleDisplay,
      ...(p.roles || []),
      p.sectionLabel,
      p.section,
      p.subarea,
      ...(p._sections || []),
      ...(p._subareas || []),
      ...(p.tags || []),
      p.personId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    state.searchIndex.set(key, hay);
  }
}

/* =========================
   UI wiring
========================= */
function wireUI() {
  if (els.search) {
    const onInput = debounce((e) => {
      state.query = (e.target.value || "").trim().toLowerCase();
      renderCards();
    }, 80);

    els.search.addEventListener("input", onInput);
  }

  if (els.clear) {
    els.clear.addEventListener("click", () => {
      state.query = "";
      if (els.search) els.search.value = "";
      renderCards(true);
      els.search?.focus?.();
    });
  }

  if (els.reset) {
    els.reset.addEventListener("click", () => {
      state.query = "";
      if (els.search) els.search.value = "";
      renderCards(true);
      els.search?.focus?.();
    });
  }

  // Modal close controls
  els.modalClose?.addEventListener("click", closeModal);
  els.cancel?.addEventListener("click", closeModal);

  els.modal?.addEventListener("click", (e) => {
    if (e.target && e.target.hasAttribute("data-close")) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isModalOpen()) closeModal();
  });

  els.send?.addEventListener("click", submitRating);
}

/* =========================
   Render cards
========================= */
function renderCards(keepScroll = false) {
  // Si falló la carga de datos, lo decimos claro (no es lo mismo que "sin resultados")
  if (state.loadError) {
    els.grid.innerHTML = `<p class="error" style="padding:14px;font-weight:700;">No se pudo cargar el equipo. Revisa que <code>data.json</code> exista y recarga la página.</p>`;
    if (els.empty) els.empty.hidden = true;
    return;
  }

  const all = state.people || [];
  const q = state.query;

  const results = q
    ? all.filter((p) => {
        const hay = state.searchIndex.get(personKey(p)) || "";
        return hay.includes(q);
      })
    : all;

  const prevScrollTop = els.grid?.scrollTop ?? 0;

  els.grid.innerHTML = results.map((p, i) => toCard(p, i)).join("");

  // Click handlers
  els.grid.querySelectorAll("[data-person-index]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.getAttribute("data-person-index"));
      const person = results[idx];
      state.lastFocus = e.currentTarget;
      openModal(person);
    });
  });

  // Accesibilidad: abrir con Enter/Espacio sobre la tarjeta
  els.grid.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        card.querySelector("[data-person-index]")?.click();
      }
    });
  });

  els.empty.hidden = results.length !== 0;

  if (keepScroll && els.grid) els.grid.scrollTop = prevScrollTop;
}

function toCard(p, i) {
  const photo = p.photo || "./assets/avatar.png";
  const area = p.sectionLabel || "Equipo";

  // mostrar hasta 4 tags (fusionados)
  const tags = (p.tags || [])
    .slice(0, 4)
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join("");

  // roleDisplay puede ser largo, pero igual sirve.
  const roleText = String(p.roleDisplay || p.roles?.[0] || "");

  return `
    <article class="card" tabindex="0" aria-label="${escapeHtml(p.name)}, ${escapeHtml(roleText)}">
      <button class="card__media" data-person-index="${i}" aria-label="Calificar a ${escapeHtml(p.name)}" type="button">
        <img src="${escapeAttr(photo)}" alt="Foto de ${escapeAttr(p.name)}" loading="lazy" decoding="async">
        <span class="badge">${escapeHtml(area)}</span>
      </button>
      <div class="card__body">
        <h3 class="card__name">${escapeHtml(p.name)}</h3>
        <p class="card__role">${escapeHtml(roleText)}</p>
        <div class="card__meta">${tags}</div>
      </div>
    </article>
  `;
}

/* =========================
   Modal
========================= */
function openModal(person) {
  if (!person) return;

  state.currentPerson = person;
  state.selectedStars = 0;
  state.sending = false;

  els.mPhoto.src = person.photo || "./assets/avatar.png";
  els.mPhoto.alt = `Foto de ${person.name || ""}`;
  els.mName.textContent = person.name || "";

  // Aquí mostramos todos los roles fusionados, bonito:
  els.mRole.textContent = person.roleDisplay || (person.roles || []).join(" · ") || "";

  els.comment.value = "";
  els.send.disabled = false;

  setStatus("", "");
  renderStars(0);

  els.modal.classList.add("is-open");
  els.modal.setAttribute("aria-hidden", "false");

  // Enfocar botón de cerrar para accesibilidad
  els.modalClose?.focus?.();
}

function closeModal() {
  if (!isModalOpen()) return;

  els.modal.classList.remove("is-open");
  els.modal.setAttribute("aria-hidden", "true");

  // Volver foco donde estaba
  if (state.lastFocus && typeof state.lastFocus.focus === "function") {
    state.lastFocus.focus();
  }

  state.currentPerson = null;
  state.selectedStars = 0;
  state.sending = false;
}

function isModalOpen() {
  return els.modal?.classList?.contains("is-open");
}

function renderStars(current) {
  els.stars.innerHTML = Array.from({ length: 5 }, (_, i) => {
    const n = i + 1;
    const on = n <= current ? "is-on" : "";
    return `<button type="button" class="starBtn ${on}" data-star="${n}" aria-label="${n} estrellas">★</button>`;
  }).join("");

  els.stars.querySelectorAll("[data-star]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.sending) return;
      const n = Number(btn.getAttribute("data-star"));
      state.selectedStars = n;
      renderStars(n);
    });
  });
}

/* =========================
   Submit (Firestore)
========================= */
async function submitRating() {
  if (!state.currentPerson) return;
  if (state.sending) return;

  const stars = Number(state.selectedStars || 0);
  if (!stars || stars < 1 || stars > 5) {
    setStatus("Selecciona estrellas 🙂", "error");
    return;
  }

  const comment = (els.comment.value || "").trim().slice(0, 500);

  // UI lock
  state.sending = true;
  els.send.disabled = true;
  setStatus("Enviando…", "");

  try {
    const personId = toPersonId(state.currentPerson);

    // Guardar (público solo create; rules bloquean read)
    await addDoc(collection(db, "reviews"), {
      personId,
      stars,
      comment,
      createdAt: serverTimestamp(),
    });

    setStatus("¡Listo! Gracias 💙", "success");

    // Cerrar suavecito para “califica y chao”
    setTimeout(() => closeModal(), 900);
  } catch (e) {
    console.error(e);

    const msg =
      isFirebasePermissionError(e)
        ? "No se pudo enviar por permisos. (Revisa Firestore Rules)."
        : "Error al enviar. Intenta otra vez.";

    setStatus(msg, "error");
    state.sending = false;
    els.send.disabled = false;
  }
}

function isFirebasePermissionError(err) {
  const s = String(err?.message || err || "");
  return s.toLowerCase().includes("permission") || s.toLowerCase().includes("missing or insufficient permissions");
}

function setStatus(text, kind) {
  els.status.textContent = text;
  els.status.className = "toastMini " + (kind || "");
}

/* =========================
   PersonId estable
========================= */
function toPersonId(person) {
  // Preferido: person.personId (en fusionados siempre existe)
  if (person.personId) return String(person.personId);

  // fallback: id
  if (person.id) return String(person.id);

  // último fallback: slug por nombre + roles
  const roles = Array.isArray(person.roles) ? person.roles.join("-") : (person.roleDisplay || person.role || "");
  return slug(`${person.name || "persona"}-${roles}`);
}

function personKey(p) {
  // clave interna para indexar búsqueda (para fusionados: personId estable)
  return String(p.personId || p.id || `${p.name || ""}`);
}

/* =========================
   Utils
========================= */
function slug(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
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

function escapeAttr(s) {
  // Para atributos tipo src/alt
  return escapeHtml(s).replaceAll("`", "&#096;");
}
