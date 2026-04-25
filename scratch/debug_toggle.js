// Test script to simulate what Android sends when toggling isCashActive
// This replicates the exact Gson payload from StoreUpdateRequest(isCashActive = false)

const fetch = require('node-fetch') || globalThis.fetch;

const API_URL = 'https://api-staging.quacxel.my.id';

async function testUpdateStore() {
    // Step 1: We need a JWT token. Let's try to get store info first without auth
    // to verify the server is reachable
    console.log('=== Testing Store Update (isCashActive toggle) ===\n');

    // Simulate the EXACT payload Gson sends from Android
    // When StoreUpdateRequest(isCashActive = false) is called:
    const gsonPayload = {
        name: null,
        isOpen: null,
        bankName: null,
        bankNumber: null,
        bankHolder: null,
        ewalletType: null,
        ewalletNumber: null,
        ewalletName: null,
        whatsappNumber: null,
        isKasirQrVerificationEnabled: null,
        cashPaymentMode: null,
        isCashActive: false
    };

    console.log('Payload being sent (simulating Gson):');
    console.log(JSON.stringify(gsonPayload, null, 2));
    console.log('\n--- JavaScript behavior check ---');
    
    // Check what happens with null values in JavaScript
    const { name, isOpen, bankName, bankNumber, bankHolder, ewalletType, 
            ewalletNumber, ewalletName, whatsappNumber, 
            isKasirQrVerificationEnabled, cashPaymentMode, isCashActive } = gsonPayload;

    console.log(`name !== undefined: ${name !== undefined}`);  // true! null !== undefined
    console.log(`name != null: ${name != null}`);              // false! null == null
    console.log(`name value: ${JSON.stringify(name)}`);
    
    // Simulate the FIXED validation
    console.log('\n--- Validation simulation (FIXED with != null) ---');
    if (name != null) {
        console.log(`name.length check would run... name.length = ${name?.length}`);
    } else {
        console.log('name is null/undefined → SKIPPED ✅');
    }

    // Simulate the sanitizedData construction
    const sanitizedData = {
        name: (name !== undefined && name !== null) ? name : undefined,
        isOpen: (isOpen === true || isOpen === 'true') ? true : (isOpen === false || isOpen === 'false' ? false : undefined),
        bankName: (bankName !== undefined && bankName !== null) ? bankName : undefined,
        bankNumber: (bankNumber !== undefined && bankNumber !== null) ? bankNumber : undefined,
        bankHolder: (bankHolder !== undefined && bankHolder !== null) ? bankHolder : undefined,
        ewalletType: (ewalletType !== undefined && ewalletType !== null) ? ewalletType : undefined,
        ewalletNumber: (ewalletNumber !== undefined && ewalletNumber !== null) ? ewalletNumber : undefined,
        ewalletName: (ewalletName !== undefined && ewalletName !== null) ? ewalletName : undefined,
        whatsappNumber: (whatsappNumber !== undefined && whatsappNumber !== null) ? whatsappNumber : undefined,
        isKasirQrVerificationEnabled: (isKasirQrVerificationEnabled === 'true' || isKasirQrVerificationEnabled === true) ? true : (isKasirQrVerificationEnabled === 'false' || isKasirQrVerificationEnabled === false ? false : undefined),
        cashPaymentMode: (cashPaymentMode !== undefined && cashPaymentMode !== null) ? cashPaymentMode : undefined,
        isCashActive: (isCashActive === 'true' || isCashActive === true) ? true : (isCashActive === 'false' || isCashActive === false ? false : undefined)
    };

    console.log('\n--- sanitizedData that would be sent to Prisma ---');
    console.log(JSON.stringify(sanitizedData, null, 2));

    // Check: does sanitizedData have any non-undefined values besides isCashActive?
    const activeKeys = Object.entries(sanitizedData).filter(([k, v]) => v !== undefined);
    console.log('\n--- Active fields (non-undefined) ---');
    activeKeys.forEach(([k, v]) => console.log(`  ${k}: ${JSON.stringify(v)}`));

    // KEY CHECK: Is the Prisma Client aware of isCashActive?
    console.log('\n--- Prisma Client Check ---');
    try {
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        
        // Get the DMMF (Data Model Meta Format) to check what fields Store model has
        const storeFields = prisma._baseDmmf?.modelMap?.Store?.fields?.map(f => f.name) || [];
        console.log('Store model fields in LOCAL Prisma Client:');
        console.log(storeFields);
        
        if (storeFields.includes('isCashActive')) {
            console.log('✅ isCashActive EXISTS in local Prisma Client');
        } else {
            console.log('❌ isCashActive MISSING from local Prisma Client!');
        }

        await prisma.$disconnect();
    } catch (e) {
        console.log('Error checking Prisma Client:', e.message);
    }
}

testUpdateStore().catch(console.error);
