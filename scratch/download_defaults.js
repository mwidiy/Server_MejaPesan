const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.staging' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const AR_ASSETS_DIR = path.join(__dirname, 'public/ar-assets');

async function downloadDefaults() {
    const files = ['defaul1.glb', 'defaul2.glb'];
    
    for (const file of files) {
        console.log(`Downloading ${file}...`);
        const { data, error } = await supabase.storage
            .from('AR')
            .download(file);
            
        if (error) {
            console.error(`Error downloading ${file}:`, error.message);
            continue;
        }
        
        const buffer = Buffer.from(await data.arrayBuffer());
        fs.writeFileSync(path.join(AR_ASSETS_DIR, file), buffer);
        console.log(`Saved ${file} to ${AR_ASSETS_DIR}`);
    }
}

downloadDefaults();
