const express = require('express');
const cors = require('cors');
const youtubedl = require('youtube-dl-exec');
const ytSearch = require('yt-search');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ffmpegPath = require('ffmpeg-static');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Lista di istanze Invidious pubbliche (verranno provate in cascata)
const INVIDIOUS_INSTANCES = [
    'https://invidious.fdn.fr',
    'https://yewtu.be',
    'https://invidious.nerdvpn.de',
    'https://inv.tux.pizza',
    'https://invidious.privacyredirect.com'
];

// Estrai l'ID del video da un URL di YouTube
function extractYouTubeId(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
    return match ? match[1] : null;
}

// Scarica un video/audio tramite Invidious proxy (nessun cookie necessario)
async function downloadViaInvidious(videoId, format, quality, tempFilename, ext) {
    for (const instance of INVIDIOUS_INSTANCES) {
        try {
            console.log(`Trying Invidious instance: ${instance}`);
            const infoUrl = `${instance}/api/v1/videos/${videoId}?fields=adaptiveFormats,formatStreams`;
            const { data: info } = await axios.get(infoUrl, { timeout: 8000 });

            if (format === 'mp4') {
                // Cerca il formato video + audio più vicino alla qualità richiesta
                const targetHeight = quality ? parseInt(quality) : 1080;
                const videoFormats = (info.adaptiveFormats || []).filter(f => f.type && f.type.startsWith('video/mp4'));
                const audioFormats = (info.adaptiveFormats || []).filter(f => f.type && f.type.startsWith('audio/'));

                if (videoFormats.length === 0) continue;

                const best = videoFormats.sort((a, b) => {
                    const da = Math.abs((a.resolution ? parseInt(a.resolution) : 0) - targetHeight);
                    const db = Math.abs((b.resolution ? parseInt(b.resolution) : 0) - targetHeight);
                    return da - db;
                })[0];

                const bestAudio = audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

                const videoProxyUrl = `${instance}/latest_version?id=${videoId}&itag=${best.itag}`;
                const audioProxyUrl = bestAudio ? `${instance}/latest_version?id=${videoId}&itag=${bestAudio.itag}` : null;

                // Scarica video e audio separatamente poi uniscili con ffmpeg
                const tempVideo = tempFilename.replace('.mp4', '_video.mp4');
                const tempAudio = tempFilename.replace('.mp4', '_audio.m4a');

                const [vRes, aRes] = await Promise.all([
                    axios({ method: 'GET', url: videoProxyUrl, responseType: 'arraybuffer', timeout: 60000 }),
                    audioProxyUrl ? axios({ method: 'GET', url: audioProxyUrl, responseType: 'arraybuffer', timeout: 60000 }) : Promise.resolve(null)
                ]);

                fs.writeFileSync(tempVideo, Buffer.from(vRes.data));
                if (aRes) fs.writeFileSync(tempAudio, Buffer.from(aRes.data));

                return { success: true, tempVideo, tempAudio: aRes ? tempAudio : null };

            } else {
                // Solo audio MP3
                const audioFormats = (info.adaptiveFormats || []).filter(f => f.type && f.type.startsWith('audio/'));
                if (audioFormats.length === 0) continue;

                const bestAudio = audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
                const audioProxyUrl = `${instance}/latest_version?id=${videoId}&itag=${bestAudio.itag}`;

                const aRes = await axios({ method: 'GET', url: audioProxyUrl, responseType: 'arraybuffer', timeout: 60000 });
                fs.writeFileSync(tempFilename.replace('.mp3', '_raw.m4a'), Buffer.from(aRes.data));

                return { success: true, rawAudio: tempFilename.replace('.mp3', '_raw.m4a') };
            }
        } catch (err) {
            console.warn(`Invidious ${instance} failed: ${err.message}`);
        }
    }
    return { success: false };
}

