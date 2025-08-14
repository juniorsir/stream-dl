// script.js - The Definitive Version with a robust, JSON-driven API client.

let sessionTicket = null;

async function getSessionTicket() {
    try {
        const response = await fetch('/api/get-ticket');
        if (!response.ok) throw new Error('Could not acquire session ticket.');
        const data = await response.json();
        sessionTicket = data.ticket;
        console.log("Secure session ticket acquired successfully.");
    } catch (error) {
        console.error(error);
        showError("Could not establish a secure session with the server. Please refresh the page.");
    }
}

function showError(message) {
    const statusArea = document.getElementById('status-area');
    if (statusArea) {
        statusArea.innerHTML = `<div class="error">${message}</div>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    getSessionTicket();
    const urlInput = document.getElementById('video-url');
    const statusArea = document.getElementById('status-area');
    const resultsArea = document.getElementById('results-area');
    const videoInfo = document.querySelector('.video-info');
    const videoTitle = document.getElementById('video-title');
    const videoThumbnail = document.getElementById('video-thumbnail');
    const formatsList = document.getElementById('formats-list');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalCloseButton = document.querySelector('.close-button');
    const modalUrlDisplay = document.getElementById('direct-url-display');
    const copyUrlButton = document.getElementById('copy-url-btn');
    let debounceTimeout;

    urlInput.addEventListener('input', () => { clearTimeout(debounceTimeout); resultsArea.classList.add('hidden'); const videoUrl = urlInput.value.trim(); if (isValidUrl(videoUrl)) { debounceTimeout = setTimeout(() => { processUrl(videoUrl); }, 500); } });

    async function processUrl(videoUrl) {
        if (!sessionTicket) { return showError("Secure session not ready."); }
        clearStatus();
        showLoader('Fetching video data...');
        const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionTicket}` };
        try {
            // A single, unified API call that returns structured JSON.
            const response = await fetch('/api/get-data', {
                method: 'POST',
                headers,
                body: JSON.stringify({ url: videoUrl })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'An unknown server error occurred.' }));
                throw new Error(errorData.error);
            }
            const data = await response.json();
            displayResults(data); // Pass the unified data object.
        } catch (error) {
            showError(error.message);
        } finally {
            if (statusArea.querySelector('.loader')) {
                clearStatus();
            }
        }
    }

    // The brittle `bulletproofParser` function has been REMOVED.

    // --- UI Update Function ---
    // Now accepts a single, clean data object, eliminating the need for separate metadata.
    function displayResults(data) {
        if (data && data.title && data.thumbnail) {
            videoTitle.textContent = data.title;
            videoThumbnail.src = `/api/image-proxy?url=${encodeURIComponent(data.thumbnail)}`;
            videoInfo.classList.remove('hidden');
        } else {
            videoInfo.classList.add('hidden');
        }
        formatsList.innerHTML = '';

        if (!data.formats || data.formats.length === 0) {
            formatsList.innerHTML = '<p class="error">No downloadable formats were found.</p>';
            resultsArea.classList.remove('hidden');
            return;
        }

        const grouped = { merged: [], videoOnly: [], audioOnly: [] };
        // Use the formats array directly from the data object.
        data.formats.forEach(f => {
            const hasVideo = f.vcodec && f.vcodec.toLowerCase() !== 'none' && !f.resolution.toLowerCase().includes('audio');
            const hasAudio = f.acodec && f.acodec.toLowerCase() !== 'none' && f.acodec.toLowerCase() !== 'video only' && f.acodec !== 'unknown';
            if (hasVideo && hasAudio) { grouped.merged.push(f); }
            else if (hasVideo) { grouped.videoOnly.push(f); }
            else if (hasAudio || (f.resolution && f.resolution.toLowerCase().includes('audio only'))) { grouped.audioOnly.push(f); }
        });

        // The rest of this function works as before, as it was already designed for structured data.
        const parseFilesize = (sizeStr) => { if (!sizeStr) return 0; const size = parseFloat(sizeStr.replace('~', '')); if (isNaN(size)) return 0; if (sizeStr.toLowerCase().includes('gib')) return size * 1024; if (sizeStr.toLowerCase().includes('kib')) return size / 1024; return size; };
        const getBestOfGroup = (group) => { const map = new Map(); group.forEach(f => { const key = `${f.resolution}_${f.ext}`; const currentBest = map.get(key); if (!currentBest || parseFilesize(f.filesize) > parseFilesize(currentBest.filesize)) { map.set(key, f); } }); return Array.from(map.values()).sort((a, b) => { const heightA = parseInt((a.resolution || '0').split('x')[1] || 0); const heightB = parseInt((b.resolution || '0').split('x')[1] || 0); return heightB - heightA; }); };
        const bestOf = { merged: getBestOfGroup(grouped.merged), videoOnly: getBestOfGroup(grouped.videoOnly), audioOnly: getBestOfGroup(grouped.audioOnly).sort((a,b) => parseFilesize(b.filesize) - parseFilesize(a.filesize)) };

        const createTableHTML = (formats, isVideoOnly) => { if (formats.length === 0) return ''; return formats.map(format => `<div class="format-item"><div class="format-details"><div class="format-prop"><strong>${(format.resolution || '').includes('x') ? 'Resolution' : 'Quality'}</strong> ${format.resolution}</div><div class="format-prop"><strong>Format</strong> ${format.ext}</div><div class="format-prop"><strong>Filesize</strong> ${format.filesize || 'N/A'}</div></div><div class="format-actions"><button class="action-btn get-link-btn" title="Get temporary link" data-format-id="${format.format_id}"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"></path></svg></button><button class="action-btn download-btn" data-format-id="${format.format_id}" data-video-only="${isVideoOnly}"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download</button></div></div>`).join(''); };
        let finalHTML = '';
        if (bestOf.merged.length > 0) { finalHTML += `<h4>Video + Audio</h4><p class="section-desc">Complete files, good for quick downloads.</p>${createTableHTML(bestOf.merged, false)}`; }
        if (bestOf.videoOnly.length > 0) { finalHTML += `<h4>Video Only (Highest Quality)</h4><p class="section-desc">Silent video. The app will automatically merge the best audio.</p>${createTableHTML(bestOf.videoOnly, true)}`; }
        if (bestOf.audioOnly.length > 0) { finalHTML += `<h4>Audio Only</h4><p class="section-desc">Just the sound, perfect for music or podcasts.</p>${createTableHTML(bestOf.audioOnly, false)}`; }
        formatsList.innerHTML = finalHTML; resultsArea.classList.remove('hidden');
    }

    // --- Event Delegation & Handlers ---
    formatsList.addEventListener('click', (e) => { const downloadButton = e.target.closest('.download-btn'); const getLinkButton = e.target.closest('.get-link-btn'); if (downloadButton) handleDownloadClick(downloadButton); else if (getLinkButton) handleGetLinkClick(getLinkButton); });
    function handleDownloadClick(button) { const formatId = button.dataset.formatId; const isVideoOnly = button.dataset.videoOnly === 'true'; const videoUrl = urlInput.value.trim(); const videoTitle = document.getElementById('video-title').textContent || 'video'; const downloadUrl = `/api/download?url=${encodeURIComponent(videoUrl)}&format_id=${encodeURIComponent(formatId)}&video_only=${isVideoOnly}&title=${encodeURIComponent(videoTitle)}`; button.disabled = true; const originalButtonHTML = button.innerHTML; button.innerHTML = `<svg class="spinner" viewBox="0 0 50 50"><circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle></svg> Preparing...`; window.location.href = downloadUrl; setTimeout(() => { button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download`; button.disabled = false; }, 5000); }
    async function handleGetLinkClick(button) { if (!sessionTicket) return showError("Secure session not ready."); const formatId = button.dataset.formatId; const videoUrl = urlInput.value.trim(); button.disabled = true; clearStatus(); showLoader('Getting temporary link...'); try { const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionTicket}` }; const response = await fetch('/api/get-url', { method: 'POST', headers, body: JSON.stringify({ url: videoUrl, format_id: formatId }) }); if (!response.ok) throw new Error((await response.json()).error); const data = await response.json(); modalUrlDisplay.value = data.direct_url; modalOverlay.classList.add('visible'); } catch (error) { showError(error.message); } finally { if (statusArea.querySelector('.loader')) { clearStatus(); } button.disabled = false; } }
    
    // --- Modal Logic & Helpers ---
    function hideModal() { modalOverlay.classList.remove('visible'); }
    if(copyUrlButton) { copyUrlButton.addEventListener('click', () => { modalUrlDisplay.select(); navigator.clipboard.writeText(modalUrlDisplay.value); copyUrlButton.textContent = 'Copied!'; setTimeout(() => { copyUrlButton.textContent = 'Copy Link'; }, 2000); }); }
    modalCloseButton.addEventListener('click', hideModal);
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) hideModal(); });
    function isValidUrl(string) { try { new URL(string); return true; } catch (_) { return false; } }
    function showLoader(message) { statusArea.innerHTML = `<div class="loader"></div><p>${message}</p>`; }
    function clearStatus() { statusArea.innerHTML = ''; }
});
