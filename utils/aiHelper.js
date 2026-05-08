/**
 * AI Helper for MejaPesan WhatsApp Bot
 * Powered by OpenRouter (Smart Key Rotation)
 */

// List of API Keys for Rolling Mechanism
const openRouterKeys = [
    process.env.OPENROUTERAI_1,
    process.env.OPENROUTERAI_2,
    process.env.OPENROUTERAI_3,
    process.env.OPENROUTERAI_4,
    process.env.OPENROUTERAI_5,
    process.env.OPENROUTERAI_6
].filter(key => !!key); // Only keep valid keys

let currentKeyIndex = 0;

/**
 * Get next API key in rotation
 */
const getNextApiKey = () => {
    if (openRouterKeys.length === 0) return null;
    const key = openRouterKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % openRouterKeys.length;
    return key;
};

const getGeminiResponse = async (userMessage, storeContext) => {
    const apiKey = getNextApiKey();
    
    if (!apiKey) {
        console.error("[AI] Error: No OpenRouter API Keys found in .env");
        return null;
    }

    try {
        console.log(`[AI] Using Key Index: ${currentKeyIndex} (Rolling)`);

        const systemPrompt = `
        Kamu adalah asisten pintar untuk restoran bernama "${storeContext.name}".
        Tugas kamu adalah membalas pesan customer di WhatsApp dengan ramah, singkat, dan membantu.
        
        Konteks Restoran:
        - Nama: ${storeContext.name}
        - Status: ${storeContext.isOpen ? "Buka" : "Tutup Sementara"}
        - Layanan: Pemesanan digital via WhatsApp (MejaPesan)
        
        Aturan Penting:
        1. Kamu adalah asisten ramah. Panggil customer dengan "Kak" atau "Sobat ${storeContext.name}".
        2. Jika customer tanya menu atau mau pesan, katakan bahwa mereka bisa langsung klik link yang dikirimkan bot sebelumnya.
        3. Jika customer bertanya hal di luar restoran, jawablah bahwa kamu hanya bisa membantu seputar layanan "${storeContext.name}".
        4. Jawab dengan singkat, padat, dan jelas (Maksimal 2-3 kalimat).
        5. Jangan pernah memberikan harga jika tidak ada dalam data, arahkan saja untuk cek di aplikasi.
        `;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://quacxel.my.id", // Optional for OpenRouter
                "X-Title": "MejaPesan Bot" // Optional for OpenRouter
            },
            body: JSON.stringify({
                "model": "openrouter/free", // Let OpenRouter pick the best available free model
                "messages": [
                    { "role": "system", "content": systemPrompt },
                    { "role": "user", "content": userMessage }
                ],
                "max_tokens": 200
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error(`[AI] OpenRouter API Error (Key ${currentKeyIndex}):`, data.error?.message || response.statusText);
            // If this key failed, we could recursively try next key, but for now let's return null to avoid infinite loops
            return "Maaf kak, otak AI aku lagi istirahat bentar. Coba chat lagi nanti ya!";
        }

        if (data.choices && data.choices.length > 0) {
            return data.choices[0].message.content.trim();
        }

        return "Maaf kak, aku bingung mau jawab apa. Bisa tanya admin aja?";
    } catch (err) {
        console.error("[AI] Fetch Error:", err.message);
        return "Maaf kak, koneksi AI aku lagi terganggu. Hubungi admin ya!";
    }
};

module.exports = { getGeminiResponse };
