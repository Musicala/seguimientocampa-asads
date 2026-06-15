import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyC-EzXAs_7UY2XX2R0RuLamEC1hxAsH2W0",
  authDomain: "marketing-musicala.firebaseapp.com",
  projectId: "marketing-musicala",
  storageBucket: "marketing-musicala.firebasestorage.app",
  messagingSenderId: "794855454178",
  appId: "1:794855454178:web:b8dacfa32e83c8d895f5bb",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
