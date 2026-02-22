// Native fetch used

async function test() {
    const api = 'http://localhost:3000/api/orders';
    const headers = { 'Content-Type': 'application/json' };

    const make = async (name) => {
        const res = await fetch(api, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                customerName: name,
                items: [{ productId: 1, quantity: 1, price: 5000 }],
                orderType: 'dine_in',
                tableId: '1'
            })
        });
        return await res.json();
    };

    const get = async (code) => {
        const res = await fetch(api + '/code/' + code);
        return await res.json();
    };

    try {
        console.log('1. Creating Order A...');
        const a = await make('Order A');
        console.log('Order A Code:', a.data.transactionCode);

        let resA = await get(a.data.transactionCode);
        console.log(`[Initial] Order A Position: ${resA.data.queuePosition} (Expected: 1)`);

        console.log('2. Creating Order B...');
        const b = await make('Order B');
        console.log('Order B Code:', b.data.transactionCode);

        // CHECK A AGAIN
        resA = await get(a.data.transactionCode);
        console.log(`[After B] Order A Position: ${resA.data.queuePosition} (Expected: 1)`);

        // CHECK B
        let resB = await get(b.data.transactionCode);
        console.log(`[After B] Order B Position: ${resB.data.queuePosition} (Expected: 2)`);

        if (resA.data.queuePosition !== 1) {
            console.error("BUG CONFIRMED: Order A position shifted!");
        } else {
            console.log("LOGIC SEEMS CORRECT: Order A stayed at 1.");
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

test();
