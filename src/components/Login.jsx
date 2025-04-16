import React, { useEffect, useState } from 'react';
import { signInWithPopup, GoogleAuthProvider, TwitterAuthProvider, GithubAuthProvider, signInAnonymously } from 'firebase/auth';
import { doc, setDoc, getDoc, collection, query, where, getDocs, runTransaction } from 'firebase/firestore';
import { auth, db, googleProvider, twitterProvider, githubProvider } from '../firebase';
import { useNavigate } from 'react-router-dom';

const Login = () => {
  const [error, setError] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isProcessingAuth, setIsProcessingAuth] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Set dark theme by default
    const theme = localStorage.getItem('theme') || 'dark';
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check if user is already logged in
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      console.log('Auth state changed:', user ? 'User logged in' : 'No user');
      if (user && !isProcessingAuth) {
        try {
          const userRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userRef);
          
          if (userDoc.exists()) {
            console.log('User document exists, navigating to chat...');
            navigate('/chat', { replace: true });
          } else {
            console.log('User document does not exist, waiting for setup...');
          }
        } catch (error) {
          console.error('Error checking user document:', error);
        }
      }
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, [navigate, isProcessingAuth]);

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
      setIsProcessingAuth(true);
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        // User exists - update auth details but keep the same shortId
        const existingData = userDoc.data();
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || 'User',
          photoURL: user.photoURL,
          lastSeen: new Date().toISOString(),
          online: true,
          shortId: existingData.shortId
        }, { merge: true });
        console.log('Updated existing user:', user.uid);
      } else {
        // First time user - create new document with new shortId
        const shortId = await generateShortId();
        const timestamp = new Date().toISOString();
        const userData = {
          uid: user.uid,
          email: user.email,
          shortId: shortId,
          displayName: user.displayName || 'User',
          photoURL: user.photoURL,
          createdAt: timestamp,
          lastSeen: timestamp,
          online: true,
          connections: {}
        };

        // Create new user document
        await setDoc(userRef, userData);
        console.log('Created new user:', user.uid);
      }

      console.log('User setup complete, navigating to chat...');
      navigate('/chat', { replace: true });
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
    } finally {
      setIsProcessingAuth(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (!isOnline) {
      setError('You are offline. Please check your internet connection.');
      return;
    }

    try {
      console.log('Starting Google sign-in process...');
      const result = await signInWithPopup(auth, googleProvider);
      console.log('Google sign-in successful, setting up user...');
      await setupUser(result.user);
    } catch (error) {
      console.error('Login error:', error);
      handleAuthError(error);
    }
  };

  const handleTwitterLogin = async () => {
    if (!isOnline) {
      setError('You are offline. Please check your internet connection.');
      return;
    }

    try {
      console.log('Starting Twitter sign-in process...');
      const result = await signInWithPopup(auth, twitterProvider);
      console.log('Twitter sign-in successful, setting up user...');
      await setupUser(result.user);
    } catch (error) {
      console.error('Twitter login error:', error);
      handleAuthError(error);
    }
  };

  const handleGithubLogin = async () => {
    if (!isOnline) {
      setError('You are offline. Please check your internet connection.');
      return;
    }

    try {
      console.log('Starting GitHub sign-in process...');
      const result = await signInWithPopup(auth, githubProvider);
      console.log('GitHub sign-in successful, setting up user...');
      await setupUser(result.user);
    } catch (error) {
      console.error('GitHub login error:', error);
      handleAuthError(error);
    }
  };

  const handleGuestLogin = async () => {
    if (!isOnline) {
      setError('You are offline. Please check your internet connection.');
      return;
    }

    try {
      console.log('Starting Guest sign-in process...');
      setIsProcessingAuth(true);
      
      // Sign in anonymously with Firebase
      const result = await signInAnonymously(auth);
      const guestUser = result.user;
      
      // Generate a random guest name
      const guestName = `Guest${Math.floor(1000 + Math.random() * 9000)}`;
      
      // Create a guest user profile with 5-chat limitation
      const shortId = await generateShortId();
      const timestamp = new Date().toISOString();
      const userData = {
        uid: guestUser.uid,
        email: null,
        shortId: shortId,
        displayName: guestName,
        photoURL: null,
        createdAt: timestamp,
        lastSeen: timestamp,
        online: true,
        isGuest: true,
        maxConnections: 5,
        connections: {},
        // Flag to show the warning on first login
        showGuestWarning: true
      };

      // Save to Firestore
      const userRef = doc(db, 'users', guestUser.uid);
      await setDoc(userRef, userData);
      console.log('Created new guest user:', guestUser.uid);
      
      // Navigate directly to chat
      navigate('/chat', { replace: true });
    } catch (error) {
      console.error('Guest login error:', error);
      handleAuthError(error);
    } finally {
      setIsProcessingAuth(false);
    }
  };

  const handleAuthError = (error) => {
    let errorMessage = 'Failed to sign in. Please try again.';

    if (error.code === 'auth/popup-closed-by-user') {
      errorMessage = 'Sign-in was cancelled. Please try again.';
    } else if (error.code === 'auth/popup-blocked') {
      errorMessage = 'Sign-in popup was blocked. Please allow popups for this site.';
    } else if (error.code === 'auth/cancelled-popup-request') {
      errorMessage = 'Multiple sign-in attempts detected. Please try again.';
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      errorMessage = 'An account already exists with the same email address but different sign-in credentials. Sign in using your original provider.';
    }

    setError(errorMessage);
    setIsProcessingAuth(false);
  };

  return (
    <div className="login-container">
      <div className="login-content">
        <div className="yappin-logo">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42l10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701l-.321 4.843c.47 0 .677-.216.94-.47l2.26-2.2l4.709 3.477c.867.48 1.49.233 1.71-.804l3.082-14.503c.314-1.262-.485-1.835-1.558-1.31z" fill="currentColor"/>
          </svg>
        </div>
        <h1>Welcome to Yappin</h1>
        <p>Sign in to start chatting</p>
        
        <div className="auth-buttons">
          <button 
            className="google-signin-button auth-button"
            onClick={handleGoogleLogin}
            disabled={!isOnline}
          >
            <img src="https://www.google.com/favicon.ico" alt="Google" />
            Continue with Google
          </button>
          
          <button 
            className="google-signin-button auth-button"
            onClick={handleGithubLogin}
            disabled={!isOnline}
          >
            <img src="https://github.com/favicon.ico" alt="GitHub" />
            Continue with GitHub
          </button>
          
          <div className="separator">
            <span>or</span>
          </div>
          
          <button 
            className="google-signin-button auth-button"
            onClick={handleGuestLogin}
            disabled={!isOnline}
          >
            <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xNyAxMWE1IDUgMCAwIDEtMTAgMCI+PC9wYXRoPjxjaXJjbGUgY3g9IjEyIiBjeT0iNyIgcj0iNCIgZmlsbD0iY3VycmVudENvbG9yIiBzdHJva2U9Im5vbmUiPjwvY2lyY2xlPjxwYXRoIGZpbGw9ImN1cnJlbnRDb2xvciIgc3Ryb2tlPSJub25lIiBkPSJNNiAyMXYtMmE0IDQgMCAwIDEgNC00aDRhNCA0IDAgMCAxIDQgNHYyIj48L3BhdGg+PC9zdmc+" alt="Guest" />
            Continue as Guest
          </button>
          <div className="guest-limit-note">Limited to 5 chats</div>
        </div>
        
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

// Add CSS styles for the login component
const styles = document.createElement('style');
styles.textContent = `
  .separator {
    display: flex;
    align-items: center;
    text-align: center;
    margin: 15px 0;
    color: var(--text-muted);
  }
  
  .separator::before,
  .separator::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid var(--border-color);
  }
  
  .separator span {
    padding: 0 10px;
    font-size: 14px;
  }
  
  .guest-limit-note {
    font-size: 12px;
    color: #e53935;
    text-align: center;
    margin-bottom: 20px;
    font-weight: 500;
  }
`;
document.head.appendChild(styles);

export default Login; 
