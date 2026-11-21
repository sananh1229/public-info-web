const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_KEY are required');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    const { data, error } = await supabase.from('users').select('id').limit(1);
    if (error) {
        console.error('Supabase connection failed:', error.message);
        process.exitCode = 1;
    } else {
        console.log(`Supabase connection succeeded; found ${data.length} user record(s).`);
    }
}
test();