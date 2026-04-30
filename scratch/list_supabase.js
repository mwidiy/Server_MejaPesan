const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.staging' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function listBuckets() {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) {
        console.error('Error listing buckets:', error);
    } else {
        console.log('Buckets:', JSON.stringify(data, null, 2));
        for (const bucket of data) {
            const { data: files, error: fileError } = await supabase.storage.from(bucket.name).list();
            if (fileError) {
                console.error(`Error listing files in ${bucket.name}:`, fileError);
            } else {
                console.log(`Files in ${bucket.name}:`, JSON.stringify(files.map(f => f.name), null, 2));
            }
        }
    }
}

listBuckets();
