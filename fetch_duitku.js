async function fetchDuitku() {
    try {
        const res = await fetch('https://api.github.com/repos/duitkupg/sample-project-duitku-pop/contents/php/requestTransaction.php', {
            headers: { 'User-Agent': 'NodeJS-Test-App' }
        });
        const json = await res.json();
        if (json.content) {
            const buf = Buffer.from(json.content, 'base64');
            console.log(buf.toString('utf-8'));
        } else {
            console.log("No content found:", json);
        }
    } catch (e) {
        console.error(e);
    }
}
fetchDuitku();
