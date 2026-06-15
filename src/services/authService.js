import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { auth, googleProvider } from "../firebase.js";

// Correos autorizados para operar la app. Debe coincidir con firestore.rules.
export const ALLOWED_EMAILS = [
  "alekcaballeromusic@gmail.com",
  "catalina.medina.leal@gmail.com",
  "imusicala@gmail.com",
  "musicalaasesor@gmail.com",
];

let authReadyResolve;
const authReady = new Promise((resolve) => {
  authReadyResolve = resolve;
});

// Resuelve una sola vez cuando Firebase confirma el estado inicial de sesion.
onAuthStateChanged(auth, (user) => {
  if (authReadyResolve) {
    authReadyResolve(user);
    authReadyResolve = null;
  }
});

// Espera a que Firebase resuelva la sesion antes de leer/escribir Firestore.
export function waitForAuthReady() {
  return authReady;
}

export function isAuthorizedUser(user = auth.currentUser) {
  const email = String(user?.email || "").toLowerCase();
  return !!email && ALLOWED_EMAILS.includes(email);
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export function signOutUser() {
  return signOut(auth);
}

export function currentUser() {
  return auth.currentUser;
}

export function authUserPayload(user = auth.currentUser) {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
  };
}
