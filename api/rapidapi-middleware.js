// api/rapidapi-middleware.js

const RAPIDAPI_PROXY_SECRET = process.env.RAPIDAPI_PROXY_SECRET;

const verifyRapidAPI = (req, res, next) => {
    // 1. Check if the required environment variable is set on your server.
    if (!RAPIDAPI_PROXY_SECRET) {
        console.error("FATAL: RAPIDAPI_PROXY_SECRET is not configured on the server.");
        return res.status(500).json({ error: "API provider configuration error." });
    }

    // 2. Get the secret header sent by the RapidAPI proxy.
    const proxySecret = req.get('X-RapidAPI-Proxy-Secret');

    // 3. Compare the header with your secret environment variable.
    if (proxySecret && proxySecret === RAPIDAPI_PROXY_SECRET) {
        // The request is legitimate and came from RapidAPI. Proceed to the endpoint.
        return next();
    } else {
        // If the secret is missing or incorrect, block the request.
        // This prevents anyone from bypassing RapidAPI and hitting your server directly.
        return res.status(403).json({ error: "Forbidden. You are not authorized to access this endpoint directly." });
    }
};

module.exports = { verifyRapidAPI };
