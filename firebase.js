'use strict';

/**
 * firebase.js (ESM para GitHub Pages)
 * - Inicializa Firebase una sola vez
 * - Exporta db/auth/provider para rate.js y admin.js
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyB9C2qvB4ap4MV2VkifOHUY_mj1RW2ZtfQ",
  authDomain: "calificacion-equipo-musicala.firebaseapp.com",
  projectId: "calificacion-equipo-musicala",
  storageBucket: "calificacion-equipo-musicala.firebasestorage.app",
  messagingSenderId: "636509932421",
  appId: "1:636509932421:web:553db6049d8d07e74e92ec",
};

// Init (evita doble init)
export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Firestore
export const db = getFirestore(app);

// Storage
export const storage = getStorage(app);

// Auth (solo lo usa admin.html, pero no estorba exportarlo siempre)
export const auth = getAuth(app);
auth.useDeviceLanguage(); // ayuda a que el popup salga en el idioma del dispositivo

// Google provider
export const provider = new GoogleAuthProvider();
// Si algún día quieres forzar cuenta cada vez, descomenta:
// provider.setCustomParameters({ prompt: "select_account" });

// Utilidad mínima para debugging
export const projectId = firebaseConfig.projectId;
export const isFirebaseReady = () => !!app && !!db && !!auth && !!storage;
