import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import process from 'node:process';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import webpush from 'web-push';
import dotenv from 'dotenv';

// --- Configuration ---
dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE
};

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;const SALT_ROUNDS = 10;

// Setup web-push
webpush.setVapidDetails(
  process.env.VAPID_MAILTO,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// --- Database Connection ---
const pool = mysql.createPool(dbConfig);

// --- Server Setup ---
const app = express();
const PORT = 4000;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// Authentication Middleware to protect routes
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) return res.sendStatus(401); // if there isn't any token

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403); // if the token is no longer valid
    req.user = user;
    next();
  });
};

// --- Helper Function to Send Notifications ---
const sendNotification = async (transaction) => {
    try {
        const [subscriptions] = await pool.query('SELECT subscription FROM subscriptions');
        const numericAmount = Number(transaction.amount);

        const payload = JSON.stringify({
            title: 'New Transaction Pending',
            body: `${transaction.child_name} submitted a new request for $${numericAmount.toFixed(2)}.`
        });

        subscriptions.forEach(s => {
            const subscriptionObject = JSON.parse(s.subscription);
            webpush.sendNotification(subscriptionObject, payload)
                .catch(error => {
                    // If the subscription is gone (410), it's no longer valid.
                    if (error.statusCode === 410) {
                        console.log('Subscription has expired or is invalid. Deleting from DB.');
                        // Delete the invalid subscription from the database.
                        pool.query("DELETE FROM subscriptions WHERE JSON_EXTRACT(subscription, '$.endpoint') = ?", [subscriptionObject.endpoint])
                            .catch(deleteError => console.error('Failed to delete subscription:', deleteError));
                    } else {
                        console.error('Error sending notification:', error);
                    }
                });
        });
    } catch (error) {
        console.error('Failed to send notifications:', error);
    }
};

// --- API Routes ---

// AUTH: Register a new user
app.post('/api/money/register', async (req, res) => {
  try {
    const { name, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const sql = 'INSERT INTO users (name, password, role) VALUES (?, ?, ?)';
    await pool.query(sql, [name, hashedPassword, role]);
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Username likely already exists or database error.' });
  }
});

// AUTH: Login a user
app.post('/api/money/login', async (req, res) => {
    try {
        const { name, password } = req.body;
        const sql = 'SELECT * FROM users WHERE name = ?';
        const [[user]] = await pool.query(sql, [name]);

        if (user && await bcrypt.compare(password, user.password)) {
            // Passwords match, create JWT
            const accessToken = jwt.sign({ id: user.id, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
            res.json({ accessToken, user: { id: user.id, name: user.name, role: user.role } });
        } else {
            res.status(400).json({ error: 'Invalid username or password' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'An error occurred during login' });
    }
});

// GET: VAPID Public Key for the frontend
app.get('/api/money/vapid-public-key', (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// POST: Subscribe to push notifications
app.post('/api/money/subscribe', authenticateToken, async (req, res) => {
    const subscription = req.body;
    const userId = req.user.id;
    try {
        const sql = 'INSERT INTO subscriptions (subscription, user_id) VALUES (?, ?)';
        await pool.query(sql, [JSON.stringify(subscription), userId]);
        res.status(201).json({ message: 'Subscription saved.' });
    } catch (error) {
        console.error('Could not save subscription', error);
        res.status(500).json({ error: 'Failed to save subscription.' });
    }
});

// GET: Fetch children (For Admin dropdown)
app.get('/api/money/children', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        const sql = 'SELECT name FROM users WHERE role = "child" ORDER BY name ASC';
        const [rows] = await pool.query(sql);
        res.json(rows);
    } catch (error) {
        console.error('Failed to fetch children:', error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

// GET: Fetch all transactions (Protected and Scoped to User Role)
app.get('/api/money/transactions', authenticateToken, async (req, res) => {
  try {
    let sql = 'SELECT * FROM transactions ORDER BY created_at DESC';
    let params = [];

    // If the logged-in user is a child, modify the query to only show their transactions.
    if (req.user.role === 'child') {
      sql = 'SELECT * FROM transactions WHERE child_name = ? ORDER BY created_at DESC';
      params.push(req.user.name);
    }

    console.log(sql)
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    console.error('Failed to fetch transactions:', error);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// POST: Add a new transaction (Protected)
app.post('/api/money/transactions', authenticateToken, async (req, res) => {
  try {
    const { description, amount, type, child_name } = req.body;
    
    // Default status for requests
    let status = 'pending';
    let approvedBy = null;

    // If Admin is creating it, approve immediately
    if (req.user.role === 'admin') {
        status = 'approved';
        approvedBy = req.user.name;
    } else {
        // If a child is creating it, force the child_name to be themselves for security
        if (child_name !== req.user.name) {
            return res.status(403).json({ error: 'You can only submit requests for yourself.' });
        }
    }

    const sql = 'INSERT INTO transactions (description, amount, type, child_name, status, approved_by) VALUES (?, ?, ?, ?, ?, ?)';
    const [result] = await pool.query(sql, [description, amount, type, child_name, status, approvedBy]);
    const [[newTransaction]] = await pool.query('SELECT * FROM transactions WHERE id = ?', [result.insertId]);
    
    // Send notification only if it's a pending request (not auto-approved by admin)
    if (status === 'pending') {
        sendNotification(newTransaction);
    }
    
    res.status(201).json(newTransaction);
  } catch (error) {
    console.error('Failed to add transaction:', error);
    res.status(500).json({ error: 'Database insert failed' });
  }
});
// PUT: Approve a transaction (Protected & Admin only)
app.put('/api/money/transactions/:id/approve', authenticateToken, async (req, res) => {
  // Check if the authenticated user is an admin
  if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Only admins can approve transactions.' });
  }

  try {
    const { id } = req.params;
    const parent_name = req.user.name; // Use the authenticated user's name
    const sql = 'UPDATE transactions SET status = ?, approved_by = ? WHERE id = ?';
    const [result] = await pool.query(sql, ['approved', parent_name, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ message: 'Transaction approved successfully' });
  } catch (error) {
    console.error('Failed to approve transaction:', error);
    res.status(500).json({ error: 'Database update failed' });
  }
});

// DELETE: Decline and delete a transaction
app.put('/api/money/transactions/:id/decline', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Only admins can decline transactions.' });
    }
    try {
        const { id } = req.params;
        const adminName = req.user.name; // Get admin name from authenticated token

        // Update the transaction status to 'declined' and record who declined it
        const sql = 'UPDATE transactions SET status = ?, approved_by = ? WHERE id = ?';
        const [result] = await pool.query(sql, ['declined', adminName, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Transaction not found.' });
        }

        res.status(200).json({ message: 'Transaction declined successfully.' });
    } catch (error) {
        console.error('Failed to decline transaction:', error);
        res.status(500).json({ error: 'Database update failed' });
    }
});

// --- Start the Server ---
pool.getConnection()
  .then(connection => {
    console.log('Successfully connected to the MySQL database.');
    connection.release();
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error('Error connecting to the database:', error);
    process.exit(1);
  });