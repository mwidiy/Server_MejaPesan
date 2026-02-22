const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Start seeding...');

  // 1. Create Default Owner
  let owner = await prisma.user.findUnique({ where: { email: 'admin@kasir.com' } });
  if (!owner) {
    owner = await prisma.user.create({
      data: {
        email: 'admin@kasir.com',
        name: 'Admin Kasir',
        role: 'owner'
      }
    });
    console.log('Created default owner admin@kasir.com');
  }

  // 2. Create Default Store
  let store = await prisma.store.findUnique({ where: { ownerId: owner.id } });
  if (!store) {
    store = await prisma.store.create({
      data: {
        name: 'Kantin Utama',
        ownerId: owner.id
      }
    });
    console.log('Created default store Kantin Utama');
  }

  const storeId = store.id;

  // 3. Seed Categories
  const categories = ["Makanan", "Minuman", "Cemilan", "Paket"];
  console.log('Start seeding categories...');
  for (const categoryName of categories) {
    let cat = await prisma.category.findFirst({
      where: { name: categoryName, storeId }
    });
    if (!cat) {
      cat = await prisma.category.create({
        data: { name: categoryName, storeId }
      });
      console.log(`Created category: ${cat.name}`);
    } else {
      console.log(`Verified category: ${cat.name}`);
    }
  }

  // 4. Seed Locations
  const locations = ["Indoor", "Outdoor", "Lantai 2", "VIP"];
  console.log('Start seeding locations...');
  for (const locationName of locations) {
    let loc = await prisma.location.findFirst({
      where: { name: locationName, storeId }
    });
    if (!loc) {
      loc = await prisma.location.create({
        data: { name: locationName, storeId }
      });
      console.log(`Created location: ${loc.name}`);
    } else {
      console.log(`Verified location: ${loc.name}`);
    }
  }

  // 5. Seed Special Table
  console.log('Seeding special table: Counter Pickup...');
  const indoorLocation = await prisma.location.findFirst({
    where: { name: 'Indoor', storeId }
  });

  if (indoorLocation) {
    let table = await prisma.table.findUnique({
      where: { qrCode: 'COUNTER-PICKUP' }
    });
    if (!table) {
      table = await prisma.table.create({
        data: {
          name: 'Counter Pickup',
          qrCode: 'COUNTER-PICKUP',
          locationId: indoorLocation.id,
          isActive: true
        }
      });
      console.log('Created Counter Pickup table.');
    } else {
      console.log('Counter Pickup table verified.');
    }
  }

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });