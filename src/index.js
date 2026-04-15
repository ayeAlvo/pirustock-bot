require("dotenv").config();
const { Telegraf } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

// Test: responder a cualquier mensaje
bot.on("text", (ctx) => {
  ctx.reply("Bot online ✔");
});

bot.launch();
console.log("Bot iniciado...");