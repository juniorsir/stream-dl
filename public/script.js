// script.js - Updated to integrate with the new Node.js/Python backend

let sessionTicket = null;
let bestAudioFormat = null; // Still needed to identify if a video-only format can be merged

// --- Toast Notifications (No changes needed) ---
function showToast(message, type = 'info', duration = 5000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, duration);
}

// --- Session Management (No changes needed) ---
async function getSessionTicket() {
    try {
        const response = await fetch('/api/get-ticket');
        if (!response.ok) throw new Error('Could not acquire session ticket.');
        const data = await response.json();
        sessionTicket = data.ticket;
        console.log("Secure session ticket acquired successfully.");
    } catch (error) {
        console.error(error);
        showToast("Could not establish a secure session.", 'error');
    }
}

// --- Local History Management (No changes needed) ---
const HISTORY_KEY = 'videoDownloaderHistory';
const MAX_HISTORY_ITEMS = 8;

function loadHistory() {
    const historySection = document.getElementById('history-section');
    const historyList = document.getElementById('history-list');
    if (!historySection || !historyList) return;
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    historyList.innerHTML = '';
    if (history.length > 0) {
        history.forEach(item => renderHistoryItem(item));
        historySection.classList.remove('hidden');
    } else {
        historySection.classList.add('hidden');
    }
}

function saveToHistory(videoData) {
    let history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    history = history.filter(item => item.url !== videoData.url);
    history.unshift({ url: videoData.url, title: videoData.title, thumbnail: videoData.thumbnail });
    if (history.length > MAX_HISTORY_ITEMS) { history = history.slice(0, MAX_HISTORY_ITEMS); }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    loadHistory();
}

function renderHistoryItem(item) {
    const historyList = document.getElementById('history-list');
    if (!historyList) return;
    const div = document.createElement('div');
    div.className = 'history-item';
    div.dataset.url = item.url;
    // The image proxy endpoint is correct
    div.innerHTML = `<img src="/api/image-proxy?url=${encodeURIComponent(item.thumbnail)}" alt="${item.title}" class="history-item-thumb" loading="lazy"><div class="history-item-title">${item.title}</div><div class="history-item-overlay">Fetch Again</div>`;
    historyList.appendChild(div);
}

