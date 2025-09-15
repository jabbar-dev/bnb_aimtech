// backend/config/db.js
const mongoose = require('mongoose');

let isConnected = false;

async function connectDB() {
  if (isConnected) return; // avoid duplicate connects on hot-reload/Passenger

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set in environment');
  }

  try {
    // Optional in Mongoose 8+, harmless if kept
    mongoose.set('strictQuery', true);

    await mongoose.connect(uri, {
      // You can add options if needed:
      // serverSelectionTimeoutMS: 10000,
      // maxPoolSize: 10,
      // dbName: process.env.MONGO_DB, // only if your URI doesn't include db
    });

    isConnected = true;
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    throw err; // let server.js handle exit / retry
  }
}

// Also export the mongoose instance if needed: require('./config/db').mongoose
connectDB.mongoose = mongoose;

module.exports = connectDB;
