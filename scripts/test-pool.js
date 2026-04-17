const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://postgres.gozlnvvkcplvxoutqlsu:KopiPagiHujan@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5'
    }
  }
});
prisma.$connect()
  .then(() => console.log('✅ Connected AWS-0 !'))
  .catch(e => console.error('❌ Err AWS-0:', e.message))
  .finally(() => prisma.$disconnect());