app.post('/api/search', async (req, res) => {
    const { url, category } = req.body;
    
    try {
        console.log(`Processing search for: ${url} (Category: ${category})`);

        let originalTitle = '';
        let topResults = [];

        if (['youtube', 'youtube-custom', 'tiktok', 'instagram'].includes(category)) {
            if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be') && !url.includes('tiktok.com') && !url.includes('instagram.com'))) {
                return res.status(400).json({ error: 'Please provide a valid URL for the selected platform.' });
            }
            
            if (category === 'tiktok' || url.includes('tiktok.com')) {
                console.log(`Fetching TikTok metadata via TikWM for: ${url}`);
                const { data: tikData } = await axios.get(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
                if (tikData && tikData.code === 0 && tikData.data) {
                    const t = tikData.data;
                    originalTitle = t.title || 'TikTok Video';
                    topResults.push({
                        title: t.title || 'Unknown Title',
                        url: url,
                        thumbnail: t.cover || '',
                        author: (t.author && t.author.nickname) || 'TikTok User',
                        duration: t.duration ? `${t.duration}s` : '',
                        formats: []
                    });
                    return res.json({ originalTitle, results: topResults });
                } else {
                    return res.status(500).json({ error: "Failed to fetch TikTok video data." });
                }
            }
            
            console.log(`Fetching metadata directly via yt-dlp for: ${url}`);
            
            let searchOpts = { dumpSingleJson: true, noWarnings: true, noCheckCertificates: true };
            const videoInfo = await youtubedl(url, searchOpts);
            
            let availableFormats = [];
            if (category === 'youtube-custom' && videoInfo.formats) {
                availableFormats = videoInfo.formats
                    .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
                    .map(f => f.height)
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .sort((a, b) => b - a);
            }
            
            originalTitle = videoInfo.title || 'YouTube Video';
            topResults.push({
                title: videoInfo.title || 'Unknown Title',
                url: videoInfo.webpage_url || url,
                thumbnail: videoInfo.thumbnail || '',
                author: videoInfo.uploader || 'YouTube',
                duration: videoInfo.duration_string || '',
                formats: availableFormats
            });

        } else {
            // Default to Spotify behavior
            if (!url || !url.includes('spotify.com') || (!url.includes('/track/') && !url.includes('/album/'))) {
                return res.status(400).json({ error: 'Please provide a valid Spotify track or album URL.' });
            }
            
            // 1. Scrape Spotify for Title and Artist
            const { data } = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            const $ = cheerio.load(data);
            const titleTag = $('meta[property="og:title"]').attr('content');
            const descTag = $('meta[property="og:description"]').attr('content');
            
            if (!titleTag) {
                throw new Error('Could not extract track information from Spotify.');
            }

            originalTitle = titleTag;
            let searchQuery = `${titleTag}`;
            let spotifyArtist = '';
            if (descTag) {
                const artistPart = descTag.split('·')[0]?.trim();
                if (artistPart) {
                    searchQuery += ` ${artistPart}`;
                    spotifyArtist = artistPart;
                } else {
                    searchQuery += ` ${descTag}`;
                    spotifyArtist = descTag;
                }
            }
            searchQuery += ' audio';
            
            console.log(`Searching YouTube for: ${searchQuery}`);

            // 2. Search on YouTube
            const searchResults = await ytSearch(searchQuery);
            if (!searchResults || !searchResults.videos.length) {
                throw new Error('No YouTube videos found matching this query.');
            }

            // Trova la durata ufficiale usando il primo risultato assoluto (di solito il Topic ufficiale)
            const targetDuration = searchResults.videos[0].seconds || 0;

            // Filtra i canali Topic per evitare il DRM
            let validVideos = searchResults.videos.filter(v => 
                v.author && !v.author.name.toLowerCase().includes('- topic')
            );
            
            if (validVideos.length === 0) {
                validVideos = searchResults.videos; // Fallback se sono tutti Topic
            }

            // Ordina i risultati validi per vicinanza alla durata ufficiale
            if (targetDuration > 0) {
                validVideos.sort((a, b) => {
                    const diffA = Math.abs((a.seconds || 0) - targetDuration);
                    const diffB = Math.abs((b.seconds || 0) - targetDuration);
                    return diffA - diffB;
                });
            }

            // Restituisci un singolo risultato "Spotify" perfetto
            const bestVideo = validVideos[0];
            const spotifyImage = $('meta[property="og:image"]').attr('content');

            topResults = [{
                title: originalTitle,
                url: bestVideo.url,
                thumbnail: spotifyImage || bestVideo.thumbnail,
                author: spotifyArtist || (bestVideo.author ? bestVideo.author.name : 'YouTube'),
                duration: bestVideo.timestamp
            }];
        }

        res.json({
            originalTitle: originalTitle,
            results: topResults
        });

    } catch (error) {
        console.error('Error in /api/search:', error.message);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

app.post('/api/download', async (req, res) => {
    const { videoUrl, title, format, quality } = req.body;
    
    if (!videoUrl || (!videoUrl.includes('youtube.com') && !videoUrl.includes('youtu.be') && !videoUrl.includes('tiktok.com') && !videoUrl.includes('instagram.com'))) {
        return res.status(400).json({ error: 'Please provide a valid supported URL.' });
    }

    try {
        const sanitizedTitle = (title || 'download').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const ext = format === 'mp4' ? 'mp4' : 'mp3';
        const tempFilename = path.join(os.tmpdir(), `${sanitizedTitle}_${Date.now()}.${ext}`);
        
        console.log(`Downloading and converting to temp file: ${tempFilename} (Format: ${ext})`);

        if (videoUrl.includes('tiktok.com')) {
            console.log(`Fetching TikTok download URL via TikWM for: ${videoUrl}`);
            const { data: tikData } = await axios.get(`https://tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`);
            if (tikData && tikData.code === 0 && tikData.data) {
                const directUrl = (format === 'mp4') ? tikData.data.play : (tikData.data.music_info && tikData.data.music_info.play ? tikData.data.music_info.play : tikData.data.music || tikData.data.play);
                const response = await axios({ method: 'GET', url: directUrl, responseType: 'stream' });
                res.setHeader('Content-Disposition', `attachment; filename="${sanitizedTitle}.${ext}"`);
                response.data.pipe(res);
                return;
            } else {
                return res.status(500).json({ error: "Failed to download TikTok video via API." });
            }
        }

        // Per YouTube: prova prima via Invidious (nessun blocco datacenter), poi fallback su yt-dlp
        const isYouTube = videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be');
        if (isYouTube) {
            const videoId = extractYouTubeId(videoUrl);
            if (videoId) {
                console.log(`Trying Invidious proxy for: ${videoId}`);
                const result = await downloadViaInvidious(videoId, format, quality, tempFilename, ext);

                if (result.success) {
                    const ffmpeg = require('fluent-ffmpeg');
                    ffmpeg.setFfmpegPath(ffmpegPath);

                    await new Promise((resolve, reject) => {
                        let cmd = ffmpeg();
                        if (format === 'mp4') {
                            cmd = cmd.input(result.tempVideo);
                            if (result.tempAudio) cmd = cmd.input(result.tempAudio);
                            cmd.outputOptions(['-c:v copy', '-c:a aac', '-movflags faststart'])
                               .output(tempFilename)
                               .on('end', resolve)
                               .on('error', reject)
                               .run();
                        } else {
                            cmd.input(result.rawAudio)
                               .audioCodec('libmp3lame')
                               .audioBitrate(192)
                               .output(tempFilename)
                               .on('end', resolve)
                               .on('error', reject)
                               .run();
                        }
                    });

                    // Pulizia file temporanei
                    [result.tempVideo, result.tempAudio, result.rawAudio].forEach(f => {
                        if (f && fs.existsSync(f)) fs.unlinkSync(f);
                    });

                    res.download(tempFilename, `${sanitizedTitle}.${ext}`, () => {
                        fs.unlink(tempFilename, () => {});
                    });
                    return;
                }
                console.log('All Invidious instances failed, falling back to yt-dlp...');
            }
        }

        // Fallback: yt-dlp classico (funziona in locale, potrebbe dare 403 su cloud)
        let dlOptions = {
            ffmpegLocation: ffmpegPath,
            output: tempFilename,
            noCheckCertificates: true,
            noWarnings: true,
            extractorArgs: 'youtube:player-client=android,mweb',
            addHeader: [
                'user-agent:Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Mobile Safari/537.36'
            ]
        };

        if (format === 'mp4') {
            if (quality) {
                dlOptions.format = `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${quality}]+bestaudio/best`;
            } else {
                dlOptions.format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
            }
            dlOptions.mergeOutputFormat = 'mp4';
        } else {
            dlOptions.extractAudio = true;
            dlOptions.audioFormat = 'mp3';
            dlOptions.preferFreeFormats = true;
        }

        const audioProcess = youtubedl.exec(videoUrl, dlOptions);
        audioProcess.catch(err => { console.error('yt-dlp rejected:', err.message); });
        audioProcess.on('close', (code) => {
            if (code === 0) {
                res.download(tempFilename, `${sanitizedTitle}.${ext}`, (err) => {
                    if (err) console.error('Error sending file:', err);
                    fs.unlink(tempFilename, () => {});
                });
            } else {
                if (!res.headersSent) res.status(500).json({ error: 'Download failed. YouTube is blocking server requests.' });
            }
        });
        audioProcess.on('error', (err) => {
            if (!res.headersSent) res.status(500).json({ error: 'Error during download.' });
        });

    } catch (error) {
        console.error('Error in /api/download:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Server error: ' + error.message });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on http://localhost:${PORT}`);
});
