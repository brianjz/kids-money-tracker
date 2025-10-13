import { useState, useEffect } from 'react';

const API_URL = '/api/money';

// --- Push Notification Subscription Logic ---
async function registerForPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications are not supported by this browser.');
    return;
  }

  try {
    // Register the service worker
    const swRegistration = await navigator.serviceWorker.register('/sw.js');
    console.log('Service Worker registered:', swRegistration);

    // Check for existing subscription
    let subscription = await swRegistration.pushManager.getSubscription();
    
    if (subscription === null) {
      // No subscription found, create a new one
      const permission = await window.Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('Notification permission was not granted.');
        return;
      }
      
      const { publicKey } = await apiFetch('/vapid-public-key');
      subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey
      });
      
      // Send the new subscription to the backend
      await apiFetch('/subscribe', {
        method: 'POST',
        body: JSON.stringify(subscription),
      });
      console.log('User is subscribed.');
    } else {
      console.log('User was already subscribed.');
    }
  } catch (error) {
    console.error('Failed to subscribe to push notifications:', error);
  }
}

// --- Helper for API calls ---
const apiFetch = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(errorBody.error || `HTTP error! status: ${response.status}`);
  }
  return response.json();
};

// --- Login Page Component ---
function AuthPage({ onLogin }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const data = await apiFetch('/login', {
        method: 'POST',
        body: JSON.stringify({ name, password }),
      });
      onLogin(data.accessToken, data.user);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-900">
      <div className="w-full max-w-md p-8 space-y-6 bg-slate-800 rounded-xl shadow-lg">
        <h2 className="text-3xl font-bold text-center text-cyan-400">
          Welcome Back!
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
           {error && <p className="text-red-400 text-center">{error}</p>}
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Name" required className="bg-slate-700 p-3 rounded-md w-full focus:ring-2 focus:ring-cyan-500 focus:outline-none"/>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required className="bg-slate-700 p-3 rounded-md w-full focus:ring-2 focus:ring-cyan-500 focus:outline-none"/>
          <button type="submit" className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-4 rounded-md transition-colors duration-300">
            Login
          </button>
        </form>
      </div>
    </div>
  );
}


