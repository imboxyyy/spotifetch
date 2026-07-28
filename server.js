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

// Salva i cookie di YouTube da env var in un file temp (necessario per i server cloud)
const COOKIES_FILE = path.join(os.tmpdir(), 'youtube_cookies.txt');
if (process.env.YOUTUBE_COOKIES) {
    fs.writeFileSync(COOKIES_FILE, process.env.YOUTUBE_COOKIES, 'utf8');
    console.log('YouTube cookies loaded from environment variable.');
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

        let dlOptions = {
            ffmpegLocation: ffmpegPath,
            output: tempFilename,
            noCheckCertificates: true,
            noWarnings: true,
            addHeader: [
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36'
            ]
        };

        if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
            dlOptions.extractorArgs = 'youtube:player-client=android';
            // Usa i cookie se disponibili (essenziali su server cloud per evitare il blocco bot)
            if (process.env.YOUTUBE_COOKIES && fs.existsSync(COOKIES_FILE)) {
                dlOptions.cookies = COOKIES_FILE;
            }
        }
        
        if (videoUrl.includes('tiktok.com')) {
            console.log(`Fetching TikTok download URL via TikWM for: ${videoUrl}`);
            const { data: tikData } = await axios.get(`https://tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`);
            if (tikData && tikData.code === 0 && tikData.data) {
                const directUrl = (format === 'mp4') ? tikData.data.play : (tikData.data.music_info && tikData.data.music_info.play ? tikData.data.music_info.play : tikData.data.music || tikData.data.play);
                const response = await axios({
                    method: 'GET',
                    url: directUrl,
                    responseType: 'stream'
                });
                res.setHeader('Content-Disposition', `attachment; filename="${sanitizedTitle}.${ext}"`);
                response.data.pipe(res);
                return;
            } else {
                return res.status(500).json({ error: "Failed to download TikTok video via API." });
            }
        }

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

        audioProcess.catch(err => {
            console.error('youtube-dl-exec promise rejected:', err.message);
        });

        audioProcess.on('close', (code) => {
            console.log(`yt-dlp process exited with code ${code}`);
            if (code === 0) {
                res.download(tempFilename, `${sanitizedTitle}.${ext}`, (err) => {
                    if (err) {
                        console.error('Error sending file:', err);
                    }
                    fs.unlink(tempFilename, (unlinkErr) => {
                        if (unlinkErr) console.error('Error deleting temp file:', unlinkErr);
                    });
                });
            } else {
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error 403 or YouTube blocked the request.' });
                }
            }
        });

        audioProcess.on('error', (err) => {
            console.error('yt-dlp error event:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error during conversion with yt-dlp.' });
            }
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
