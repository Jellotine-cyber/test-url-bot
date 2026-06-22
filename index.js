// This listener maps directly to the /save menu option you set up in BotFather
bot.command('save', async (ctx) => {
    // parse command arguments: /save nickname url
    const args = ctx.message.text.split(/\s+/);
    const nickname = args[1];
    let url = args[2];

    if (!nickname || !url) {
        return ctx.reply("⚠️ Format: /save [nickname] [url]");
    }

    // normalize URL to https if protocol is missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
    }

    await kv.hset(`user:${ctx.chat.id}:sites`, { [nickname.toLowerCase()]: url });
    await ctx.reply(`💾 Saved shortcut *${nickname.toLowerCase()}*!`, { parse_mode: 'Markdown' });
});
// This listener maps directly to the /savedurls menu option you set up in BotFather
bot.command('savedurl', async (ctx) => {
    // load saved URLs for this chat/user
    const sites = await kv.hgetall(`user:${ctx.chat.id}:sites`);

    if (!sites || Object.keys(sites).length === 0) {
        return ctx.reply("No saved URLs yet. Use /save [nickname] [url]");
    }

    const lines = Object.entries(sites).map(
        ([name, url]) => `*${name}* -> ${url}`
    );

    await ctx.reply(`Saved URLs:\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
});
// This listener maps directly to the /check menu option you set up in BotFather
bot.command('check', async (ctx) => {
    // retrieve saved URLs and validate each one
    const sites = await kv.hgetall(`user:${ctx.chat.id}:sites`);

    if (!sites || Object.keys(sites).length === 0) {
        return ctx.reply("No saved URLs to check. Use /save first.");
    }

    const results = await Promise.all(
        Object.entries(sites).map(async ([name, url]) => {
            try {
                const res = await fetch(url, { method: 'GET', redirect: 'follow' });

                if (res.status === 200) {
                    return `Connection to ${url} is successful with status '200'`;
                }

                return `Connection to ${url} failed with status '${res.status}' with reason: ${res.statusText || 'Unknown'}`;
            } catch (err) {
                // network issue or invalid URL
                return `Connection to ${url} failed with status 'error' with reason: ${err.message}`;
            }
        })
    );

    await ctx.reply(results.join('\n'), { disable_web_page_preview: true });
});
// ...existing code...