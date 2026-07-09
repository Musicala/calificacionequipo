'use strict';

/**
 * Musicala · Admin Panel Pro
 * - Login con Google
 * - Solo correos autorizados pueden ver datos
 * - Lectura de /reviews desde Firestore
 * - KPIs, distribución, tendencias, ranking, comentarios, control de datos y exportaciones
 */

import { auth, provider, db, storage } from "./firebase.js";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  query,
  orderBy,
  limit,
  getDocs,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getDownloadURL,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const ADMIN_EMAILS = new Set([
  "alekcaballeromusic@gmail.com",
  "catalina.medina.leal@gmail.com"
]);

const MS_DAY = 24 * 60 * 60 * 1000;

const state = {
  user: null,
  isAdmin: false,
  loading: false,
  rowsCache: [],
  peopleById: new Map(),
  editingPersonId: "",
  loadedLimit: 500,
};

const els = {
  btnLogin: document.getElementById("btnLogin"),
  btnLogout: document.getElementById("btnLogout"),
  authState: document.getElementById("authState"),
  summary: document.getElementById("summary"),
  msg: document.getElementById("msg"),

  filterPerson: document.getElementById("filterPerson"),
  rangeDays: document.getElementById("rangeDays"),
  filterStars: document.getElementById("filterStars"),
  filterComments: document.getElementById("filterComments"),
  loadLimit: document.getElementById("loadLimit"),
  sortRanking: document.getElementById("sortRanking"),
  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),
  commentSearch: document.getElementById("commentSearch"),
  minReviews: document.getElementById("minReviews"),
  btnClearFilters: document.getElementById("btnClearFilters"),
  btnReload: document.getElementById("btnReload"),
  btnExport: document.getElementById("btnExport"),
  btnExportAgg: document.getElementById("btnExportAgg"),
  memberForm: document.getElementById("memberForm"),
  memberName: document.getElementById("memberName"),
  memberRole: document.getElementById("memberRole"),
  memberSection: document.getElementById("memberSection"),
  memberSubarea: document.getElementById("memberSubarea"),
  memberTags: document.getElementById("memberTags"),
  memberPhotoUrl: document.getElementById("memberPhotoUrl"),
  memberPhotoFile: document.getElementById("memberPhotoFile"),
  memberPreview: document.getElementById("memberPreview"),
  memberStatus: document.getElementById("memberStatus"),
  memberDirectory: document.getElementById("memberDirectory"),
  memberSubmit: document.getElementById("memberSubmit"),
  memberCancelEdit: document.getElementById("memberCancelEdit"),

  kpisWrap: document.getElementById("kpis"),
  kpiTotal: document.getElementById("kpiTotal"),
  kpiAvg: document.getElementById("kpiAvg"),
  kpiPeople: document.getElementById("kpiPeople"),
  kpiWithComment: document.getElementById("kpiWithComment"),
  kpiRecent: document.getElementById("kpiRecent"),
  kpiNotPerfect: document.getElementById("kpiNotPerfect"),
  kpiCritical: document.getElementById("kpiCritical"),
  kpiLast: document.getElementById("kpiLast"),

  insightBox: document.getElementById("insightBox"),
  autoSummary: document.getElementById("autoSummary"),
  dataIntegrity: document.getElementById("dataIntegrity"),
  chartsGrid: document.getElementById("chartsGrid"),
  starsDistribution: document.getElementById("starsDistribution"),
  dailyTrend: document.getElementById("dailyTrend"),
  sectionDistribution: document.getElementById("sectionDistribution"),

  tbodyAgg: document.getElementById("tbodyAgg"),
  commentsList: document.getElementById("commentsList"),
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
  els.btnExport?.addEventListener("click", exportRecordsCSV);
  els.btnExportAgg?.addEventListener("click", exportRankingCSV);
  els.btnClearFilters?.addEventListener("click", clearFilters);
  els.memberForm?.addEventListener("submit", saveTeamMember);
  els.memberPhotoFile?.addEventListener("change", previewMemberPhoto);
  els.memberPhotoUrl?.addEventListener("input", previewMemberPhotoUrl);
  els.memberCancelEdit?.addEventListener("click", clearMemberForm);
  els.memberDirectory?.addEventListener("click", handleMemberDirectoryClick);

  const rerender = debounce(() => renderAllFromCache(), 80);
  [
    els.filterPerson,
    els.rangeDays,
    els.filterStars,
    els.filterComments,
    els.sortRanking,
    els.dateFrom,
    els.dateTo,
    els.commentSearch,
    els.minReviews
  ].forEach((el) => el?.addEventListener("input", rerender));

  els.loadLimit?.addEventListener("change", () => loadAndRender());
}

async function doLogin() {
  setMsg("");
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
    const code = String(e?.code || "");

    // Si el popup se bloquea o se cierra, intentamos con redirect (más confiable en localhost / móvil).
    if (code === "auth/popup-blocked" || code === "auth/cancelled-popup-request" || code === "auth/popup-closed-by-user") {
      setMsg("El popup fue bloqueado. Redirigiendo a Google para iniciar sesión…");
      try {
        await signInWithRedirect(auth, provider);
        return;
      } catch (e2) {
        console.error(e2);
        setMsg(authErrorMessage(e2), "error");
        return;
      }
    }

    setMsg(authErrorMessage(e), "error");
  }
}

