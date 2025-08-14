// api/db.js - The Definitive, Self-Healing Version

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

/**
 * Checks if a specific column exists in a table.
 * @param {string} tableName - The name of the table.
 * @param {string} columnName - The name of the column to check for.
 * @returns {Promise<boolean>} - True if the column exists, false otherwise.
 */
const columnExists = async (tableName, columnName) => {
    const query = `
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2;
    `;
    const { rows } = await pool.query(query, [tableName, columnName]);
    return rows.length > 0;
};

/**
 * This function runs on server startup to ensure all necessary database tables and columns exist.
 * It's "idempotent," meaning it can be run safely multiple times.
 */
const initializeDatabase = async () => {
    const client = await pool.connect(); // Use a single client for all setup operations
    try {
        await client.query('BEGIN'); // Start a transaction

        // Defines the table for storing recent request logs
        await client.query(`
            CREATE TABLE IF NOT EXISTS request_logs (
                id SERIAL PRIMARY KEY,
                url TEXT NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        
        // Defines the table for storing owner-blocked domains
        await client.query(`
            CREATE TABLE IF NOT EXISTS blocked_domains (
                id SERIAL PRIMARY KEY,
                domain TEXT NOT NULL UNIQUE,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        
        // Defines the table for persistent settings
        await client.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value BOOLEAN NOT NULL
            );
        `);
        
        // --- Self-Healing Schema Migration ---
        // Check if the 'country_code' column is missing from the request_logs table.
        const countryCodeColumnExists = await columnExists('request_logs', 'country_code');
        if (!countryCodeColumnExists) {
            console.log("Schema update: 'country_code' column not found in 'request_logs'. Adding it now...");
            // If it's missing, add it. This is non-destructive.
            await client.query('ALTER TABLE request_logs ADD COLUMN country_code CHAR(2);');
            console.log("Successfully added 'country_code' column.");
        }
        
        // Insert the default setting for download mode, but only if it's not already there.
        await client.query(`
            INSERT INTO settings (key, value) 
            VALUES ('is_redirect_mode_enabled', false) 
            ON CONFLICT (key) DO NOTHING;
        `);

        await client.query('COMMIT'); // Commit the transaction
        console.log("Database tables and columns are verified and ready.");

    } catch (err) {
        await client.query('ROLLBACK'); // Roll back on error
        console.error("Error creating or initializing database tables:", err);
        throw err; // Re-throw the error to prevent the server from starting in a bad state
    } finally {
        client.release(); // Always release the client back to the pool
    }
};

module.exports = { pool, initializeDatabase };
