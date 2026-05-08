/**
 * AI Helper for MejaPesan WhatsApp Bot
 * Powered by OpenRouter (Smart Key Rotation & Context Injection)
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
 * Main AI function with Strict Ordering Context
 */
const getGeminiResponse = async (userMessage, storeContext, attempt = 1) => {
    const apiKey = getNextApiKey();
    if (!apiKey) return null;

    try {
        // Format Product List for Context
        const productList = storeContext.products
            ?.map(p => `- ${p.name}: ${p.isActive ? "Tersedia" : "Habis"} (Rp ${p.price.toLocaleString("id-ID")})`)
            .join("\n") || "Daftar menu tidak tersedia.";

        const systemPrompt = `
        Kamu adalah Asisten Digital ramah untuk "${storeContext.name}".
        
        DATA MENU SAAT INI:
        ${productList}
        
        ATURAN KETAT:
        1. HANYA bahas tentang pesanan, stok menu, jam buka, dan layanan resto.
        2. Jika customer tanya stok: Cek DATA MENU di atas. Jika "Habis", katakan maaf stok kosong.
        3. Jika customer OOT (Out Of Topic) atau tanya hal aneh (misal: "siapa kamu", "apa arti S", "tess"): 
           Jawab: "Maaf kak, aku asisten digital ${storeContext.name}. Ada yang bisa dibantu soal pesanan menu kami?"
        4. JANGAN HALU. Jangan mengarang menu yang tidak ada di DATA MENU.
        5. SINGKAT: Jawab maksimal 2 kalimat. Gunakan "Kak".
        6. Jika customer ingin pesan: Arahkan klik link pemesanan yang dikirim bot sebelumnya.
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
                "max_tokens": 150,
                "temperature": 0.5 // Lower temperature = less hallucination
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error(`[AI] Error Attempt ${attempt} (Key ${currentKeyIndex}):`, data.error?.message);
            // SMART RETRY: Try next key if not max attempts
            if (attempt < 3) {
                console.log(`[AI] Retrying with different key... (Attempt ${attempt + 1})`);
                return await getGeminiResponse(userMessage, storeContext, attempt + 1);
            }
            throw new Error("API Limit reached across keys");
        }

        if (data.choices && data.choices.length > 0) {
            let content = data.choices[0].message.content.trim();
            // Anti-Short-Response-Bug: If AI returns garbage or too short like "S", retry
            if (content.length < 2 && attempt < 3) {
                return await getGeminiResponse(userMessage, storeContext, attempt + 1);
            }
            return content;
        }

        return "Maaf kak, aku lagi bingung. Bisa tanya admin?";
    } catch (err) {
        console.error("[AI] Final Failure:", err.message);
        return "Maaf kak, koneksi AI aku lagi terganggu. Hubungi admin ya!";
    }
};

module.exports = { getGeminiResponse };
