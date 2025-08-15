// api/url-validator.js
const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');

// List of private/reserved IP address ranges.
const privateRanges = [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.88.99.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0/4",
    "255.255.255.255/32",
    "::1/128",
    "fc00::/7",
    "fe80::/10"
];

const validatePublicUrl = async (req, res, next) => {
    const urlString = req.body.url || req.query.url;
    if (!urlString) {
        // Let the endpoint handler decide if URL is required.
        return next();
    }

    try {
        const url = new URL(urlString);
        const hostname = url.hostname;

        // Prevent requests to localhost.
        if (hostname === 'localhost') {
             return res.status(403).json({ error: "Access to localhost is forbidden." });
        }

        // Resolve the hostname to an IP address.
        const { address } = await dns.lookup(hostname);
        const ip = ipaddr.parse(address);

        // Check if the resolved IP is in any of the private ranges.
        const isPrivate = privateRanges.some(range => ip.match(ipaddr.parseCIDR(range)));

        if (isPrivate) {
            return res.status(403).json({ error: "URL resolves to a private or reserved IP address." });
        }

        // If all checks pass, proceed to the next middleware.
        next();

    } catch (error) {
        // This can happen for invalid URLs or DNS lookup failures.
        return res.status(400).json({ error: "Invalid or unresolvable URL provided." });
    }
};

module.exports = { validatePublicUrl };