function authErrorMessage(e) {
  const code = String(e?.code || "");
  if (code === "auth/unauthorized-domain") {
    return `Este dominio (${location.hostname}) no está autorizado en Firebase. Agrégalo en Authentication → Settings → Authorized domains.`;
  }
  if (code === "auth/operation-not-allowed") {
    return "El proveedor de Google no está habilitado en Firebase Authentication.";
  }
  if (code === "auth/network-request-failed") {
    return "Falla de red al contactar Firebase. Revisa tu conexión.";
  }
  return "No se pudo iniciar sesión. Revisa la consola para ver el detalle del error.";
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

function clearFilters() {
  if (els.filterPerson) els.filterPerson.value = "";
  if (els.rangeDays) els.rangeDays.value = "0";
  if (els.filterStars) els.filterStars.value = "all";
  if (els.filterComments) els.filterComments.value = "all";
  if (els.sortRanking) els.sortRanking.value = "avg-desc";
  if (els.dateFrom) els.dateFrom.value = "";
  if (els.dateTo) els.dateTo.value = "";
  if (els.commentSearch) els.commentSearch.value = "";
  if (els.minReviews) els.minReviews.value = "";
  renderAllFromCache();
}

/* =========================
   Auth
========================= */
function bindAuth() {
  // Si volvemos de un signInWithRedirect, recogemos errores aquí.
  getRedirectResult(auth).catch((e) => {
    console.error(e);
    setMsg(authErrorMessage(e), "error");
  });

  onAuthStateChanged(auth, async (user) => {
    state.user = user || null;

    if (!user) {
      state.isAdmin = false;
      state.rowsCache = [];
      state.peopleById.clear();
      setAuthUI("No has iniciado sesión.", false);
      hideAdminData();
      renderEmptyAll("Inicia sesión con un correo autorizado para ver los datos.");
      setSummary("Inicia sesión para ver datos.");
      setMsg("");
      return;
    }

    const email = String(user.email || "").toLowerCase();
    state.isAdmin = ADMIN_EMAILS.has(email);

    setAuthUI(`Sesión: ${email}`, true);

    if (!state.isAdmin) {
      hideAdminData();
      renderEmptyAll("Este correo no está autorizado para ver el panel.");
      setSummary("Acceso denegado.");
      setMsg("Acceso denegado: correo no autorizado.", "error");
      return;
    }

    setMsg("");
    await loadPeopleIndex();
    await loadAndRender();
  });
}

function setAuthUI(text, loggedIn) {
  if (els.authState) els.authState.textContent = text;
  if (els.btnLogin) els.btnLogin.hidden = !!loggedIn;
  if (els.btnLogout) els.btnLogout.hidden = !loggedIn;
}

/* =========================
   People index
========================= */
async function loadPeopleIndex() {
  try {
    const res = await fetch("./data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const staticPeople = Array.isArray(data?.people) ? data.people : [];
    const dynamicPeople = await loadDynamicTeamMembers();
    const people = [...staticPeople, ...dynamicPeople];
    const merged = new Map();

    for (const p of people) {
      const pid = String(p.personId || p.id || "").trim();
      if (!pid) continue;

      const cur = merged.get(pid) || {
        personId: pid,
        name: String(p.name || pid).trim(),
        roles: [],
        sections: [],
        subareas: [],
        tags: [],
        photo: "",
        photoUrl: "",
        photoDataUrl: "",
        dynamic: false,
      };

      const name = String(p.name || "").trim();
      if (p._deleted) {
        merged.delete(pid);
        continue;
      }

      if (p._dynamic) {
        cur.name = name || cur.name;
        cur.roles = [];
        cur.sections = [];
        cur.subareas = [];
        cur.tags = [];
        cur.photo = "";
        cur.photoUrl = p.photoUrl || "";
        cur.photoDataUrl = p.photoDataUrl || "";
        cur.dynamic = true;
      } else if (name && name.length > String(cur.name || "").length) {
        cur.name = name;
      }

      pushUnique(cur.roles, p.role);
      pushUnique(cur.sections, p.sectionLabel || p.section);
      pushUnique(cur.subareas, p.subarea);
      for (const tag of (Array.isArray(p.tags) ? p.tags : [])) pushUnique(cur.tags, tag);

      const photo = resolveAssetPath(p.photo);
      if (photo && (!cur.photo || cur.photo.includes("avatar.png"))) cur.photo = photo;

      merged.set(pid, cur);
    }

    state.peopleById.clear();
    for (const [pid, p] of merged.entries()) {
      state.peopleById.set(pid, {
        ...p,
        role: p.roles.join(" · "),
        sectionLabel: p.sections[0] || "Sin área",
        subarea: p.subareas.join(" · "),
        photo: p.photo || "./assets/avatar.png",
        photoUrl: p.photoUrl || "",
        photoDataUrl: p.photoDataUrl || "",
        dynamic: !!p.dynamic,
      });
    }
    renderMemberDirectory();
  } catch (e) {
    console.warn("No se pudo cargar data.json para index", e);
    state.peopleById.clear();
    renderMemberDirectory();
  }
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
        photoUrl: d.photoUrl || "",
        photoDataUrl: d.photoDataUrl || "",
        _dynamic: true,
        _deleted: d.active === false,
      });
    });
    return people;
  } catch (e) {
    console.warn("No se pudieron cargar miembros dinámicos.", e);
    return [];
  }
}

