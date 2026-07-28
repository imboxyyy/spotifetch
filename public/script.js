// Modal Logic
const modalOverlay = document.getElementById('modal-overlay');
const navLinks = document.querySelectorAll('.nav-link');
const closeBtns = document.querySelectorAll('.modal-close');

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modalOverlay.classList.remove('hidden');
        modal.classList.remove('hidden');
        // Small delay to allow display block to apply before animating opacity
        setTimeout(() => {
            modalOverlay.classList.add('active');
            modal.classList.add('active');
        }, 10);
    }
}

function closeModal() {
    modalOverlay.classList.remove('active');
    const activeModals = document.querySelectorAll('.modal.active');
    activeModals.forEach(modal => {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 400); // match css transition time
    });
    setTimeout(() => {
        modalOverlay.classList.add('hidden');
    }, 400);
}

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const modalId = link.getAttribute('data-modal');
        openModal(modalId);
    });
});

closeBtns.forEach(btn => {
    btn.addEventListener('click', closeModal);
});

modalOverlay.addEventListener('click', closeModal);

let currentPlatform = 'spotify';
let currentFormat = 'mp3';

// Platform Logic
const platforms = document.querySelectorAll('.platform-card');
const urlInput = document.getElementById('spotify-url');
const formatTabs = document.querySelectorAll('.format-tab');
const tabSlider = document.getElementById('tab-slider');

function updateFormatSlider(activeTab) {
    if (!tabSlider || !activeTab) return;
    const offsetLeft = activeTab.offsetLeft;
    const offsetTop = activeTab.offsetTop;
    const width = activeTab.offsetWidth;
    const height = activeTab.offsetHeight;
    
    tabSlider.style.opacity = '1';
    tabSlider.style.width = `${width}px`;
    tabSlider.style.height = `${height}px`;
    tabSlider.style.transform = `translate(${offsetLeft}px, ${offsetTop}px)`;
}

platforms.forEach(platform => {
    platform.addEventListener('click', () => {
        platforms.forEach(p => p.classList.remove('active'));
        platform.classList.add('active');
        currentPlatform = platform.getAttribute('data-platform');
        
        formatTabs.forEach(tab => {
            const format = tab.getAttribute('data-format');
            if (currentPlatform === 'spotify') {
                if (format === 'mp3') {
                    tab.classList.remove('disabled');
                    tab.classList.add('active');
                    currentFormat = 'mp3';
                    updateFormatSlider(tab);
                } else {
                    tab.classList.add('disabled');
                    tab.classList.remove('active');
                }
                urlInput.placeholder = 'https://open.spotify.com/track/...';
            } else {
                tab.classList.remove('disabled');
                if (currentPlatform === 'tiktok') {
                    urlInput.placeholder = 'https://www.tiktok.com/@user/video/...';
                } else if (currentPlatform === 'instagram') {
                    urlInput.placeholder = 'https://www.instagram.com/p/...';
                } else {
                    urlInput.placeholder = 'https://www.youtube.com/watch?v=...';
                }
            }
        });
    });
});

formatTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        if (tab.classList.contains('disabled')) return;
        
        formatTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        currentFormat = tab.getAttribute('data-format');
        updateFormatSlider(tab);
    });
});

// Initial setup
const initialActiveFormat = document.querySelector('.format-tab.active');
if (initialActiveFormat) {
    if (document.fonts) {
        document.fonts.ready.then(() => updateFormatSlider(initialActiveFormat));
    }
    setTimeout(() => updateFormatSlider(initialActiveFormat), 150);
    setTimeout(() => updateFormatSlider(initialActiveFormat), 500);
}

window.addEventListener('resize', () => {
    const active = document.querySelector('.format-tab.active');
    if (active) updateFormatSlider(active);
});