// --- Main Tracker Component ---
function TrackerPage({ currentUser, onLogout }) {
    const [transactions, setTransactions] = useState([]);
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [type, setType] = useState('income');

    useEffect(() => {
        apiFetch('/transactions')
            .then(setTransactions)
            .catch(err => console.error("Failed to fetch transactions:", err));
        
        // If the logged-in user is an admin, try to set up push notifications
        if (currentUser.role === 'admin') {
            registerForPushNotifications();
        }
    }, [currentUser.role]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!description || !amount) return;
        const newTransaction = {
            description,
            amount: parseFloat(amount),
            type,
            child_name: currentUser.name, // Children can only submit for themselves
        };
        try {
            const savedTransaction = await apiFetch('/transactions', {
                method: 'POST',
                body: JSON.stringify(newTransaction),
            });
            setTransactions([savedTransaction, ...transactions]);
            setDescription('');
            setAmount('');
        } catch (err) {
            console.error("Failed to add transaction:", err);
        }
    };
    
    const handleApprove = async (transactionId) => {
        try {
            await apiFetch(`/transactions/${transactionId}/approve`, { method: 'PUT' });
            setTransactions(transactions.map(t =>
                t.id === transactionId ? { ...t, status: 'approved', approved_by: currentUser.name } : t
            ));
        } catch (err) {
            console.error("Failed to approve transaction:", err);
        }
    };

    const handleDecline = async (transactionId) => {
        try {
            await apiFetch(`/transactions/${transactionId}/decline`, { method: 'PUT' });
            setTransactions(transactions.map(t =>
                t.id === transactionId ? { ...t, status: 'declined', approved_by: currentUser.name } : t
            ));
        } catch (err) {
            console.error("Failed to decline transaction:", err);
        }
    };

    const totalBalance = transactions.reduce((acc, t) => {
        if (t.status !== 'approved') return acc;
        return t.type === 'income' ? acc + parseFloat(t.amount) : acc - parseFloat(t.amount);
    }, 0);

    return (
     <div className="bg-slate-900 min-h-screen text-slate-200 flex flex-col items-center p-4 sm:p-8 font-sans">
      <div className="w-full max-w-4xl">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-cyan-400">Money Tracker</h1>
          <div className="text-right">
            <p className="text-slate-300">Welcome, <span className="font-bold">{currentUser.name}</span>!</p>
            <button onClick={onLogout} className="text-sm text-cyan-400 hover:underline">Logout</button>
          </div>
        </header>

        <div className="bg-slate-800 p-6 rounded-xl shadow-lg mb-8 text-center">
            <h2 className="text-xl font-semibold text-slate-400">Total Approved Balance</h2>
            <p className={`text-4xl font-bold mt-2 ${totalBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ${totalBalance.toFixed(2)}
            </p>
        </div>
        
        {currentUser.role === 'child' && (
             <div className="bg-slate-800 p-6 rounded-xl shadow-lg mb-8">
                <h2 className="text-2xl font-bold mb-4 text-cyan-400">Request a Transaction</h2>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                    <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Description" className="bg-slate-700 p-2 rounded-md w-full focus:ring-2 focus:ring-cyan-500 focus:outline-none"/>
                    <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount" className="bg-slate-700 p-2 rounded-md w-full focus:ring-2 focus:ring-cyan-500 focus:outline-none"/>
                    <select value={type} onChange={e => setType(e.target.value)} className="bg-slate-700 p-2 rounded-md w-full focus:ring-2 focus:ring-cyan-500 focus:outline-none">
                        <option value="income">Income</option>
                        <option value="expense">Expense</option>
                    </select>
                    <button type="submit" className="sm:col-span-3 bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-md w-full mt-2">Submit Request</button>
                </form>
            </div>
        )}

        <div className="bg-slate-800 p-6 rounded-xl shadow-lg">
           <h2 className="text-2xl font-bold text-cyan-400 mb-4">Pending Transactions</h2>
            <ul className="space-y-3">
                {transactions.filter(t => t.status === 'pending').map(t => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between bg-slate-700 p-3 rounded-md">
                        <div>
                            <span className="font-semibold">{t.description}</span>
                            <span className="text-xs text-slate-400 block">{t.child_name}</span>
                        </div>
                        <div className="flex items-center gap-4">
                            <span className={`font-semibold ${t.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                                {t.type === 'income' ? '+' : '-'}${parseFloat(t.amount).toFixed(2)}
                            </span>
                            {currentUser.role === 'admin' && (
                                <div className="ml-4 flex gap-2">
                                    <button onClick={() => handleApprove(t.id)} className="bg-green-500 hover:bg-green-600 text-white font-bold py-1 px-3 rounded-md text-sm">Approve</button>
                                    <button onClick={() => handleDecline(t.id)} className="bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-3 rounded-md text-sm">Decline</button>
                                </div>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
           <h2 className="text-2xl font-bold text-cyan-400 mt-8 mb-4">Approved Transactions</h2>
           <ul className="space-y-3">
            {transactions.filter(t => t.status === 'approved').map(t => (
                <li key={t.id} className="flex flex-wrap items-center justify-between bg-slate-900/50 p-3 rounded-md opacity-70">
                    <div>
                        <span className="font-semibold">{t.description}</span>
                        <span className="text-xs text-slate-400 block">{t.child_name} - Approved by {t.approved_by}</span>
                    </div>
                    <div className={`font-semibold ${t.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                        {t.type === 'income' ? '+' : '-'}${parseFloat(t.amount).toFixed(2)}
                    </div>
                </li>
            ))}
          </ul>
           <h2 className="text-2xl font-bold text-cyan-400 mt-8 mb-4">Declined Transactions</h2>
           <ul className="space-y-3">
            {transactions.filter(t => t.status === 'declined').map(t => (
                <li key={t.id} className="flex flex-wrap items-center justify-between bg-slate-900/50 p-3 rounded-md opacity-50">
                    <div>
                        <span className="font-semibold line-through">{t.description}</span>
                        <span className="text-xs text-slate-400 block">{t.child_name} - Declined by {t.approved_by}</span>
                    </div>
                    <div className={`font-semibold text-slate-500 line-through`}>
                        {t.type === 'income' ? '+' : '-'}${parseFloat(t.amount).toFixed(2)}
                    </div>
                </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
    );
}

// --- App Component (Main controller) ---
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('token'));

  useEffect(() => {
    // This effect synchronizes the token state with localStorage
    if (token) {
      localStorage.setItem('token', token);
      // Decode token to get user info without a server round-trip for UI purposes
      // NOTE: This is for UI display only. The server ALWAYS validates the token.
      try {
        const decodedUser = JSON.parse(atob(token.split('.')[1]));
        setCurrentUser({ name: decodedUser.name, role: decodedUser.role });
      } catch (e) {
        console.error("Failed to decode token, logging out:", e);
        // If token is invalid, log out
        handleLogout();
      }
    } else {
      localStorage.removeItem('token');
      setCurrentUser(null);
    }
  }, [token]);

  const handleLogin = (newToken, user) => {
    setToken(newToken);
    setCurrentUser(user);
  };
  
  const handleLogout = () => {
    setToken(null);
  };

  return (
    <div>
      {currentUser ? (
        <TrackerPage currentUser={currentUser} onLogout={handleLogout} />
      ) : (
        <AuthPage onLogin={handleLogin} />
      )}
    </div>
  );
}