const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const session = require('express-session');

function requiredEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

const supabaseUrl = requiredEnv('SUPABASE_URL');
const supabaseKey = requiredEnv('SUPABASE_KEY');
const sessionSecret = requiredEnv('SESSION_SECRET');
if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters long');
}
const bootstrapAdminUsername = process.env.ADMIN_USERNAME;
const bootstrapAdminPassword = process.env.ADMIN_PASSWORD;
if (Boolean(bootstrapAdminUsername) !== Boolean(bootstrapAdminPassword)) {
    throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must be configured together');
}

const app = express();
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

async function initAdmin() {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('id')
            .eq('username', bootstrapAdminUsername || 'admin')
            .maybeSingle();

        if (error) {
            console.error('Failed to check for an existing admin account:', error.message);
            return;
        }

        if (!data) {
            if (!bootstrapAdminUsername) {
                console.error('Admin bootstrap skipped: configure ADMIN_USERNAME and ADMIN_PASSWORD.');
                return;
            }

            const hash = await bcrypt.hash(bootstrapAdminPassword, 10);
            const { error: insertError } = await supabase.from('users').insert([{
                username: bootstrapAdminUsername,
                password: hash,
                fullname: bootstrapAdminUsername,
                role: 'admin'
            }]);
            if (insertError) {
                console.error('Failed to create the bootstrap admin account:', insertError.message);
                return;
            }
            console.log('Initial admin account created.');
        } else {
            console.log('Connected to Supabase.');
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
}
initAdmin();

function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') return next();
    res.status(403).json({ error: 'ບໍ່ມີສິດເຂົ້າເຖິງ (ສະເພາະ Admin ເທົ່ານັ້ນ)' });
}

// --- API: สมัครสมาชิก / เข้าสู่ระบบ ---
app.post('/api/register', async (req, res) => {
    const { username, password, fullname } = req.body;
    if (!username || !password || !fullname) {
        return res.status(400).json({ error: 'ກະລຸນາປ້ອນຂໍ້ມູນໃຫ້ຄົບຖ້ວນ' });
    }
    const hash = await bcrypt.hash(password, 10);
    const { error } = await supabase
        .from('users')
        .insert([{ username: username.trim(), password: hash, fullname: fullname.trim() }]);

    if (error) {
        if (error.code === '23505') return res.status(400).json({ error: 'ຊື່ຜູ້ໃຊ້ນີ້ຖືກນຳໃຊ້ແລ້ວ' });
        return res.status(400).json({ error: 'ບັນທຶກບໍ່ສຳເລັດ: ' + error.message });
    }
    res.json({ success: true, message: 'ລົງທະບຽນສຳເລັດ ກະລຸນາເຂົ້າສູ່ລະບົບ' });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('username', (username || '').trim())
        .maybeSingle();

    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'ຊື່ຜູ້ໃຊ້ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ' });
    }
    req.session.user = { id: user.id, username: user.username, fullname: user.fullname, role: user.role };
    res.json({ success: true, role: user.role });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', async (req, res) => {
    if (!req.session.user) return res.json({ loggedIn: false });
    const { data: user } = await supabase
        .from('users')
        .select('id, username, fullname, role, vip_expires_at')
        .eq('id', req.session.user.id)
        .maybeSingle();

    if (!user) return res.json({ loggedIn: false });
    const now = new Date();
    const expires = user.vip_expires_at ? new Date(user.vip_expires_at) : null;
    const isVipActive = user.role === 'admin' || (expires && expires > now);
    const daysLeft = expires && expires > now ? Math.ceil((expires - now) / (1000 * 60 * 60 * 24)) : 0;
    res.json({ loggedIn: true, user, isVipActive, daysLeft });
});

// --- API: ข้อมูลหน้าเว็บหลัก ---
app.get('/api/public-data', async (req, res) => {
    const { data: contacts } = await supabase.from('emergency_contacts').select('*').order('id', { ascending: true });
    const { data: contents } = await supabase.from('contents').select('*').order('id', { ascending: false });

    let isVipActive = false;
    if (req.session.user) {
        if (req.session.user.role === 'admin') {
            isVipActive = true;
        } else {
            const { data: u } = await supabase.from('users').select('vip_expires_at').eq('id', req.session.user.id).maybeSingle();
            isVipActive = u && u.vip_expires_at && new Date(u.vip_expires_at) > new Date();
        }
    }

    const sanitizedContents = (contents || []).map(item => {
        if (item.is_vip && !isVipActive) {
            return {
                ...item,
                body: 'ເນື້ອຫາສ່ວນນີ້ສະຫງວນສິດສະເພາະສະມາຊິກ VIP ກະລຸນາເຂົ້າສູ່ລະບົບ, ເລືອກແພັກເກັດ ແລະ ແຈ້ງໂອນເງິນເພື່ອເປີດນຳໃຊ້',
                locked: true
            };
        }
        return { ...item, locked: false };
    });

    res.json({ contacts: contacts || [], contents: sanitizedContents });
});

