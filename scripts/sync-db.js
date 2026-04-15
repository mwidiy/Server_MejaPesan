const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
const fs = require('fs');

async function main() {
  console.log('🚀 Starting Database Sync: Production -> Staging...');

  // 1. Load Prod Config
  const prodEnv = dotenv.parse(fs.readFileSync('.env'));
  const prodClient = new PrismaClient({
    datasources: { db: { url: prodEnv.DATABASE_URL } },
  });

  // 2. Load Staging Config
  const stagingEnv = dotenv.parse(fs.readFileSync('.env.staging'));
  const stagingClient = new PrismaClient({
    datasources: { db: { url: stagingEnv.DATABASE_URL } },
  });

  // Order of migration (Parents before Children)
  const tables = [
    { name: 'User', model: 'user' },
    { name: 'Store', model: 'store' },
    { name: 'Category', model: 'category' },
    { name: 'Location', model: 'location' },
    { name: 'Table', model: 'table' },
    { name: 'Product', model: 'product' },
    { name: 'Banner', model: 'banner' },
    { name: 'ArAsset', model: 'arAsset' },
    { name: 'Order', model: 'order' },
    { name: 'OrderItem', model: 'orderItem' },
    { name: 'Withdrawal', model: 'withdrawal' },
    { name: 'SystemConfig', model: 'systemConfig' },
  ];

  try {
    console.log('--- Cleaning Staging Database (Full Reset) ---');
    // Try TRUNCATE with the most common Prisma/Supabase naming patterns
    try {
      // Attempt 1: Quoted Uppercase (Standard Prisma)
      const tableNames = tables.map(t => `"${t.name}"`).join(', ');
      await stagingClient.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE;`);
    } catch (e) {
      console.log('  Quoted uppercase failed, trying unquoted lowercase...');
      // Attempt 2: Quoted Lowercase (Prevents reserved keyword syntax errors like "user")
      const lowerNames = tables.map(t => `"${t.name.toLowerCase()}"`).join(', ');
      await stagingClient.$executeRawUnsafe(`TRUNCATE TABLE ${lowerNames} RESTART IDENTITY CASCADE;`);
    }
    console.log('  Cleaned all tables and reset identities.');

    console.log('--- Copying Data ---');
    for (const table of tables) {
      console.log(`Copying ${table.name}...`);
      const data = await prodClient[table.model].findMany();
      console.log(`  Found ${data.length} records in Prod.`);
      
      if (data.length > 0) {
        // Splitting into chunks of 100 for safety
        const chunkSize = 100;
        for (let i = 0; i < data.length; i += chunkSize) {
          const chunk = data.slice(i, i + chunkSize);
          await stagingClient[table.model].createMany({
            data: chunk,
            skipDuplicates: true,
          });
        }
        console.log(`  Successfully inserted into Staging.`);
      }
    }

    // Double check sequence resets (createMany might not update sequences in some Postgres versions)
    console.log('--- Verifying Sequences ---');
    for (const table of tables) {
      if (table.name === 'SystemConfig') continue;
      try {
        await stagingClient.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"${table.name}"', 'id'), coalesce(max(id), 1), max(id) IS NOT NULL) FROM "${table.name}";`);
      } catch (e) {
        // Silently continue if sequence doesn't match standard pattern
      }
    }

    console.log('✅ Database Sync Completed Successfully!');
  } catch (error) {
    console.error('❌ Error during sync:', error);
  } finally {
    await prodClient.$disconnect();
    await stagingClient.$disconnect();
  }
}

main();
