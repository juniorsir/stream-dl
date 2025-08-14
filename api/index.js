// api/index.js - The Definitive Server Entry Point

// --- Module Imports ---
require('dotenv').config(); // Loads environment variables from a .env file into process.env
const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const apiRoutes = require('./routes');
const { initializeDatabase } = require('./db');

// --- Application Setup ---
const app = express();
const PORT = process.env.PORT || 4000;

// --- Configuration & Global Paths ---
const projectRoot = process.cwd();
const isProduction = process.env.NODE_ENV === 'production';
// Define paths to the binaries. This is crucial for deployment.
const ytDlpPath = isProduction ? path.join(projectRoot, 'bin', 'yt-dlp') : 'yt-dlp';
const ffmpegPath = isProduction ? path.join(projectRoot, 'bin', 'ffmpeg') : 'ffmpeg';

// --- Startup Permission Fixer ---
// This function runs on startup to ensure the bundled binaries are executable,
// which is a common requirement on hosting platforms like Vercel.
const ensurePermissions = () => {
    return new Promise((resolve) => {
        // We only need to do this in a production environment.
        if (!isProduction) {
            console.log("Skipping permission check in development mode.");
            return resolve();
        }
        
        console.log("Setting executable permissions for binaries...");
        // Use 'chmod +x' to make the files executable.
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
            resolve(); // Resolve anyway so the server can try to start.
        });
    });
};

// --- Middleware Setup ---
// The order of middleware is important.
app.use(cors()); // Enable Cross-Origin Resource Sharing for all routes.
app.use(express.json()); // Enable the express app to parse JSON formatted request bodies.
app.use(express.static(path.join(projectRoot, 'public'))); // Serve static files (HTML, CSS, JS) from the 'public' directory.

// --- Route Handling ---
app.use('/api', apiRoutes); // All API logic is handled by routes.js, prefixed with /api.

// A simple health check endpoint to verify the server is running.
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Server is healthy.' });
});

// A catch-all route for Single Page Applications (SPA).
// This serves the main index.html for any non-API GET request.
// This must come AFTER your API routes.
app.get('*', (req, res) => {
    res.sendFile(path.join(projectRoot, 'public', 'index.html'));
});


// --- Global Error Handling Middleware ---
// This is the final safety net. It catches any unhandled errors from other routes.
// It MUST be the last `app.use()` call before `app.listen`.
app.use((err, req, res, next) => {
    // Log the full error stack trace to the console for detailed debugging.
    console.error("--- A CRITICAL UNHANDLED ERROR OCCURRED ---");
    console.error(err.stack);
    console.error("-----------------------------------------");

    // Send a generic, user-friendly JSON error message back to the client.
    // Avoid sending detailed stack traces to the public for security reasons.
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

        // Initialize the database only if the connection URL is provided.
        if (process.env.DATABASE_URL) {
            await initializeDatabase();
        } else {
            console.warn("WARNING: DATABASE_URL not found, skipping database setup. Admin logs and analytics will not be persistent.");
        }

        // THIS IS THE LINE THAT KEEPS THE SCRIPT RUNNING.
        // It starts the server and makes it listen for incoming requests.
        app.listen(PORT, () => {
            console.log(`🚀 Ultimate server is running on http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error("FATAL: Failed to start server:", error);
        process.exit(1); // Exit the process with an error code if startup fails critically.
    }
};

// Start the server!
startServer();
