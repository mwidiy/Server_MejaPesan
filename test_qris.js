const QRCode = require('qrcode');

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

function generateDynamicQris(rawQris, newAmount) {
    let crcTagIndex = rawQris.lastIndexOf("6304");
    if (crcTagIndex === -1) throw new Error("Tag 6304 not found");
    
    let i = 0;
    let modifiedStr = "";
    
    while (i < crcTagIndex) {
        let tag = rawQris.substring(i, i + 2);
        let lenStr = rawQris.substring(i + 2, i + 4);
        let len = parseInt(lenStr, 10);
        let val = rawQris.substring(i + 4, i + 4 + len);
        
        if (tag === "54") {
            let newAmtStr = newAmount.toString();
            let newLenStr = newAmtStr.length.toString().padStart(2, '0');
            modifiedStr += "54" + newLenStr + newAmtStr;
        } else {
            modifiedStr += tag + lenStr + val;
        }
        
        i += 4 + len;
    }
    
    modifiedStr += "6304";
    let newCrc = calculateCrc16(modifiedStr);
    return modifiedStr + newCrc;
}

const originalString = "00020101021226610014COM.GO-JEK.WWW01189360091439559600780210G9559600780303UMI51440014ID.CO.QRIS.WWW0215ID10254109926280303UMI52048999530336054035005802ID5925MUHAMAD WIDIYANTO, Digita6008PEMALANG61055235362395028A220260324100645wuMapYJP3NID0703A016304A734";

let baseOriginal = originalString.slice(0, -4);
let calc = calculateCrc16(baseOriginal);
console.log("✓ Original CRC Check (Should be A734):", calc);

let amount = 15001;
let dynamicQris = generateDynamicQris(originalString, amount);
console.log(`\n✓ New Dynamic QRIS for Rp ${amount}:`);
console.log(dynamicQris);
console.log("✓ Contains new amount string (540515001)?", dynamicQris.includes("540515001"));

try {
    QRCode.toDataURL(dynamicQris, (err, url) => {
        if (!err) {
            console.log("\n✓ Base64 Image Generated!");
        } else {
            console.error("Error generating image:", err);
        }
    });
} catch(e) {
    console.log("No qrcode module installed.");
}
