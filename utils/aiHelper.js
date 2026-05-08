/**
 * AI Helper for MejaPesan WhatsApp Bot
 * Powered by OpenRouter (Human-like Personality & Proactive Sales)
 */

const openRouterKeys = [
    process.env.OPENROUTERAI_1,
    process.env.OPENROUTERAI_2,
    process.env.OPENROUTERAI_3,
    process.env.OPENROUTERAI_4,
    process.env.OPENROUTERAI_5,
    process.env.OPENROUTERAI_6
].filter(key => !!key);

let currentKeyIndex = 0;

const getNextApiKey = () => {
    if (openRouterKeys.length === 0) return null;
    const key = openRouterKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % openRouterKeys.length;
    return key;
};

/**
 * Main AI function with Human-like Personality
 */
const getGeminiResponse = async (userMessage, storeContext, magicalLink, attempt = 1) => {
    const apiKey = getNextApiKey();
    if (!apiKey) return null;

    try {
        // Format Product List for Context (Only Active Items)
        const activeProducts = storeContext.products?.filter(p => p.isActive) || [];
        const productListString = activeProducts
            .map(p => `- ${p.name} (Rp ${p.price.toLocaleString("id-ID")})`)
            .join("\n");

        const systemPrompt = `
        Kamu adalah asisten digital yang RAMAH, CERIA, dan PROAKTIF untuk restoran "${storeContext.name}".
        Nama kamu adalah "Asisten MejaPesan". Gunakan bahasa Indonesia yang santai, luwes (seperti manusia), dan sopan.
        
        DAFTAR MENU YANG TERSEDIA SAAT INI:
        ${productListString || "Menu sedang disiapkan."}
        
        LINK PEMESANAN KAKAK (Sangat Penting):
        ${magicalLink}
        
        ATURAN KOMUNIKASI:
        1. JANGAN KAKU. Jangan gunakan bahasa robot atau terjemahan mesin. Gunakan kata seperti "Kak", "nih", "ya", "yuk".
        2. JIKA CUSTOMER INGIN PESAN/TANYA CARA PESAN: Berikan instruksi singkat dan sertakan LINK PEMESANAN di atas. Katakan bahwa link itu sudah otomatis terhubung ke nomor mereka.
        3. JIKA TANYA MENU: Sebutkan 3 menu andalan dari daftar di atas secara menarik, lalu arahkan untuk lihat menu lengkap di LINK PEMESANAN.
        4. JIKA TANYA STOK ITEM SPESIFIK: Cek daftar di atas. Jika ada, jawab dengan semangat. Jika tidak ada, katakan maaf dan tawarkan menu lain yang mirip atau andalan.
        5. PROAKTIF: Di akhir jawaban, selalu tawarkan bantuan atau ajak memesan. Contoh: "Mau sekalian Kakak pesan sekarang?", "Ada lagi yang bikin Kakak laper?".
        6. JIKA OOT (Out of Topic): Jawab dengan candaan halus lalu tarik kembali ke soal makanan/pesanan di "${storeContext.name}".
        7. SINGKAT & PADAT: Maksimal 3 kalimat agar nyaman dibaca di WhatsApp.
        `;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "X-Title": "MejaPesan AI Bot"
            },
            body: JSON.stringify({
                "model": "openrouter/free",
                "messages": [
                    { "role": "system", "content": systemPrompt },
                    { "role": "user", "content": userMessage }
                ],
                "max_tokens": 250,
                "temperature": 0.7 // Slightly higher for more natural language
            })
        });

        const data = await response.json();

        if (!response.ok) {
            if (attempt < 3) return await getGeminiResponse(userMessage, storeContext, magicalLink, attempt + 1);
            throw new Error("API Limit");
        }

        if (data.choices && data.choices.length > 0) {
            let content = data.choices[0].message.content.trim();
            // Filter out robotic prefixes if AI adds them
            content = content.replace(/^(Asisten|AI|Bot):/i, "").trim();
            if (content.length < 5 && attempt < 3) return await getGeminiResponse(userMessage, storeContext, magicalLink, attempt + 1);
            return content;
        }

        return "Aduh maaf Kak, koneksi aku lagi drop. Langsung klik link pemesanan aja ya!";
    } catch (err) {
        console.error("[AI] Error:", err.message);
        return "Wah maaf banget Kak, sistem aku lagi istirahat bentar. Langsung pesan lewat link ini aja ya: " + magicalLink;
    }
};

module.exports = { getGeminiResponse };
