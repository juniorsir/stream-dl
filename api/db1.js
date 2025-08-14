// api/db.js - The Definitive, Corrected Version

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // This SSL configuration is required for connecting to Render's PostgreSQL
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

/**
 * This function runs on server startup to ensure all necessary database tables exist.
 * It's "idempotent," meaning it can be run safely multiple times.
 */
const initializeDatabase = async () => {
    // Defines the table for storing recent request logs
    const logsTableQuery = `
        CREATE TABLE IF NOT EXISTS request_logs (
            id SERIAL PRIMARY KEY,
            url TEXT NOT NULL,
            timestamp TIMESTAMPTZ DEFAULT NOW()
        );
    `;
    
    // Defines the table for storing owner-blocked domains
    const domainsTableQuery = `
        CREATE TABLE IF NOT EXISTS blocked_domains (
            id SERIAL PRIMARY KEY,
            domain TEXT NOT NULL UNIQUE,
            timestamp TIMESTAMPTZ DEFAULT NOW()
        );
    `;
    
    // Defines the table for persistent settings, like the download mode toggle
    const settingsTableQuery = `
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value BOOLEAN NOT NULL
        );
    `;
    
    try {
        // Execute the queries to create the tables if they don't exist
        await pool.query(logsTableQuery);
        await pool.query(domainsTableQuery);
        await pool.query(settingsTableQuery);
        
        // Insert the default setting for download mode, but only if it's not already there.
        await pool.query(`
            INSERT INTO settings (key, value) 
            VALUES ('is_redirect_mode_enabled', false) 
            ON CONFLICT (key) DO NOTHING;
        `);
        
        console.log("Database tables are ready.");
    } catch (err) {
        console.error("Error creating or initializing database tables:", err);
    }
};

module.exports = { pool, initializeDatabase };
