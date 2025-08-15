// api/rapidapi-routes.js

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const { verifyRapidAPI } = require('./rapidapi-middleware');
const { pool } = require('./db');
const NodeCache = require('node-cache');

const router = express.Router();
const cache = new NodeCache({ stdTTL: 3600 }); // Use a separate cache if desired

// --- Path Configuration ---
const projectRoot = process.cwd();
const isProduction = process.env.NODE_ENV === 'production';
const ytDlpPath = isProduction ? path.join(projectRoot, 'bin', 'yt-dlp') : 'yt-dlp';
const cookiesPath = path.join(projectRoot, 'cookies.txt');

const MAX_DURATION_BASIC_PLAN = parseInt(process.env.MAX_DURATION_BASIC_PLAN) || 600; // 10 minutes (in seconds)
const MAX_DURATION_PRO_PLAN = parseInt(process.env.MAX_DURATION_PRO_PLAN) || 3600;
// --- Helper Functions ---
const parseYtdlpError = (stderr) => { if (!stderr) return 'An unknown error occurred.'; if (stderr.includes('private video')) return 'This video is private.'; if (stderr.includes('Sign in to confirm')) return 'This video requires login. Cookies may be needed.'; if (stderr.includes('Unsupported URL')) return 'This website or URL is not supported.'; if (stderr.includes('404')) return 'Video not found (404).'; if (stderr.includes('KeyError')) return 'This site has changed its structure.'; const errorLines = stderr.trim().split('\n').filter(line => line.trim() !== ''); const specificError = errorLines.pop(); return specificError ? `yt-dlp ERROR: ${specificError}` : 'An unknown error occurred.'; };

const logRapidApiRequest = async (url, user) => {
    // You can create a new logging function or table for paying customers
    console.log(`RapidAPI Request from user [${user || 'UNKNOWN'}] for URL: ${url}`);
    // Optionally log to your database:
    // if (url && process.env.DATABASE_URL) {
    //     await pool.query('INSERT INTO rapidapi_logs(url, username) VALUES($1, $2)', [url, user]);
    // }
};

// --- The Endpoint You Will Sell ---
// This is the most valuable endpoint. We protect it with our new middleware.
router.post('/get-data', verifyRapidAPI, async (req, res, next) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'A "url" parameter is required in the request body.' });
        }

        // Log the request, using the username provided by RapidAPI
        const rapidApiUser = req.get('X-RapidAPI-User');
        await logRapidApiRequest(url, rapidApiUser);

        const cacheKey = `rapidapi_data_${url}`;
        if (cache.has(cacheKey)) {
            const cachedData = cache.get(cacheKey);
            // If the cached entry is an error, return it immediately
            if (cachedData.error) {
                console.log(`[CACHE_HIT_FAILURE] Serving cached error for: ${url}`);
                return res.status(500).json(cachedData);
            }
            return res.json(cachedData);
        }

        const pythonHelperPath = path.join(projectRoot, 'api', 'yt_dlp_helper.py');
        const pythonProcess = spawn('python3', [pythonHelperPath, url]);

        let output = '', errorOutput = '';
        pythonProcess.stdout.on('data', (data) => output += data.toString());
        pythonProcess.stderr.on('data', (data) => errorOutput += data.toString());
        pythonProcess.on('error', (err) => next(err));

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                const errorResponse = { error: parseYtdlpError(errorOutput) };
                // --- NEW: Cache the failure for 5 minutes (300 seconds) ---
                console.log(`[CACHE_SET_FAILURE] Caching failure for: ${url}`);
                cache.set(cacheKey, errorResponse, 300);
                return res.status(500).json(errorResponse);
            }
            try {
                // Parse and format the data just like in your original routes.js
                const info = JSON.parse(output);
                const duration = info.duration || 0;
                const subscription = req.get('X-RapidAPI-Subscription') || 'BASIC'; // Default to BASIC if header is missing
                const allowMerging = subscription.toUpperCase() !== 'BASIC'; // Only paid plans can merge
                console.log(`[ACCESS_CONTROL] User: ${rapidApiUser}, Plan: ${subscription}, Duration: ${duration}s, Merging Allowed: ${allowMerging}`);
                if (subscription.toUpperCase() === 'BASIC' && duration > MAX_DURATION_BASIC_PLAN) {
                    return res.status(403).json({ error: `Forbidden. Your plan (BASIC) is limited to videos under ${MAX_DURATION_BASIC_PLAN / 60} minutes. This video is ~${Math.round(duration / 60)} minutes.` });
                }
                if (subscription.toUpperCase() !== 'BASIC' && duration > MAX_DURATION_PRO_PLAN) {
                    return res.status(403).json({ error: `Forbidden. Your plan is limited to videos under ${MAX_DURATION_PRO_PLAN / 60} minutes. This video is ~${Math.round(duration / 60)} minutes.` });
                }
                
                const formats = (info.formats || []).map(f => {
                    if (!allowMerging && f.vcodec !== 'none' && f.acodec === 'none') {
                            return null;
                    }
                    let filesize = f.filesize || f.filesize_approx;
                    if (!filesize && f.tbr && duration > 0) { filesize = (f.tbr * 1000 / 8) * duration; }
                    let filesize_str = "N/A";
                    if (filesize) { const size_mib = filesize / (1024 * 1024); if (size_mib >= 1000) { filesize_str = `${(size_mib / 1024).toFixed(2)} GiB`; } else { filesize_str = `${size_mib.toFixed(1)} MiB`; } }
                    return { format_id: f.format_id, ext: f.ext, resolution: f.resolution || (f.height ? `${f.height}p` : "audio only"), filesize: filesize_str, vcodec: f.vcodec || 'none', acodec: f.acodec || 'none' };
                }).filter(Boolean);

                const responseData = { title: info.title, thumbnail: info.thumbnail, formats: formats };
                cache.set(cacheKey, responseData);
                res.json(responseData);
            } catch (e) {
                res.status(500).json({ error: 'Failed to parse video data.' });
            }
        });

    } catch (error) {
        next(error);
    }
});

module.exports = router;
