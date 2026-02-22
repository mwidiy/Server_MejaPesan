const https = require('https');

// Helper: Send Notification to Telegram
const sendTelegramNotification = (message) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        console.warn("Telegram Notification Skipped: Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
        return;
    }

    const data = JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
    });

    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    const req = https.request(options, (res) => {
        let responseBody = '';

        res.on('data', (chunk) => {
            responseBody += chunk;
        });

        res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                console.log("Telegram Notification Sent!");
            } else {
                console.error(`Telegram API Error: Status ${res.statusCode}`, responseBody);
            }
        });
    });

    req.on('error', (error) => {
        console.error("Failed to send Telegram notification:", error);
    });

    req.write(data);
    req.end();
};

module.exports = { sendTelegramNotification };
