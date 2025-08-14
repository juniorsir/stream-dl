// api/routes.js - Updated with Analytics Endpoints

const express = require('express');
const rateLimit = require('express-rate-limit');
const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const geoip = require('geoip-lite'); // <-- NEW: For country lookup
const { pool } = require('./db');
const NodeCache = require('node-cache');

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Only 5 login attempts per 15 minutes per IP
    message: { error: 'Too many login attempts. Please try again later.' },
});

const cache = new NodeCache({ stdTTL: 3600 });
let blockedDomains = new Set();
let isRedirectMode = false;

// --- Smart Path Configuration ---
const projectRoot = process.cwd();
const isProduction = process.env.NODE_ENV === 'production';
const ytDlpPath = isProduction ? path.join(projectRoot, 'bin', 'yt-dlp') : 'yt-dlp';
const ffmpegPath = isProduction ? path.join(projectRoot, 'bin', 'ffmpeg') : 'ffmpeg';
const cookiesPath = path.join(projectRoot, 'cookies.txt');

const JWT_SECRET = process.env.JWT_SECRET;
const APP_URL = process.env.APP_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// --- Helper Functions ---
const loadSettings = async () => { if (!process.env.DATABASE_URL) return; try { const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'is_redirect_mode_enabled'"); if (rows.length > 0) { isRedirectMode = rows[0].value; console.log(`Loaded settings: Redirect Mode is ${isRedirectMode ? 'ENABLED' : 'DISABLED'}.`); } } catch (err) { console.error("Could not load settings:", err); }};
const loadBlockedDomains = async () => { if (!process.env.DATABASE_URL) return; try { const { rows } = await pool.query('SELECT domain FROM blocked_domains'); blockedDomains = new Set(rows.map(row => row.domain)); console.log(`Loaded ${blockedDomains.size} blocked domains.`); } catch (err) { console.error("Could not load blocked domains:", err); }};
loadSettings();
loadBlockedDomains();

// MODIFIED: The logging function now accepts a country code.
const logRequestToDb = async (url, countryCode) => {
    if (!url || !process.env.DATABASE_URL) return;
    try {
        await pool.query('INSERT INTO request_logs(url, country_code) VALUES($1, $2)', [url, countryCode]);
    } catch (err) {
        console.error("DB Log Error:", err);
    }
};
const parseYtdlpError = (stderr) => { if (!stderr) return 'An unknown error occurred.'; if (stderr.includes('private video')) return 'This video is private.'; if (stderr.includes('Sign in to confirm')) return 'This video requires login. Cookies may be needed.'; if (stderr.includes('Unsupported URL')) return 'This website or URL is not supported.'; if (stderr.includes('404')) return 'Video not found (404).'; if (stderr.includes('KeyError')) return 'This site has changed its structure.'; const errorLines = stderr.trim().split('\n').filter(line => line.trim() !== ''); const specificError = errorLines.pop(); return specificError ? `yt-dlp ERROR: ${specificError}` : 'An unknown error occurred.'; };

// --- Security Middleware (No changes here) ---
const checkOrigin = (req, res, next) => { if (process.env.NODE_ENV === 'production') { const requestOrigin = req.get('origin') || req.get('referer'); if (!APP_URL) return res.status(500).json({ error: "Server config error: APP_URL not set." }); if (requestOrigin && requestOrigin.startsWith(APP_URL)) return next(); else return res.status(403).json({ error: "Forbidden: Access from this origin is not allowed." }); } else return next(); };
const verifyTicket = (req, res, next) => { if (!JWT_SECRET) return res.status(500).json({ error: "Server config error: JWT_SECRET not set." }); const authHeader = req.headers.authorization; if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: "Authorization ticket missing." }); const token = authHeader.split(' ')[1]; try { jwt.verify(token, JWT_SECRET); next(); } catch (err) { return res.status(403).json({ error: "Forbidden: Invalid or expired ticket." }); } };
const verifyAdmin = (req, res, next) => { const authHeader = req.headers.authorization; if (!ADMIN_PASSWORD) return res.status(500).json({ error: "Admin not configured." }); if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" }); next(); };
const checkIfBlocked = (req, res, next) => { const { url } = req.body; if (url && [...blockedDomains].some(domain => url.includes(domain))) { return res.status(403).json({ error: "Access to this website is blocked by the administrator." }); } next(); };

// --- API Endpoints ---
router.get('/get-ticket', checkOrigin, (req, res, next) => { try { const token = jwt.sign({ iss: 'video-api' }, JWT_SECRET, { expiresIn: '15m' }); res.json({ ticket: token }); } catch(err) { next(err); }});

router.post('/get-data', verifyTicket, checkIfBlocked, async (req, res, next) => {
    try {
        // MODIFIED: Perform IP lookup and log with country code.
        // Get the real IP from the 'x-forwarded-for' header (used by services like Vercel/Render) or fall back to req.ip.
        const forwardedFor = req.headers['x-forwarded-for'];
        let ip;
        if (forwardedFor) {
            ip = forwardedFor.split(',')[0].trim();
        } else {
            ip = req.socket.remoteAddress;
        }
        
        console.log(`[DEBUG] Detected IP: ${ip}`);
        const geo = ip ? geoip.lookup(ip) : null;
        const countryCode = geo ? geo.country : null;
        console.log(`[DEBUG] Looked up Country Code: ${countryCode}`);
        await logRequestToDb(req.body.url, countryCode);

        // ... rest of the function is unchanged
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL required' });
        const cacheKey = `data_${url}`;
        if (cache.has(cacheKey)) { return res.json(cache.get(cacheKey)); }
        const pythonHelperPath = path.join(projectRoot, 'api', 'yt_dlp_helper.py');
        const pythonProcess = spawn('python3', [pythonHelperPath, url]);
        let output = '', errorOutput = '';
        pythonProcess.stdout.on('data', (data) => output += data.toString());
        pythonProcess.stderr.on('data', (data) => errorOutput += data.toString());
        pythonProcess.on('error', (err) => next(err));
        pythonProcess.on('close', (code) => {
            if (code !== 0) { return res.status(500).json({ error: parseYtdlpError(errorOutput) }); }
            try {
                const info = JSON.parse(output);
                const duration = info.duration || 0;
                const formats = (info.formats || []).map(f => {
                    if (!f.format_id || f.ext === 'mhtml' || (f.vcodec && f.vcodec.includes('images'))) { return null; }
                    let filesize = f.filesize || f.filesize_approx;
                    if (!filesize && f.tbr && duration > 0) { filesize = (f.tbr * 1000 / 8) * duration; }
                    let filesize_str = "N/A";
                    if (filesize) { const size_mib = filesize / (1024 * 1024); if (size_mib >= 1000) { filesize_str = `${(size_mib / 1024).toFixed(2)} GiB`; } else { filesize_str = `${size_mib.toFixed(1)} MiB`; } }
                    return { format_id: f.format_id, ext: f.ext, resolution: f.resolution || (f.height ? `${f.height}p` : "audio only"), filesize: filesize_str, note: f.format_note || '', vcodec: f.vcodec || 'none', acodec: f.acodec || 'none' };
                }).filter(Boolean);
                const responseData = { title: info.title, thumbnail: info.thumbnail, formats: formats };
                cache.set(cacheKey, responseData);
                res.json(responseData);
            } catch (e) { console.error("Error parsing JSON from Python helper:", e.message); res.status(500).json({ error: 'Failed to parse video data from helper.' }); }
        });
    } catch (error) { next(error); }
});

// ... Other endpoints like /get-url, /image-proxy, /download remain unchanged ...
router.post('/get-url', verifyTicket, checkIfBlocked, (req, res, next) => { try { const { url, format_id } = req.body; if (!url || !format_id) return res.status(400).json({ error: 'URL and format_id required' }); const ytdlpProcess = spawn(ytDlpPath, ['-f', format_id, '--get-url', '--cookies', cookiesPath, url, '--ffmpeg-location', ffmpegPath]); let output = '', errorOutput = ''; ytdlpProcess.stdout.on('data', (data) => output += data); ytdlpProcess.stderr.on('data', (data) => errorOutput += data); ytdlpProcess.on('error', (err) => next(err)); ytdlpProcess.on('close', (code) => { if (code !== 0) return res.status(500).json({ error: 'Failed to get direct URL.' }); res.json({ direct_url: output.trim() }); }); } catch (error) { next(error); }});
router.get('/image-proxy', async (req, res) => { const { url } = req.query; if (!url) return res.status(400).send('URL required'); try { const imageResponse = await axios({ method: 'get', url, responseType: 'stream' }); res.setHeader('Content-Type', imageResponse.headers['content-type']); imageResponse.data.pipe(res); } catch (error) { res.status(404).send('Image not found'); } });
router.get('/download', (req, res, next) => { try { const { url, format_id, title } = req.query; if (!url || !format_id) return res.status(400).json({ error: 'URL and format_id required' }); let finalFormatString; const isVideoOnly = req.query.video_only === 'true'; if (isVideoOnly) { finalFormatString = `${format_id}+bestaudio`; } else { finalFormatString = format_id; } if (isRedirectMode) { const commandArgs = ['-f', finalFormatString, '--get-url', '--cookies', cookiesPath, url, '--ffmpeg-location', ffmpegPath]; const ytdlpProcess = spawn(ytDlpPath, commandArgs); let directUrl = ''; ytdlpProcess.stdout.on('data', (data) => directUrl += data.toString()); ytdlpProcess.on('error', (err) => next(err)); ytdlpProcess.on('close', (code) => { if (code !== 0) return res.status(500).send('Failed to get direct URL for redirect.'); res.redirect(302, directUrl.trim()); }); } else { const cleanTitle = (title || 'video').replace(/[^a-z0-9_.-]/gi, '_').substring(0, 100); res.setHeader('Content-Disposition', `attachment; filename="${cleanTitle}.mp4"`); const commandArgs = [url, '-f', finalFormatString, '--cookies', cookiesPath, '-o', '-', '--ffmpeg-location', ffmpegPath]; const ytdlpProcess = spawn(ytDlpPath, commandArgs); ytdlpProcess.stdout.pipe(res); ytdlpProcess.stderr.on('data', (data) => console.error(`yt-dlp stderr: ${data}`)); ytdlpProcess.on('error', (err) => next(err)); } } catch (error) { if (!res.headersSent) res.status(500).json({ error: 'An internal server error occurred.' }); }});

// --- Admin Endpoints ---
router.post('/admin/login', loginLimiter, (req, res) => { const { password } = req.body; if (!ADMIN_PASSWORD) return res.status(500).json({ error: "Admin not configured." }); if (password === ADMIN_PASSWORD) res.json({ success: true }); else res.status(401).json({ success: false, error: "Invalid password" }); });
router.get('/admin/stats', verifyAdmin, (req, res) => { res.json({ cacheSize: cache.getStats().keys }); });

// MODIFIED: /admin/requests now includes country code
router.get('/admin/requests', verifyAdmin, async (req, res) => {
    if (!process.env.DATABASE_URL) return res.json([]);
    try {
        const { rows } = await pool.query('SELECT url, timestamp, country_code FROM request_logs ORDER BY timestamp DESC LIMIT 50');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch request logs." });
    }
});

// NEW: Analytics endpoint to calculate and return daily and country stats
router.get('/admin/analytics', verifyAdmin, async (req, res, next) => {
    if (!process.env.DATABASE_URL) {
        return res.json({ dailyCounts: [], countryCounts: [] });
    }
    try {
        // Fetch daily counts for the last 30 days
        const dailyQuery = `
            SELECT DATE(timestamp) as request_date, COUNT(*) as request_count 
            FROM request_logs
            WHERE timestamp > NOW() - INTERVAL '30 days'
            GROUP BY request_date 
            ORDER BY request_date DESC;
        `;
        
        // Fetch top 10 country counts for the last 30 days
        const countryQuery = `
            SELECT country_code, COUNT(*) as count 
            FROM request_logs 
            WHERE country_code IS NOT NULL AND timestamp > NOW() - INTERVAL '30 days'
            GROUP BY country_code 
            ORDER BY count DESC 
            LIMIT 10;
        `;

        const [dailyResult, countryResult] = await Promise.all([
            pool.query(dailyQuery),
            pool.query(countryQuery)
        ]);

        res.json({
            dailyCounts: dailyResult.rows,
            countryCounts: countryResult.rows
        });
    } catch (err) {
        next(err); // Pass error to global error handler
    }
});

// ... Other admin endpoints remain unchanged ...
router.post('/admin/clear-cache', verifyAdmin, (req, res) => { cache.flushAll(); res.json({ success: true, message: "Cache cleared." }); });
router.get('/admin/blocked-domains', verifyAdmin, async (req, res) => { res.json(Array.from(blockedDomains)); });
router.post('/admin/blocked-domains', verifyAdmin, async (req, res) => { const { domain } = req.body; if (!domain) return res.status(400).json({ error: "Domain is required." }); try { await pool.query('INSERT INTO blocked_domains(domain) VALUES($1) ON CONFLICT (domain) DO NOTHING', [domain.trim()]); await loadBlockedDomains(); res.status(201).json({ success: true }); } catch (err) { res.status(500).json({ error: "Failed to add domain." }); }});
router.delete('/admin/blocked-domains', verifyAdmin, async (req, res) => { const { domain } = req.body; if (!domain) return res.status(400).json({ error: "Domain is required." }); try { await pool.query('DELETE FROM blocked_domains WHERE domain = $1', [domain.trim()]); await loadBlockedDomains(); res.json({ success: true }); } catch (err) { res.status(500).json({ error: "Failed to remove domain." }); }});
router.get('/admin/settings', verifyAdmin, (req, res) => { res.json({ is_redirect_mode_enabled: isRedirectMode }); });
router.post('/admin/settings', verifyAdmin, async (req, res) => { const { is_redirect_mode_enabled } = req.body; if (typeof is_redirect_mode_enabled !== 'boolean') return res.status(400).json({ error: 'Value must be a boolean.' }); try { await pool.query("UPDATE settings SET value = $1 WHERE key = 'is_redirect_mode_enabled'", [is_redirect_mode_enabled]); await loadSettings(); res.json({ success: true, is_redirect_mode_enabled: isRedirectMode }); } catch (err) { res.status(500).json({ error: "Failed to update settings." }); }});


module.exports = router;
