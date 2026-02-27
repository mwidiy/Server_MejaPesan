const predictedTime = new Date('2024-05-15T08:30:00Z'); // Assumed UTC from DB
const utcMillis = predictedTime.getTime();
const wibMillis = utcMillis + (7 * 60 * 60 * 1000);
const wibDate = new Date(wibMillis);
const hours = String(wibDate.getUTCHours()).padStart(2, '0');
const minutes = String(wibDate.getUTCMinutes()).padStart(2, '0');
const clockTime = `${hours}:${minutes}`;

console.log(`Input (UTC): ${predictedTime.toISOString()}`);
console.log(`Output (WIB 15:30): ${clockTime}`);