// Main Logic
document.getElementById('search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const url = urlInput.value.trim();
    const btn = document.getElementById('search-btn');
    const btnText = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.loader');
    const resultsSection = document.getElementById('results-section');
    const resultsList = document.getElementById('results-list');
    const downloadProgress = document.getElementById('download-progress');
    
    if (currentPlatform === 'spotify') {
        if (!url.includes('spotify.com') || (!url.includes('/track/') && !url.includes('/album/'))) {
            showToast('Please provide a valid Spotify track or album link.', 'error');
            return;
        }
    } else if (currentPlatform === 'youtube') {
        if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
            showToast('Please provide a valid YouTube link.', 'error');
            return;
        }
    } else if (currentPlatform === 'tiktok') {
        if (!url.includes('tiktok.com')) {
            showToast('Please provide a valid TikTok link.', 'error');
            return;
        }
    } else if (currentPlatform === 'instagram') {
        if (!url.includes('instagram.com')) {
            showToast('Please provide a valid Instagram link.', 'error');
            return;
        }
    }

    resultsSection.classList.add('hidden');
    downloadProgress.classList.add('hidden');
    resultsList.innerHTML = '';
    
    setLoadingState(true);

    try {
        let apiCategory = currentPlatform;
        if (currentFormat === 'mp4-custom') {
            apiCategory = (currentPlatform === 'youtube') ? 'youtube-custom' : currentPlatform;
        }

        const response = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, category: apiCategory })
        });

        if (!response.ok) {
            let errorMsg = 'Unknown error occurred';
            try {
                const errData = await response.json();
                errorMsg = errData.error || errorMsg;
            } catch(e) {}
            throw new Error(errorMsg);
        }

        const data = await response.json();
        const results = data.results;

        if (!results || results.length === 0) {
            throw new Error('No results found.');
        }

        results.forEach((result, index) => {
            const card = document.createElement('div');
            card.className = 'result-card';
            card.style.animationDelay = `${index * 0.1}s`;
            
            const btnText = currentFormat === 'mp4' ? 'Download MP4' : 'Download MP3';
            
            let actionHtml = '';
            if (apiCategory === 'youtube-custom' && result.formats && result.formats.length > 0) {
                let optionsHtml = result.formats.map(f => `<div class="custom-option" data-value="${f}">${f}p</div>`).join('');
                const defaultQuality = result.formats[0];
                actionHtml = `
                    <div class="result-actions">
                        <div class="custom-select-wrapper">
                            <div class="custom-select" data-value="${defaultQuality}">
                                <span class="custom-select-text">${defaultQuality}p</span>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                            </div>
                            <div class="custom-select-dropdown hidden">
                                ${optionsHtml}
                            </div>
                        </div>
                        <button type="button" class="download-btn-small" data-url="${result.url}" data-title="${data.originalTitle || result.title}">
                            Download
                        </button>
                    </div>
                `;
            } else {
                actionHtml = `
                    <button type="button" class="download-btn-small" data-url="${result.url}" data-title="${data.originalTitle || result.title}">
                        ${btnText}
                    </button>
                `;
            }

            card.innerHTML = `
                <img src="${result.thumbnail}" alt="Thumbnail" class="result-img">
                <div class="result-info">
                    <div class="result-title">${result.title}</div>
                    <div class="result-author">${result.author} ${result.duration ? '• ' + result.duration : ''}</div>
                </div>
                ${actionHtml}
            `;
            
            resultsList.appendChild(card);
        });

        const downloadBtns = document.querySelectorAll('.download-btn-small');
        downloadBtns.forEach(btn => {
            btn.addEventListener('click', (ev) => {
                const videoUrl = ev.target.getAttribute('data-url');
                const title = ev.target.getAttribute('data-title');
                
                let quality = null;
                const selectElement = ev.target.parentElement.querySelector('.custom-select');
                if (selectElement) {
                    quality = selectElement.getAttribute('data-value');
                }
                
                startDownload(videoUrl, title, currentFormat, quality);
            });
        });

        // Setup custom dropdowns logic
        const customSelects = document.querySelectorAll('.custom-select-wrapper');
        customSelects.forEach(wrapper => {
            const select = wrapper.querySelector('.custom-select');
            const dropdown = wrapper.querySelector('.custom-select-dropdown');
            const text = wrapper.querySelector('.custom-select-text');
            const options = wrapper.querySelectorAll('.custom-option');

            select.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close other open dropdowns
                document.querySelectorAll('.custom-select-dropdown').forEach(d => {
                    if (d !== dropdown) d.classList.add('hidden');
                });
                dropdown.classList.toggle('hidden');
            });

            options.forEach(opt => {
                opt.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const val = opt.getAttribute('data-value');
                    const label = opt.textContent;
                    select.setAttribute('data-value', val);
                    text.textContent = label;
                    dropdown.classList.add('hidden');
                });
            });
        });

        // Close dropdowns on outside click (add once globally if not already added, but adding here is fine for now as results wipe out on search)
        document.addEventListener('click', () => {
            document.querySelectorAll('.custom-select-dropdown').forEach(d => {
                d.classList.add('hidden');
            });
        }, { once: true });

        resultsSection.classList.remove('hidden');
        showToast('Ready to download!', 'info');

    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        setLoadingState(false);
    }

    function setLoadingState(isLoading) {
        btn.disabled = isLoading;
        if (isLoading) {
            btnText.classList.add('hidden');
            loader.classList.remove('hidden');
        } else {
            btnText.classList.remove('hidden');
            loader.classList.add('hidden');
        }
    }
});

// Toast System
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Icon based on type
    let iconSvg = '';
    if (type === 'error') {
        iconSvg = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="9"></circle><line x1="10" y1="6" x2="10" y2="10"></line><line x1="10" y1="14" x2="10.01" y2="14"></line></svg>`;
    } else if (type === 'success') {
        iconSvg = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"></path></svg>`;
    } else {
        iconSvg = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }

    toast.innerHTML = `${iconSvg} <span>${message}</span>`;
    container.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after 4 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400); // Wait for transition
    }, 4000);
}

async function startDownload(videoUrl, originalTitle, format, quality) {
    const resultsSection = document.getElementById('results-section');
    const downloadProgress = document.getElementById('download-progress');
    const urlInput = document.getElementById('spotify-url');

    resultsSection.classList.add('hidden');
    downloadProgress.classList.remove('hidden');

    try {
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoUrl, title: originalTitle, format, quality })
        });

        if (!response.ok) {
            let errorMsg = 'Unknown error occurred';
            try {
                const errData = await response.json();
                errorMsg = errData.error || errorMsg;
            } catch(e) {}
            throw new Error(errorMsg);
        }

        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        
        let filename = format === 'mp4' ? 'download.mp4' : 'download.mp3';
        const disposition = response.headers.get('Content-Disposition');
        if (disposition && disposition.indexOf('attachment') !== -1) {
            const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
            const matches = filenameRegex.exec(disposition);
            if (matches != null && matches[1]) { 
                filename = matches[1].replace(/['"]/g, '');
            }
        }

        a.style.display = 'none';
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        window.URL.revokeObjectURL(downloadUrl);
        a.remove();
        
        showToast('Download completed!', 'success');
        urlInput.value = '';

    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    } finally {
        downloadProgress.classList.add('hidden');
    }
}

// Button Click Animation
document.querySelectorAll('.minimal-btn, .modal-btn-primary').forEach(btn => {
    btn.addEventListener('click', function() {
        this.classList.add('clicked');
        setTimeout(() => {
            this.classList.remove('clicked');
        }, 400); // match animation duration
    });
});
