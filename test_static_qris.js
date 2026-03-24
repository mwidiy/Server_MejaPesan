function calculateCrc16(str) {
    let crc = 0xFFFF;
    for (let c = 0; c < str.length; c++) {
        crc ^= str.charCodeAt(c) << 8;
        for (let i = 0; i < 8; i++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc = crc << 1;
            }
        }
    }
    return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

function generateDynamicQRIS(staticQR, amount) {
    // 1. Change POI Method (Static to Dynamic)
    let modifiedStr = staticQR.replace("010211", "010212");

    // 2. Inject the Transaction Amount (Tag 54)
    let newAmtStr = Math.round(amount).toString();
    let newLenStr = newAmtStr.length.toString().padStart(2, '0');
    let tag54Payload = "54" + newLenStr + newAmtStr;
    
    if (!modifiedStr.includes("5303360")) {
        throw new Error("Tag 53 for Currency IDR (5303360) not found in the static QRIS");
    }
    modifiedStr = modifiedStr.replace("5303360", "5303360" + tag54Payload);

    // 3. Prepare String for CRC Calculation
    let crcTagIndex = modifiedStr.lastIndexOf("6304");
    if (crcTagIndex === -1) {
        throw new Error("CRC tag 6304 not found");
    }
    let strForCrc = modifiedStr.slice(0, crcTagIndex + 4);

    // 4 & 5. Calculate New CRC16 Checksum & Assemble
    let newCrc = calculateCrc16(strForCrc);
    return strForCrc + newCrc;
}

const originalStaticString = "00020101021126610014COM.GO-JEK.WWW01189360091439559600780210G9559600780303UMI51440014ID.CO.QRIS.WWW0215ID10254109926280303UMI5204899953033605802ID5925MUHAMAD WIDIYANTO, Digita6008PEMALANG61055235362070703A0163046140";
const targetAmount = 15001;

console.log("Original Static QRIS:");
console.log(originalStaticString);

try {
    const dynamicQris = generateDynamicQRIS(originalStaticString, targetAmount);
    console.log(`\nSuccess! Generated Dynamic QRIS for Rp ${targetAmount}:`);
    console.log(dynamicQris);
    
    console.log("\nVerifications:");
    console.log("- Contains Dynamic POI (010212) ?", dynamicQris.includes("010212"));
    console.log("- Contains New Amount (540515001) ?", dynamicQris.includes("540515001"));
    console.log("- Ends with 4 hex characters checksum?", /^[0-9A-F]{4}$/.test(dynamicQris.slice(-4)));
} catch (e) {
    console.error("Error generating QRIS:", e);
}