// --- Main Application Logic ---
document.addEventListener('DOMContentLoaded', () => {
    // Initial setup
    getSessionTicket();
    loadHistory();

    // --- DOM Element Selectors ---
    const urlInput = document.getElementById('video-url');
    const urlFavicon = document.getElementById('url-favicon');
    const pasteBtn = document.getElementById('paste-btn');
    const statusArea = document.getElementById('status-area');
    const resultsArea = document.getElementById('results-area');
    const videoInfo = document.querySelector('.video-info');
    const videoTitle = document.getElementById('video-title');
    const videoThumbnail = document.getElementById('video-thumbnail');
    const formatsList = document.getElementById('formats-list');
    const availableFormatsTitle = document.querySelector('#results-area > h3');
    const historyList = document.getElementById('history-list');
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    
    // Modal selectors
    const modalOverlay = document.getElementById('modal-overlay');
    const modalCloseButton = modalOverlay.querySelector('.close-button');
    const modalUrlDisplay = document.getElementById('direct-url-display');
    const copyUrlButton = document.getElementById('copy-url-btn');
    const shareBtn = document.getElementById('share-btn');
    const previewThumbBtn = document.getElementById('preview-thumb-btn');
    const thumbModalOverlay = document.getElementById('thumbnail-modal-overlay');
    const fullResThumb = document.getElementById('full-res-thumbnail');
    const thumbModalCloseBtn = thumbModalOverlay.querySelector('.close-button');
    const privacyLink = document.getElementById('privacy-policy-link');
    const privacyModalOverlay = document.getElementById('privacy-modal-overlay');
    const privacyModalCloseBtn = privacyModalOverlay.querySelector('.close-button');

    // --- SPA Navigation & Intersection Observer (No changes needed) ---
    const navLinks = document.querySelectorAll('.nav-links a[data-section]');
    const sections = document.querySelectorAll('.content-section');
    const headerOffset = 64;
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const sectionId = entry.target.id;
                navLinks.forEach(link => link.classList.toggle('active', link.dataset.section === sectionId));
            }
        });
    }, { root: null, rootMargin: `-${headerOffset}px 0px 0px 0px`, threshold: 0.4 });
    sections.forEach(section => { if(section) observer.observe(section); });
    document.querySelectorAll('.main-nav a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetElement = document.querySelector(this.getAttribute('href'));
            if (targetElement) {
                const offsetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - headerOffset;
                window.scrollTo({ top: offsetPosition, behavior: "smooth" });
            }
        });
    });

    // --- Core Data Fetching and Display ---
    let debounceTimeout;
    
    // The unified /api/get-data endpoint is used here. No change to the endpoint path was needed.
    async function processUrl(videoUrl) {
        if (!sessionTicket) { return showToast("Secure session not ready.", 'error'); }
        if (!isValidUrl(videoUrl)) return;
        
        clearStatus();
        showLoader('Fetching video data...');
        resultsArea.classList.add('hidden');
        
        const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionTicket}` };
        try {
            const response = await fetch('/api/get-data', { method: 'POST', headers, body: JSON.stringify({ url: videoUrl }) });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'An unknown server error occurred.' }));
                throw new Error(errorData.error);
            }
            const data = await response.json();
            saveToHistory({ url: videoUrl, ...data });
            displayResults(data);
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            clearStatus();
        }
    }

    function displayResults(data) {
        bestAudioFormat = null;
        resultsArea.classList.remove('hidden');

        if (data && data.title && data.thumbnail) {
            videoTitle.textContent = data.title;
            // The /api/image-proxy endpoint is still used and correct
            videoThumbnail.src = `/api/image-proxy?url=${encodeURIComponent(data.thumbnail)}`;
            fullResThumb.src = data.thumbnail;
            videoInfo.classList.remove('hidden');
        } else {
            videoInfo.classList.add('hidden');
        }

        formatsList.innerHTML = '';
        if (!data.formats || data.formats.length === 0) {
            formatsList.innerHTML = '<p class="error">No downloadable formats were found.</p>';
            availableFormatsTitle.classList.add('hidden');
            return;
        }
        availableFormatsTitle.classList.remove('hidden');

        // Group formats by type (same logic as before)
        const grouped = { merged: [], videoOnly: [], audioOnly: [] };
        data.formats.forEach(f => {
            const hasVideo = f.vcodec && f.vcodec.toLowerCase() !== 'none' && !f.resolution.toLowerCase().includes('audio');
            const hasAudio = f.acodec && f.acodec.toLowerCase() !== 'none' && f.acodec.toLowerCase() !== 'video only' && f.acodec !== 'unknown';
            if (hasVideo && hasAudio) { grouped.merged.push(f); } 
            else if (hasVideo) { grouped.videoOnly.push(f); } 
            else if (hasAudio || (f.resolution && f.resolution.toLowerCase().includes('audio only'))) { grouped.audioOnly.push(f); }
        });

        // *** CHANGE: Updated filesize parser to handle strings like "123.4 MiB" from the new API ***
        const parseFilesize = (sizeStr) => {
            if (!sizeStr || typeof sizeStr !== 'string') return 0;
            const size = parseFloat(sizeStr);
            if (isNaN(size)) return 0;
            if (sizeStr.toLowerCase().includes('gib')) return size * 1024;
            if (sizeStr.toLowerCase().includes('kib')) return size / 1024;
            return size; // Assume MiB if no other unit
        };

        // De-duplication and sorting logic remains valuable on the frontend
        const getBestOfGroup = (group) => {
            const map = new Map();
            group.forEach(f => {
                const key = `${f.resolution}_${f.ext}`;
                const currentBest = map.get(key);
                if (!currentBest || parseFilesize(f.filesize) > parseFilesize(currentBest.filesize)) {
                    map.set(key, f);
                }
            });
            return Array.from(map.values()).sort((a, b) => {
                const heightA = parseInt((a.resolution || '0').split('x')[1] || 0);
                const heightB = parseInt((b.resolution || '0').split('x')[1] || 0);
                return heightB - heightA;
            });
        };
        
        const bestOf = {
            merged: getBestOfGroup(grouped.merged),
            videoOnly: getBestOfGroup(grouped.videoOnly),
            audioOnly: getBestOfGroup(grouped.audioOnly).sort((a, b) => parseFilesize(b.filesize) - parseFilesize(a.filesize))
        };
        
        // Find the single best audio format, which we use to determine if merging is possible
        if (bestOf.audioOnly.length > 0) {
            bestAudioFormat = bestOf.audioOnly[0];
        }

        const createTableHTML = (formats, isVideoOnly) => {
            if (formats.length === 0) return '';
            // *** CHANGE: The download button for video-only formats now gets a `data-mergeable` attribute ***
            // This tells the download handler that the server can merge it with the best audio.
            const isMergeable = isVideoOnly && !!bestAudioFormat;

            return formats.map(format => `
                <div class="format-item">
                    <div class="format-details">
                        <div class="format-prop"><strong>${(format.resolution || '').includes('x') ? 'Resolution' : 'Quality'}</strong> ${format.resolution}</div>
                        <div class="format-prop"><strong>Format</strong> ${format.ext}</div>
                        <div class="format-prop"><strong>Filesize</strong> ${format.filesize || 'N/A'}</div>
                    </div>
                    <div class="format-actions">
                        <button class="action-btn get-link-btn" title="Get temporary link" data-format-id="${format.format_id}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/></svg>
                        </button>
                        <button class="action-btn download-btn" data-format-id="${format.format_id}" data-mergeable="${isMergeable}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Download
                        </button>
                    </div>
                </div>`).join('');
        };

        let finalHTML = '';
        if (bestOf.merged.length > 0) finalHTML += `<h4>Video + Audio</h4><p class="section-desc">Complete files, good for quick downloads.</p>${createTableHTML(bestOf.merged, false)}`;
        if (bestOf.videoOnly.length > 0) finalHTML += `<h4>Video Only (Highest Quality)</h4><p class="section-desc">Silent video. The app will automatically merge the best audio.</p>${createTableHTML(bestOf.videoOnly, true)}`;
        if (bestOf.audioOnly.length > 0) finalHTML += `<h4>Audio Only</h4><p class="section-desc">Just the sound, perfect for music or podcasts.</p>${createTableHTML(bestOf.audioOnly, false)}`;
        formatsList.innerHTML = finalHTML;
    }

    // --- Event Handlers ---
    
    // *** MAJOR CHANGE: Simplified download link construction ***
    function handleDownloadClick(button) {
        const formatId = button.dataset.formatId;
        // Check the new 'data-mergeable' attribute.
        const shouldMerge = button.dataset.mergeable === 'true'; 
        const videoUrl = urlInput.value.trim();
        const videoTitleText = videoTitle.textContent || 'video';

        if (shouldMerge) {
            showToast('Merging best video and audio...', 'info');
        }

        // The URL is now simpler. We just pass a 'video_only' flag to the server
        // and it handles the merging logic. We no longer need to send v_format_id and a_format_id.
        const downloadUrl = `/api/download?url=${encodeURIComponent(videoUrl)}&format_id=${encodeURIComponent(formatId)}&title=${encodeURIComponent(videoTitleText)}&video_only=${shouldMerge}`;

        button.disabled = true;
        const originalButtonHTML = button.innerHTML;
        button.innerHTML = `<svg class="spinner" viewBox="0 0 50 50"><circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle></svg> Preparing...`;
        window.location.href = downloadUrl;
        setTimeout(() => {
            button.innerHTML = originalButtonHTML;
            button.disabled = false;
        }, 5000);
    }

    // This function for getting a direct URL did not require changes.
    async function handleGetLinkClick(button) {
        if (!sessionTicket) return showToast("Secure session not ready.", 'error');
        const formatId = button.dataset.formatId;
        const videoUrl = urlInput.value.trim();
        button.disabled = true;
        showLoader('Getting temporary link...');
        try {
            const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionTicket}` };
            const response = await fetch('/api/get-url', { method: 'POST', headers, body: JSON.stringify({ url: videoUrl, format_id: formatId }) });
            if (!response.ok) throw new Error((await response.json()).error);
            const data = await response.json();
            modalUrlDisplay.value = data.direct_url;
            modalOverlay.classList.add('visible');
            if (shareBtn) shareBtn.classList.toggle('hidden', !navigator.share);
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            clearStatus();
            button.disabled = false;
        }
    }

    // All event listeners below this point are standard and require no changes
    if (urlInput) {
        urlInput.addEventListener('input', () => {
            clearTimeout(debounceTimeout);
            resultsArea.classList.add('hidden');
            const videoUrl = urlInput.value.trim();
            updateFavicon(videoUrl);
            debounceTimeout = setTimeout(() => { if (isValidUrl(videoUrl)) { processUrl(videoUrl); } }, 500);
        });
    }

    if (pasteBtn) {
        pasteBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                urlInput.value = text;
                urlInput.focus();
                urlInput.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (err) { showToast('Failed to read clipboard.', 'error'); }
        });
    }

    if (formatsList) {
        formatsList.addEventListener('click', (e) => {
            const downloadButton = e.target.closest('.download-btn');
            const getLinkButton = e.target.closest('.get-link-btn');
            if (downloadButton) handleDownloadClick(downloadButton);
            else if (getLinkButton) handleGetLinkClick(getLinkButton);
        });
    }

    if (historyList) {
        historyList.addEventListener('click', (e) => {
            const item = e.target.closest('.history-item');
            if (item) {
                urlInput.value = item.dataset.url;
                urlInput.dispatchEvent(new Event('input', { bubbles: true }));
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    }

    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear your history?')) {
                localStorage.removeItem(HISTORY_KEY);
                loadHistory();
                showToast('History cleared.', 'success');
            }
        });
    }

    // Modal event listeners
    [
        { btn: previewThumbBtn, modal: thumbModalOverlay },
        { btn: thumbModalCloseBtn, modal: thumbModalOverlay },
        { btn: modalCloseButton, modal: modalOverlay },
        { btn: privacyLink, modal: privacyModalOverlay },
        { btn: privacyModalCloseBtn, modal: privacyModalOverlay },
    ].forEach(({ btn, modal }) => {
        if (btn && modal) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                modal.classList.toggle('visible');
            });
        }
    });

    [thumbModalOverlay, modalOverlay, privacyModalOverlay].forEach(modal => {
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.remove('visible');
            });
        }
    });

    if (copyUrlButton) {
        copyUrlButton.addEventListener('click', () => {
            modalUrlDisplay.select();
            navigator.clipboard.writeText(modalUrlDisplay.value);
            copyUrlButton.textContent = 'Copied!';
            showToast('Link copied to clipboard!', 'success');
            setTimeout(() => { copyUrlButton.textContent = 'Copy Link'; }, 2000);
        });
    }

    if (shareBtn && navigator.share) {
        shareBtn.addEventListener('click', async () => {
            try {
                await navigator.share({ title: 'Video Download Link', text: `Direct link for: ${videoTitle.textContent}`, url: modalUrlDisplay.value });
                showToast('Link shared!', 'success');
            } catch (err) { showToast('Could not share link.', 'error'); }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === "Escape") {
            [modalOverlay, thumbModalOverlay, privacyModalOverlay].forEach(m => m?.classList.remove('visible'));
        }
        if (document.activeElement === urlInput && e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(debounceTimeout);
            processUrl(urlInput.value.trim());
        }
    });

    // --- Utility Functions ---
    const DEFAULT_FAVICON_SRC = urlFavicon ? urlFavicon.src : '';
    function updateFavicon(url) {
        if (!urlFavicon) return;
        if (isValidUrl(url)) {
            try {
                const { hostname } = new URL(url);
                urlFavicon.src = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
                urlFavicon.classList.add('active');
            } catch (error) { resetFavicon(); }
        } else { resetFavicon(); }
    }
    function resetFavicon() { if (urlFavicon) { urlFavicon.src = DEFAULT_FAVICON_SRC; urlFavicon.classList.remove('active'); } }
    if (urlFavicon) { urlFavicon.onerror = () => { resetFavicon(); }; }
    
    function isValidUrl(string) { try { new URL(string); return true; } catch (_) { return false; } }
    function showLoader(message) { if (statusArea) statusArea.innerHTML = `<div class="loader"></div><p>${message}</p>`; }
    function clearStatus() { if (statusArea) statusArea.innerHTML = ''; }
});
