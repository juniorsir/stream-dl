// api/index.js - The Definitive Server Entry Point

// --- Module Imports ---
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const rateLimit = require('express-rate-limit');
const apiRoutes = require('./routes');
const { initializeDatabase } = require('./db');

// --- Application Setup ---
const app = express();
const PORT = process.env.PORT || 4000;

// This is crucial for rate-limiting to work correctly behind Render's proxy.
app.set('trust proxy', 1);

// --- Configuration & Global Paths ---
const projectRoot = process.cwd();
const isProduction = process.env.NODE_ENV === 'production';
const ytDlpPath = isProduction ? path.join(projectRoot, 'bin', 'yt-dlp') : 'yt-dlp';
const ffmpegPath = isProduction ? path.join(projectRoot, 'bin', 'ffmpeg') : 'ffmpeg';

// --- Startup Permission Fixer ---
const ensurePermissions = () => {
    // ... (This function is correct, no changes needed)
    return new Promise((resolve) => {
        if (!isProduction) {
            console.log("Skipping permission check in development mode.");
            return resolve();
        }
        console.log("Setting executable permissions for binaries...");
        const chmodProcess = spawn('chmod', ['+x', ytDlpPath, ffmpegPath]);
        chmodProcess.on('close', (code) => {
            if (code === 0) console.log("Permissions set successfully.");
            else console.warn(`Chmod process exited with code ${code}. This may be okay.`);
            resolve();
        });
        chmodProcess.on('error', (err) => {
            console.error("Error running chmod:", err.message);
            console.warn("Could not set permissions automatically.");
            resolve();
        });
    });
};

// --- Middleware Setup ---
app.use(cors());
app.use(express.json());

// Configure the rate limiter
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Limit each IP to 200 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again after 15 minutes.' },
});

// --- Route Handling (Recommended Order) ---
// 1. API routes are handled first, with rate limiting applied.
app.use('/api', apiLimiter, apiRoutes);

// 2. Static files are served next.
app.use(express.static(path.join(projectRoot, 'public')));

// 3. Health check endpoint.
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Server is healthy.' });
});

// 4. SPA catch-all is last. It serves index.html for any remaining GET requests.
app.get('*', (req, res) => {
    res.sendFile(path.join(projectRoot, 'public', 'index.html'));
});


// --- Global Error Handling Middleware ---
app.use((err, req, res, next) => {
    // ... (This function is correct, no changes needed)
    console.error("--- A CRITICAL UNHANDLED ERROR OCCURRED ---");
    console.error(err.stack);
    console.error("-----------------------------------------");
    if (!res.headersSent) {
        res.status(500).json({
            error: "A critical server error occurred. The administrator has been notified."
        });
    }
});


// --- Server Startup Logic ---
const startServer = async () => {
    // ... (This function is correct, no changes needed)
    try {
        await ensurePermissions();
        if (process.env.DATABASE_URL) {
            await initializeDatabase();
        } else {
            console.warn("WARNING: DATABASE_URL not found, skipping database setup.");
        }
        app.listen(PORT, () => {
            console.log(`🚀 Ultimate server is running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("FATAL: Failed to start server:", error);
        process.exit(1);
    }
};

startServer();