function resolveAssetPath(path) {
  const val = String(path || "").trim();
  if (!val) return "./assets/avatar.png";
  if (/^data:image\//i.test(val)) return val;
  if (/^https?:\/\//i.test(val)) return val;
  if (val.startsWith("./") || val.startsWith("../")) return val;
  if (val.includes("/")) return `./${val.replace(/^\//, "")}`;
  return `./assets/${val}`;
}

async function saveTeamMember(event) {
  event.preventDefault();
  if (!state.isAdmin) {
    setMemberStatus("Inicia sesión con un correo autorizado.", "error");
    return;
  }

  const name = String(els.memberName?.value || "").trim();
  const role = String(els.memberRole?.value || "").trim();
  const sectionLabel = String(els.memberSection?.value || "").trim();
  const subarea = String(els.memberSubarea?.value || "").trim();
  const photoUrl = String(els.memberPhotoUrl?.value || "").trim();
  const tags = String(els.memberTags?.value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (!name || !role || !sectionLabel) {
    setMemberStatus("Completa nombre, rol y área.", "error");
    return;
  }

  setMemberStatus("Guardando miembro...", "");

  try {
    const file = els.memberPhotoFile?.files?.[0] || null;
    const personId = state.editingPersonId || slug(name);
    const current = state.peopleById.get(personId);
    let finalPhotoUrl = photoUrl || (current?.photoUrl || "");
    if (file) {
      setMemberStatus("Subiendo foto...", "");
      finalPhotoUrl = await uploadTeamPhoto(file, personId);
    }

    await setDoc(doc(db, "teamMembers", personId), {
      personId,
      name,
      role,
      section: slug(sectionLabel) || "equipo",
      sectionLabel,
      subarea,
      tags,
      photoUrl: finalPhotoUrl,
      photoDataUrl: "",
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: state.user?.email || "",
      updatedBy: state.user?.email || "",
    });

    const wasEditing = !!state.editingPersonId;
    clearMemberForm();
    setMemberStatus(wasEditing ? "Miembro actualizado." : "Miembro agregado. Ya aparecerá en la pantalla pública.", "success");
    await loadPeopleIndex();
    renderAllFromCache();
  } catch (e) {
    console.error(e);
    const msg = isPermissionError(e)
      ? "No se pudo guardar por permisos. Publica las reglas nuevas de Firestore."
      : "No se pudo guardar. Revisa la consola.";
    setMemberStatus(msg, "error");
  }
}

async function previewMemberPhoto() {
  const file = els.memberPhotoFile?.files?.[0] || null;
  if (!file || !els.memberPreview) return;
  try {
    els.memberPreview.src = await imageFileToDataUrl(file);
  } catch (e) {
    console.warn(e);
    setMemberStatus("La foto no se pudo leer. Usa JPG, PNG o WEBP.", "error");
  }
}

function previewMemberPhotoUrl() {
  const url = String(els.memberPhotoUrl?.value || "").trim();
  if (url && els.memberPreview && !els.memberPhotoFile?.files?.length) {
    els.memberPreview.src = url;
  }
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      reject(new Error("Formato no soportado"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer la imagen"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("No se pudo procesar la imagen"));
      img.onload = () => {
        const max = 720;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

async function uploadTeamPhoto(file, personId) {
  const blob = await imageFileToJpegBlob(file);
  const stamp = Date.now();
  const cleanPersonId = slug(personId) || "persona";
  const photoRef = ref(storage, `teamMembers/${cleanPersonId}/foto-${stamp}.jpg`);
  await uploadBytes(photoRef, blob, {
    contentType: "image/jpeg",
    customMetadata: {
      uploadedBy: state.user?.email || "",
    },
  });
  return getDownloadURL(photoRef);
}

function imageFileToJpegBlob(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      reject(new Error("Formato no soportado"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer la imagen"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("No se pudo procesar la imagen"));
      img.onload = () => {
        const max = 900;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("No se pudo comprimir la imagen"));
            return;
          }
          resolve(blob);
        }, "image/jpeg", 0.84);
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function handleMemberDirectoryClick(event) {
  const deleteBtn = event.target.closest?.("[data-delete-person]");
  if (deleteBtn) {
    deleteTeamMember(deleteBtn.getAttribute("data-delete-person") || "");
    return;
  }

  const btn = event.target.closest?.("[data-edit-person]");
  if (!btn) return;
  const personId = btn.getAttribute("data-edit-person") || "";
  const person = state.peopleById.get(personId);
  if (!person) return;

  state.editingPersonId = personId;
  if (els.memberName) els.memberName.value = person.name || "";
  if (els.memberRole) els.memberRole.value = (person.roles || []).join(", ") || person.role || "";
  if (els.memberSection) els.memberSection.value = person.sectionLabel || "";
  if (els.memberSubarea) els.memberSubarea.value = person.subarea || "";
  if (els.memberTags) els.memberTags.value = (person.tags || []).join(", ");
  if (els.memberPhotoUrl) els.memberPhotoUrl.value = person.photoUrl || "";
  if (els.memberPhotoFile) els.memberPhotoFile.value = "";
  if (els.memberPreview) els.memberPreview.src = person.photo || "./assets/avatar.png";
  if (els.memberSubmit) els.memberSubmit.textContent = "Guardar cambios";
  if (els.memberCancelEdit) els.memberCancelEdit.hidden = false;
  setMemberStatus(`Editando ${person.name}.`, "");
  els.memberName?.focus?.();
}

async function deleteTeamMember(personId) {
  const person = state.peopleById.get(personId);
  if (!person) return;

  const ok = window.confirm(`¿Eliminar a ${person.name} del directorio de calificaciones?`);
  if (!ok) return;

  setMemberStatus(`Eliminando ${person.name}...`, "");

  try {
    await setDoc(doc(db, "teamMembers", personId), {
      personId,
      name: person.name || personId,
      role: person.role || "Equipo",
      section: slug(person.sectionLabel || "equipo") || "equipo",
      sectionLabel: person.sectionLabel || "Equipo",
      subarea: person.subarea || "",
      tags: Array.isArray(person.tags) ? person.tags : [],
      photoUrl: person.photoUrl || "",
      photoDataUrl: "",
      active: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: state.user?.email || "",
      updatedBy: state.user?.email || "",
    });

    if (state.editingPersonId === personId) clearMemberForm();
    setMemberStatus(`${person.name} fue eliminado del directorio.`, "success");
    await loadPeopleIndex();
    renderAllFromCache();
  } catch (e) {
    console.error(e);
    const msg = isPermissionError(e)
      ? "No se pudo eliminar por permisos. Revisa Firestore Rules."
      : "No se pudo eliminar. Revisa la consola.";
    setMemberStatus(msg, "error");
  }
}

function clearMemberForm() {
  state.editingPersonId = "";
  els.memberForm?.reset();
  if (els.memberPreview) els.memberPreview.src = "./assets/avatar.png";
  if (els.memberSubmit) els.memberSubmit.textContent = "Agregar miembro";
  if (els.memberCancelEdit) els.memberCancelEdit.hidden = true;
}

function renderMemberDirectory() {
  if (!els.memberDirectory) return;
  const people = Array.from(state.peopleById.values()).sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "es")
  );
  els.memberDirectory.innerHTML = people.slice(0, 80).map((p) => `
    <div class="memberMini">
      <img src="${escapeAttr(p.photo || "./assets/avatar.png")}" alt="" loading="lazy" onerror="this.src='./assets/avatar.png'" />
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <span>${escapeHtml(p.role || p.sectionLabel || p.personId)}</span>
      </div>
      <button class="miniBtn" type="button" data-edit-person="${escapeAttr(p.personId)}">Editar</button>
      <button class="miniBtn" type="button" data-delete-person="${escapeAttr(p.personId)}">Eliminar</button>
    </div>
  `).join("");
}

function setMemberStatus(text, kind) {
  if (!els.memberStatus) return;
  els.memberStatus.textContent = text;
  els.memberStatus.className = "panel__hint " + (kind || "");
}

/* =========================
   Data load
========================= */
async function loadAndRender() {
  if (!state.isAdmin || state.loading) return;

  state.loading = true;
  state.loadedLimit = clampInt(Number(els.loadLimit?.value || 500), 1, 2000);

  setMsg("Cargando datos…");
  setSummary("Consultando Firestore…");

  try {
    const q = query(
      collection(db, "reviews"),
      orderBy("createdAt", "desc"),
      limit(state.loadedLimit)
    );

    const snap = await getDocs(q);
    const rows = [];

    snap.forEach((doc) => {
      const d = doc.data() || {};
      const createdAt = normalizeFirestoreDate(d.createdAt);
      const personId = String(d.personId || "").trim();
      const comment = String(d.comment || "").trim();
      const stars = clampInt(Number(d.stars || 0), 0, 5);

      rows.push({
        id: doc.id,
        createdAt,
        personId,
        stars,
        comment,
        createdAtMs: createdAt ? createdAt.getTime() : 0,
      });
    });

    state.rowsCache = rows;
    renderAllFromCache();
    setMsg("Datos actualizados.", "success");
  } catch (e) {
    console.error(e);

    const msg = isPermissionError(e)
      ? "Sin permisos para leer. Revisa Firestore Rules, admins autorizados y el dominio autorizado en Auth. Sí, Firebase también tiene sus humillaciones rituales."
      : "No se pudo cargar. Intenta recargar o revisa la consola.";

    hideAdminData();
    renderEmptyAll("No se pudieron cargar datos.");
    setSummary("No se pudieron cargar datos.");
    setMsg(msg, "error");
  } finally {
    state.loading = false;
  }
}

function normalizeFirestoreDate(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* =========================
   Render
========================= */
function renderAllFromCache() {
  if (!state.isAdmin) return;

  const filteredRows = applyRecordFilters(state.rowsCache);
  const ranking = buildRanking(filteredRows);
  const visibleRanking = applyRankingFiltersAndSort(ranking);
  const stats = computeStats(filteredRows, visibleRanking);

  showAdminData();
  renderKpis(stats);
  renderAutoSummary(stats, visibleRanking, filteredRows);
  renderDataIntegrity(filteredRows);
  renderStarsDistribution(filteredRows);
  renderDailyTrend(filteredRows);
  renderSectionDistribution(filteredRows);
  renderRanking(visibleRanking);
  renderComments(filteredRows);
  renderRaw(filteredRows);

  setSummary(`Mostrando ${filteredRows.length} de ${state.rowsCache.length} registros cargados (límite: ${state.loadedLimit}). Ranking: ${visibleRanking.length} personas.`);
}

function applyRecordFilters(rows) {
  const q = normalizeText(els.filterPerson?.value || "");
  const commentQuery = normalizeText(els.commentSearch?.value || "");
  const days = Number(els.rangeDays?.value || 0);
  const starFilter = String(els.filterStars?.value || "all");
  const commentFilter = String(els.filterComments?.value || "all");

  const now = Date.now();
  const minDateByDays = days > 0 ? new Date(now - days * MS_DAY) : null;
  const from = parseDateInput(els.dateFrom?.value, "start");
  const to = parseDateInput(els.dateTo?.value, "end");

  return (rows || []).filter((r) => {
    if (minDateByDays && r.createdAt && r.createdAt < minDateByDays) return false;
    if (from && r.createdAt && r.createdAt < from) return false;
    if (to && r.createdAt && r.createdAt > to) return false;
    if ((minDateByDays || from || to) && !r.createdAt) return false;

    if (starFilter !== "all") {
      if (starFilter === "low" && !(r.stars <= 3 && r.stars > 0)) return false;
      else if (starFilter === "attention" && !(r.stars < 5 && r.stars > 0)) return false;
      else if (!["low", "attention"].includes(starFilter) && r.stars !== Number(starFilter)) return false;
    }

    const hasComment = Boolean(String(r.comment || "").trim());
    if (commentFilter === "with" && !hasComment) return false;
    if (commentFilter === "without" && hasComment) return false;

    if (commentQuery && !normalizeText(r.comment || "").includes(commentQuery)) return false;

    if (!q) return true;
    const person = getPersonInfo(r.personId);
    const haystack = normalizeText([
      r.personId,
      person.name,
      person.role,
      person.sectionLabel,
      person.subarea,
      ...(person.tags || [])
    ].join(" "));
    return haystack.includes(q);
  });
}

function buildRanking(rows) {
  const map = new Map();

  for (const r of (rows || [])) {
    const pid = String(r.personId || "").trim() || "sin-personId";
    const cur = map.get(pid) || {
      personId: pid,
      count: 0,
      sum: 0,
      comments: 0,
      notPerfect: 0,
      critical: 0,
      last: null,
      rows: [],
    };

    cur.count += 1;
    cur.sum += Number(r.stars || 0);
    if (String(r.comment || "").trim()) cur.comments += 1;
    if (r.stars > 0 && r.stars < 5) cur.notPerfect += 1;
    if (r.stars > 0 && r.stars <= 3) cur.critical += 1;
    if (r.createdAt && (!cur.last || r.createdAt > cur.last)) cur.last = r.createdAt;
    cur.rows.push(r);
    map.set(pid, cur);
  }

  return Array.from(map.values()).map((item) => {
    const avg = item.count ? item.sum / item.count : 0;
    const sorted = [...item.rows].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    const recentAvg = average(sorted.slice(0, 3).map((r) => r.stars).filter(Boolean));
    const previousAvg = average(sorted.slice(3, 6).map((r) => r.stars).filter(Boolean));
    const delta = recentAvg !== null && previousAvg !== null ? recentAvg - previousAvg : null;
    const status = getStatus({ avg, count: item.count, critical: item.critical, notPerfect: item.notPerfect });

    return {
      ...item,
      avg,
      recentAvg,
      previousAvg,
      delta,
      status,
      info: getPersonInfo(item.personId),
    };
  });
}

function applyRankingFiltersAndSort(ranking) {
  const minReviews = Math.max(0, Number(els.minReviews?.value || 0));
  const sortMode = String(els.sortRanking?.value || "avg-desc");

  const filtered = ranking.filter((r) => !minReviews || r.count >= minReviews);

  const statusPriority = { bad: 3, warn: 2, neutral: 1, good: 0 };

  filtered.sort((a, b) => {
    if (sortMode === "avg-asc") return (a.avg - b.avg) || (b.count - a.count);
    if (sortMode === "count-desc") return (b.count - a.count) || (b.avg - a.avg);
    if (sortMode === "latest-desc") return ((b.last?.getTime?.() || 0) - (a.last?.getTime?.() || 0)) || (b.avg - a.avg);
    if (sortMode === "attention") {
      return (statusPriority[b.status.kind] - statusPriority[a.status.kind])
        || (b.critical - a.critical)
        || (b.notPerfect - a.notPerfect)
        || (a.avg - b.avg)
        || (b.count - a.count);
    }
    return (b.avg - a.avg) || (b.count - a.count) || String(a.info.name).localeCompare(String(b.info.name), "es");
  });

  return filtered;
}

function computeStats(rows, ranking) {
  const total = rows.length;
  const sum = rows.reduce((acc, r) => acc + Number(r.stars || 0), 0);
  const avg = total ? sum / total : 0;
  const withComment = rows.filter((r) => String(r.comment || "").trim()).length;
  const notPerfect = rows.filter((r) => r.stars > 0 && r.stars < 5).length;
  const critical = rows.filter((r) => r.stars > 0 && r.stars <= 3).length;
  const recent7 = rows.filter((r) => r.createdAt && (Date.now() - r.createdAt.getTime()) <= 7 * MS_DAY).length;
  const last = rows.reduce((max, r) => r.createdAt && (!max || r.createdAt > max) ? r.createdAt : max, null);
  const topPerson = ranking[0] || null;
  const attention = ranking.filter((r) => ["bad", "warn"].includes(r.status.kind));

  return {
    total,
    avg,
    people: ranking.length,
    withComment,
    commentPct: total ? Math.round((withComment / total) * 100) : 0,
    notPerfect,
    critical,
    recent7,
    last,
    topPerson,
    attention,
  };
}

function renderKpis(stats) {
  if (!els.kpisWrap) return;
  els.kpisWrap.style.display = "grid";

  setText(els.kpiTotal, stats.total);
  setText(els.kpiAvg, stats.total ? stats.avg.toFixed(2) : "0.00");
  setText(els.kpiPeople, stats.people);
  setText(els.kpiWithComment, `${stats.commentPct}%`);
  setText(els.kpiRecent, stats.recent7);
  setText(els.kpiNotPerfect, stats.notPerfect);
  setText(els.kpiCritical, stats.critical);
  setText(els.kpiLast, stats.last ? fmtDateShort(stats.last) : "—");

  paintKpiState(els.kpiAvg?.closest(".kpi"), stats.avg >= 4.7 ? "good" : stats.avg >= 4.2 ? "warn" : "bad");
  paintKpiState(els.kpiNotPerfect?.closest(".kpi"), stats.notPerfect === 0 ? "good" : "warn");
  paintKpiState(els.kpiCritical?.closest(".kpi"), stats.critical === 0 ? "good" : "bad");
}

function renderAutoSummary(stats, ranking, rows) {
  if (!els.autoSummary) return;

  const items = [];
  if (!stats.total) {
    items.push("No hay registros con los filtros actuales. Una estadística muy limpia, porque no existe. 🫥");
  } else {
    items.push(`El promedio general filtrado está en ${stats.avg.toFixed(2)} sobre 5 con ${stats.total} evaluaciones.`);
    items.push(`${stats.commentPct}% de las evaluaciones tiene comentario. Esto ayuda a leer el porqué, no solo el numerito decorativo.`);

    if (stats.topPerson) {
      items.push(`La persona mejor posicionada en esta vista es ${stats.topPerson.info.name}, con promedio ${stats.topPerson.avg.toFixed(2)} y ${stats.topPerson.count} evaluación(es).`);
    }

    if (stats.critical > 0) {
      items.push(`Hay ${stats.critical} evaluación(es) de 3 estrellas o menos. Conviene revisar comentarios y contexto antes de sacar la guillotina institucional.`);
    } else if (stats.notPerfect > 0) {
      items.push(`No aparecen alertas críticas, pero sí ${stats.notPerfect} evaluación(es) por debajo de 5. Buena zona para mejora fina.`);
    } else {
      items.push("Todas las evaluaciones filtradas son de 5 estrellas. Bonito, aunque sospechosamente perfecto como comercial de yogur.");
    }

    const recentComment = rows.find((r) => String(r.comment || "").trim());
    if (recentComment) {
      items.push(`Último comentario visible: ${getPersonInfo(recentComment.personId).name}, ${fmtDate(recentComment.createdAt)}.`);
    }
  }

  els.autoSummary.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderDataIntegrity(rows) {
  if (!els.dataIntegrity) return;

  const unknownIds = [...new Set(rows.map((r) => r.personId).filter((pid) => pid && !state.peopleById.has(pid)))];
  const missingPersonId = rows.filter((r) => !String(r.personId || "").trim()).length;
  const missingDate = rows.filter((r) => !r.createdAt).length;
  const zeroStars = rows.filter((r) => !r.stars).length;

  const badges = [];
  badges.push(statusBadge("Directorio", unknownIds.length ? "warn" : "good", unknownIds.length ? `${unknownIds.length} personId sin data.json` : "Todo conectado"));
  badges.push(statusBadge("Fechas", missingDate ? "warn" : "good", missingDate ? `${missingDate} sin fecha` : "OK"));
  badges.push(statusBadge("personId", missingPersonId ? "bad" : "good", missingPersonId ? `${missingPersonId} vacío(s)` : "OK"));
  badges.push(statusBadge("Estrellas", zeroStars ? "warn" : "good", zeroStars ? `${zeroStars} sin valor` : "OK"));

  if (unknownIds.length) {
    badges.push(`<div class="panel__hint">No están en data.json: <code>${escapeHtml(unknownIds.slice(0, 8).join(", "))}${unknownIds.length > 8 ? "…" : ""}</code></div>`);
  }

  els.dataIntegrity.innerHTML = badges.join("");
}

function renderStarsDistribution(rows) {
  if (!els.starsDistribution) return;

  const counts = new Map([[5,0],[4,0],[3,0],[2,0],[1,0]]);
  for (const r of rows) {
    if (counts.has(r.stars)) counts.set(r.stars, counts.get(r.stars) + 1);
  }
  const max = Math.max(1, ...counts.values());

  els.starsDistribution.innerHTML = [5,4,3,2,1].map((star) => {
    const count = counts.get(star) || 0;
    const pct = Math.round((count / max) * 100);
    return `
      <div class="barRow">
        <span>${escapeHtml(starsLabel(star))}</span>
        <span class="barTrack"><span class="barFill" style="width:${pct}%"></span></span>
        <span>${count}</span>
      </div>
    `;
  }).join("");
}

function renderDailyTrend(rows) {
  if (!els.dailyTrend) return;

  const byDay = new Map();
  for (const r of rows) {
    if (!r.createdAt) continue;
    const key = dateKey(r.createdAt);
    const cur = byDay.get(key) || { count: 0, sum: 0, date: stripTime(r.createdAt) };
    cur.count += 1;
    cur.sum += Number(r.stars || 0);
    byDay.set(key, cur);
  }

  const days = Array.from(byDay.values()).sort((a, b) => a.date - b.date).slice(-14);
  if (!days.length) {
    els.dailyTrend.innerHTML = `<div class="commentEmpty">No hay fechas para graficar.</div>`;
    return;
  }

  const max = Math.max(1, ...days.map((d) => d.count));
  els.dailyTrend.innerHTML = days.map((d) => {
    const h = Math.max(8, Math.round((d.count / max) * 132));
    const avg = d.count ? d.sum / d.count : 0;
    return `
      <div class="trendCol" title="${escapeHtml(fmtDateOnly(d.date))}: ${d.count} evaluación(es), promedio ${avg.toFixed(2)}">
        <span class="trendValue">${d.count}</span>
        <span class="trendBar" style="height:${h}px"></span>
        <span class="trendLabel">${escapeHtml(dayShort(d.date))}</span>
      </div>
    `;
  }).join("");
}

function renderSectionDistribution(rows) {
  if (!els.sectionDistribution) return;

  const counts = new Map();
  for (const r of rows) {
    const info = getPersonInfo(r.personId);
    const section = info.sectionLabel || "Sin área";
    counts.set(section, (counts.get(section) || 0) + 1);
  }

  const arr = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...arr.map(([, count]) => count));

  if (!arr.length) {
    els.sectionDistribution.innerHTML = `<div class="commentEmpty">No hay áreas para graficar.</div>`;
    return;
  }

  els.sectionDistribution.innerHTML = arr.map(([section, count]) => {
    const pct = Math.round((count / max) * 100);
    return `
      <div class="barRow">
        <span title="${escapeHtml(section)}">${escapeHtml(shorten(section, 16))}</span>
        <span class="barTrack"><span class="barFill" style="width:${pct}%"></span></span>
        <span>${count}</span>
      </div>
    `;
  }).join("");
}

function renderRanking(ranking) {
  if (!els.tbodyAgg) return;

  if (!ranking.length) {
    els.tbodyAgg.innerHTML = emptyRow(8, "No hay personas para mostrar con estos filtros.");
    return;
  }

  els.tbodyAgg.innerHTML = ranking.map((a) => {
    const info = a.info;
    const status = a.status;
    return `
      <tr>
        <td>
          <div class="personCell">
            <img class="personThumb" src="${escapeAttr(info.photo)}" alt="" loading="lazy" onerror="this.style.display='none'" />
            <div>
              <div class="personName">${escapeHtml(info.name)}</div>
              <div class="personRole">${escapeHtml(info.role || info.sectionLabel || a.personId)}</div>
              <div class="panel__hint"><code>${escapeHtml(a.personId)}</code></div>
            </div>
          </div>
        </td>
        <td><span class="scoreBig">${escapeHtml(a.avg.toFixed(2))}</span></td>
        <td>${escapeHtml(String(a.count))}</td>
        <td>${escapeHtml(String(a.comments))}</td>
        <td>${escapeHtml(String(a.notPerfect))}</td>
        <td>${escapeHtml(fmtDate(a.last))}</td>
        <td>${trendMarkup(a.delta)}</td>
        <td>${statusBadge("", status.kind, status.label)}</td>
      </tr>
    `;
  }).join("");
}

function renderComments(rows) {
  if (!els.commentsList) return;

  const withText = (rows || [])
    .filter((r) => String(r.comment || "").trim().length > 0)
    .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
    .slice(0, 80);

  if (!withText.length) {
    els.commentsList.innerHTML = `<div class="commentEmpty">No hay comentarios en este filtro.</div>`;
    return;
  }

  els.commentsList.innerHTML = withText.map((r) => {
    const info = getPersonInfo(r.personId);
    return `
      <article class="commentCard">
        <div class="commentTop">
          <div>
            <div class="commentName">${escapeHtml(info.name)}</div>
            <div class="commentDate">${escapeHtml(fmtDate(r.createdAt))}</div>
          </div>
          <span class="starsTxt">${escapeHtml(starsText(r.stars))}</span>
        </div>
        <p class="commentText">${escapeHtml(r.comment)}</p>
      </article>
    `;
  }).join("");
}

function renderRaw(rows) {
  if (!els.tbody) return;

  if (!rows || rows.length === 0) {
    els.tbody.innerHTML = emptyRow(5, "No hay registros para mostrar.");
    return;
  }

  const sorted = [...rows].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  els.tbody.innerHTML = sorted.map((r) => {
    const info = getPersonInfo(r.personId);
    return `
      <tr>
        <td>${escapeHtml(fmtDate(r.createdAt))}</td>
        <td>${escapeHtml(info.name)}</td>
        <td><code>${escapeHtml(r.personId)}</code></td>
        <td class="starsTxt">${escapeHtml(starsText(r.stars))}</td>
        <td>${escapeHtml(r.comment || "")}</td>
      </tr>
    `;
  }).join("");
}

function renderEmptyAll(text) {
  if (els.tbodyAgg) els.tbodyAgg.innerHTML = emptyRow(8, text);
  if (els.commentsList) els.commentsList.innerHTML = `<div class="commentEmpty">${escapeHtml(text)}</div>`;
  if (els.tbody) els.tbody.innerHTML = emptyRow(5, text);
  if (els.autoSummary) els.autoSummary.innerHTML = `<li>${escapeHtml(text)}</li>`;
  if (els.dataIntegrity) els.dataIntegrity.innerHTML = "";
  if (els.starsDistribution) els.starsDistribution.innerHTML = "";
  if (els.dailyTrend) els.dailyTrend.innerHTML = "";
  if (els.sectionDistribution) els.sectionDistribution.innerHTML = "";
}

function hideAdminData() {
  if (els.kpisWrap) els.kpisWrap.style.display = "none";
  if (els.insightBox) els.insightBox.hidden = true;
  if (els.chartsGrid) els.chartsGrid.hidden = true;
}

function showAdminData() {
  if (els.kpisWrap) els.kpisWrap.style.display = "grid";
  if (els.insightBox) els.insightBox.hidden = false;
  if (els.chartsGrid) els.chartsGrid.hidden = false;
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
function exportRecordsCSV() {
  if (!state.isAdmin) return;
  const rows = applyRecordFilters(state.rowsCache);
  const header = ["fecha", "persona", "rol", "area", "personId", "stars", "comment"];
  const lines = [header.map(csvCell).join(",")];

  for (const r of rows) {
    const info = getPersonInfo(r.personId);
    lines.push([
      fmtDateISO(r.createdAt),
      info.name,
      info.role,
      info.sectionLabel,
      r.personId,
      String(r.stars || 0),
      String(r.comment || ""),
    ].map(csvCell).join(","));
  }

  downloadCSV(lines, `musicala_calificaciones_registros_${todayKey()}.csv`);
}

function exportRankingCSV() {
  if (!state.isAdmin) return;
  const rows = applyRecordFilters(state.rowsCache);
  const ranking = applyRankingFiltersAndSort(buildRanking(rows));
  const header = ["persona", "rol", "area", "personId", "promedio", "cantidad", "comentarios", "menos_de_5", "criticas", "ultima", "estado", "tendencia"];
  const lines = [header.map(csvCell).join(",")];

  for (const r of ranking) {
    lines.push([
      r.info.name,
      r.info.role,
      r.info.sectionLabel,
      r.personId,
      r.avg.toFixed(2),
      String(r.count),
      String(r.comments),
      String(r.notPerfect),
      String(r.critical),
      fmtDateISO(r.last),
      r.status.label,
      r.delta === null ? "Sin dato" : r.delta.toFixed(2),
    ].map(csvCell).join(","));
  }

  downloadCSV(lines, `musicala_calificaciones_ranking_${todayKey()}.csv`);
}

function downloadCSV(lines, filename) {
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* =========================
   Helpers
========================= */
function getPersonInfo(personId) {
  const pid = String(personId || "").trim();
  const found = state.peopleById.get(pid);
  if (found) return found;
  return {
    personId: pid,
    name: pid || "Sin personId",
    role: "No está en data.json",
    sectionLabel: "Sin área",
    subarea: "",
    tags: [],
    photo: "./assets/avatar.png",
  };
}

function getStatus({ avg, count, critical, notPerfect }) {
  if (critical > 0) return { kind: "bad", label: "Atención" };
  if (count < 3) return { kind: "neutral", label: "Pocos datos" };
  if (avg >= 4.8 && notPerfect === 0) return { kind: "good", label: "Muy bien" };
  if (avg >= 4.4) return { kind: "warn", label: "Revisar" };
  return { kind: "bad", label: "Atención" };
}

function statusBadge(prefix, kind, label) {
  const safeKind = ["good", "warn", "bad"].includes(kind) ? kind : "";
  const text = prefix ? `${prefix}: ${label}` : label;
  return `<span class="badgeMini ${safeKind}">${escapeHtml(text)}</span>`;
}

function trendMarkup(delta) {
  if (delta === null || Number.isNaN(delta)) return `<span class="deltaFlat">Sin dato</span>`;
  if (Math.abs(delta) < 0.05) return `<span class="deltaFlat">≈ Igual</span>`;
  if (delta > 0) return `<span class="deltaUp">↗ +${escapeHtml(delta.toFixed(2))}</span>`;
  return `<span class="deltaDown">↘ ${escapeHtml(delta.toFixed(2))}</span>`;
}

function paintKpiState(el, kind) {
  if (!el) return;
  el.classList.remove("good", "warn", "bad");
  if (["good", "warn", "bad"].includes(kind)) el.classList.add(kind);
}

function setText(el, text) {
  if (el) el.textContent = String(text);
}

function setMsg(text, kind) {
  if (!els.msg) return;
  els.msg.textContent = text || "";
  els.msg.className = "adminMsg " + (kind || "");
}

function setSummary(text) {
  if (els.summary) els.summary.textContent = String(text || "");
}

function average(values) {
  const valid = values.filter((n) => Number.isFinite(Number(n)) && Number(n) > 0);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + Number(b), 0) / valid.length;
}

function parseDateInput(value, mode) {
  if (!value) return null;
  const d = new Date(`${value}T${mode === "end" ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  if (!d) return "";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(d);
}

function fmtDateShort(d) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short" }).format(d).replace(".", "");
}

function fmtDateOnly(d) {
  if (!d) return "";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(d);
}

function fmtDateISO(d) {
  if (!d) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dateKey(d) {
  const x = stripTime(d);
  const pad = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`;
}

function todayKey() {
  return dateKey(new Date());
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayShort(d) {
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short" }).format(d).replace(".", "");
}

function starsText(n) {
  const v = clampInt(Number(n || 0), 0, 5);
  if (!v) return "";
  return `${v} ${"★".repeat(v)}${"☆".repeat(5 - v)}`;
}

function starsLabel(n) {
  return `${n} ${"★".repeat(n)}`;
}

function shorten(text, max = 18) {
  const s = String(text || "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function clampInt(n, a, b) {
  const x = Number.isFinite(n) ? Math.round(n) : a;
  return Math.max(a, Math.min(b, x));
}

function pushUnique(arr, value) {
  const v = String(value || "").trim();
  if (!v) return;
  const key = v.toLowerCase();
  if (!arr.some((x) => String(x).toLowerCase() === key)) arr.push(v);
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
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
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("`", "&#096;");
}

function csvCell(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}
