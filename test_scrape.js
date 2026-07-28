const axios = require('axios');
const cheerio = require('cheerio');

async function check() {
    const url = 'https://open.spotify.com/intl-it/track/5t1APSbE7Bnb0kZOXNlsca';
    const { data } = await axios.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
    });
    const $ = cheerio.load(data);
    const title = $('meta[property="og:title"]').attr('content');
    const desc = $('meta[property="og:description"]').attr('content');
    
    console.log("Title:", title);
    console.log("Desc:", desc);
    
    let searchQuery = `${title}`;
    if (desc) {
        const artistPart = desc.split('·')[0]?.trim();
        if (artistPart) {
            searchQuery += ` ${artistPart}`;
        } else {
            searchQuery += ` ${desc}`;
        }
    }
    console.log("Search Query:", searchQuery);
}

check();
