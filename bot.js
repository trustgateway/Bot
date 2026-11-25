require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const session = require('express-session');

// ============================================
// 1. ഡാറ്റ (പ്രൊഡക്ഷനിൽ MongoDB ഉപയോഗിക്കുക)
// ============================================
const users = {}; // { telegramId: { balance, completed } }
const tasks = [
    { id: 1, title: 'ഉദാഹരണ ടാസ്ക് 1', reward: 10 },
    { id: 2, title: 'ഉദാഹരണ ടാസ്ക് 2', reward: 20 }
];
const pendingDeposits = []; // മാനുവൽ UPI അംഗീകാരത്തിന്

// ============================================
// 2. അഡ്മിൻ ക്രെഡൻഷ്യലുകൾ
// ============================================
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(Number);

// ============================================
// 3. Telegram ബോട്ട് (Telegraf)
// ============================================
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
    const id = ctx.from.id;
    if (!users[id]) users[id] = { balance: 0, completed: [] };
    ctx.reply(
        `സ്വാഗതം ${ctx.from.first_name}! 👋\nബാലൻസ്: ₹${users[id].balance}`,
        Markup.keyboard([['📋 ടാസ്കുകൾ', '💰 ബാലൻസ്']]).resize()
    );
});

bot.hears('📋 ടാസ്കുകൾ', (ctx) => {
    if (tasks.length === 0) return ctx.reply('ഇപ്പോൾ ടാസ്കുകൾ ഇല്ല.');
    tasks.forEach((t) => {
        ctx.reply(
            `ടാസ്ക്: ${t.title}\nപ്രതിഫലം: ₹${t.reward}`,
            Markup.inlineKeyboard([Markup.button.callback('✅ പൂർത്തിയാക്കി', `complete_${t.id}`)])
        );
    });
});

bot.action(/complete_(\d+)/, async (ctx) => {
    const taskId = parseInt(ctx.match[1]);
    const userId = ctx.from.id;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return ctx.answerCbQuery('ടാസ്ക് കണ്ടെത്തിയില്ല');
    if (!users[userId]) users[userId] = { balance: 0, completed: [] };
    if (users[userId].completed.includes(taskId)) return ctx.answerCbQuery('ഇത് ഇതിനകം പൂർത്തിയാക്കി');

    users[userId].balance += task.reward;
    users[userId].completed.push(taskId);
    await ctx.answerCbQuery('✅ പൂർത്തിയായി!');
    await ctx.reply(`₹${task.reward} ബാലൻസിൽ ചേർത്തു. ആകെ: ₹${users[userId].balance}`);
});

bot.hears('💰 ബാലൻസ്', (ctx) => {
    const id = ctx.from.id;
    ctx.reply(`നിങ്ങളുടെ ബാലൻസ്: ₹${users[id] ? users[id].balance : 0}`);
});

// അഡ്മിൻ കമാൻഡ്: ടാസ്ക് ചേർക്കുക (Telegram-ൽ നിന്ന് തന്നെ)
bot.command('addtask', (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id)) return;
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) return ctx.reply('ഉപയോഗം: /addtask <title> <reward>');
    tasks.push({ id: Date.now(), title: args[0], reward: Number(args[1]) });
    ctx.reply(`✅ ടാസ്ക് ചേർത്തു: ${args[0]} (₹${args[1]})`);
});

// ============================================
// 4. അഡ്മിൻ പാനൽ (Express) — അതേ ഫയലിൽ
// ============================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'default-secret',
    resave: false,
    saveUninitialized: false
}));

app.get('/admin/login', (req, res) => {
    res.send(`
        <html><body style="font-family:sans-serif;padding:50px;background:#f4f4f4;">
        <div style="max-width:300px;margin:auto;background:white;padding:30px;border-radius:8px;">
            <h2>Admin Login</h2>
            <form method="POST" action="/admin/login">
                <input name="username" placeholder="Username" required style="width:100%;padding:8px;margin:5px 0;" /><br>
                <input name="password" type="password" placeholder="Password" required style="width:100%;padding:8px;margin:5px 0;" /><br>
                <button type="submit" style="width:100%;padding:10px;background:#007bff;color:white;border:none;margin-top:10px;">Login</button>
            </form>
        </div></body></html>
    `);
});

