const order = { createdAt: new Date() };
const totalMinutesAhead = 10;
const myPrep = 5;

const baseTime = new Date(order.createdAt);
const predictedTime = new Date(baseTime.getTime() + (totalMinutesAhead + myPrep) * 60000);

const formatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
});

const clockTime = formatter.format(predictedTime).replace('.', ':');
console.log(clockTime);
