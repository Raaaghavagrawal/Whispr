import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { collection, addDoc, query, orderBy, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';

function Chat() {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const { userId } = useParams();
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!recipientId) return;

    const chatId = [userId, recipientId].sort().join('_');
    const q = query(
      collection(db, `chats/${chatId}/messages`),
      orderBy('timestamp')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messageList = [];
      snapshot.forEach((doc) => {
        messageList.push({ ...doc.data(), id: doc.id });
      });
      setMessages(messageList);
    });

    setIsConnected(true);
    return () => unsubscribe();
  }, [userId, recipientId]);

  const connectToUser = (e) => {
    e.preventDefault();
    if (recipientId === userId) {
      alert("You cannot chat with yourself!");
      return;
    }
    setIsConnected(true);
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !recipientId) return;

    const chatId = [userId, recipientId].sort().join('_');
    
    try {
      await addDoc(collection(db, `chats/${chatId}/messages`), {
        text: newMessage,
        sender: userId,
        timestamp: new Date().toISOString(),
      });
      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setRecipientId('');
    setMessages([]);
  };

  return (
    <div className="chat-container">
      <h2>Your ID: {userId}</h2>
      
      {!isConnected ? (
        <div className="connect-form">
          <h3>Connect with another user</h3>
          <form onSubmit={connectToUser}>
            <input
              type="text"
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              placeholder="Enter recipient's ID"
              required
            />
            <button type="submit">Connect</button>
          </form>
        </div>
      ) : (
        <>
          <div className="chat-header">
            <h3>Chatting with: {recipientId}</h3>
            <button onClick={handleDisconnect}>Disconnect</button>
          </div>
          
          <div className="messages">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`message ${message.sender === userId ? 'sent' : 'received'}`}
              >
                {message.text}
              </div>
            ))}
          </div>

          <form onSubmit={sendMessage} className="message-form">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a message"
            />
            <button type="submit">Send</button>
          </form>
        </>
      )}
    </div>
  );
}

export default Chat;