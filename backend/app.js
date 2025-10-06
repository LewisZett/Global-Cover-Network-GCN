const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DBNAME || 'gcn';
const PI_API_KEY = process.env.PI_API_KEY;
const PORT = process.env.PORT || 3001;

// MongoDB connection
let db, orders;
MongoClient.connect(MONGODB_URI, { useUnifiedTopology: true })
  .then(client => {
    db = client.db(DB_NAME);
    orders = db.collection('orders');
    console.log("Connected to MongoDB");
  })
  .catch(err => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// Verify Pi accessToken
app.post('/signin', async (req, res) => {
  try {
    const { authResult } = req.body;
    const accessToken = authResult.accessToken;
    const piUserResponse = await axios.get('https://api.minepi.com/v2/me', {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'pi-api-key': PI_API_KEY }
    });
    // User data is valid
    res.json({ success: true, user: piUserResponse.data });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid Pi token', error: err.message });
  }
});

// Create a Pi payment request
app.post('/create-payment', async (req, res) => {
  try {
    const { amount, memo, metadata } = req.body;
    // Create a new order in DB, status: pending
    const order = {
      amount,
      memo,
      metadata,
      createdAt: new Date(),
      status: 'pending'
    };
    const result = await orders.insertOne(order);

    // Build the payment object for Pi SDK
    const payment = {
      amount,
      memo,
      metadata: { ...metadata, orderId: result.insertedId.toString() }
    };

    res.json({ success: true, payment });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create payment', error: err.message });
  }
});

// (OPTIONAL) Pi Network callbacks: approve, complete, cancel
app.post('/payment-callback/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { paymentId, txid } = req.body;
    const validTypes = ['approve', 'complete', 'cancel'];
    if (!validTypes.includes(type)) return res.status(400).json({ message: 'Invalid callback type' });

    // Update order status in DB
    const update = {};
    if (type === 'approve') update.status = 'approved';
    if (type === 'complete') { update.status = 'completed'; update.txid = txid; }
    if (type === 'cancel') update.status = 'cancelled';

    await orders.updateOne({ 'metadata.orderId': paymentId }, { $set: update });

    res.json({ success: true, message: `Order status updated: ${type}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Callback failed', error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
