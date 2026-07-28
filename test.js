const play = require('play-dl');

async function test() {
    try {
        console.log('Testing play-dl...');
        const stream = await play.stream('https://youtube.com/watch?v=poUENi10oEk');
        console.log('Stream obtained:', !!stream);
        console.log('Stream URL:', stream.url);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

test();
