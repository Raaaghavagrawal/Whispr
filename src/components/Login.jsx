import React, { useEffect, useState } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { doc, setDoc, getDoc, collection, query, where, getDocs, runTransaction } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useNavigate } from 'react-router-dom';

const Login = () => {
  const [error, setError] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const navigate = useNavigate();

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check if user is already logged in
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        navigate('/chat');
      }
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, [navigate]);

  const generateShortId = async () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const length = 6;
    let shortId;
    let isUnique = false;

    while (!isUnique) {
      shortId = '';
      for (let i = 0; i < length; i++) {
        shortId += characters.charAt(Math.floor(Math.random() * characters.length));
      }

      // Check if this ID is already in use
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('shortId', '==', shortId));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        isUnique = true;
      }
    }

    return shortId;
  };

  const setupUser = async (user) => {
    try {
      // Use user's UID as the document ID
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        // User exists - update auth details but keep the same shortId
        const existingData = userDoc.data();
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          lastSeen: new Date().toISOString(),
          online: true,
          shortId: existingData.shortId // Keep existing shortId
        }, { merge: true });
        console.log('Updated existing user, kept shortId:', existingData.shortId);
      } else {
        // First time user - create new document with new shortId
        const shortId = await generateShortId();
        const userData = {
          uid: user.uid,
          email: user.email,
          shortId: shortId,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          online: true,
          connections: {}
        };

        // Use UID as document ID
        await setDoc(userRef, userData);
        console.log('Created new user with shortId:', shortId);
      }

      // Navigate to chat after successful setup
      navigate('/chat');
    } catch (error) {
      console.error('Error setting up user:', error);
      let errorMessage = 'Failed to set up user profile. Please try again.';
      
      if (error.code === 'permission-denied') {
        errorMessage = 'You do not have permission to access this feature.';
      } else if (error.code === 'unavailable') {
        errorMessage = 'The service is currently unavailable. Please try again later.';
      }
      
      setError(errorMessage);
      throw error;
    }
  };

  const handleLogin = async () => {
    if (!isOnline) {
      setError('You are offline. Please check your internet connection.');
      return;
    }

    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      await setupUser(result.user);
    } catch (error) {
      console.error('Login error:', error);
      let errorMessage = 'Failed to sign in. Please try again.';

      if (error.code === 'auth/popup-closed-by-user') {
        errorMessage = 'Sign-in was cancelled. Please try again.';
      } else if (error.code === 'auth/popup-blocked') {
        errorMessage = 'Sign-in popup was blocked. Please allow popups for this site.';
      } else if (error.code === 'auth/cancelled-popup-request') {
        errorMessage = 'Multiple sign-in attempts detected. Please try again.';
      }

      setError(errorMessage);
    }
  };

  return (
    <div className="login-container">
      <div className="login-content">
        <div className="whispr-logo">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42l10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701l-.321 4.843c.47 0 .677-.216.94-.47l2.26-2.2l4.709 3.477c.867.48 1.49.233 1.71-.804l3.082-14.503c.314-1.262-.485-1.835-1.558-1.31z" fill="currentColor"/>
          </svg>
        </div>
        <h1>Welcome to Whispr</h1>
        <p>Sign in with Google to start chatting</p>
        <button 
          className="google-signin-button"
          onClick={handleLogin}
          disabled={!isOnline}
        >
          <img src="https://www.google.com/favicon.ico" alt="Google" />
          Continue with Google
        </button>
        {error && (
          <div className="error-message">
            <p>{error}</p>
            <button onClick={() => setError('')}>Dismiss</button>
          </div>
        )}
        {!isOnline && (
          <div className="offline-message">
            You are currently offline
          </div>
        )}
      </div>
    </div>
  );
};

export default Login; 
