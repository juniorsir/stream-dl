// api/index.js - The Definitive Server Entry Point

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const apiRoutes = require('./routes');
const { initializeDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

// --- Configuration ---
const projectRoot = process.cwd();
const ytDlpPath = path.join(projectRoot, 'bin', 'yt-dlp');
const ffmpegPath = path.join(projectRoot, 'bin', 'ffmpeg');

// --- Bulletproof Permission Fixer ---
// This function runs on every startup to ensure the binaries are executable.
const ensurePermissions = () => {
    return new Promise((resolve) => {
        console.log("Setting executable permissions for binaries...");
        const chmodProcess = spawn('chmod', ['+x', ytDlpPath, ffmpegPath]);

        chmodProcess.on('close', (code) => {
            if (code === 0) {
                console.log("Permissions set successfully.");
            } else {
                // This is not a fatal error, as permissions might already be set.
                console.warn(`Chmod process exited with code ${code}. This may be okay.`);
            }
            resolve();
        });

        chmodProcess.on('error', (err) => {
            console.error("Error running chmod:", err.message);
            console.warn("Could not set permissions automatically. Ensure bin/yt-dlp and bin/ffmpeg are executable.");
            resolve();
        });
    });
};

// --- Middleware Setup ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(projectRoot, 'public')));

// --- Route Handling ---
app.use('/api', apiRoutes); // All API logic is in routes.js
app.get('/health', (req, res) => { res.status(200).json({ status: 'ok' }); });
// A catch-all to serve the main index.html for any non-API route
app.get('*', (req, res) => {
    res.sendFile(path.join(projectRoot, 'public', 'index.html'));
});


// --- Global Error Handling Middleware ---
// This is the safety net. It MUST be the last `app.use()` call before `startServer`.
app.use((err, req, res, next) => {
    // Log the full error stack trace to the console for detailed debugging.
    console.error("--- A CRITICAL UNHANDLED ERROR OCCURRED ---");
    console.error(err.stack);
    console.error("-----------------------------------------");

    // Send a generic, user-friendly JSON error message back to the client.
    // Avoid sending detailed stack traces to the public.
    if (!res.headersSent) {
        res.status(500).json({
            error: "A critical server error occurred. The administrator has been notified."
        });
    }
});


// --- Server Startup Logic ---
const startServer = async () => {
    try {
        await ensurePermissions(); // Run the permission fixer first.

        if (process.env.DATABASE_URL) {
            await initializeDatabase();
        } else {
            console.warn("DATABASE_URL not found, skipping database setup. Admin logs will not be persistent.");
        }

        app.listen(PORT, () => {
            console.log(`🚀 Ultimate server is running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("FATAL: Failed to start server:", error);
        process.exit(1); // Exit the process if startup fails critically.
    }
};

startServer();