// --- API: แจ้งโอนเงิน ---
app.post('/api/payments', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'ກະລຸນາເຂົ້າສູ່ລະບົບກ່ອນ' });
    const { package_days, amount, transfer_note } = req.body;
    if (!transfer_note) return res.status(400).json({ error: 'ກະລຸນາລະບຸລາຍລະອຽດການໂອນເງິນ' });

    const { error } = await supabase.from('payments').insert([{
        user_id: req.session.user.id,
        package_days: parseInt(package_days),
        amount: parseFloat(amount),
        transfer_note: transfer_note.trim()
    }]);

    if (error) return res.status(500).json({ error: 'ບັນທຶກບໍ່ສຳເລັດ: ' + error.message });
    res.json({ success: true, message: 'ສົ່ງຂໍ້ມູນແຈ້ງໂອນເງິນສຳເລັດ ກະລຸນາລໍຖ້າແອັດມິນກວດສອບ ແລະ ເປີດສິດ' });
});

// --- API: ระบบหลังบ้าน (Admin Dashboard) ---
app.get('/api/admin/dashboard', isAdmin, async (req, res) => {
    const { data: users } = await supabase.from('users').select('id, username, fullname, role, vip_expires_at').order('id', { ascending: false });
    const { data: payments } = await supabase.from('payments').select('*').order('id', { ascending: false });
    const { data: contents } = await supabase.from('contents').select('*').order('id', { ascending: false });
    const { data: contacts } = await supabase.from('emergency_contacts').select('*').order('id', { ascending: true });

    const userMap = {};
    (users || []).forEach(u => { userMap[u.id] = u; });

    const linkedPayments = (payments || []).map(p => ({
        ...p,
        users: userMap[p.user_id] || { username: 'ບໍ່ພົບຜູ້ໃຊ້', fullname: '-' }
    }));

    res.json({
        payments: linkedPayments,
        users: users || [],
        contents: contents || [],
        contacts: contacts || []
    });
});

// อนุมัติยอดโอนและเพิ่มวันใช้งาน VIP
app.post('/api/admin/approve-payment/:id', isAdmin, async (req, res) => {
    const paymentId = req.params.id;
    const { data: payment } = await supabase.from('payments').select('*').eq('id', paymentId).maybeSingle();
    if (!payment || payment.status === 'approved') {
        return res.status(400).json({ error: 'ລາຍການບໍ່ຖືກຕ້ອງ ຫຼື ອະນຸມັດໄປແລ້ວ' });
    }

    const { data: user } = await supabase.from('users').select('vip_expires_at').eq('id', payment.user_id).maybeSingle();
    const now = new Date();
    let baseDate = (user && user.vip_expires_at && new Date(user.vip_expires_at) > now) ? new Date(user.vip_expires_at) : now;
    baseDate.setDate(baseDate.getDate() + parseInt(payment.package_days));

    await supabase.from('users').update({ vip_expires_at: baseDate.toISOString() }).eq('id', payment.user_id);
    await supabase.from('payments').update({ status: 'approved' }).eq('id', paymentId);
    res.json({ success: true });
});

// เพิ่มวันใช้งาน VIP โดยตรง
app.post('/api/admin/add-days', isAdmin, async (req, res) => {
    const { user_id, days } = req.body;
    const { data: user } = await supabase.from('users').select('vip_expires_at').eq('id', user_id).maybeSingle();
    const now = new Date();
    let baseDate = (user && user.vip_expires_at && new Date(user.vip_expires_at) > now) ? new Date(user.vip_expires_at) : now;
    baseDate.setDate(baseDate.getDate() + parseInt(days));

    await supabase.from('users').update({ vip_expires_at: baseDate.toISOString() }).eq('id', user_id);
    res.json({ success: true });
});

// --- API: จัดการข่าวสาร / ชุดข้อมูล (เพิ่ม / แก้ไข / ลบ) ---
app.post('/api/admin/contents', isAdmin, async (req, res) => {
    const { title, category, body, is_vip } = req.body;
    const { error } = await supabase.from('contents').insert([{ title, category, body, is_vip: Boolean(is_vip) }]);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
});

app.put('/api/admin/contents/:id', isAdmin, async (req, res) => {
    const { title, category, body, is_vip } = req.body;
    const { error } = await supabase
        .from('contents')
        .update({ title, category, body, is_vip: Boolean(is_vip) })
        .eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
});

app.delete('/api/admin/contents/:id', isAdmin, async (req, res) => {
    const { error } = await supabase.from('contents').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
});

// --- API: จัดการเบอร์โทรฉุกเฉิน (เพิ่ม / ลบ) ---
app.post('/api/admin/contacts', isAdmin, async (req, res) => {
    const { agency, phone, note } = req.body;
    const { error } = await supabase.from('emergency_contacts').insert([{ agency, phone, note }]);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
});

app.delete('/api/admin/contacts/:id', isAdmin, async (req, res) => {
    const { error } = await supabase.from('emergency_contacts').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));