app.post('/admin/login', (req, res) => {
    if (req.body.username === ADMIN_USER && req.body.password === ADMIN_PASS) {
        req.session.admin = true;
        res.redirect('/admin');
    } else {
        res.send('Invalid credentials. <a href="/admin/login">Try again</a>');
    }
});

function requireAdmin(req, res, next) {
    if (req.session.admin) return next();
    res.redirect('/admin/login');
}

app.get('/admin', requireAdmin, (req, res) => {
    res.send(`
        <html><body style="font-family:sans-serif;padding:50px;">
        <h1>📊 Jayesh Payment Bot - Admin</h1>
        <p>Users: ${Object.keys(users).length} | Tasks: ${tasks.length} | Pending Deposits: ${pendingDeposits.length}</p>
        <ul>
            <li><a href="/admin/tasks">ടാസ്ക് മാനേജ്മെന്റ്</a></li>
            <li><a href="/admin/deposits">പെൻഡിംഗ് ഡെപ്പോസിറ്റുകൾ</a></li>
        </ul>
        <a href="/admin/logout">Logout</a>
        </body></html>
    `);
});

app.get('/admin/tasks', requireAdmin, (req, res) => {
    res.send(`
        <html><body style="font-family:sans-serif;padding:50px;">
        <h2>Tasks</h2>
        <form method="POST" action="/admin/tasks">
            <input name="title" placeholder="Task Title" required />
            <input name="reward" type="number" placeholder="Reward ₹" required />
            <button type="submit">Add Task</button>
        </form>
        <ul>${tasks.map(t => `<li>${t.title} - ₹${t.reward}</li>`).join('')}</ul>
        <a href="/admin">Back</a>
        </body></html>
    `);
});

app.post('/admin/tasks', requireAdmin, (req, res) => {
    tasks.push({ id: Date.now(), title: req.body.title, reward: Number(req.body.reward) });
    res.redirect('/admin/tasks');
});

app.get('/admin/deposits', requireAdmin, (req, res) => {
    res.send(`
        <html><body style="font-family:sans-serif;padding:50px;">
        <h2>Pending Deposits</h2>
        <table border="1" cellpadding="8">
            <tr><th>User ID</th><th>Amount</th><th>UTR</th><th>Action</th></tr>
            ${pendingDeposits.map((d, i) => `
                <tr>
                    <td>${d.userId}</td><td>₹${d.amount}</td><td>${d.utr}</td>
                    <td>
                        <form method="POST" action="/admin/deposit/${i}/approve" style="display:inline"><button>Approve</button></form>
                        <form method="POST" action="/admin/deposit/${i}/reject" style="display:inline"><button>Reject</button></form>
                    </td>
                </tr>
            `).join('')}
        </table>
        <a href="/admin">Back</a>
        </body></html>
    `);
});

app.post('/admin/deposit/:index/approve', requireAdmin, (req, res) => {
    const d = pendingDeposits[req.params.index];
    if (d) {
        if (!users[d.userId]) users[d.userId] = { balance: 0, completed: [] };
        users[d.userId].balance += d.amount;
        pendingDeposits.splice(req.params.index, 1);
    }
    res.redirect('/admin/deposits');
});

app.post('/admin/deposit/:index/reject', requireAdmin, (req, res) => {
    pendingDeposits.splice(req.params.index, 1);
    res.redirect('/admin/deposits');
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// ============================================
// 5. രണ്ടും ഒരുമിച്ച് സ്റ്റാർട്ട് ചെയ്യുക
// ============================================
app.listen(PORT, () => {
    console.log(`✅ അഡ്മിൻ പാനൽ: http://localhost:${PORT}/admin/login`);
});

bot.launch().then(() => {
    console.log('✅ ബോട്ട് സ്റ്റാർട്ട് ചെയ്തു');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
