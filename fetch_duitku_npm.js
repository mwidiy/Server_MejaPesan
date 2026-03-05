const fs = require('fs');
const https = require('https');

https.get('https://unpkg.com/duitku@0.0.7/lib/core.js', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        fs.writeFileSync('duitku_core.js', data);
        console.log('Saved duitku_core.js');
    });
}).on('error', err => {
    console.error('Error:', err.message);
});
