import { initializeApp } from 'firebase/app';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBm-kH9VtyQ13TmfggSaf02OC9tvx-7qsk",
  authDomain: "chat-app-f758e.firebaseapp.com",
  projectId: "chat-app-f758e",
  storageBucket: "chat-app-f758e.firebasestorage.app",
  messagingSenderId: "986298238629",
  appId: "1:986298238629:web:99b4605ab4ca92ffd5ef4c",
  measurementId: "G-YK9QR7RERG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);

// Initialize Firestore
const db = getFirestore(app);

// Enable offline persistence
enableIndexedDbPersistence(db)
  .catch((err) => {
    if (err.code === 'failed-precondition') {
      // Multiple tabs open, persistence can only be enabled in one tab at a time
      console.warn('Multiple tabs open, persistence disabled');
    } else if (err.code === 'unimplemented') {
      // The current browser doesn't support persistence
      console.warn('Browser does not support persistence');
    }
  });

export { db };

// Initialize Google Auth Provider
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('profile');
googleProvider.addScope('email');
googleProvider.setCustomParameters({
  prompt: 'select_account'
});