const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * AI Helper for MejaPesan WhatsApp Bot
 * Powered by Google Gemini
 */
const getGeminiResponse = async (userMessage, storeContext) => {
    try {
        const apiKey = process.env.AI_APIKEY_GOOGLE;
        if (!apiKey) {
            console.error("[AI] Error: AI_APIKEY_GOOGLE is missing in .env");
            return null;
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        // TAHAP AI: Pakai model flash terbaru yang lebih stabil
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

        // System Prompt to define AI personality and context
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

        const prompt = `${systemPrompt}\n\nCustomer: ${userMessage}\nAsisten:`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (err) {
        console.error("[AI] Gemini Error:", err.message);
        return "Maaf kak, otak AI aku lagi loading. Bisa chat lagi nanti? atau hubungi admin ya!";
    }
};

module.exports = { getGeminiResponse };
