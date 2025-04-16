import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { doc, getDoc, collection, addDoc, setDoc, updateDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';

const CreateGroup = ({ onClose, onSuccess, userConnections = [] }) => {
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [connections, setConnections] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [showAllUsers, setShowAllUsers] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    loadConnections();
    loadAllUsers();
  }, []);

  const loadConnections = async () => {
    if (!auth.currentUser) return;

    try {
      setIsLoading(true);
      console.log('Loading connections for user:', auth.currentUser.uid);
      
      const userRef = doc(db, 'users', auth.currentUser.uid);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const connectionsData = userData.connections || {};
        
        // Debug: Log connections data to see what we have
        console.log('Raw connections data:', JSON.stringify(connectionsData));
        console.log('Connections count:', Object.keys(connectionsData).length);
        
        // Get all users in the database to check if we're missing any
        const usersRef = collection(db, 'users');
        const usersSnapshot = await getDocs(usersRef);
        const allUsers = [];
        
        usersSnapshot.forEach((doc) => {
          if (doc.id !== auth.currentUser.uid) { // Exclude current user
            allUsers.push({
              id: doc.id,
              ...doc.data()
            });
          }
        });
        
        console.log('All users in database (excluding current user):', allUsers.length);
        
        // Load all connection profiles from our connections
        const connectionsList = [];
        for (const [userId, connection] of Object.entries(connectionsData)) {
          try {
            console.log('Loading connection details for:', userId);
            const userDoc = await getDoc(doc(db, 'users', userId));
            
            if (userDoc.exists()) {
              const userData = userDoc.data();
              connectionsList.push({
                id: userId,
                shortId: userData.shortId,
                displayName: userData.displayName || 'Unknown User',
                photoURL: userData.photoURL,
                selected: false
              });
              console.log('Added connection:', userData.displayName);
            } else {
              console.log('User document not found for connection:', userId);
            }
          } catch (error) {
            console.error('Error loading connection:', error);
          }
        }
        
        console.log('Final connections list:', connectionsList.length, 'connections loaded');
        setConnections(connectionsList);
      }
    } catch (error) {
      console.error('Error loading connections:', error);
      setError('Failed to load your connections');
    } finally {
      setIsLoading(false);
    }
  };

  const loadAllUsers = async () => {
    if (!auth.currentUser) return;

    try {
      console.log('Loading all users');
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      const usersList = [];
      
      usersSnapshot.forEach((doc) => {
        // Don't include the current user
        if (doc.id !== auth.currentUser.uid) {
          const userData = doc.data();
          usersList.push({
            id: doc.id,
            shortId: userData.shortId,
            displayName: userData.displayName || 'Unknown User',
            photoURL: userData.photoURL,
            selected: false
          });
        }
      });
      
      console.log('All users loaded:', usersList.length);
      setAllUsers(usersList);
    } catch (error) {
      console.error('Error loading all users:', error);
    }
  };

  const toggleMemberSelection = (connectionId) => {
    if (selectedMembers.includes(connectionId)) {
      setSelectedMembers(selectedMembers.filter(id => id !== connectionId));
    } else {
      setSelectedMembers([...selectedMembers, connectionId]);
    }
  };

  const toggleUserListMode = () => {
    setShowAllUsers(!showAllUsers);
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      setError('Please enter a group name');
      return;
    }

    if (selectedMembers.length === 0) {
      setError('Please select at least one member');
      return;
    }

    try {
      setIsCreating(true);
      setError('');

      // Check if user is a guest and already has 5 connections
      if (auth.currentUser) {
        const userRef = doc(db, 'users', auth.currentUser.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
          const userData = userDoc.data();
          
          if (userData.isGuest) {
            const connections = userData.connections || {};
            const groups = userData.groups || {};
            const totalConnectionCount = Object.keys(connections).length + Object.keys(groups).length;
            
            if (totalConnectionCount >= (userData.maxConnections || 5)) {
              setError("As a guest user, you are limited to 5 total connections (direct chats + groups). Please sign in to create more groups.");
              setIsCreating(false);
              return;
            }
          }
        }
      }

      // Create a new group in Firestore
      const groupData = {
        name: groupName.trim(),
        createdBy: auth.currentUser.uid,
        createdAt: new Date().toISOString(),
        lastMessageTime: new Date().toISOString(),
        members: [auth.currentUser.uid, ...selectedMembers],
        isGroup: true
      };

      // Add the group to the groups collection
      const groupRef = await addDoc(collection(db, 'groups'), groupData);
      const groupId = groupRef.id;

      // Add the group to the current user's document first
      try {
        const currentUserRef = doc(db, 'users', auth.currentUser.uid);
        const currentUserDoc = await getDoc(currentUserRef);
        
        if (currentUserDoc.exists()) {
          const userData = currentUserDoc.data();
          const groups = userData.groups || {};
          
          await updateDoc(currentUserRef, {
            groups: {
              ...groups,
              [groupId]: {
                joinedAt: new Date().toISOString()
              }
            }
          });
          
          // Now that we've successfully created the group and updated our own profile,
          // we can notify group members one by one in the background
          // We don't await this to avoid blocking the UI
          addMembersToGroup(groupId, selectedMembers);
          
          onSuccess(groupId);
          onClose();
        }
      } catch (userUpdateError) {
        console.error('Error updating user document:', userUpdateError);
        // The group was created, but we couldn't update the user document
        // We should notify the user but allow them to continue
        setError('Group created, but there was an issue adding it to your profile. You can still access the group.');
        onSuccess(groupId);
        onClose();
      }
    } catch (error) {
      console.error('Error creating group:', error);
      if (error.code === 'permission-denied') {
        setError('Permission denied. You may not have permission to create groups.');
      } else {
        setError('Failed to create group. Please try again.');
      }
    } finally {
      setIsCreating(false);
    }
  };
  
  // Helper function to add members to the group in the background
  const addMembersToGroup = async (groupId, memberIds) => {
    for (const memberId of memberIds) {
      try {
        const userRef = doc(db, 'users', memberId);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
          const userData = userDoc.data();
          const groups = userData.groups || {};
          
          await updateDoc(userRef, {
            groups: {
              ...groups,
              [groupId]: {
                joinedAt: new Date().toISOString(),
                addedBy: auth.currentUser.uid
              }
            }
          });
        }
      } catch (error) {
        console.error(`Error adding member ${memberId} to group:`, error);
        // Continue with other members even if one fails
      }
    }
  };

  return (
    <div className="create-group-container">
      <div className="create-group-header">
        <h3>Create New Group</h3>
        <button 
          onClick={onClose} 
          className="close-button"
          title="Close"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
          </svg>
        </button>
      </div>

      <div className="group-form">
        <div className="input-group">
          <label>Group Name</label>
          <input
            type="text"
            value={groupName}
            onChange={(e) => {
              setGroupName(e.target.value);
              setError('');
            }}
            placeholder="Enter group name"
            maxLength={30}
            className="group-name-input"
          />
          <span className="char-counter">
            {groupName.length}/30
          </span>
        </div>

        <div className="members-section">
          <div className="section-header">
            <label>Select Members</label>
            <div className="toggle-container">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={showAllUsers}
                  onChange={toggleUserListMode}
                  className="toggle-input"
                />
                <span className="toggle-text">
                  {showAllUsers ? "Showing all users" : "Showing connections"}
                </span>
              </label>
            </div>
          </div>

          {isLoading ? (
            <div className="loading-connections">Loading your connections...</div>
          ) : (showAllUsers ? allUsers : connections).length === 0 ? (
            <div className="no-connections">
              {showAllUsers ? 
                "No users found in the database." : 
                "You don't have any connections yet. Connect with people first to create a group."}
              {!showAllUsers && allUsers.length > 0 && (
                <button 
                  className="show-all-users-button"
                  onClick={() => setShowAllUsers(true)}
                >
                  Show all available users
                </button>
              )}
            </div>
          ) : (
            <div className="connections-list">
              {(showAllUsers ? allUsers : connections).map((connection) => (
                <div 
                  key={connection.id}
                  className={`connection-item ${selectedMembers.includes(connection.id) ? 'selected' : ''}`}
                  onClick={() => toggleMemberSelection(connection.id)}
                >
                  <div className="connection-avatar">
                    {connection.photoURL ? (
                      <img src={connection.photoURL} alt={connection.displayName} />
                    ) : (
                      <div className="avatar-placeholder">
                        {connection.displayName[0]?.toUpperCase() || '?'}
                      </div>
                    )}
                  </div>
                  <div className="connection-info">
                    <div className="connection-name">{connection.displayName}</div>
                    <div className="connection-id">{connection.shortId}</div>
                  </div>
                  <div className="selection-indicator">
                    {selectedMembers.includes(connection.id) && (
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                      </svg>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="error-message">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <div className="form-actions">
          <button 
            className="cancel-button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button 
            className="create-button"
            onClick={handleCreateGroup}
            disabled={isCreating || !groupName.trim() || selectedMembers.length === 0}
          >
            {isCreating ? 'Creating...' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateGroup; 