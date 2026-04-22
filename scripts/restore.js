const fs = require('fs');
const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient();

const sqlDump = fs.readFileSync('DB.sql', 'utf8');

const parsePostgresText = (val) => {
  if (val === '\\N') return null;
  
  let res = val;
  // Unescape standard postgres copy escapes
  res = res.replace(/\\\\/g, '\u0000_BACKSLASH_\u0000'); // Temp placeholder
  res = res.replace(/\\b/g, '\b');
  res = res.replace(/\\f/g, '\f');
  res = res.replace(/\\n/g, '\n');
  res = res.replace(/\\r/g, '\r');
  res = res.replace(/\\t/g, '\t');
  res = res.replace(/\\v/g, '\v');
  res = res.replace(/\u0000_BACKSLASH_\u0000/g, '\\');
  return res;
};

async function main() {
  // Disable foreign key checks for the session to prevent order-of-insertion errors
  await prisma.$executeRawUnsafe('SET session_replication_role = replica;');

  const lines = sqlDump.split(/\r?\n/);
  
  let currentTable = null;
  let columns = [];
  let rows = [];

  const copyRegex = /^COPY\s+public\."([^"]+)"\s+\(([^)]+)\)\s+FROM\s+stdin;/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (currentTable) {
      if (line === '\\.') {
        console.log(`Inserting ${rows.length} rows into public."${currentTable}"`);
        
        if (rows.length > 0) {
           // Insert in batches of 100
           const batchSize = 100;
           for(let b = 0; b < rows.length; b += batchSize) {
               const batchRows = rows.slice(b, b + batchSize);
               
               const colNames = columns.map(c => `"${c}"`).join(', ');
               let placeholders = [];
               
               for (const row of batchRows) {
                   let rowLiterals = [];
                   for (const val of row) {
                       if (val === null) {
                           rowLiterals.push('NULL');
                       } else if (val === 't') {
                           rowLiterals.push('TRUE');
                       } else if (val === 'f') {
                           rowLiterals.push('FALSE');
                       } else {
                           // Escape single quotes by doubling them
                           const escaped = val.replace(/'/g, "''");
                           rowLiterals.push(`'${escaped}'`);
                       }
                   }
                   placeholders.push(`(${rowLiterals.join(', ')})`);
               }
               
               const pk = currentTable === 'SystemConfig' ? 'key' : 'id';
               const query = `INSERT INTO public."${currentTable}" (${colNames}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`;
               
               try {
                  await prisma.$executeRawUnsafe(query);
               } catch(e) {
                  console.error(`Error inserting batch into ${currentTable}:`, e.message);
                  console.error("Query snippet:", query.substring(0, 500) + "...");
                  throw e;
               }
           }
        }
        
        currentTable = null;
        columns = [];
        rows = [];
      } else {
        const rawValues = line.split('\t');
        const values = rawValues.map(parsePostgresText);
        rows.push(values);
      }
    } else {
      const match = line.match(copyRegex);
      if (match) {
        currentTable = match[1];
        // Split columns, remove quotes
        columns = match[2].split(',').map(c => c.trim().replace(/^"/, '').replace(/"$/, ''));
        rows = [];
        console.log(`Found table: ${currentTable} with columns: ${columns.join(', ')}`);
      }
    }
  }

  // After all INSERTS, we must update the sequences for any autoincremental IDs.
  // Let's query all primary key sequences in public schema
  console.log("Syncing sequences...");
  try {
      const syncQuery = `
      DO $$
      DECLARE
          seq_record record;
      BEGIN
          FOR seq_record IN 
              SELECT c.oid::regclass AS seq_name, t.relname AS table_name, a.attname AS column_name
              FROM pg_class c
              JOIN pg_depend d ON d.objid = c.oid
              JOIN pg_class t ON d.refobjid = t.oid
              JOIN pg_attribute a ON a.attnum = d.refobjsubid AND a.attrelid = t.oid
              WHERE c.relkind = 'S' AND t.relnamespace = 'public'::regnamespace
          LOOP
              EXECUTE format('SELECT setval(''%s'', COALESCE(MAX(%I), 1)) FROM public.%I', seq_record.seq_name, seq_record.column_name, seq_record.table_name);
          END LOOP;
      END $$;
      `;
      await prisma.$executeRawUnsafe(syncQuery);
      console.log("Sequences synced successfully.");
  } catch (e) {
      console.error("Failed to sync sequences:", e.message);
  }

  console.log("Restore complete!");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(() => {
  prisma.$disconnect();
});
