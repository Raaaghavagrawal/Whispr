import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { collection, addDoc, query, orderBy, onSnapshot, doc, getDoc, setDoc, where, getDocs, deleteDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';

const Chat = () => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [recipientInfo, setRecipientInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userShortId, setUserShortId] = useState('');
  const [recentChats, setRecentChats] = useState([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [isMobileView, setIsMobileView] = useState(window.innerWidth <= 480);
  const [showMessages, setShowMessages] = useState(false);
  const messagesEndRef = useRef(null);
  const messageListenerRef = useRef(null);
  const navigate = useNavigate();
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [activeMenu, setActiveMenu] = useState(null);
  const [notification, setNotification] = useState(null);

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

  useEffect(() => {
    let unsubscribeChats = null;
    
    const unsubscribeAuth = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        navigate('/');
        return;
      }
      
      try {
        // Get user's data
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
          const userData = userDoc.data();
          console.log('User data loaded:', userData); // Debug log
          if (!userData.shortId) {
            // If shortId doesn't exist, generate one
            const shortId = await generateShortId();
            console.log('Generated new shortId:', shortId); // Debug log
            await setDoc(userRef, {
              shortId: shortId,
              displayName: user.displayName || 'User',
              photoURL: user.photoURL,
              lastSeen: new Date().toISOString(),
              online: true
            }, { merge: true });
            setUserShortId(shortId);
          } else {
            console.log('Using existing shortId:', userData.shortId); // Debug log
            setUserShortId(userData.shortId);
          }
          
          // Update online status
          await updateUserStatus(user.uid, true);
          
          // Load recent chats and store the unsubscribe function
          unsubscribeChats = await loadRecentChats(user.uid);
        } else {
          console.error('User document not found');
          setError('Failed to load user data. Please try logging in again.');
          await signOut(auth);
          navigate('/');
        }
      } catch (error) {
        console.error('Error loading user data:', error);
        setError('Failed to load user data. Please try again.');
      } finally {
        setIsLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeChats) {
        unsubscribeChats();
      }
      if (auth.currentUser) {
        updateUserStatus(auth.currentUser.uid, false);
      }
      if (messageListenerRef.current) {
        messageListenerRef.current();
      }
    };
  }, [navigate]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleBeforeUnload = () => {
      if (auth.currentUser) {
        updateUserStatus(auth.currentUser.uid, false);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const updateUserStatus = async (userId, isOnline) => {
    try {
      const userRef = doc(db, 'users', userId);
      await setDoc(userRef, {
        online: isOnline,
        lastSeen: new Date().toISOString(),
      }, { merge: true });
    } catch (error) {
      console.error('Error updating user status:', error);
    }
  };

  const verifyRecipient = async (shortId) => {
    try {
      console.log('Verifying recipient with ID:', shortId);
      const usersRef = collection(db, 'users');
      // Make sure we're querying with the exact format of stored IDs
      const q = query(usersRef, where('shortId', '==', shortId.toUpperCase()));
      const querySnapshot = await getDocs(q);

      console.log('Query results:', querySnapshot.size, 'documents found');
      
      if (!querySnapshot.empty) {
        const recipientDoc = querySnapshot.docs[0];
        const recipientData = recipientDoc.data();
        console.log('Found recipient data:', recipientData);
        
        if (!recipientData.shortId) {
          console.error('Recipient document exists but has no shortId:', recipientDoc.id);
          setError('Invalid user ID. Please try again.');
          return null;
        }
        
        setRecipientInfo({ ...recipientData, uid: recipientDoc.id });
        return recipientDoc.id;
      } else {
        console.log('No user found with ID:', shortId);
        setError(`User ID "${shortId}" not found. Please check the ID and try again.`);
        return null;
      }
    } catch (error) {
      console.error("Error verifying recipient:", error);
      setError("Failed to verify recipient. Please try again.");
      return null;
    }
  };

  const handleRecipientIdChange = (e) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (value.length <= 6) {
      setRecipientId(value);
      setError('');
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const cleaned = pastedText.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setRecipientId(cleaned.slice(0, 6));
    setError('');
  };

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!auth.currentUser) {
      setError("You must be logged in to chat.");
      return;
    }

    const trimmedId = recipientId.trim().toUpperCase();
    if (!trimmedId || trimmedId.length !== 6) {
      setError("Please enter a complete user ID (6 characters)");
      return;
    }

    if (trimmedId === userShortId) {
      setError("You cannot chat with yourself!");
      return;
    }

    setError('');
    setIsConnecting(true);

    try {
      const recipientUid = await verifyRecipient(trimmedId);
      if (!recipientUid) {
        setError("User ID not found! Please check the ID and try again.");
        setIsConnecting(false);
        return;
      }

      // Create or update chat document
      const chatId = [auth.currentUser.uid, recipientUid].sort().join('_');
      await setDoc(doc(db, 'chats', chatId), {
        participants: [auth.currentUser.uid, recipientUid].sort(),
        createdAt: new Date().toISOString(),
        lastMessageTime: new Date().toISOString()
      }, { merge: true });

      // Store the connection in user's connections collection
      const userConnectionsRef = doc(db, 'users', auth.currentUser.uid);
      await setDoc(userConnectionsRef, {
        connections: {
          [recipientUid]: {
            shortId: trimmedId,
            timestamp: new Date().toISOString()
          }
        }
      }, { merge: true });

      setIsConnected(true);
      setShowNewChat(false);
      setupMessageListener(recipientUid);
    } catch (error) {
      console.error("Error connecting to chat:", error);
      setError("Failed to connect to chat. Please try again.");
    } finally {
      setIsConnecting(false);
    }
  };

  const setupMessageListener = useCallback((recipientUid) => {
    if (!auth.currentUser) return;

    try {
      const chatId = [auth.currentUser.uid, recipientUid].sort().join('_');
    const q = query(
      collection(db, `chats/${chatId}/messages`),
      orderBy('timestamp')
    );

      // Clean up previous listener if exists
      if (messageListenerRef.current) {
        messageListenerRef.current();
      }

      messageListenerRef.current = onSnapshot(q, (snapshot) => {
      const messageList = [];
      snapshot.forEach((doc) => {
        messageList.push({ ...doc.data(), id: doc.id });
      });
      setMessages(messageList);
      }, (error) => {
        console.error("Error in message listener:", error);
        setError("Failed to load messages. Please try reconnecting.");
      });
    } catch (error) {
      console.error("Error setting up message listener:", error);
      setError("Failed to initialize chat. Please try again.");
    }
  }, []);

  const handleDisconnect = () => {
    if (messageListenerRef.current) {
      messageListenerRef.current();
    }
    setIsConnected(false);
    setRecipientId('');
    setMessages([]);
    setError('');
    setRecipientInfo(null);
  };

  const handleSignOut = async () => {
    try {
      if (auth.currentUser) {
        await updateUserStatus(auth.currentUser.uid, false);
      }
      await signOut(auth);
      navigate('/');
    } catch (error) {
      console.error("Error signing out:", error);
      setError("Failed to sign out. Please try again.");
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !recipientInfo || !auth.currentUser) return;

    const messageText = newMessage.trim();
    setNewMessage('');

    try {
      const chatId = [auth.currentUser.uid, recipientInfo.uid].sort().join('_');
      const timestamp = new Date().toISOString();
      
      // Update chat document first
      await setDoc(doc(db, 'chats', chatId), {
        participants: [auth.currentUser.uid, recipientInfo.uid].sort(),
        lastMessage: messageText,
        lastMessageTime: timestamp,
        updatedAt: timestamp
      }, { merge: true });

      // Then add the message
      await addDoc(collection(db, `chats/${chatId}/messages`), {
        text: messageText,
        sender: auth.currentUser.uid,
        receiver: recipientInfo.uid,
        timestamp: timestamp
      });

    } catch (error) {
      console.error("Error sending message:", error);
      setError('Failed to send message. Please try again.');
      setNewMessage(messageText);
    }
  };

  const loadRecentChats = async (userId) => {
    console.log('Loading recent chats for user:', userId);
    try {
      // First, get user's connections
      const userDocRef = doc(db, 'users', userId);
      const userDocSnap = await getDoc(userDocRef);
      const userData = userDocSnap.data();
      const connections = userData.connections || {};
      
      // Query all chats where the current user is a participant
      const chatsRef = collection(db, 'chats');
      const q = query(
        chatsRef,
        where('participants', 'array-contains', userId),
        orderBy('lastMessageTime', 'desc')
      );

      // Set up real-time listener for chats
      const unsubscribe = onSnapshot(q, async (snapshot) => {
        console.log('Received chat updates, documents count:', snapshot.docs.length);
        const chatsData = [];
        
        // First, process all chats that have messages
        for (const chatDoc of snapshot.docs) {
          const chatData = chatDoc.data();
          console.log('Processing chat:', chatDoc.id, chatData);
          
          const otherUserId = chatData.participants.find(id => id !== userId);
          
          if (otherUserId) {
            try {
              const recipientDocRef = doc(db, 'users', otherUserId);
              const recipientDocSnap = await getDoc(recipientDocRef);
              if (recipientDocSnap.exists()) {
                const recipientData = recipientDocSnap.data();
                
                if (chatData.lastMessage) {
                  chatsData.push({
                    chatId: chatDoc.id,
                    recipientId: recipientData.shortId,
                    recipientUid: otherUserId,
                    recipientName: recipientData.displayName || 'Unknown User',
                    recipientPhoto: recipientData.photoURL,
                    lastMessage: chatData.lastMessage,
                    timestamp: chatData.lastMessageTime,
                    online: recipientData.online
                  });
                }
              }
            } catch (error) {
              console.error('Error fetching recipient data:', error);
            }
          }
        }

        // Then, add any connections that don't already have a chat entry
        for (const [connectedUserId, connection] of Object.entries(connections)) {
          if (!chatsData.some(chat => chat.recipientUid === connectedUserId)) {
            try {
              const recipientDocRef = doc(db, 'users', connectedUserId);
              const recipientDocSnap = await getDoc(recipientDocRef);
              if (recipientDocSnap.exists()) {
                const recipientData = recipientDocSnap.data();
                chatsData.push({
                  chatId: [userId, connectedUserId].sort().join('_'),
                  recipientId: recipientData.shortId,
                  recipientUid: connectedUserId,
                  recipientName: recipientData.displayName || 'Unknown User',
                  recipientPhoto: recipientData.photoURL,
                  lastMessage: '',  // Don't show any message text if there are no messages
                  timestamp: connection.timestamp,
                  online: recipientData.online
                });
              }
            } catch (error) {
              console.error('Error fetching connection data:', error);
            }
          }
        }
        
        // Sort by most recent activity
        chatsData.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
        console.log('Final chats data:', chatsData);
        setRecentChats(chatsData);
      });

      return unsubscribe;
    } catch (error) {
      console.error('Error in loadRecentChats:', error);
      setError('Failed to load recent chats');
    }
  };

  const switchChat = async (chatInfo) => {
    try {
      setShowNewChat(false);
      setRecipientId(chatInfo.recipientId);
      
      // Get the latest recipient data
      const userDoc = await getDoc(doc(db, 'users', chatInfo.recipientUid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        setRecipientInfo({
          uid: chatInfo.recipientUid,
          shortId: chatInfo.recipientId,
          displayName: userData.displayName || chatInfo.recipientName,
          photoURL: userData.photoURL || chatInfo.recipientPhoto,
          online: userData.online
        });
        setIsConnected(true);
        setShowMessages(true);
        setupMessageListener(chatInfo.recipientUid);
      } else {
        console.error('Recipient user document not found');
        setError('Failed to load recipient data');
      }
    } catch (error) {
      console.error('Error switching chat:', error);
      setError('Failed to switch chat. Please try again.');
    }
  };

  const handleBackToList = () => {
    setShowMessages(false);
  };

  // Add theme toggle function
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  // Initialize theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  const showNotification = (message, type = 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleDeleteChat = async (chatId, recipientUid) => {
    try {
      // First, delete all messages in the chat
      const messagesRef = collection(db, `chats/${chatId}/messages`);
      const messagesSnapshot = await getDocs(messagesRef);
      const batch = writeBatch(db);
      
      messagesSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      batch.delete(doc(db, 'chats', chatId));
      await batch.commit();
      
      const userRef = doc(db, 'users', auth.currentUser.uid);
      const userDoc = await getDoc(userRef);
      const userData = userDoc.data();
      const connections = { ...userData.connections };
      delete connections[recipientUid];
      
      await updateDoc(userRef, { connections });
      setRecentChats(prevChats => prevChats.filter(chat => chat.chatId !== chatId));
      
      if (recipientInfo?.uid === recipientUid) {
        handleDisconnect();
      }
      
      setActiveMenu(null);
      showNotification('Chat deleted successfully', 'success');
    } catch (error) {
      console.error('Error deleting chat:', error);
      showNotification('Failed to delete chat');
    }
  };

  // Add click outside handler to close menu
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (activeMenu && !event.target.closest('.chat-item-options')) {
        setActiveMenu(null);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [activeMenu]);

  // Add resize listener
  useEffect(() => {
    const handleResize = () => {
      setIsMobileView(window.innerWidth <= 480);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner">Loading...</div>
      </div>
    );
  }

  if (!auth.currentUser) {
    navigate('/');
    return null;
  }

  return (
    <div className="chat-container">
      {notification && (
        <div className={`popup-notification ${notification.type}`}>
          <div className="icon">
            {notification.type === 'success' ? (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
              </svg>
            )}
          </div>
          <div className="content">
            <p className="message">{notification.message}</p>
          </div>
          <button 
            className="close-button"
            onClick={() => setNotification(null)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
            </svg>
          </button>
        </div>
      )}
      <div className="chat-header">
        <h2>Chats</h2>
        <div className="user-id">
          <span>Your ID: {userShortId}</span>
          <button 
            className="copy-button"
            onClick={() => {
              navigator.clipboard.writeText(userShortId);
              showNotification('ID copied to clipboard!', 'success');
            }}
          >
            Copy ID
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button 
            className="theme-toggle" 
            onClick={toggleTheme} 
            title="Toggle theme"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M20 8.69V4h-4.69L12 .69 8.69 4H4v4.69L.69 12 4 15.31V20h4.69L12 23.31 15.31 20H20v-4.69L23.31 12 20 8.69zM12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm0-10c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z"/>
            </svg>
          </button>
          <button onClick={handleSignOut} className="logout-button">
            Logout
          </button>
        </div>
      </div>

      <div className="chat-layout">
        <div className={`recent-chats-list ${showMessages && isMobileView ? 'hidden' : ''}`}>
          <div className="chat-list-header">
            <h2>Recent Chats</h2>
            <button onClick={() => setShowNewChat(true)} className="new-chat-button">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
              New Chat
            </button>
          </div>
          
          {showNewChat && (
            <div className="connect-form">
              <div className="form-header">
                <h3>New Chat</h3>
                <button 
                  onClick={() => setShowNewChat(false)} 
                  className="close-button"
                  title="Close"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
                  </svg>
                </button>
              </div>
              <div className="input-group">
                <div className="input-wrapper">
                  <input
                    type="text"
                    value={recipientId}
                    onChange={handleRecipientIdChange}
                    onPaste={handlePaste}
                    placeholder="Enter ID"
                    disabled={isConnecting}
                    maxLength={6}
                    className="recipient-input"
                    spellCheck="false"
                    autoComplete="off"
                  />
                  <span className="char-counter">
                    {recipientId.length}/6
                  </span>
                </div>
                <button 
                  onClick={handleConnect}
                  disabled={isConnecting || !recipientId.trim() || recipientId.length !== 6}
                  className="connect-button"
                >
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </button>
              </div>
              {recipientId && (
                <p className="recipient-hint">
                  {recipientId.length === 6
                    ? 'Press Connect when you\'re ready to start chatting'
                    : `Please enter a complete user ID (${recipientId.length}/6 characters)`}
                </p>
              )}
            </div>
          )}

          <div className="chats-list">
            {recentChats.length > 0 ? (
              recentChats.map((chat) => (
                <div
                  key={chat.chatId}
                  className={`chat-item ${recipientInfo?.shortId === chat.recipientId ? 'active' : ''}`}
                  onClick={() => switchChat(chat)}
                >
                  <div className="chat-item-avatar">
                    {chat.recipientPhoto ? (
                      <img src={chat.recipientPhoto} alt={chat.recipientName} />
                    ) : (
                      <div className="avatar-placeholder">
                        {chat.recipientName?.[0]?.toUpperCase() || '?'}
                      </div>
                    )}
                  </div>
                  <div className="chat-item-info">
                    <div className="chat-item-name">{chat.recipientName}</div>
                    <div className="chat-item-message">
                      {chat.lastMessage || (
                        <span className="no-messages">Click to start chatting</span>
                      )}
                    </div>
                  </div>
                  <div className="chat-item-time">
                    {chat.timestamp ? formatTime(chat.timestamp) : ''}
                  </div>
                  <div className="chat-item-options">
                    <button
                      className="options-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenu(activeMenu === chat.chatId ? null : chat.chatId);
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                        <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                      </svg>
                    </button>
                    {activeMenu === chat.chatId && (
                      <div className="options-menu">
                        <div
                          className="options-menu-item delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteChat(chat.chatId, chat.recipientUid);
                          }}
                        >
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                          </svg>
                          Delete Chat
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-chat">
                <div className="empty-chat-illustration">
                  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12zm-2-7H6v2h12V9zm0-3H6v2h12V6z"/>
                  </svg>
                </div>
                <p>Welcome! Start your first conversation</p>
                <button onClick={() => setShowNewChat(true)} className="start-chat-button">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                  </svg>
                  Start a New Chat
                </button>
              </div>
            )}
          </div>
        </div>

        <div className={`messages-container ${showMessages ? 'active' : ''}`}>
          {isMobileView && isConnected && (
            <button className="back-button" onClick={handleBackToList}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
              </svg>
              Back to chats
            </button>
          )}
          {isConnected ? (
            <>
              <div className="chat-header">
                <div className="recipient-info">
                  <div className="recipient-avatar">
                    {recipientInfo?.photoURL ? (
                      <img src={recipientInfo.photoURL} alt={recipientInfo.displayName} />
                    ) : (
                      <div className="avatar-placeholder">
                        {recipientInfo?.displayName?.[0]?.toUpperCase() || '?'}
                      </div>
                    )}
                  </div>
                  <div className="recipient-details">
                    <h2>{recipientInfo?.displayName || 'Unknown User'}</h2>
                    <span className={`status ${recipientInfo?.online ? 'online' : 'offline'}`}>
                      {recipientInfo?.online ? 'online' : 'offline'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="messages">
                {messages.length > 0 ? (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`message ${message.sender === auth.currentUser.uid ? 'sent' : 'received'}`}
                    >
                      <div className="message-content">
                        {message.text}
                        <span className="message-time">
                          {formatTime(message.timestamp)}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-chat">
                    <p>No messages yet</p>
                    <p>Start the conversation by sending a message!</p>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <form onSubmit={sendMessage} className="message-form">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Write a message..."
                  disabled={!isOnline}
                />
                <button 
                  type="submit" 
                  disabled={!newMessage.trim() || !isOnline}
                >
                  Send
                </button>
              </form>
            </>
          ) : (
            <div className="empty-chat welcome-message">
              <p>Select a chat or start a new conversation</p>
              <button onClick={() => setShowNewChat(true)} className="start-chat-button">
                Start a new chat
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Chat; 