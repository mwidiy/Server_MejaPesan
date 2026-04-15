const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
const fs = require('fs');

async function main() {
  const stagingEnv = dotenv.parse(fs.readFileSync('.env.staging'));
  const prisma = new PrismaClient({
    datasources: { db: { url: stagingEnv.DATABASE_URL } },
  });

  try {
    const result = await prisma.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
