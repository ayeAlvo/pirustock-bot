require("dotenv").config();
const { Telegraf } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

const { google } = require("googleapis");

// Autenticación con Google
const auth = new google.auth.GoogleAuth({
  keyFile: "service-account.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// Función para leer la sheet
async function getStock() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: "A:B",
  });

  return res.data.values || [];
}

bot.command("stock", async (ctx) => {
  try {
    const rows = await getStock();

    // convertir la tabla en texto
    let respuesta = "📦 *Stock actual:*\n\n";
    rows.forEach((row) => {
      respuesta += `• ${row[0]}: ${row[1]}\n`;
    });

    ctx.reply(respuesta, { parse_mode: "Markdown" });
  } catch (err) {
    // console.error(err);
    console.error("🔥 ERROR GOOGLE API:", err.response?.data || err.message || err);
    ctx.reply("❌ Error leyendo la lista de stock.");
  }
});

bot.command("agregar", async (ctx) => {
  try {
    const partes = ctx.message.text.split(" ");

    if (partes.length < 3) {
      return ctx.reply("Usá: /agregar producto cantidad");
    }

    const producto = partes[1];
    const cantidad = Number(partes[2]);

    if (isNaN(cantidad)) {
      return ctx.reply("La cantidad debe ser un número.");
    }

    const result = await updateStock(producto, cantidad);

    if (result.creado) {
      return ctx.reply(`🆕 El producto *${producto}* no existía y fue agregado con cantidad *${cantidad}*`, { parse_mode: "Markdown" });
}

    ctx.reply(`✅ ${producto} ahora tiene ${result.nuevaCantidad}`);
  } catch (err) {
    console.error(err);
    ctx.reply("❌ Error al actualizar stock.");
  }
});

bot.command("sacar", async (ctx) => {
  try {
    const partes = ctx.message.text.split(" ");

    if (partes.length < 3) {
      return ctx.reply("Usá: /sacar producto cantidad");
    }

    const producto = partes[1];
    const cantidad = Number(partes[2]);

    if (isNaN(cantidad)) {
      return ctx.reply("La cantidad debe ser un número.");
    }

    const result = await removeStock(producto, cantidad);

    if (result.error === "not_found") {
      return ctx.reply("❌ Producto no encontrado.");
    }

    if (result.ajuste) {
      return ctx.reply(
        `⚠️ No había suficiente stock de *${producto}*.\n` +
        `Se ajustó a *0* (antes: ${result.cantidadActual}).`,
        { parse_mode: "Markdown" }
      );
    }

    ctx.reply(
      `🟡 Se descontaron ${cantidad} de *${producto}*.\n` +
      `Nuevo stock: *${result.nuevaCantidad}*`,
      { parse_mode: "Markdown" }
    );

  } catch (err) {
    console.error(err);
    ctx.reply("❌ Error al actualizar stock.");
  }
});

bot.command("eliminar", async (ctx) => {
  try {
    const partes = ctx.message.text.split(" ");

    if (partes.length < 3 || partes[2] !== "confirmar") {
      return ctx.reply(
        "⚠️ Para eliminar un producto usá:\n/eliminar producto confirmar"
      );
    }

    const producto = partes[1];

    const result = await deleteProduct(producto);

    if (result.error === "not_found") {
      return ctx.reply("❌ Producto no encontrado.");
    }

    ctx.reply(`🗑️ Producto *${producto}* eliminado del stock.`, {
      parse_mode: "Markdown",
    });

  } catch (err) {
    console.error(err);
    ctx.reply("❌ Error al eliminar producto.");
  }
});

async function updateStock(producto, cantidad) {
  // Obtenemos toda la sheet con headers incluidos
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: "A:B",
  });

  const rows = res.data.values || [];

  let filaReal = -1;

  // Buscamos la fila real en toda la sheet (incluye huecos)
  rows.forEach((row, index) => {
    const nombre = row[0]?.trim().toLowerCase();
    if (nombre === producto.toLowerCase()) {
      filaReal = index + 1; // A1 = fila 1
    }
  });

  // 🆕 Si no existe → lo creamos al final
  if (filaReal === -1) {
    const nuevaFila = rows.length + 1;

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range: `A${nuevaFila}:B${nuevaFila}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[producto, cantidad]],
      },
    });

    return {
      producto,
      nuevaCantidad: cantidad,
      creado: true,
    };
  }

  // Si existe, sumamos cantidad
  const cantidadActual = Number(rows[filaReal - 1][1]) || 0;
  const nuevaCantidad = cantidadActual + cantidad;

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SHEET_ID,
    range: `B${filaReal}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[nuevaCantidad]],
    },
  });

  return { producto, nuevaCantidad, creado: false };
}

async function removeStock(producto, cantidad) {
  // Obtenemos toda la sheet con headers incluidos
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: "A:B",
  });

  const rows = res.data.values || [];
  let filaReal = -1;

  // Buscar la fila real (incluye headers)
  rows.forEach((row, index) => {
    const nombre = row[0]?.trim().toLowerCase();
    if (nombre === producto.toLowerCase()) {
      filaReal = index + 1;
    }
  });

  if (filaReal === -1) {
    return { error: "not_found" };
  }

  const cantidadActual = Number(rows[filaReal - 1][1]) || 0;
  let nuevaCantidad = cantidadActual - cantidad;
  let ajuste = false;

  // Si queda negativo → lo dejamos en 0
  if (nuevaCantidad < 0) {
    nuevaCantidad = 0;
    ajuste = true;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SHEET_ID,
    range: `B${filaReal}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[nuevaCantidad]],
    },
  });

  return {
    producto,
    nuevaCantidad,
    ajuste,
    cantidadActual,
  };
}

async function deleteProduct(producto) {
  // 1. Traemos todas las filas
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: "A:B",
  });

  const rows = res.data.values || [];

  let filaReal = -1; // fila de Sheets (1-based)

  rows.forEach((row, index) => {
    const nombre = row[0]?.trim().toLowerCase();

    if (nombre === producto.toLowerCase()) {
      filaReal = index + 1; // +1 porque Sheets arranca en 1
    }
  });

  if (filaReal === -1) {
    return { error: "not_found" };
  }

  // 2. Borrar FÍSICAMENTE la fila usando batchUpdate
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: process.env.SHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: 0,          // HOJA PRINCIPAL (si es la primera)
              dimension: "ROWS",
              startIndex: filaReal - 1, // 0-based
              endIndex: filaReal,       // no inclusive
            },
          },
        },
      ],
    },
  });

  return { producto };
}

// responde si no es un comando
bot.on("text", (ctx) => {
  if (!ctx.message.text.startsWith("/")) {
    ctx.reply("Bot online ✔");
  }
});

bot.launch();
console.log("Bot iniciado...");