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
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // System Prompt to define AI personality and context
        const systemPrompt = `
        Kamu adalah asisten pintar untuk restoran bernama "${storeContext.name}".
        Tugas kamu adalah membalas pesan customer di WhatsApp dengan ramah, singkat, dan membantu.
        
        Konteks Restoran:
        - Nama: ${storeContext.name}
        - Alamat: ${storeContext.address || "Hubungi admin untuk lokasi detail"}
        - Status: ${storeContext.isOpen ? "Buka" : "Tutup Sementara"}
        
        Aturan:
        1. Gunakan bahasa Indonesia yang santai tapi sopan (gaul dikit boleh, misal pake "kak").
        2. Jawab sesingkat mungkin tapi jelas.
        3. Jika customer ingin memesan, arahkan mereka untuk menggunakan aplikasi MejaPesan yang sudah disediakan.
        4. Jangan memberikan informasi palsu. Jika tidak tahu, arahkan ke admin.
        5. Hindari menjawab di luar topik restoran.
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
